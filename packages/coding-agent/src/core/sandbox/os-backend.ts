/**
 * Pluggable OS sandbox backend (Codex Windows restricted-token / elevated is native).
 * Default = host spawn. Experimental flag fails closed without a real helper.
 *
 * S-OS.1: external helper probe + JSON-line execute protocol (MVP helper).
 * Probe/execute via helper does **not** mean RestrictedToken isolation.
 * isolation: "mvp-helper" = env strip + FS root checks + process-tree kill — not Job Object / RT.
 *
 * See apps/quake-desktop/docs/CODEX_WINDOWS_SANDBOX.md
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { waitForChildProcess } from "../../utils/child-process.js";
import { killProcessTree } from "../../utils/shell.js";

export type OsSandboxMode = "off" | "experimental";

/** CLI flag a helper must accept and exit 0 for discovery (T1.P2 / S-OS.1). */
export const OS_SANDBOX_PROBE_ARG = "--quake-sandbox-probe";

/** Default probe timeout (ms). */
export const OS_SANDBOX_PROBE_TIMEOUT_MS = 3_000;

/** Extra grace after timeoutMs for helper IPC teardown (ms). */
export const OS_SANDBOX_HELPER_IPC_GRACE_MS = 5_000;

/**
 * Isolation label returned by the Node MVP helper.
 * Not RestrictedToken / elevated ACL — do not market as full OS sandbox.
 */
export const OS_SANDBOX_ISOLATION_MVP_HELPER = "mvp-helper" as const;

/**
 * Capability bits from helper probe JSON (honest flags).
 * `restrictedToken` / `jobObject` stay false until a native runner implements them.
 */
export interface OsSandboxHelperCapabilities {
	restrictedToken: boolean;
	jobObject: boolean;
	/** Helper validates cwd (and optional strict-FS path heuristics) against workspaceRoots. */
	fsRoots: boolean;
}

/** Detailed probe result (exit 0 + optional capability JSON on stdout). */
export interface OsSandboxHelperProbeResult {
	ok: boolean;
	isolation?: string;
	capabilities?: OsSandboxHelperCapabilities;
	/** Raw stdout from probe (for tests/debug). */
	rawStdout?: string;
}

/**
 * JSON-line execute request written to helper stdin (one line).
 * Response is one JSON line on helper stdout — see {@link OsSandboxHelperResponse}.
 */
export interface OsSandboxHelperRequest {
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	timeoutMs?: number;
	/** If non-empty, helper must refuse cwd outside these roots. */
	workspaceRoots?: string[];
}

/** JSON-line execute response read from helper stdout (one line). */
export interface OsSandboxHelperResponse {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	signal?: string | null;
	/** Machine-readable error when ok=false (e.g. cwd_outside_roots). */
	error?: string;
	timedOut?: boolean;
	/**
	 * Observability: e.g. "mvp-helper".
	 * Presence does **not** mean RestrictedToken isolation.
	 */
	isolation?: string;
}

export interface OsSandboxExecRequest {
	command: string;
	args?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	shell?: boolean | string;
	timeoutMs?: number;
	/**
	 * Optional workspace roots forwarded to the external helper.
	 * When set, helper fails if cwd is outside all roots.
	 */
	workspaceRoots?: string[];
	/** Streaming callback for stdout chunks (invoked as data arrives). */
	onStdout?: (chunk: Buffer) => void;
	/** Streaming callback for stderr chunks (invoked as data arrives). */
	onStderr?: (chunk: Buffer) => void;
	/** Abort signal — kills the process tree when aborted. */
	signal?: AbortSignal;
}

export interface OsSandboxExecResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signal?: string | null;
	/** Backend id that ran the process */
	backendId: string;
	/**
	 * Helper isolation label when run via external-runner (e.g. "mvp-helper").
	 * Undefined for host spawn. Not RestrictedToken.
	 */
	isolation?: string;
}

export interface OsSandboxBackend {
	readonly id: string;
	/** False when experimental is requested but helper is missing / unprobeable */
	readonly available: boolean;
	execute(req: OsSandboxExecRequest): Promise<OsSandboxExecResult>;
}

