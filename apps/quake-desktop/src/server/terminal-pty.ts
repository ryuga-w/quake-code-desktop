import type { Server, IncomingMessage } from "node:http";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { spawn as ptySpawn, type IPty } from "node-pty";
import type { WebAuth } from "./auth.js";

const IS_WIN = process.platform === "win32";
const MAX_COLS = 500;
const MAX_ROWS = 200;
const MAX_INPUT_CHARS = 64 * 1024;
const REPLAY_LIMIT = 512 * 1024;
const DETACHED_TTL_MS = 5 * 60_000;
const SESSION_ID_RE = /^[a-zA-Z0-9._-]{1,100}$/;

export type TerminalProfile = "default" | "powershell" | "cmd" | "bash" | "zsh";

type ClientMessage =
  | { t: "i"; d: string }
  | { t: "r"; c: number; r: number }
  | { t: "kill" };

type TerminalSession = {
  id: string;
  pty: IPty;
  profile: TerminalProfile;
  shellLabel: string;
  cwd: string;
  clients: Set<WebSocket>;
  replay: string;
  exited: boolean;
  exitCode?: number;
  detachedAt?: number;
};

export interface TerminalPtyServer {
  dispose(): void;
  sessionCount(): number;
}

function clampDimension(value: string | number | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(2, Math.floor(parsed)));
}

function pickShell(profile: TerminalProfile): { file: string; args: string[]; label: string } {
  if (IS_WIN) {
    if (profile === "cmd") return { file: "cmd.exe", args: ["/d"], label: "Command Prompt" };
    if (profile === "bash") return { file: "bash.exe", args: ["--login"], label: "Bash" };
    return { file: "powershell.exe", args: ["-NoLogo"], label: "PowerShell" };
  }
  if (profile === "zsh") return { file: "/bin/zsh", args: ["-l"], label: "Zsh" };
  if (profile === "bash") return { file: "/bin/bash", args: ["-l"], label: "Bash" };
  const shell = process.env.SHELL || "/bin/bash";
  return { file: shell, args: ["-l"], label: shell.split("/").pop() || "Shell" };
}

function parseProfile(value: string | null): TerminalProfile {
  if (value === "powershell" || value === "cmd" || value === "bash" || value === "zsh") return value;
  return "default";
}

