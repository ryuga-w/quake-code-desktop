#!/usr/bin/env node
/**
 * quake-command-runner — OS sandbox helper execute protocol MVP (S-OS.1 / harden track).
 *
 * What this **is**:
 * - Probe (`--quake-sandbox-probe`) + JSON-line execute IPC
 * - cwd must be inside workspaceRoots when provided
 * - Dangerous env vars stripped (LD_PRELOAD, NODE_OPTIONS inject, etc.)
 * - Optional strict FS heuristic when QUAKE_RUNNER_STRICT_FS=1 (`..` path escapes)
 * - Process-tree kill on timeout (Windows: taskkill /T; Unix: process group)
 * - Response marks isolation: "mvp-helper" for observability
 *
 * What this is **not**:
 * - RestrictedToken / CreateProcessAsUserW
 * - Windows Job Object API assignment (no native binding yet)
 * - Transparent network proxy or elevated ACL sandbox
 *
 *   QUAKE_OS_SANDBOX=experimental
 *   QUAKE_COMMAND_RUNNER=/abs/path/to/quake-command-runner.mjs
 *   QUAKE_RUNNER_STRICT_FS=1   # optional: heuristic deny of .. escapes outside roots
 *
 * Protocol (JSON-line IPC):
 *   stdin  → one line: { command, args?, cwd?, env?, timeoutMs?, workspaceRoots? }
 *   stdout → one line: { ok, exitCode, stdout, stderr, signal?, error?, timedOut?, isolation }
 *
 * Probe:
 *   argv `--quake-sandbox-probe` → stdout JSON capabilities, exit 0
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve as pathResolve, normalize as pathNormalize } from "node:path";

const PROBE_ARG = "--quake-sandbox-probe";

/** Isolation label for every execute/probe response (observability; not RestrictedToken). */
const ISOLATION = "mvp-helper";

/**
 * Env vars that enable code injection / loader tricks. Stripped from child env.
 * Case-insensitive match on Windows; exact on POSIX (we always compare uppercased).
 */
const DANGEROUS_ENV_KEYS = new Set(
	[
		// Dynamic linker / preload injection
		"LD_PRELOAD",
		"LD_LIBRARY_PATH",
		"LD_AUDIT",
		"DYLD_INSERT_LIBRARIES",
		"DYLD_LIBRARY_PATH",
		"DYLD_FORCE_FLAT_NAMESPACE",
		"DYLD_FRAMEWORK_PATH",
		// Node / V8 inject
		"NODE_OPTIONS",
		"NODE_PATH",
		"NODE_REPL_EXTERNAL_MODULE",
		// Other runtimes
		"PYTHONSTARTUP",
		"PYTHONPATH",
		"PERL5OPT",
		"PERL5LIB",
		"RUBYOPT",
		"RUBYLIB",
		"JAVA_TOOL_OPTIONS",
		"_JAVA_OPTIONS",
		"JDK_JAVA_OPTIONS",
		"DOTNET_STARTUP_HOOKS",
		"BASH_ENV",
		"ENV",
		"SHELLOPTS",
		"BASHOPTS",
		"PROMPT_COMMAND",
		"PS4",
		"GCONV_PATH",
		"GETCONF_DIR",
		"HOSTALIASES",
		"LOCALDOMAIN",
		"RES_OPTIONS",
		"TERMINFO",
		"TERMINFO_DIRS",
		"TERMPATH",
		"ZDOTDIR",
		"SSLKEYLOGFILE",
		// Windows loader-ish
		"COR_ENABLE_PROFILING",
		"COR_PROFILER",
		"COR_PROFILER_PATH",
		"CORECLR_ENABLE_PROFILING",
		"CORECLR_PROFILER",
		"CORECLR_PROFILER_PATH",
	].map((k) => k.toUpperCase()),
);

/**
 * Capability report for probe (honest: no RestrictedToken / Job Object API yet).
 * jobObject stays false until a native helper assigns the child to a Win32 Job Object.
 * Process-tree kill via taskkill /T is lifecycle hygiene, not Job Object isolation.
 */
function buildCapabilities() {
	return {
		restrictedToken: false,
		jobObject: false,
		fsRoots: true,
	};
}

