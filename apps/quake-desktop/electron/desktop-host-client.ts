/**
 * Persistent PowerShell desktop host client (JSON line protocol).
 * Keeps SendInput helpers warm — avoids 0.5–2s cold start per action.
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

type HostResponse = {
	id?: string;
	ok?: boolean;
	ready?: boolean;
	detail?: Record<string, unknown>;
	error?: string;
};

type Pending = {
	resolve: (value: Record<string, unknown>) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

let child: ChildProcessWithoutNullStreams | null = null;
let buffer = "";
let seq = 0;
const pending = new Map<string, Pending>();
let starting: Promise<void> | null = null;

function hostScriptPath(): string {
	// Dev: electron/desktop-host/host.ps1 next to compiled dist/electron
	const candidates = [
		path.join(__dirname, "desktop-host", "host.ps1"),
		path.join(__dirname, "..", "electron", "desktop-host", "host.ps1"),
		path.join(process.cwd(), "electron", "desktop-host", "host.ps1"),
		path.join(process.cwd(), "dist", "electron", "desktop-host", "host.ps1"),
	];
	for (const p of candidates) {
		if (existsSync(p)) return p;
	}
	throw new Error(`desktop-host/host.ps1 not found (tried: ${candidates.join(", ")})`);
}

function clearChild(err?: Error): void {
	if (child) {
		try {
			child.kill();
		} catch {
			/* ignore */
		}
	}
	child = null;
	buffer = "";
	for (const [, p] of pending) {
		clearTimeout(p.timer);
		p.reject(err ?? new Error("Desktop host exited"));
	}
	pending.clear();
	starting = null;
}

function handleLine(line: string): void {
	const trimmed = line.trim();
	if (!trimmed) return;
	let msg: HostResponse;
	try {
		msg = JSON.parse(trimmed) as HostResponse;
	} catch {
		return;
	}
	if (msg.ready && !msg.id) return; // boot handshake
	const id = msg.id;
	if (!id || !pending.has(id)) return;
	const p = pending.get(id)!;
	pending.delete(id);
	clearTimeout(p.timer);
	if (msg.ok === false) {
		p.reject(new Error(msg.error || "Desktop host action failed"));
		return;
	}
	p.resolve((msg.detail ?? {}) as Record<string, unknown>);
}

async function ensureHost(): Promise<void> {
	if (child && !child.killed) return;
	if (starting) return starting;
	starting = new Promise<void>((resolve, reject) => {
		try {
			const script = hostScriptPath();
			const proc = spawn(
				"powershell.exe",
				["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
				{
					windowsHide: true,
					stdio: ["pipe", "pipe", "pipe"],
				},
			);
			child = proc;
			let ready = false;
			const bootTimer = setTimeout(() => {
				if (!ready) {
					clearChild(new Error("Desktop host failed to become ready"));
					reject(new Error("Desktop host failed to become ready"));
				}
			}, 45_000);

			proc.stdout.setEncoding("utf8");
			proc.stdout.on("data", (chunk: string) => {
				buffer += chunk;
				let idx: number;
				while ((idx = buffer.indexOf("\n")) >= 0) {
					const line = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 1);
					// First ready line
					if (!ready) {
						try {
							const msg = JSON.parse(line.trim()) as HostResponse;
							if (msg.ready || msg.ok) {
								ready = true;
								clearTimeout(bootTimer);
								resolve();
								continue;
							}
						} catch {
							/* fall through */
						}
					}
					handleLine(line);
				}
			});
			proc.stderr.setEncoding("utf8");
			proc.stderr.on("data", () => {
				/* host may write noise; ignore unless no responses */
			});
			proc.on("exit", () => {
				const wasReady = ready;
				clearChild(new Error("Desktop host process exited"));
				if (!wasReady) {
					clearTimeout(bootTimer);
					reject(new Error("Desktop host exited during startup"));
				}
			});
			proc.on("error", (err) => {
				clearTimeout(bootTimer);
				clearChild(err);
				reject(err);
			});
		} catch (err) {
			starting = null;
			reject(err instanceof Error ? err : new Error(String(err)));
		}
	});
	try {
		await starting;
	} finally {
		// keep starting null only after failure via clearChild; on success keep child
		if (child) starting = null;
	}
}

export async function hostRequest(
	action: string,
	params: Record<string, unknown> = {},
	timeoutMs = 45_000,
): Promise<Record<string, unknown>> {
	if (process.platform !== "win32") {
		throw new Error("Desktop actuation is currently supported on Windows only.");
	}
	await ensureHost();
	if (!child?.stdin) throw new Error("Desktop host stdin unavailable");

	const id = `r${++seq}`;
	const payload = JSON.stringify({ id, action, ...params });

	return new Promise<Record<string, unknown>>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`Desktop host timeout (${action})`));
		}, timeoutMs);
		pending.set(id, { resolve, reject, timer });
		try {
			child!.stdin.write(`${payload}\n`);
		} catch (err) {
			clearTimeout(timer);
			pending.delete(id);
			clearChild(err instanceof Error ? err : new Error(String(err)));
			reject(err instanceof Error ? err : new Error(String(err)));
		}
	});
}

export function stopDesktopHost(): void {
	clearChild();
}

export function isDesktopHostRunning(): boolean {
	return Boolean(child && !child.killed);
}
