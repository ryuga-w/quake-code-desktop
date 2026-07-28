import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { TerminalPolicy } from "./terminal-policy.js";

export interface TerminalRunOptions {
  id?: string;
  timeoutMs?: number;
  onStart?: (command: string) => void;
  onOutput?: (stream: "stdout" | "stderr", text: string) => void;
}

export interface TerminalRunResult {
  command: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

/**
 * One-shot terminal runner (`POST /api/terminal/run`).
 * Always applies {@link TerminalPolicy} before host spawn — not OS-sandboxed.
 * Distinct from interactive PTY (`terminal-pty.ts`), which has no policy gate.
 */
export class WebTerminalService {
  private readonly active = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(
    private readonly cwd: string,
    private readonly policy = new TerminalPolicy(),
  ) {}

  stop(id: string): boolean {
    const child = this.active.get(id);
    if (!child) return false;
    child.kill("SIGTERM");
    return true;
  }

  run(command: string, timeoutOrOptions: number | TerminalRunOptions = 30_000): Promise<TerminalRunResult> {
    const options: TerminalRunOptions = typeof timeoutOrOptions === "number" ? { timeoutMs: timeoutOrOptions } : timeoutOrOptions;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const trimmed = command.trim();
    if (!trimmed) throw new Error("Komut boş");
    if (trimmed.length > 4_000) throw new Error("Komut çok uzun");
    // TerminalPolicy (safe / allow-all / disabled) — required for one-shot path.
    const decision = this.policy.check(trimmed);
    if (!decision.allowed) throw new Error(decision.reason ?? "Komut terminal politikası tarafından engellendi");

    const started = Date.now();
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", trimmed] : ["-lc", trimmed];

    return new Promise((resolve, reject) => {
      options.onStart?.(trimmed);
      const child = spawn(shell, args, { cwd: this.cwd, windowsHide: true, env: process.env });
      if (options.id) this.active.set(options.id, child);
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const limit = 256 * 1024;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, Math.min(Math.max(timeoutMs, 1_000), 120_000));

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        options.onOutput?.("stdout", text);
        stdout += text;
        if (stdout.length > limit) stdout = stdout.slice(-limit);
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        options.onOutput?.("stderr", text);
        stderr += text;
        if (stderr.length > limit) stderr = stderr.slice(-limit);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (options.id) this.active.delete(options.id);
        reject(error);
      });
      child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        if (options.id) this.active.delete(options.id);
        resolve({ command: trimmed, exitCode, signal, stdout, stderr, durationMs: Date.now() - started, timedOut });
      });
    });
  }
}
