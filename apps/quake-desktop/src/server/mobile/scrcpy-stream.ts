import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { existsSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import { delimiter, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { WebAuth } from "../auth.js";

interface StreamSession {
  deviceId: string;
  process: ChildProcessByStdio<null, Readable, Readable>;
  clients: Set<WebSocket>;
  profile: string;
}

function executableName(): string { return process.platform === "win32" ? "scrcpy.exe" : "scrcpy"; }

export function resolveScrcpyExecutable(): string | undefined {
  const explicit = process.env.QUAKE_SCRCPY_PATH;
  const candidates = [explicit, ...(process.env.PATH || "").split(delimiter).map((directory) => join(directory, executableName()))].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate));
}

function loopback(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function attachMobileStreamWebSocket(server: Server, auth: WebAuth) {
  const sessions = new Map<string, StreamSession>();
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => protocols.has("quake-mobile-h264") ? "quake-mobile-h264" : false });

  function stop(session: StreamSession): void {
    sessions.delete(session.deviceId);
    try { session.process.kill(); } catch { /* exited */ }
  }

  function create(deviceId: string, profile: string): StreamSession {
    if (process.env.QUAKE_MOBILE_SCRCPY === "0") throw new Error("scrcpy feature flag kapalı; screenshot fallback kullanılıyor");
    const executable = resolveScrcpyExecutable();
    if (!executable) throw new Error("scrcpy bulunamadı; QUAKE_SCRCPY_PATH ayarlayın veya scrcpy kurun");
    const settings = profile === "quality" ? { size: "1920", bitrate: "12M", fps: "60" } : profile === "data" ? { size: "720", bitrate: "2M", fps: "24" } : { size: "1280", bitrate: "6M", fps: "45" };
    // scrcpy 3.x can emit raw H.264 to stdout. Control remains on the semantic/action API.
    const processHandle = spawn(executable, ["--serial", deviceId, "--no-audio", "--no-control", "--no-window", "--video-codec=h264", "--video-format=h264", `--max-size=${settings.size}`, `--video-bit-rate=${settings.bitrate}`, `--max-fps=${settings.fps}`, "--record=-"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const session: StreamSession = { deviceId, process: processHandle, clients: new Set(), profile };
    sessions.set(deviceId, session);
    processHandle.stdout.on("data", (chunk: Buffer) => { for (const client of session.clients) if (client.readyState === client.OPEN) client.send(chunk, { binary: true }); });
    processHandle.stderr.on("data", (chunk: Buffer) => { const message = JSON.stringify({ type: "diagnostic", message: chunk.toString("utf8").slice(-1000) }); for (const client of session.clients) if (client.readyState === client.OPEN) client.send(message); });
    processHandle.once("exit", () => { for (const client of session.clients) client.close(1011, "scrcpy stream ended"); sessions.delete(deviceId); });
    return session;
  }

  server.on("upgrade", (req, socket, head) => {
    let url: URL;
    try { url = new URL(req.url || "", "http://localhost"); } catch { return; }
    if (url.pathname !== "/api/mobile/stream") return;
    if (!loopback(req) || !auth.isAuthorized(req, url)) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", "http://localhost");
    const deviceId = url.searchParams.get("deviceId") || "";
    const profile = url.searchParams.get("profile") || "balanced";
    if (!/^[a-zA-Z0-9._:-]+$/.test(deviceId)) { ws.close(1008, "invalid device"); return; }
    try {
      const session = sessions.get(deviceId) || create(deviceId, profile);
      session.clients.add(ws);
      ws.once("close", () => { session.clients.delete(ws); if (!session.clients.size) setTimeout(() => { if (!session.clients.size) stop(session); }, 3_000); });
    } catch (reason) { ws.close(1011, reason instanceof Error ? reason.message : "stream failed"); }
  });

  return { available: () => Boolean(resolveScrcpyExecutable()), close: () => { for (const session of sessions.values()) stop(session); wss.close(); } };
}