/** Resolve QUAKE_OS_SANDBOX: off | experimental (default off). */
export function resolveOsSandboxMode(env: NodeJS.ProcessEnv = process.env): OsSandboxMode {
	const raw = String(env.QUAKE_OS_SANDBOX || "off").toLowerCase().trim();
	if (raw === "experimental" || raw === "1" || raw === "true" || raw === "on") return "experimental";
	return "off";
}

/**
 * Resolve QUAKE_COMMAND_RUNNER to an existing file path, or undefined.
 * Existence alone does **not** make the backend available — see {@link probeOsSandboxHelper}.
 */
export function resolveOsSandboxHelperPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const raw = String(env.QUAKE_COMMAND_RUNNER || "").trim();
	if (!raw) return undefined;
	try {
		if (existsSync(raw) && statSync(raw).isFile()) return raw;
	} catch {
		// ignore ENOENT / access errors
	}
	return undefined;
}

/**
 * How to spawn a helper for probe and execute.
 * Native binaries are argv0; `.js`/`.mjs`/`.cjs` stubs are run via `process.execPath`
 * so the optional node test stub works on Windows without a shebang runner.
 */
export function resolveOsSandboxHelperSpawn(
	helperPath: string,
	extraArgs: string[] = [],
): { command: string; args: string[] } {
	const lower = helperPath.toLowerCase();
	if (lower.endsWith(".mjs") || lower.endsWith(".js") || lower.endsWith(".cjs")) {
		return { command: process.execPath, args: [helperPath, ...extraArgs] };
	}
	return { command: helperPath, args: [...extraArgs] };
}

/**
 * Parse optional capability JSON from probe stdout.
 * Helpers may print nothing (legacy exit-0 only) or one JSON object with capabilities.
 * Exported for unit tests.
 */
export function parseOsSandboxHelperProbeStdout(stdout: string): {
	isolation?: string;
	capabilities?: OsSandboxHelperCapabilities;
} {
	const trimmed = String(stdout || "").trim();
	if (!trimmed) return {};
	// Prefer last non-empty line (helpers may print diagnostics before JSON).
	const lines = trimmed
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	const line = lines.length > 0 ? lines[lines.length - 1]! : "";
	if (!line.startsWith("{")) return {};
	try {
		const parsed = JSON.parse(line) as Record<string, unknown>;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const isolation = typeof parsed.isolation === "string" ? parsed.isolation : undefined;
		let capabilities: OsSandboxHelperCapabilities | undefined;
		const caps = parsed.capabilities;
		if (caps && typeof caps === "object" && !Array.isArray(caps)) {
			const c = caps as Record<string, unknown>;
			capabilities = {
				restrictedToken: c.restrictedToken === true,
				jobObject: c.jobObject === true,
				fsRoots: c.fsRoots === true,
			};
		}
		return { isolation, capabilities };
	} catch {
		return {};
	}
}

/**
 * Detailed probe: exit 0 within timeout, optionally parse capability JSON from stdout.
 * Missing/unexecutable/timeout/non-zero → `{ ok: false }` (fail-closed).
 *
 * This is discovery only — it does **not** prove RestrictedToken isolation.
 * A helper may report isolation: "mvp-helper" with restrictedToken: false.
 */
