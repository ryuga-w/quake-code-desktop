import { afterEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createLocalBashOperations } from "../tools/bash.js";
import { spawn } from "node:child_process";
import {
	resolveOsSandboxMode,
	resolveOsSandboxBackend,
	resolveOsSandboxBackendAsync,
	resolveOsSandboxHelperPath,
	probeOsSandboxHelper,
	probeOsSandboxHelperDetailed,
	assertOsSandboxAllowsSpawn,
	getOsSandboxBackend,
	setOsSandboxBackend,
	ensureOsSandboxBackend,
	clearOsSandboxProbeCache,
	HostSpawnBackend,
	ExperimentalOsSandboxBackend,
	ExternalRunnerOsSandboxBackend,
	parseOsSandboxHelperResponse,
	parseOsSandboxHelperProbeStdout,
	serializeOsSandboxEnv,
	OS_SANDBOX_PROBE_ARG,
	OS_SANDBOX_ISOLATION_MVP_HELPER,
} from "./os-backend.js";

const STUB_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../scripts/quake-command-runner-stub.mjs",
);

const RUNNER_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../scripts/quake-command-runner.mjs",
);

/** Run helper execute protocol directly (for env-strip / strict-FS unit checks). */
async function runHelperExecute(
	helperPath: string,
	request: Record<string, unknown>,
	helperEnv?: NodeJS.ProcessEnv,
): Promise<{ exitCode: number | null; response: Record<string, unknown> }> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [helperPath], {
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
			env: helperEnv ? { ...process.env, ...helperEnv } : process.env,
		});
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		child.stdout?.on("data", (d: Buffer) => out.push(d));
		child.stderr?.on("data", (d: Buffer) => err.push(d));
		child.stdin?.write(JSON.stringify(request) + "\n");
		child.stdin?.end();
		child.once("error", reject);
		child.once("exit", (code) => {
			const raw = Buffer.concat(out).toString("utf-8").trim();
			const lines = raw
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter(Boolean);
			const line = lines[lines.length - 1] || "{}";
			let response: Record<string, unknown>;
			try {
				response = JSON.parse(line) as Record<string, unknown>;
			} catch {
				reject(
					new Error(
						`bad helper JSON: ${line} stderr=${Buffer.concat(err).toString("utf-8")}`,
					),
				);
				return;
			}
			resolve({ exitCode: code, response });
		});
	});
}

