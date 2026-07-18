/**
 * Gating integration tests — drive shipped entry points for Codex-parity gaps.
 * Not re-implementations: uses real TurnLifecycle, Agent queues, guardian, sandbox,
 * execpolicy, turn-diff history.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { Agent } from "@mrquake/quakecode-agent-core";
import { TurnLifecycle, turnLifecycle } from "./turn/lifecycle.js";
import {
	guardianRuntime,
	gateToolExecution,
	setGuardianInterruptHook,
	DEFAULT_DENIAL_CIRCUIT_BREAKER,
	inferApprovalKind,
} from "./guardian/index.js";
import { createSandbox, setActiveSandbox } from "./sandbox/index.js";
import { evaluateCommand } from "./execpolicy/policy.js";
import {
	turnDiffAggregator,
	rebuildTurnDiffFromDetails,
	serializeTurnDiffSnapshot,
	deserializeTurnDiffSnapshot,
	rebuildTurnDiffFromSessionEntries,
} from "./turn-diff/index.js";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";

describe("Codex parity integration — turn lifecycle + steer expectedTurnId", () => {
	it("steer mismatch fails; interrupt emits interrupted; clears agent queues", () => {
		const life = new TurnLifecycle();
		const { event: started } = life.beginTurn("turn-live-42");
		expect(started.type).toBe("turn_started");
		expect(started.turnId).toBe("turn-live-42");

		const bad = life.assertExpectedTurnId("wrong-id");
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.error).toMatch(/mismatch/);

		const ok = life.assertExpectedTurnId("turn-live-42");
		expect(ok.ok).toBe(true);

		// Agent steer queue + abort clears (shipped Agent.abort)
		const agent = new Agent();
		agent.steer({ role: "user", content: "mid-turn steer", timestamp: Date.now() });
		agent.followUp({ role: "user", content: "later", timestamp: Date.now() });
		expect(agent.hasQueuedMessages()).toBe(true);
		agent.abort();
		expect(agent.hasQueuedMessages()).toBe(false);

		const aborted = life.abortTurn("interrupted");
		expect("event" in aborted).toBe(true);
		if ("event" in aborted) {
			expect(aborted.event.type).toBe("turn_aborted");
			expect(aborted.event.reason).toBe("interrupted");
			expect(aborted.event.turnId).toBe("turn-live-42");
		}
	});

	it("process-global turnLifecycle completes after start", () => {
		// Isolate: begin then complete
		const { event } = turnLifecycle.beginTurn(`gating-${Date.now()}`);
		expect(event.type).toBe("turn_started");
		const done = turnLifecycle.completeTurn();
		expect("event" in done).toBe(true);
		if ("event" in done) expect(done.event.type).toBe("turn_completed");
	});
});

describe("Codex parity integration — guardian exec vs file_change + circuit", () => {
	beforeEach(() => {
		guardianRuntime.setPreset("auto");
		guardianRuntime.clearSessionApprovals();
		guardianRuntime.clearDecisionTrail();
		guardianRuntime.endTurn();
		guardianRuntime.setCircuitBreakerLimit(DEFAULT_DENIAL_CIRCUIT_BREAKER);
		guardianRuntime.beginTurn("int-guardian");
		guardianRuntime.setUiHandler(undefined);
		setGuardianInterruptHook(undefined);
		setActiveSandbox(createSandbox({ mode: "workspace-write", workspaceRoot: process.cwd() }));
	});

	it("distinguishes exec vs file_change kinds and records trail", async () => {
		const kinds: string[] = [];
		guardianRuntime.setUiHandler(async (req) => {
			kinds.push(req.kind);
			return "accept";
		});
		const execGate = await guardianRuntime.requestApproval({
			tool: "bash",
			summary: "sudo whoami",
			risk: "high",
			needsPrompt: true,
			details: { kind: "exec", command: "sudo whoami" },
		});
		expect(execGate.kind).toBe("exec");
		expect(inferApprovalKind("bash")).toBe("exec");

		const fileGate = await guardianRuntime.requestApproval({
			tool: "apply_patch",
			summary: "patch a.ts",
			risk: "high",
			needsPrompt: true,
			details: { kind: "file_change", files: [{ path: "a.ts", kind: "modify" }] },
		});
		expect(fileGate.kind).toBe("file_change");
		expect(kinds).toEqual(["exec", "file_change"]);
		const trail = guardianRuntime.getDecisionTrail();
		expect(trail.some((e) => e.kind === "exec")).toBe(true);
		expect(trail.some((e) => e.kind === "file_change")).toBe(true);
	});

	it("N consecutive declines trip circuit and fire interrupt hook", async () => {
		const interrupts: string[] = [];
		setGuardianInterruptHook((reason) => {
			interrupts.push(reason);
		});
		guardianRuntime.setCircuitBreakerLimit(3);
		guardianRuntime.beginTurn("circuit-int");
		guardianRuntime.setUiHandler(async () => "decline");
		for (let i = 0; i < 3; i += 1) {
			await guardianRuntime.requestApproval({
				tool: "bash",
				summary: `deny-${i}`,
				risk: "high",
				needsPrompt: true,
			});
		}
		expect(guardianRuntime.isCircuitTripped()).toBe(true);
		expect(interrupts.length).toBeGreaterThanOrEqual(1);
		expect(interrupts[0]).toMatch(/circuit-breaker|interrupt/i);
		const trail = guardianRuntime.getDecisionTrail();
		expect(trail.filter((e) => !e.allow).length).toBeGreaterThanOrEqual(3);
	});
});

describe("Codex parity integration — sandbox + execpolicy", () => {
	it("blocks path escape under workspace-write; full-access allows gate path", async () => {
		const ws = mkdtempSync(join(tmpdir(), "quake-sbx-"));
		setActiveSandbox(createSandbox({ mode: "workspace-write", workspaceRoot: ws }));
		guardianRuntime.setPreset("auto");
		guardianRuntime.setWorkspaceRoot(ws);
		guardianRuntime.setUiHandler(undefined);
		guardianRuntime.endTurn();
		guardianRuntime.beginTurn("sbx");

		const denied = await gateToolExecution({
			tool: "write",
			summary: "escape",
			cwd: ws,
			path: join(tmpdir(), "outside-escape.txt"),
		});
		expect(denied.allow).toBe(false);
		expect(denied.decision).toBe("forbidden");

		// Sibling-prefix path (proj vs projEVIL) must also be forbidden via gate
		const parent = dirname(ws);
		const sibling = join(parent, basename(ws) + "EVIL");
		mkdirSync(sibling, { recursive: true });
		const siblingFile = join(sibling, "pwn.txt");
		const siblingDeny = await gateToolExecution({
			tool: "apply_patch",
			summary: "sibling escape",
			cwd: ws,
			path: siblingFile,
		});
		expect(siblingDeny.allow).toBe(false);
		expect(siblingDeny.decision).toBe("forbidden");

		guardianRuntime.setPreset("full-access");
		const allowed = await gateToolExecution({
			tool: "write",
			summary: "escape-full",
			cwd: ws,
			path: join(tmpdir(), "outside-full.txt"),
		});
		expect(allowed.allow).toBe(true);
	});

	it("execpolicy forbids destructive shell; prompts for sudo", () => {
		expect(evaluateCommand("rm -rf /").decision).toBe("forbidden");
		expect(evaluateCommand("sudo ls").decision).toBe("prompt");
		expect(evaluateCommand("git status").decision).toBe("allow");
	});

	it("read-only sandbox denies writes inside workspace", () => {
		const ws = mkdtempSync(join(tmpdir(), "quake-ro-"));
		const sb = createSandbox({ mode: "read-only", workspaceRoot: ws });
		expect(sb.checkWritePath(join(ws, "a.ts")).allowed).toBe(false);
		expect(sb.checkCommand("echo hi").allowed).toBe(false);
		expect(sb.checkCommand("echo hi").decision).toBe("prompt");
	});
});

describe("Codex parity integration — turn-diff history", () => {
	it("live aggregator + rebuild from details + session entries", () => {
		const turnId = "hist-turn-9";
		turnDiffAggregator.beginTurn(turnId);
		const patch = `*** Begin Patch
*** Add File: packages/a/src/x.ts
+export const x = 1;
*** Update File: packages/a/src/y.ts
@@
-const y = 0;
+const y = 1;
*** End Patch`;
		turnDiffAggregator.recordApplyPatchDetails({ patch });
		const live = turnDiffAggregator.snapshot();
		expect(live.files.length).toBeGreaterThanOrEqual(2);
		expect(live.files.every((f) => f.diff)).toBe(true);

		const ser = serializeTurnDiffSnapshot(live);
		const fromSer = deserializeTurnDiffSnapshot(ser);
		expect(fromSer?.files.length).toBe(live.files.length);

		const rebuilt = rebuildTurnDiffFromDetails([{ patch, diff: patch }], turnId);
		expect(rebuilt.files.some((f) => f.path.includes("x.ts"))).toBe(true);
		expect(rebuilt.files.some((f) => f.path.includes("y.ts"))).toBe(true);

		// Simulate SessionManager custom entries
		const entries = [
			{ type: "custom" as const, customType: "turn-diff", data: ser },
			{ type: "custom" as const, customType: "other", data: {} },
		];
		const fromSession = rebuildTurnDiffFromSessionEntries(entries, turnId);
		expect(fromSession?.turnId).toBe(turnId);
		expect(fromSession?.files.length).toBeGreaterThanOrEqual(2);
		expect(fromSession?.files.every((f) => f.diff && f.diff.length > 0)).toBe(true);
	});
});