export async function probeOsSandboxHelperDetailed(
	helperPath: string,
	options?: { timeoutMs?: number },
): Promise<OsSandboxHelperProbeResult> {
	const path = String(helperPath || "").trim();
	if (!path) return { ok: false };
	try {
		if (!existsSync(path) || !statSync(path).isFile()) return { ok: false };
	} catch {
		return { ok: false };
	}

	const timeoutMs = options?.timeoutMs ?? OS_SANDBOX_PROBE_TIMEOUT_MS;
	const { command, args } = resolveOsSandboxHelperSpawn(path, [OS_SANDBOX_PROBE_ARG]);

	return new Promise((resolve) => {
		let settled = false;
		const stdoutChunks: Buffer[] = [];
		const finish = (result: OsSandboxHelperProbeResult) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};

		let child;
		try {
			child = spawn(command, args, {
				stdio: ["ignore", "pipe", "ignore"],
				windowsHide: true,
				// Do not detach — probe is short-lived and should not outlive the parent.
			});
		} catch {
			finish({ ok: false });
			return;
		}

		const timer = setTimeout(() => {
			try {
				if (child.pid) killProcessTree(child.pid);
			} catch {
				// ignore kill races
			}
			finish({ ok: false });
		}, timeoutMs);

		child.stdout?.on("data", (d: Buffer) => stdoutChunks.push(d));

		child.once("error", () => {
			clearTimeout(timer);
			finish({ ok: false });
		});

		child.once("exit", (code) => {
			clearTimeout(timer);
			const rawStdout = Buffer.concat(stdoutChunks).toString("utf-8");
			if (code !== 0) {
				finish({ ok: false, rawStdout });
				return;
			}
			const parsed = parseOsSandboxHelperProbeStdout(rawStdout);
			finish({
				ok: true,
				isolation: parsed.isolation,
				capabilities: parsed.capabilities,
				rawStdout,
			});
		});
	});
}

/**
 * Probe an OS sandbox helper binary.
 * Returns true only when `{path} --quake-sandbox-probe` exits 0 within the timeout.
 * Missing/unexecutable/timeout/non-zero → false (fail-closed).
 *
 * This is discovery only — it does **not** prove RestrictedToken or any real isolation.
 * Prefer {@link probeOsSandboxHelperDetailed} when capability JSON is needed.
 */
export async function probeOsSandboxHelper(
	helperPath: string,
	options?: { timeoutMs?: number },
): Promise<boolean> {
	const result = await probeOsSandboxHelperDetailed(helperPath, options);
	return result.ok;
}

/** Strip undefined ProcessEnv values for JSON-line IPC. */
export function serializeOsSandboxEnv(env?: NodeJS.ProcessEnv): Record<string, string> | undefined {
	if (!env) return undefined;
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(env)) {
		if (v === undefined) continue;
		out[k] = String(v);
	}
	return out;
}

/**
 * Parse one JSON helper response line. Throws on malformed payloads.
 * Exported for unit tests.
 */