const argv = process.argv.slice(2);
if (argv.includes(PROBE_ARG)) {
	// Probe prints JSON so discovery can surface capabilities; exit 0 is the contract.
	process.stdout.write(
		JSON.stringify({
			ok: true,
			isolation: ISOLATION,
			capabilities: buildCapabilities(),
		}) + "\n",
	);
	process.exit(0);
}

/**
 * @param {string} absPath
 * @param {string} rootPath
 */
function isPathInsideRoot(absPath, rootPath) {
	const abs = pathResolve(absPath);
	const root = pathResolve(rootPath);
	if (process.platform === "win32") {
		const a = abs.toLowerCase().replace(/\//g, "\\");
		const r = root.toLowerCase().replace(/\//g, "\\");
		if (a === r) return true;
		return a.startsWith(r.endsWith("\\") ? r : r + "\\");
	}
	if (abs === root) return true;
	const prefix = root.endsWith("/") ? root : root + "/";
	return abs.startsWith(prefix);
}

/**
 * @param {string} key
 */
function isDangerousEnvKey(key) {
	return DANGEROUS_ENV_KEYS.has(String(key).toUpperCase());
}

/**
 * Build child env: start from process.env or req.env, strip dangerous keys.
 * @param {Record<string, unknown> | undefined} reqEnv
 * @returns {NodeJS.ProcessEnv}
 */
function sanitizeEnv(reqEnv) {
	/** @type {NodeJS.ProcessEnv} */
	const base = {};
	const source =
		reqEnv && typeof reqEnv === "object" && !Array.isArray(reqEnv)
			? reqEnv
			: process.env;

	for (const [k, v] of Object.entries(source)) {
		if (v === undefined || v === null) continue;
		if (isDangerousEnvKey(k)) continue;
		base[k] = String(v);
	}
	// Never re-introduce inject vectors from the helper process itself.
	for (const k of Object.keys(base)) {
		if (isDangerousEnvKey(k)) delete base[k];
	}
	return base;
}

/**
 * When QUAKE_RUNNER_STRICT_FS=1 and workspaceRoots set, reject tokens that contain `..`
 * path segments and resolve outside all roots. Heuristic only — not a real FS sandbox.
 *
 * Absolute binaries outside roots (e.g. system `node`) are intentionally allowed;
 * the target is traversal escapes like `../../secret`, not "every absolute path".
 *
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {string[]} workspaceRoots
 * @returns {{ error: string, message: string } | null}
 */
function checkStrictFsPathEscapes(command, args, cwd, workspaceRoots) {
	const strict =
		String(process.env.QUAKE_RUNNER_STRICT_FS || "").trim() === "1" ||
		String(process.env.QUAKE_RUNNER_STRICT_FS || "").toLowerCase() === "true";
	if (!strict) return null;
	if (!workspaceRoots.length) return null;

	const tokens = [command, ...args].filter((t) => typeof t === "string" && t.length > 0);
	for (const token of tokens) {
		// Only `..` climb heuristics (per product: not full absolute-path deny).
		const hasDotDot = token.split(/[/\\]/).includes("..");
		if (!hasDotDot) continue;

		let resolved;
		try {
			if (token.startsWith("~")) {
				const home = process.env.USERPROFILE || process.env.HOME || "";
				resolved = pathResolve(home, token.slice(1).replace(/^[/\\]/, ""));
			} else if (isAbsolute(token)) {
				resolved = pathResolve(token);
			} else {
				resolved = pathResolve(cwd, token);
			}
			resolved = pathNormalize(resolved);
		} catch {
			continue;
		}

		const inside = workspaceRoots.some((root) => isPathInsideRoot(resolved, root));
		if (!inside) {
			return {
				error: "path_escape_outside_roots",
				message: `strict FS: path token resolves outside workspace roots: ${token} → ${resolved}`,
			};
		}
	}
	return null;
}

/**
 * @param {number} pid
 */
function killProcessTree(pid) {
	if (!pid) return;
	if (process.platform === "win32") {
		// Prefer taskkill /T (process tree). No Job Object API without native code.
		try {
			spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
				stdio: "ignore",
				detached: true,
				windowsHide: true,
			});
		} catch {
			// ignore
		}
	} else {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// already dead
			}
		}
	}
}

