import { describe, expect, it, beforeEach } from "vitest";
import {
	builtinApprovalPresets,
	guardianRuntime,
	gateToolExecution,
	requestGuardianApproval,
	riskForTool,
	inferApprovalKind,
	DEFAULT_DENIAL_CIRCUIT_BREAKER,
} from "./index.js";
import { createSandbox, setActiveSandbox } from "../sandbox/index.js";
import { evaluateCommand } from "../execpolicy/policy.js";
import { sessionNetworkPolicy } from "../network-policy/index.js";

describe("Codex-aligned guardian / approval presets", () => {
	beforeEach(() => {
		guardianRuntime.setPreset("auto");
		guardianRuntime.clearSessionApprovals();
		guardianRuntime.setUiHandler(undefined);
		guardianRuntime.setWorkspaceRoot(process.cwd());
		guardianRuntime.clearDecisionTrail();
		guardianRuntime.endTurn();
		guardianRuntime.setCircuitBreakerLimit(DEFAULT_DENIAL_CIRCUIT_BREAKER);
		guardianRuntime.beginTurn("test-turn");
	});

	it("exposes Codex builtin presets", () => {
		const presets = builtinApprovalPresets();
		expect(presets.map((p) => p.id)).toEqual(["read-only", "auto", "full-access"]);
		expect(presets.find((p) => p.id === "full-access")?.label).toBe("Full Access");
	});

	it("full-access auto-allows without UI", async () => {
		guardianRuntime.setPreset("full-access");
		const gate = await guardianRuntime.requestApproval({
			tool: "bash",
			summary: "sudo apt install x",
			risk: "high",
			needsPrompt: true,
			reason: "sudo",
		});
		expect(gate.allow).toBe(true);
		expect(gate.decision).toBe("auto");
	});

	it("acceptForSession caches subsequent matching prompts", async () => {
		guardianRuntime.setPreset("auto");
		let calls = 0;
		guardianRuntime.setUiHandler(async () => {
			calls += 1;
			return calls === 1 ? "acceptForSession" : "decline";
		});
		const first = await guardianRuntime.requestApproval({
			tool: "bash",
			summary: "sudo ls",
			risk: "high",
			needsPrompt: true,
		});
		expect(first.allow).toBe(true);
		expect(first.decision).toBe("acceptForSession");

		const second = await guardianRuntime.requestApproval({
			tool: "bash",
			summary: "sudo ls",
			risk: "high",
			needsPrompt: true,
		});
		expect(second.allow).toBe(true);
		expect(second.decision).toBe("auto");
		expect(calls).toBe(1);
	});

	it("acceptWithExecpolicyAmendment allows matching argv prefix", async () => {
		guardianRuntime.setPreset("auto");
		guardianRuntime.setUiHandler(undefined);
		const pending = guardianRuntime.requestApproval({
			tool: "bash",
			summary: "sudo ls",
			command: "sudo ls",
			risk: "high",
			needsPrompt: true,
		});
		await new Promise((r) => setTimeout(r, 10));
		const id = guardianRuntime.listPending()[0]?.id;
		expect(id).toBeTruthy();
		expect(
			guardianRuntime.respond({
				id: id!,
				decision: "acceptWithExecpolicyAmendment",
				execpolicyAmendment: { command: ["sudo"] },
			}),
		).toBe(true);
		const first = await pending;
		expect(first.allow).toBe(true);

		// Different args, same prefix — no UI
		guardianRuntime.setUiHandler(async () => {
			throw new Error("should not prompt");
		});
		const second = await guardianRuntime.requestApproval({
			tool: "bash",
			summary: "sudo ls -la",
			command: "sudo ls -la",
			risk: "high",
			needsPrompt: true,
		});
		expect(second.allow).toBe(true);
		expect(second.decision).toBe("auto");
	});

	it("session prefix allow never overrides forbidden", async () => {
		guardianRuntime.setPreset("auto");
		guardianRuntime.rememberSessionPrefixAllow(["rm"]);
		const gate = await gateToolExecution({
			tool: "bash",
			summary: "rm -rf /",
			cwd: process.cwd(),
			command: "rm -rf /",
		});
		expect(gate.allow).toBe(false);
		expect(gate.decision).toBe("forbidden");
	});

	it("maps terminal policy modes to presets", () => {
		expect(guardianRuntime.setFromTerminalPolicy("allow-all").id).toBe("full-access");
		expect(guardianRuntime.setFromTerminalPolicy("disabled").id).toBe("read-only");
		expect(guardianRuntime.setFromTerminalPolicy("safe").id).toBe("auto");
	});

	it("respond resolves pending request", async () => {
		guardianRuntime.setPreset("auto");
		guardianRuntime.setUiHandler(undefined);
		const pending = guardianRuntime.requestApproval({
			tool: "bash",
			summary: "unique-cmd-xyz",
			risk: "high",
			needsPrompt: true,
		});
		// give microtask for pending registration
		await new Promise((r) => setTimeout(r, 10));
		const list = guardianRuntime.listPending();
		expect(list.length).toBeGreaterThanOrEqual(1);
		const id = list[0].id;
		expect(guardianRuntime.respond({ id, decision: "accept" })).toBe(true);
		const result = await pending;
		expect(result.allow).toBe(true);
	});

	it("legacy requestGuardianApproval still works", async () => {
		guardianRuntime.setPreset("full-access");
		const d = await requestGuardianApproval({
			tool: "bash",
			summary: "x",
			risk: "high",
		});
		expect(d).toBe("allow");
	});

	it("riskForTool maps decisions", () => {
		expect(riskForTool("bash", { decision: "prompt" })).toBe("high");
		expect(riskForTool("read")).toBe("low");
	});

	it("infers exec vs file_change approval kinds", () => {
		expect(inferApprovalKind("bash")).toBe("exec");
		expect(inferApprovalKind("apply_patch", { kind: "file_change" })).toBe("file_change");
		expect(inferApprovalKind("edit")).toBe("file_change");
	});

	it("tags file_change kind on apply_patch approval", async () => {
		guardianRuntime.setUiHandler(async (req) => {
			expect(req.kind).toBe("file_change");
			expect(req.details?.kind).toBe("file_change");
			return "accept";
		});
		const gate = await guardianRuntime.requestApproval({
			tool: "apply_patch",
			summary: "patch files",
			risk: "high",
			needsPrompt: true,
			details: { kind: "file_change", files: [{ path: "a.ts", kind: "modify" }] },
		});
		expect(gate.allow).toBe(true);
		expect(gate.kind).toBe("file_change");
		const trail = guardianRuntime.getDecisionTrail();
		expect(trail.some((e) => e.kind === "file_change" && e.allow)).toBe(true);
	});

	it("circuit-breaker trips after consecutive declines", async () => {
		const { setGuardianInterruptHook } = await import("./runtime.js");
		const hooks: string[] = [];
		setGuardianInterruptHook((r) => hooks.push(r));
		guardianRuntime.setCircuitBreakerLimit(3);
		guardianRuntime.beginTurn("circuit-turn");
		guardianRuntime.setUiHandler(async () => "decline");
		for (let i = 0; i < 3; i += 1) {
			const g = await guardianRuntime.requestApproval({
				tool: "bash",
				summary: `risky-${i}`,
				risk: "high",
				needsPrompt: true,
			});
			expect(g.allow).toBe(false);
		}
		expect(guardianRuntime.isCircuitTripped()).toBe(true);
		expect(hooks.length).toBeGreaterThanOrEqual(1);
		const next = await guardianRuntime.requestApproval({
			tool: "bash",
			summary: "after-trip",
			risk: "high",
			needsPrompt: true,
		});
		expect(next.allow).toBe(false);
		expect(next.circuitTripped).toBe(true);
		expect(next.reason).toMatch(/circuit-breaker|interrupt/i);
		expect(guardianRuntime.getDecisionTrail().length).toBeGreaterThanOrEqual(3);
		setGuardianInterruptHook(undefined);
	});
});