describe("OsSandboxBackend flag", () => {
	afterEach(() => {
		setOsSandboxBackend(undefined);
		clearOsSandboxProbeCache();
	});

	it("defaults to off / host backend", () => {
		expect(resolveOsSandboxMode({})).toBe("off");
		const b = resolveOsSandboxBackend({});
		expect(b.id).toBe("host");
		expect(b.available).toBe(true);
		expect(b).toBeInstanceOf(HostSpawnBackend);
	});

	it("experimental without helper is unavailable and fail-closed", async () => {
		const env = { QUAKE_OS_SANDBOX: "experimental" };
		expect(resolveOsSandboxMode(env)).toBe("experimental");
		const b = resolveOsSandboxBackend(env);
		expect(b).toBeInstanceOf(ExperimentalOsSandboxBackend);
		expect(b.available).toBe(false);
		expect(() => assertOsSandboxAllowsSpawn(env)).toThrow(/experimental/i);
		await expect(b.execute({ command: "echo", args: ["hi"] })).rejects.toThrow(
			/helper|experimental|silently fall back/i,
		);
	});

	it("HostSpawnBackend.execute runs a host process and returns buffers", async () => {
		const backend = new HostSpawnBackend();
		const result = await backend.execute({
			command: process.execPath,
			args: ["-e", "process.stdout.write('hello-out'); process.stderr.write('hello-err');"],
			cwd: process.cwd(),
			env: process.env,
		});
		expect(result.backendId).toBe("host");
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("hello-out");
		expect(result.stderr).toBe("hello-err");
	});

	it("HostSpawnBackend.execute streams via onStdout/onStderr", async () => {
		const backend = new HostSpawnBackend();
		const stdout: string[] = [];
		const stderr: string[] = [];
		const result = await backend.execute({
			command: process.execPath,
			args: ["-e", "process.stdout.write('S'); process.stderr.write('E');"],
			cwd: process.cwd(),
			env: process.env,
			onStdout: (chunk) => stdout.push(chunk.toString("utf-8")),
			onStderr: (chunk) => stderr.push(chunk.toString("utf-8")),
		});
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toBe("S");
		expect(stderr.join("")).toBe("E");
	});

	it("HostSpawnBackend.execute rejects on abort", async () => {
		const backend = new HostSpawnBackend();
		const ac = new AbortController();
		const promise = backend.execute({
			command: process.execPath,
			args: ["-e", "setTimeout(() => {}, 60000)"],
			cwd: process.cwd(),
			env: process.env,
			signal: ac.signal,
		});
		// Abort shortly after spawn
		setTimeout(() => ac.abort(), 80);
		await expect(promise).rejects.toThrow(/aborted/);
	});

	it("getOsSandboxBackend respects setOsSandboxBackend injection", async () => {
		const fake = new ExperimentalOsSandboxBackend();
		setOsSandboxBackend(fake);
		expect(getOsSandboxBackend()).toBe(fake);
		await expect(getOsSandboxBackend().execute({ command: "x" })).rejects.toThrow(/experimental/i);
	});

	it("experimental backend never falls back to host (no silent host spawn)", async () => {
		const experimental = new ExperimentalOsSandboxBackend();
		setOsSandboxBackend(experimental);
		const backend = getOsSandboxBackend();
		expect(backend.available).toBe(false);
		expect(backend.id).not.toBe("host");
		await expect(
			backend.execute({
				command: process.execPath,
				args: ["-e", "console.log('should-not-run')"],
			}),
		).rejects.toThrow(/does not silently fall back/i);
	});

	it("createLocalBashOperations routes through backend.execute (experimental fail-closed)", async () => {
		setOsSandboxBackend(new ExperimentalOsSandboxBackend());
		const ops = createLocalBashOperations();
		await expect(
			ops.exec("echo should-not-run", process.cwd(), {
				onData: () => {},
			}),
		).rejects.toThrow(/experimental|silently fall back|helper/i);
	});

	it("createLocalBashOperations host path executes via HostSpawnBackend", async () => {
		setOsSandboxBackend(new HostSpawnBackend());
		const ops = createLocalBashOperations();
		const chunks: Buffer[] = [];
		const result = await ops.exec("echo host-via-backend", process.cwd(), {
			onData: (d) => chunks.push(d),
			env: { ...process.env },
		});
		expect(result.exitCode).toBe(0);
		expect(Buffer.concat(chunks).toString("utf-8")).toMatch(/host-via-backend/);
	});
});