/**
 * @param {object} result
 * @param {number} [helperExit]
 */
function writeResult(result, helperExit = 0) {
	const payload = {
		...result,
		// Always present for observability (mvp-helper ≠ RestrictedToken).
		isolation: typeof result.isolation === "string" ? result.isolation : ISOLATION,
	};
	process.stdout.write(JSON.stringify(payload) + "\n");
	process.exit(helperExit);
}

/**
 * Read one complete line from stdin (or all data if EOF without newline).
 * @returns {Promise<string>}
 */
function readStdinLine() {
	return new Promise((resolve, reject) => {
		let buf = "";
		let settled = false;
		const finish = (line) => {
			if (settled) return;
			settled = true;
			resolve(line);
		};
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			buf += chunk;
			const nl = buf.indexOf("\n");
			if (nl !== -1) {
				process.stdin.pause();
				finish(buf.slice(0, nl).replace(/\r$/, ""));
			}
		});
		process.stdin.on("end", () => {
			finish(buf.replace(/\r?\n$/, "").replace(/\r$/, ""));
		});
		process.stdin.on("error", (err) => {
			if (settled) return;
			settled = true;
			reject(err);
		});
	});
}

/**
 * @param {unknown} req
 * @returns {{ error: string, message: string } | null}
 */
function validateRequest(req) {
	if (!req || typeof req !== "object" || Array.isArray(req)) {
		return { error: "invalid_request", message: "request must be a JSON object" };
	}
	const r = /** @type {Record<string, unknown>} */ (req);
	if (typeof r.command !== "string" || !r.command.trim()) {
		return { error: "invalid_request", message: "command must be a non-empty string" };
	}
	if (r.args !== undefined && !Array.isArray(r.args)) {
		return { error: "invalid_request", message: "args must be an array of strings" };
	}
	if (r.args && r.args.some((a) => typeof a !== "string")) {
		return { error: "invalid_request", message: "args must be an array of strings" };
	}
	if (r.cwd !== undefined && typeof r.cwd !== "string") {
		return { error: "invalid_request", message: "cwd must be a string" };
	}
	if (r.timeoutMs !== undefined && (typeof r.timeoutMs !== "number" || !Number.isFinite(r.timeoutMs))) {
		return { error: "invalid_request", message: "timeoutMs must be a number" };
	}
	if (r.workspaceRoots !== undefined && !Array.isArray(r.workspaceRoots)) {
		return { error: "invalid_request", message: "workspaceRoots must be an array of strings" };
	}
	if (r.workspaceRoots && r.workspaceRoots.some((w) => typeof w !== "string")) {
		return { error: "invalid_request", message: "workspaceRoots must be an array of strings" };
	}
	if (r.env !== undefined && (typeof r.env !== "object" || r.env === null || Array.isArray(r.env))) {
		return { error: "invalid_request", message: "env must be an object" };
	}
	return null;
}