describe("gateToolExecution", () => {
	beforeEach(() => {
		guardianRuntime.setPreset("auto");
		guardianRuntime.clearSessionApprovals();
		guardianRuntime.setUiHandler(undefined);
		guardianRuntime.setWorkspaceRoot(process.cwd());
		guardianRuntime.endTurn();
		guardianRuntime.beginTurn("gate-turn");
		setActiveSandbox(
			createSandbox({ mode: "workspace-write", workspaceRoot: process.cwd() }),
		);
	});

	it("auto-allows normal bash under Default preset", async () => {
		const r = await gateToolExecution({
			tool: "bash",
			summary: "git status",
			cwd: process.cwd(),
			command: "git status",
		});
		expect(r.allow).toBe(true);
	});

	it("denies write path outside workspace under Default", async () => {
		const r = await gateToolExecution({
			tool: "write",
			summary: "write /tmp/escape.txt",
			cwd: process.cwd(),
			path: "C:\\Windows\\Temp\\quake-escape-test.txt",
		});
		expect(r.allow).toBe(false);
		expect(r.decision).toBe("forbidden");
	});

	it("forbids destructive shell via execpolicy", () => {
		const m = evaluateCommand("rm -rf /");
		expect(m.decision).toBe("forbidden");
	});

	it("full-access auto-allows sudo without UI", async () => {
		guardianRuntime.setPreset("full-access");
		const r = await gateToolExecution({
			tool: "bash",
			summary: "sudo ls",
			cwd: process.cwd(),
			command: "sudo ls",
		});
		expect(r.allow).toBe(true);
		expect(r.decision).toBe("auto");
	});

	it("auto preset does not early-allow network host without approval path", async () => {
		// git clone is execpolicy-allow but extracts a host → must not skip network evaluate
		let uiCalls = 0;
		guardianRuntime.setUiHandler(async (req) => {
			uiCalls += 1;
			expect(req.networkApprovalContext?.host).toBe("github.com");
			return "accept";
		});
		const r = await gateToolExecution({
			tool: "bash",
			summary: "git clone https://github.com/foo/bar.git",
			cwd: process.cwd(),
			command: "git clone https://github.com/foo/bar.git",
		});
		expect(r.allow).toBe(true);
		expect(uiCalls).toBe(1);
		expect(r.decision).not.toBe("forbidden");
	});

	it("hard-denies denied network host without UI", async () => {
		sessionNetworkPolicy.denyHost("evil.example.com");
		let uiCalls = 0;
		guardianRuntime.setUiHandler(async () => {
			uiCalls += 1;
			return "accept";
		});
		const r = await gateToolExecution({
			tool: "bash",
			summary: "curl https://evil.example.com/x",
			cwd: process.cwd(),
			command: "curl https://evil.example.com/x",
		});
		expect(r.allow).toBe(false);
		expect(r.decision).toBe("forbidden");
		expect(r.kind).toBe("network");
		expect(r.reason).toMatch(/network policy denied host/i);
		expect(r.reason).toMatch(/evil\.example\.com/);
		expect(uiCalls).toBe(0);
	});

	it("auto-allows when network host is approved for session", async () => {
		sessionNetworkPolicy.allowHost("registry.npmjs.org");
		let uiCalls = 0;
		guardianRuntime.setUiHandler(async () => {
			uiCalls += 1;
			return "decline";
		});
		const r = await gateToolExecution({
			tool: "bash",
			summary: "npm install https://registry.npmjs.org/lodash",
			cwd: process.cwd(),
			command: "npm install https://registry.npmjs.org/lodash",
		});
		expect(r.allow).toBe(true);
		expect(r.decision).toBe("auto");
		expect(uiCalls).toBe(0);
	});
});