describe("S-OS.1 probe + external-runner execute protocol", () => {
	afterEach(() => {
		setOsSandboxBackend(undefined);
		clearOsSandboxProbeCache();
	});

	it("probeOsSandboxHelper returns false when path missing", async () => {
		const ok = await probeOsSandboxHelper(
			join(process.cwd(), "__no_such_quake_command_runner__.exe"),
		);
		expect(ok).toBe(false);
	});

	it("probeOsSandboxHelper returns false for empty path", async () => {
		expect(await probeOsSandboxHelper("")).toBe(false);
		expect(await probeOsSandboxHelper("   ")).toBe(false);
	});

	it("probeOsSandboxHelper returns true for stub that exits 0 on probe", async () => {
		const ok = await probeOsSandboxHelper(STUB_PATH);
		expect(ok).toBe(true);
	});

	it("probeOsSandboxHelperDetailed reports mvp-helper capabilities (not RestrictedToken)", async () => {
		const detailed = await probeOsSandboxHelperDetailed(RUNNER_PATH);
		expect(detailed.ok).toBe(true);
		expect(detailed.isolation).toBe(OS_SANDBOX_ISOLATION_MVP_HELPER);
		expect(detailed.capabilities).toEqual({
			restrictedToken: false,
			jobObject: false,
			fsRoots: true,
		});
		// Stub path re-exports the same runner
		const viaStub = await probeOsSandboxHelperDetailed(STUB_PATH);
		expect(viaStub.ok).toBe(true);
		expect(viaStub.capabilities?.restrictedToken).toBe(false);
		expect(viaStub.capabilities?.fsRoots).toBe(true);
	});

	it("parseOsSandboxHelperProbeStdout accepts capability JSON", () => {
		const parsed = parseOsSandboxHelperProbeStdout(
			JSON.stringify({
				ok: true,
				isolation: "mvp-helper",
				capabilities: { restrictedToken: false, jobObject: false, fsRoots: true },
			}),
		);
		expect(parsed.isolation).toBe("mvp-helper");
		expect(parsed.capabilities).toEqual({
			restrictedToken: false,
			jobObject: false,
			fsRoots: true,
		});
		expect(parseOsSandboxHelperProbeStdout("").capabilities).toBeUndefined();
	});

	it("resolveOsSandboxHelperPath requires existing file", () => {
		expect(resolveOsSandboxHelperPath({})).toBeUndefined();
		expect(
			resolveOsSandboxHelperPath({
				QUAKE_COMMAND_RUNNER: join(process.cwd(), "__missing_runner__"),
			}),
		).toBeUndefined();
		expect(resolveOsSandboxHelperPath({ QUAKE_COMMAND_RUNNER: STUB_PATH })).toBe(STUB_PATH);
	});

	it("resolve mode matrix: off ignores helper path", async () => {
		const env = {
			QUAKE_OS_SANDBOX: "off",
			QUAKE_COMMAND_RUNNER: STUB_PATH,
		};
		expect(resolveOsSandboxMode(env)).toBe("off");
		const sync = resolveOsSandboxBackend(env);
		expect(sync).toBeInstanceOf(HostSpawnBackend);
		expect(sync.available).toBe(true);
		const asyncB = await resolveOsSandboxBackendAsync(env);
		expect(asyncB).toBeInstanceOf(HostSpawnBackend);
	});

	it("resolve mode matrix: experimental + missing path → experimental-unavailable", async () => {
		const env = {
			QUAKE_OS_SANDBOX: "experimental",
			QUAKE_COMMAND_RUNNER: join(process.cwd(), "__no_runner_here__"),
		};
		const sync = resolveOsSandboxBackend(env);
		expect(sync.id).toBe("experimental-unavailable");
		expect(sync.available).toBe(false);
		const asyncB = await resolveOsSandboxBackendAsync(env);
		expect(asyncB.id).toBe("experimental-unavailable");
		expect(asyncB.available).toBe(false);
	});

	it("resolve mode matrix: experimental + existing path sync → external-runner available=false", () => {
		const env = {
			QUAKE_OS_SANDBOX: "experimental",
			QUAKE_COMMAND_RUNNER: STUB_PATH,
		};
		const sync = resolveOsSandboxBackend(env);
		expect(sync).toBeInstanceOf(ExternalRunnerOsSandboxBackend);
		expect(sync.id).toBe("external-runner");
		// Sync path does not probe → fail-closed available
		expect(sync.available).toBe(false);
		expect(() => assertOsSandboxAllowsSpawn(env)).toThrow(/unavailable|experimental/i);
	});

	it("resolve mode matrix: experimental + stub async probe → external-runner available=true", async () => {
		const env = {
			QUAKE_OS_SANDBOX: "experimental",
			QUAKE_COMMAND_RUNNER: STUB_PATH,
		};
		const backend = await resolveOsSandboxBackendAsync(env);
		expect(backend).toBeInstanceOf(ExternalRunnerOsSandboxBackend);
		expect(backend.id).toBe("external-runner");
		expect(backend.available).toBe(true);
		// After probe cache, sync resolve reflects available
		const cached = resolveOsSandboxBackend(env);
		expect(cached.available).toBe(true);
		expect(() => assertOsSandboxAllowsSpawn(env)).not.toThrow();
	});

	it("external-runner unprobed execute fails closed (no host fallback)", async () => {
		const unprobed = new ExternalRunnerOsSandboxBackend(STUB_PATH, false);
		await expect(unprobed.execute({ command: "x" })).rejects.toThrow(/failed probe|not probed/i);
	});

	it("external-runner + stub execute runs a simple command end-to-end", async () => {
		const backend = new ExternalRunnerOsSandboxBackend(STUB_PATH, true);
		const result = await backend.execute({
			command: process.execPath,
			args: ["-e", "process.stdout.write('via-helper'); process.stderr.write('e');"],
			cwd: process.cwd(),
			env: process.env,
		});
		expect(result.backendId).toBe("external-runner");
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("via-helper");
		expect(result.stderr).toBe("e");
		// Observability: mvp-helper isolation label (NOT RestrictedToken)
		expect(result.isolation).toBe(OS_SANDBOX_ISOLATION_MVP_HELPER);
	});

	it("quake-command-runner rejects empty command", async () => {
		const { response } = await runHelperExecute(RUNNER_PATH, {
			command: "   ",
			args: [],
			cwd: process.cwd(),
		});
		expect(response.ok).toBe(false);
		expect(response.error).toBe("invalid_request");
		expect(response.isolation).toBe(OS_SANDBOX_ISOLATION_MVP_HELPER);
	});

	it("quake-command-runner strips dangerous env vars (NODE_OPTIONS, LD_PRELOAD)", async () => {
		const { response } = await runHelperExecute(RUNNER_PATH, {
			command: process.execPath,
			args: [
				"-e",
				"process.stdout.write(JSON.stringify({NODE_OPTIONS:process.env.NODE_OPTIONS||null,LD_PRELOAD:process.env.LD_PRELOAD||null,SAFE_OK:process.env.SAFE_OK||null}))",
			],
			cwd: process.cwd(),
			env: {
				...Object.fromEntries(
					Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][],
				),
				NODE_OPTIONS: "--require ./evil.js",
				LD_PRELOAD: "/tmp/evil.so",
				SAFE_OK: "kept",
			},
		});
		expect(response.ok).toBe(true);
		expect(response.isolation).toBe(OS_SANDBOX_ISOLATION_MVP_HELPER);
		const printed = JSON.parse(String(response.stdout || "{}")) as Record<string, unknown>;
		expect(printed.NODE_OPTIONS).toBeNull();
		expect(printed.LD_PRELOAD).toBeNull();
		expect(printed.SAFE_OK).toBe("kept");
	});

	it("QUAKE_RUNNER_STRICT_FS=1 rejects .. path escapes outside workspaceRoots", async () => {
		const root = process.cwd();
		// Climb far enough that the resolved path leaves the workspace root.
		const escapeArg = join("..", "..", "..", "..", "..", "..", "..", "..", "outside-quake-strict-fs");
		const { response } = await runHelperExecute(
			RUNNER_PATH,
			{
				command: process.execPath,
				args: ["-e", "process.stdout.write('should-not-run')", escapeArg],
				cwd: root,
				workspaceRoots: [root],
			},
			{ QUAKE_RUNNER_STRICT_FS: "1" },
		);
		expect(response.ok).toBe(false);
		expect(response.error).toBe("path_escape_outside_roots");
		expect(response.isolation).toBe(OS_SANDBOX_ISOLATION_MVP_HELPER);
	});

	it("QUAKE_RUNNER_STRICT_FS off does not apply path-escape heuristic", async () => {
		// Without strict FS, a weird arg is just passed through (spawn may fail for other reasons).
		// Use a non-path command so spawn itself succeeds/fails independently of FS heuristic.
		const root = process.cwd();
		const { response } = await runHelperExecute(
			RUNNER_PATH,
			{
				command: process.execPath,
				args: ["-e", "process.stdout.write('strict-off')"],
				cwd: root,
				workspaceRoots: [root],
			},
			{ QUAKE_RUNNER_STRICT_FS: "0" },
		);
		expect(response.ok).toBe(true);
		expect(response.stdout).toBe("strict-off");
	});

	it("external-runner delivers captured stdout/stderr to streaming callbacks once", async () => {
		const backend = new ExternalRunnerOsSandboxBackend(STUB_PATH, true);
		const stdout: string[] = [];
		const stderr: string[] = [];
		const result = await backend.execute({
			command: process.execPath,
			args: ["-e", "process.stdout.write('S'); process.stderr.write('E');"],
			cwd: process.cwd(),
			env: process.env,
			onStdout: (c) => stdout.push(c.toString("utf-8")),
			onStderr: (c) => stderr.push(c.toString("utf-8")),
		});
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toBe("S");
		expect(stderr.join("")).toBe("E");
	});

	it("external-runner rejects cwd outside workspaceRoots (fail-closed)", async () => {
		const backend = new ExternalRunnerOsSandboxBackend(STUB_PATH, true);
		const root = process.cwd();
		// tmpdir is almost always outside the workspace root used here
		const outside = tmpdir();
		await expect(
			backend.execute({
				command: process.execPath,
				args: ["-e", "process.stdout.write('should-not-run')"],
				cwd: outside,
				env: process.env,
				workspaceRoots: [root],
			}),
		).rejects.toThrow(/cwd outside workspace roots|cwd_outside_roots|silently fall back/i);
	});

	it("external-runner allows cwd inside workspaceRoots", async () => {
		const backend = new ExternalRunnerOsSandboxBackend(STUB_PATH, true);
		const root = process.cwd();
		const result = await backend.execute({
			command: process.execPath,
			args: ["-e", "process.stdout.write('inside-root')"],
			cwd: root,
			env: process.env,
			workspaceRoots: [root],
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("inside-root");
	});

	it("experimental without helper still fail-closed (no silent host)", async () => {
		const env = { QUAKE_OS_SANDBOX: "experimental" };
		const backend = await resolveOsSandboxBackendAsync(env);
		expect(backend.available).toBe(false);
		expect(backend.id).toBe("experimental-unavailable");
		await expect(
			backend.execute({
				command: process.execPath,
				args: ["-e", "process.stdout.write('nope')"],
			}),
		).rejects.toThrow(/does not silently fall back|helper is installed/i);
	});

	it("ensureOsSandboxBackend + stub runs bash path command via helper", async () => {
		const backend = await resolveOsSandboxBackendAsync({
			QUAKE_OS_SANDBOX: "experimental",
			QUAKE_COMMAND_RUNNER: STUB_PATH,
		});
		expect(backend.available).toBe(true);
		expect(backend.id).toBe("external-runner");

		setOsSandboxBackend(backend);
		const ops = createLocalBashOperations();
		const chunks: Buffer[] = [];
		const result = await ops.exec("echo helper-bash-ok", process.cwd(), {
			onData: (d) => chunks.push(d),
			env: { ...process.env },
		});
		expect(result.exitCode).toBe(0);
		expect(Buffer.concat(chunks).toString("utf-8")).toMatch(/helper-bash-ok/);
	});

	it("ensureOsSandboxBackend returns injected backend without re-probe", async () => {
		const fake = new HostSpawnBackend();
		setOsSandboxBackend(fake);
		const b = await ensureOsSandboxBackend({ QUAKE_OS_SANDBOX: "experimental" });
		expect(b).toBe(fake);
	});

	it("OS_SANDBOX_PROBE_ARG is stable contract", () => {
		expect(OS_SANDBOX_PROBE_ARG).toBe("--quake-sandbox-probe");
	});

	it("parseOsSandboxHelperResponse accepts valid final JSON", () => {
		const r = parseOsSandboxHelperResponse(
			JSON.stringify({
				ok: true,
				exitCode: 0,
				stdout: "a",
				stderr: "b",
				isolation: "mvp-helper",
			}),
		);
		expect(r.ok).toBe(true);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("a");
		expect(r.stderr).toBe("b");
		expect(r.isolation).toBe("mvp-helper");
	});

	it("parseOsSandboxHelperResponse rejects garbage", () => {
		expect(() => parseOsSandboxHelperResponse("not-json")).toThrow(/invalid helper JSON/i);
		expect(() => parseOsSandboxHelperResponse("{}")).toThrow(/missing boolean ok/i);
	});

	it("serializeOsSandboxEnv drops undefined", () => {
		const out = serializeOsSandboxEnv({ A: "1", B: undefined, C: "x" });
		expect(out).toEqual({ A: "1", C: "x" });
		expect(serializeOsSandboxEnv(undefined)).toBeUndefined();
	});
});