export function parseOsSandboxHelperResponse(line: string): OsSandboxHelperResponse {
	const trimmed = line.trim();
	if (!trimmed) {
		throw new Error("empty helper response");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (err) {
		throw new Error(
			`invalid helper JSON response: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("helper response must be a JSON object");
	}
	const o = parsed as Record<string, unknown>;
	if (typeof o.ok !== "boolean") {
		throw new Error("helper response missing boolean ok");
	}
	if (!("exitCode" in o)) {
		throw new Error("helper response missing exitCode");
	}
	if (o.exitCode !== null && typeof o.exitCode !== "number") {
		throw new Error("helper response exitCode must be number|null");
	}
	return {
		ok: o.ok,
		exitCode: o.exitCode as number | null,
		stdout: typeof o.stdout === "string" ? o.stdout : "",
		stderr: typeof o.stderr === "string" ? o.stderr : "",
		signal: (o.signal as string | null | undefined) ?? null,
		error: typeof o.error === "string" ? o.error : undefined,
		timedOut: o.timedOut === true ? true : undefined,
		isolation: typeof o.isolation === "string" ? o.isolation : undefined,
	};
}

/**
 * Placeholder experimental backend — fails closed (never silently falls back to host).
 * Used when experimental is on but no helper path exists / probe failed without a path.
 */
export class ExperimentalOsSandboxBackend implements OsSandboxBackend {
	readonly id = "experimental-unavailable";
	readonly available = false;

	async execute(_req: OsSandboxExecRequest): Promise<OsSandboxExecResult> {
		throw new Error(
			"QUAKE_OS_SANDBOX=experimental is set but no OS sandbox helper is installed. " +
				"Quake does not silently fall back to unsandboxed host spawn. " +
				"Unset QUAKE_OS_SANDBOX or install a supported helper. See docs/CODEX_WINDOWS_SANDBOX.md",
		);
	}
}

/**
 * External helper backend (S-OS.1 execute protocol).
 * `available` is true **only** after a successful `--quake-sandbox-probe`.
 * Execute spawns the helper with JSON-line IPC — no silent host fallback.
 * Not RestrictedToken isolation; product must not claim OS sandboxing.
 */
export class ExternalRunnerOsSandboxBackend implements OsSandboxBackend {
	readonly id = "external-runner";

	constructor(
		readonly helperPath: string,
		readonly available: boolean,
	) {}

	async execute(req: OsSandboxExecRequest): Promise<OsSandboxExecResult> {
		if (!this.available) {
			throw new Error(
				`QUAKE_OS_SANDBOX=experimental: external runner at ${this.helperPath} ` +
					`failed probe (${OS_SANDBOX_PROBE_ARG}) or was not probed. ` +
					"Quake does not silently fall back to unsandboxed host spawn. " +
					"See docs/CODEX_WINDOWS_SANDBOX.md",
			);
		}

		const { command: helperCmd, args: helperArgs } = resolveOsSandboxHelperSpawn(this.helperPath);

		const payload: OsSandboxHelperRequest = {
			command: req.command,
			args: req.args ?? [],
			cwd: req.cwd,
			env: serializeOsSandboxEnv(req.env),
			timeoutMs: req.timeoutMs,
			workspaceRoots: req.workspaceRoots,
		};

		const requestLine = JSON.stringify(payload) + "\n";

		// Parent-side IPC deadline: child timeout + grace, or unlimited when no timeout.
		const ipcTimeoutMs =
			req.timeoutMs !== undefined && req.timeoutMs > 0
				? req.timeoutMs + OS_SANDBOX_HELPER_IPC_GRACE_MS
				: undefined;

		return new Promise((resolve, reject) => {
			let settled = false;
			let timedOutIpc = false;
			let timeoutHandle: NodeJS.Timeout | undefined;
			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];

			const finishReject = (err: Error) => {
				if (settled) return;
				settled = true;
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (req.signal) req.signal.removeEventListener("abort", onAbort);
				reject(err);
			};

			const finishResolve = (result: OsSandboxExecResult) => {
				if (settled) return;
				settled = true;
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (req.signal) req.signal.removeEventListener("abort", onAbort);
				resolve(result);
			};

			let child;
			try {
				child = spawn(helperCmd, helperArgs, {
					stdio: ["pipe", "pipe", "pipe"],
					windowsHide: true,
				});
			} catch (err) {
				finishReject(
					new Error(
						`QUAKE_OS_SANDBOX external-runner: failed to spawn helper at ${this.helperPath}: ` +
							`${err instanceof Error ? err.message : String(err)}. ` +
							"Quake does not silently fall back to unsandboxed host spawn. " +
							"See docs/CODEX_WINDOWS_SANDBOX.md",
					),
				);
				return;
			}

			const killHelper = () => {
				if (child.pid) killProcessTree(child.pid);
			};

			const onAbort = () => {
				killHelper();
			};
			if (req.signal) {
				if (req.signal.aborted) {
					killHelper();
					finishReject(new Error("aborted"));
					return;
				}
				req.signal.addEventListener("abort", onAbort, { once: true });
			}

			if (ipcTimeoutMs !== undefined) {
				timeoutHandle = setTimeout(() => {
					timedOutIpc = true;
					killHelper();
				}, ipcTimeoutMs);
			}

			child.stdout?.on("data", (data: Buffer) => {
				stdoutChunks.push(data);
			});
			child.stderr?.on("data", (data: Buffer) => {
				stderrChunks.push(data);
			});

			try {
				child.stdin?.write(requestLine);
				child.stdin?.end();
			} catch (err) {
				killHelper();
				finishReject(
					new Error(
						`QUAKE_OS_SANDBOX external-runner: failed to write execute request: ` +
							`${err instanceof Error ? err.message : String(err)}. ` +
							"Quake does not silently fall back to unsandboxed host spawn.",
					),
				);
				return;
			}

			waitForChildProcess(child)
				.then(() => {
					if (req.signal?.aborted) {
						finishReject(new Error("aborted"));
						return;
					}
					if (timedOutIpc) {
						// Prefer HostSpawnBackend-compatible timeout surface for bash.
						finishReject(new Error(`timeout:${req.timeoutMs}`));
						return;
					}

					const rawOut = Buffer.concat(stdoutChunks).toString("utf-8");
					const helperErr = Buffer.concat(stderrChunks).toString("utf-8");
					// Helper writes one JSON result line on stdout (possibly with trailing newline).
					const lines = rawOut
						.split(/\r?\n/)
						.map((l) => l.trim())
						.filter((l) => l.length > 0);
					const resultLine = lines.length > 0 ? lines[lines.length - 1]! : "";

					let response: OsSandboxHelperResponse;
					try {
						response = parseOsSandboxHelperResponse(resultLine);
					} catch (err) {
						finishReject(
							new Error(
								`QUAKE_OS_SANDBOX external-runner: helper protocol error from ${this.helperPath}: ` +
									`${err instanceof Error ? err.message : String(err)}` +
									(helperErr ? ` (helper stderr: ${helperErr.slice(0, 500)})` : "") +
									". Quake does not silently fall back to unsandboxed host spawn. " +
									"See docs/CODEX_WINDOWS_SANDBOX.md",
							),
						);
						return;
					}

					if (response.timedOut) {
						finishReject(new Error(`timeout:${req.timeoutMs}`));
						return;
					}

					if (!response.ok) {
						const detail = response.stderr || response.error || "helper refused execute";
						finishReject(
							new Error(
								`QUAKE_OS_SANDBOX external-runner: ${detail}` +
									(response.error ? ` [${response.error}]` : "") +
									". Quake does not silently fall back to unsandboxed host spawn. " +
									"See docs/CODEX_WINDOWS_SANDBOX.md",
							),
						);
						return;
					}

					// MVP: no live streaming through IPC — deliver captured buffers once.
					if (response.stdout && req.onStdout) {
						req.onStdout(Buffer.from(response.stdout, "utf-8"));
					}
					if (response.stderr && req.onStderr) {
						req.onStderr(Buffer.from(response.stderr, "utf-8"));
					}

					finishResolve({
						stdout: response.stdout,
						stderr: response.stderr,
						exitCode: response.exitCode,
						signal: response.signal ?? null,
						backendId: this.id,
						// Observability only — "mvp-helper" is not RestrictedToken.
						isolation: response.isolation,
					});
				})
				.catch((err) => {
					finishReject(
						err instanceof Error
							? err
							: new Error(
									`QUAKE_OS_SANDBOX external-runner: helper failed: ${String(err)}. ` +
										"Quake does not silently fall back to unsandboxed host spawn.",
								),
					);
				});
		});
	}
}

/** Host process spawn (policy sandbox only; no OS isolation). */
export class HostSpawnBackend implements OsSandboxBackend {
	readonly id = "host";
	readonly available = true;

	async execute(req: OsSandboxExecRequest): Promise<OsSandboxExecResult> {
		const args = req.args ?? [];
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		return new Promise((resolve, reject) => {
			let timedOut = false;
			let timeoutHandle: NodeJS.Timeout | undefined;
			let exitSignal: NodeJS.Signals | null = null;

			const child = spawn(req.command, args, {
				cwd: req.cwd,
				env: req.env,
				shell: req.shell ?? false,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});

			const killChild = () => {
				if (child.pid) killProcessTree(child.pid);
			};

			if (req.timeoutMs !== undefined && req.timeoutMs > 0) {
				timeoutHandle = setTimeout(() => {
					timedOut = true;
					killChild();
				}, req.timeoutMs);
			}

			const onAbort = () => {
				killChild();
			};
			if (req.signal) {
				if (req.signal.aborted) onAbort();
				else req.signal.addEventListener("abort", onAbort, { once: true });
			}

			child.stdout?.on("data", (data: Buffer) => {
				stdoutChunks.push(data);
				req.onStdout?.(data);
			});
			child.stderr?.on("data", (data: Buffer) => {
				stderrChunks.push(data);
				req.onStderr?.(data);
			});

			child.once("exit", (_code, sig) => {
				exitSignal = sig;
			});

			// Wait without hanging on inherited stdio from detached descendants (Windows).
			waitForChildProcess(child)
				.then((code) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					if (req.signal) req.signal.removeEventListener("abort", onAbort);

					if (req.signal?.aborted) {
						reject(new Error("aborted"));
						return;
					}
					if (timedOut) {
						reject(new Error(`timeout:${req.timeoutMs}`));
						return;
					}
					resolve({
						stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
						stderr: Buffer.concat(stderrChunks).toString("utf-8"),
						exitCode: code,
						signal: exitSignal,
						backendId: this.id,
					});
				})
				.catch((err) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					if (req.signal) req.signal.removeEventListener("abort", onAbort);
					reject(err);
				});
		});
	}
}

let activeBackend: OsSandboxBackend | undefined;

/** Probe result cache keyed by absolute helper path (cleared via setOsSandboxBackend(undefined)). */
let probeCache: { path: string; available: boolean } | undefined;

export function clearOsSandboxProbeCache(): void {
	probeCache = undefined;
}

export function setOsSandboxBackend(backend: OsSandboxBackend | undefined): void {
	activeBackend = backend;
	if (backend === undefined) {
		clearOsSandboxProbeCache();
	}
}

export function getOsSandboxBackend(): OsSandboxBackend {
	if (activeBackend) return activeBackend;
	return resolveOsSandboxBackend();
}

/**
 * Synchronous backend resolution.
 * Experimental + existing helper path → `external-runner` with `available: false`
 * (not probed). Use {@link resolveOsSandboxBackendAsync} / {@link ensureOsSandboxBackend}
 * for probe-gated availability.
 */
export function resolveOsSandboxBackend(env: NodeJS.ProcessEnv = process.env): OsSandboxBackend {
	const mode = resolveOsSandboxMode(env);
	if (mode !== "experimental") return new HostSpawnBackend();

	const helperPath = resolveOsSandboxHelperPath(env);
	if (!helperPath) return new ExperimentalOsSandboxBackend();

	// Path exists but sync resolve cannot claim probe success → available false.
	if (probeCache?.path === helperPath) {
		return new ExternalRunnerOsSandboxBackend(helperPath, probeCache.available);
	}
	return new ExternalRunnerOsSandboxBackend(helperPath, false);
}

/**
 * Async resolution with helper probe (fail-closed).
 * `available: true` only when QUAKE_COMMAND_RUNNER points at a file that exits 0 on probe.
 */
export async function resolveOsSandboxBackendAsync(
	env: NodeJS.ProcessEnv = process.env,
): Promise<OsSandboxBackend> {
	const mode = resolveOsSandboxMode(env);
	if (mode !== "experimental") return new HostSpawnBackend();

	const helperPath = resolveOsSandboxHelperPath(env);
	if (!helperPath) return new ExperimentalOsSandboxBackend();

	if (probeCache?.path === helperPath) {
		return new ExternalRunnerOsSandboxBackend(helperPath, probeCache.available);
	}

	const ok = await probeOsSandboxHelper(helperPath);
	probeCache = { path: helperPath, available: ok };
	return new ExternalRunnerOsSandboxBackend(helperPath, ok);
}

/**
 * Prefer injected backend; otherwise async-resolve (with probe when experimental).
 * Used by bash local ops so experimental mode can discover a helper once.
 */
export async function ensureOsSandboxBackend(
	env: NodeJS.ProcessEnv = process.env,
): Promise<OsSandboxBackend> {
	if (activeBackend) return activeBackend;
	return resolveOsSandboxBackendAsync(env);
}

/**
 * Call before spawn when experimental OS sandbox is requested.
 * Throws fail-closed error if helper unavailable.
 * Note: sync — uses last probe cache if present; prefer ensureOsSandboxBackend for first use.
 */
export function assertOsSandboxAllowsSpawn(env: NodeJS.ProcessEnv = process.env): void {
	const backend = resolveOsSandboxBackend(env);
	if (!backend.available && resolveOsSandboxMode(env) === "experimental") {
		throw new Error(
			"QUAKE_OS_SANDBOX=experimental: OS sandbox helper unavailable (fail-closed). " +
				"See docs/CODEX_WINDOWS_SANDBOX.md",
		);
	}
}