function isLoopback(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function appendReplay(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length <= REPLAY_LIMIT ? next : next.slice(-REPLAY_LIMIT);
}

/**
 * Honest isolation notice for interactive PTY (S-OS.3).
 * PTY is host `node-pty` — not OsSandboxBackend, not worktree-scoped, not TerminalPolicy.
 * There is no discrete "run command" channel (only raw keystroke `i`), so regex
 * TerminalPolicy cannot be applied without breaking interactive shells.
 */
export const PTY_ISOLATION_NOTICE_TR =
  "Uyarı: Etkileşimli terminal OS sandboxed değildir; ajan worktree izolasyonunu atlayabilir.";

/**
 * Interactive terminal server. Sessions survive panel remounts and short socket
 * interruptions; an explicit tab close kills the PTY. Interactive PTYs are
 * unrestricted on localhost by design (no OS sandbox / TerminalPolicy), while
 * remote use requires an explicit QUAKE_WEB_TERMINAL_REMOTE=1 opt-in.
 */
export function attachTerminalWebSocket(server: Server, opts: {
  getCwd: () => string;
  auth: WebAuth;
  isEnabled?: () => boolean;
  allowRemote?: boolean;
}): TerminalPtyServer {
  const sessions = new Map<string, TerminalSession>();
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => protocols.has("quake-terminal") ? "quake-terminal" : false,
  });

  function closeSession(session: TerminalSession): void {
    sessions.delete(session.id);
    for (const client of session.clients) {
      try { client.close(1000, "terminal session closed"); } catch { /* already closed */ }
    }
    session.clients.clear();
    if (!session.exited) {
      try { session.pty.kill(); } catch { /* already exited */ }
    }
  }

  function createSession(id: string, profile: TerminalProfile, cols: number, rows: number): TerminalSession {
    const cwd = opts.getCwd();
    const shell = pickShell(profile);
    const pty = ptySpawn(shell.file, shell.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>,
      // ConPTY helper is unstable in some console-less Windows runtimes.
      // node-pty's WinPTY fallback is slower but deterministic here.
      useConpty: false,
    });
    const session: TerminalSession = {
      id,
      pty,
      profile,
      shellLabel: shell.label,
      cwd,
      clients: new Set(),
      replay: "",
      exited: false,
    };
    sessions.set(id, session);
    pty.onData((data) => {
      session.replay = appendReplay(session.replay, data);
      for (const client of session.clients) send(client, { t: "o", d: data });
    });
    pty.onExit(({ exitCode }) => {
      session.exited = true;
      session.exitCode = exitCode;
      for (const client of session.clients) send(client, { t: "x", code: exitCode });
    });
    return session;
  }

  server.on("upgrade", (req, socket, head) => {
    let url: URL;
    try { url = new URL(req.url || "", "http://localhost"); } catch { return; }
    if (url.pathname !== "/api/terminal") return;
    if (opts.isEnabled && !opts.isEnabled()) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!opts.allowRemote && !isLoopback(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!opts.auth.isAuthorized(req, url)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || "", "http://localhost");
    const requestedId = url.searchParams.get("session") || "";
    if (!SESSION_ID_RE.test(requestedId)) {
      send(ws, { t: "e", message: "Geçersiz terminal oturumu" });
      ws.close(1008, "invalid session");
      return;
    }
    const cols = clampDimension(url.searchParams.get("cols") || undefined, 80, MAX_COLS);
    const rows = clampDimension(url.searchParams.get("rows") || undefined, 24, MAX_ROWS);
    const profile = parseProfile(url.searchParams.get("profile"));
    let session = sessions.get(requestedId);
    try {
      if (!session || session.exited) {
        if (session) closeSession(session);
        session = createSession(requestedId, profile, cols, rows);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(ws, { t: "e", message: `Terminal başlatılamadı: ${message}` });
      ws.close(1011, "spawn failed");
      return;
    }

    session.clients.add(ws);
    session.detachedAt = undefined;
    // S-OS.3: surface isolation honesty on every connect (client shows once per tab).
    send(ws, {
      t: "ready",
      session: session.id,
      cwd: session.cwd,
      shell: session.shellLabel,
      profile: session.profile,
      isolation: "host",
      notice: PTY_ISOLATION_NOTICE_TR,
    });
    if (session.replay) send(ws, { t: "replay", d: session.replay });
    try { session.pty.resize(cols, rows); } catch { /* process may have exited */ }

    ws.on("message", (raw) => {
      const rawSize = Array.isArray(raw) ? raw.reduce((total, chunk) => total + chunk.byteLength, 0) : raw.byteLength;
      if (rawSize > MAX_INPUT_CHARS * 2) {
        ws.close(1009, "message too large");
        return;
      }
      let message: ClientMessage;
      try { message = JSON.parse(raw.toString()) as ClientMessage; } catch { return; }
      if (message.t === "i" && typeof message.d === "string" && message.d.length <= MAX_INPUT_CHARS) {
        if (!session.exited) session.pty.write(message.d);
      } else if (message.t === "r") {
        const nextCols = clampDimension(message.c, cols, MAX_COLS);
        const nextRows = clampDimension(message.r, rows, MAX_ROWS);
        try { session.pty.resize(nextCols, nextRows); } catch { /* process may have exited */ }
      } else if (message.t === "kill") {
        closeSession(session);
      }
    });

    ws.on("close", () => {
      session.clients.delete(ws);
      if (session.clients.size === 0) session.detachedAt = Date.now();
    });
  });

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (session.clients.size === 0 && session.detachedAt && now - session.detachedAt >= DETACHED_TTL_MS) closeSession(session);
    }
  }, 30_000);
  cleanupTimer.unref();

  return {
    dispose() {
      clearInterval(cleanupTimer);
      for (const session of [...sessions.values()]) closeSession(session);
      wss.close();
    },
    sessionCount: () => sessions.size,
  };
}