async function execute() {
	let line;
	try {
		line = await readStdinLine();
	} catch (err) {
		writeResult(
			{
				ok: false,
				exitCode: null,
				stdout: "",
				stderr: `failed to read stdin: ${err instanceof Error ? err.message : String(err)}`,
				error: "stdin_error",
			},
			1,
		);
		return;
	}

	if (!line || !line.trim()) {
		writeResult(
			{
				ok: false,
				exitCode: null,
				stdout: "",
				stderr: "empty execute request on stdin",
				error: "invalid_request",
			},
			1,
		);
		return;
	}

	let req;
	try {
		req = JSON.parse(line);
	} catch (err) {
		writeResult(
			{
				ok: false,
				exitCode: null,
				stdout: "",
				stderr: `invalid JSON request: ${err instanceof Error ? err.message : String(err)}`,
				error: "invalid_request",
			},
			1,
		);
		return;
	}

	const validation = validateRequest(req);
	if (validation) {
		writeResult(
			{
				ok: false,
				exitCode: null,
				stdout: "",
				stderr: validation.message,
				error: validation.error,
			},
			1,
		);
		return;
	}

	const command = String(req.command).trim();
	if (!command) {
		writeResult(
			{
				ok: false,
				exitCode: null,
				stdout: "",
				stderr: "command must be a non-empty string",
				error: "invalid_request",
			},
			1,
		);
		return;
	}

	const childArgs = Array.isArray(req.args) ? req.args.map(String) : [];
	const cwdRaw = typeof req.cwd === "string" && req.cwd.trim() ? req.cwd : process.cwd();
	const cwd = isAbsolute(cwdRaw) ? pathResolve(cwdRaw) : pathResolve(process.cwd(), cwdRaw);
	const workspaceRoots = Array.isArray(req.workspaceRoots)
		? req.workspaceRoots.map((r) => pathResolve(String(r)))
		: [];
	const timeoutMs =
		typeof req.timeoutMs === "number" && req.timeoutMs > 0 ? req.timeoutMs : undefined;

	if (workspaceRoots.length > 0) {
		const inside = workspaceRoots.some((root) => isPathInsideRoot(cwd, root));
		if (!inside) {
			writeResult(
				{
					ok: false,
					exitCode: null,
					stdout: "",
					stderr: `cwd outside workspace roots: ${cwd}`,
					error: "cwd_outside_roots",
				},
				1,
			);
			return;
		}
	}

	const strictFs = checkStrictFsPathEscapes(command, childArgs, cwd, workspaceRoots);
	if (strictFs) {
		writeResult(
			{
				ok: false,
				exitCode: null,
				stdout: "",
				stderr: strictFs.message,
				error: strictFs.error,
			},
			1,
		);
		return;
	}

	if (!existsSync(cwd)) {
		writeResult(
			{
				ok: false,
				exitCode: null,
				stdout: "",
				stderr: `cwd does not exist: ${cwd}`,
				error: "cwd_missing",
			},
			1,
		);
		return;
	}

	const env = sanitizeEnv(
		req.env && typeof req.env === "object" ? /** @type {Record<string, unknown>} */ (req.env) : undefined,
	);

	/** @type {Buffer[]} */
	const stdoutChunks = [];
	/** @type {Buffer[]} */
	const stderrChunks = [];
	let timedOut = false;
	/** @type {NodeJS.Signals | null} */
	let exitSignal = null;
	/** @type {number | null} */
	let exitCode = null;

	await new Promise((resolvePromise) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolvePromise();
		};

		let child;
		try {
			child = spawn(command, childArgs, {
				cwd,
				env,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
				// Unix: process-group kill; Windows: taskkill /T (no Job Object yet)
				detached: process.platform !== "win32",
			});
		} catch (err) {
			writeResult(
				{
					ok: false,
					exitCode: null,
					stdout: "",
					stderr: `spawn failed: ${err instanceof Error ? err.message : String(err)}`,
					error: "spawn_failed",
				},
				1,
			);
			return;
		}

		/** @type {NodeJS.Timeout | undefined} */
		let timer;
		if (timeoutMs !== undefined) {
			timer = setTimeout(() => {
				timedOut = true;
				if (child.pid) killProcessTree(child.pid);
			}, timeoutMs);
		}

		child.stdout?.on("data", (d) => stdoutChunks.push(d));
		child.stderr?.on("data", (d) => stderrChunks.push(d));

		child.once("error", (err) => {
			if (timer) clearTimeout(timer);
			stderrChunks.push(Buffer.from(`spawn error: ${err.message}`, "utf-8"));
			exitCode = null;
			finish();
		});

		child.once("exit", (code, sig) => {
			if (timer) clearTimeout(timer);
			exitSignal = sig;
			exitCode = code;
			finish();
		});
	});

	writeResult(
		{
			ok: true,
			exitCode: timedOut ? null : exitCode,
			stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
			stderr: Buffer.concat(stderrChunks).toString("utf-8"),
			signal: exitSignal,
			isolation: ISOLATION,
			...(timedOut ? { timedOut: true } : {}),
		},
		0,
	);
}

void execute().catch((err) => {
	try {
		writeResult(
			{
				ok: false,
				exitCode: null,
				stdout: "",
				stderr: `helper crash: ${err instanceof Error ? err.message : String(err)}`,
				error: "helper_crash",
			},
			1,
		);
	} catch {
		process.exit(1);
	}
});
