import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.js";
import { extractStage1FromContent, loadStage1Records, runPhase1, writeStage1Record } from "./phase1.js";
import { runPhase2 } from "./phase2.js";
import { runMemoryStartup } from "./startup.js";
import { recordMemoryRead, loadReadUsage } from "./usage.js";

describe("Phase 1 + Phase 2 artifact pipeline", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const d of dirs) {
			try {
				rmSync(d, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
		dirs.length = 0;
	});

	function tempRoot(): string {
		const root = mkdtempSync(join(tmpdir(), "quake-mem-phase-"));
		dirs.push(root);
		return root;
	}

	it("extractStage1FromContent finds preference and error signals", () => {
		const rec = extractStage1FromContent({
			thread_id: "t1",
			rollout_path: "/tmp/t1.jsonl",
			cwd: "/proj",
			content: "Please prefer tabs over spaces.\nError: failed build\n",
			source_updated_at: "2026-01-01T00:00:00.000Z",
		});
		expect(rec.outcome).toBe("succeeded");
		expect(rec.raw_memory).toMatch(/prefer|Failure/i);
		expect(rec.rollout_summary.length).toBeGreaterThan(0);
	});

	it("runPhase1 writes stage1 json then Phase2 syncs raw_memories and summary", () => {
		const root = tempRoot();
		const now = Date.now();
		const p1 = runPhase1(
			[
				{
					thread_id: "session-alpha",
					rollout_path: "/x/session-alpha.jsonl",
					cwd: "/workspace",
					content: "User said always use pnpm. Bug: regression in parser.\n",
					source_updated_at: new Date(now - 120_000).toISOString(),
				},
				{
					thread_id: "session-beta",
					rollout_path: "/x/session-beta.jsonl",
					cwd: "/workspace",
					content: "trivial hello\n",
					source_updated_at: new Date(now - 120_000).toISOString(),
				},
			],
			{ memoriesRoot: root, minIdleMs: 0, maxAgeMs: 7 * 24 * 3600_000, now, maxJobs: 8 },
		);
		expect(p1.claimed).toBeGreaterThan(0);
		expect(p1.succeeded_with_output).toBeGreaterThanOrEqual(1);
		const stageFiles = loadStage1Records(root);
		expect(stageFiles.some((r) => r.thread_id === "session-alpha")).toBe(true);

		const p2 = runPhase2({ memoriesRoot: root, maxRawMemories: 10 });
		expect(p2.ok).toBe(true);
		expect(p2.skipped).toBeFalsy();
		expect(existsSync(join(root, "raw_memories.md"))).toBe(true);
		expect(existsSync(join(root, "memory_summary.md"))).toBe(true);
		const raw = readFileSync(join(root, "raw_memories.md"), "utf-8");
		expect(raw).toContain("session-alpha");
		const summary = readFileSync(join(root, "memory_summary.md"), "utf-8");
		expect(summary.startsWith("v1")).toBe(true);
		expect(summary).toContain("session-alpha");

		// Second Phase2 with no new stage1 changes: still ok (may or may not change fingerprint)
		const p2b = runPhase2({ memoriesRoot: root, maxRawMemories: 10 });
		expect(p2b.ok).toBe(true);
	});

	it("Phase2 is no-op success when claim is blocked (lock)", () => {
		const root = tempRoot();
		// Simulate running phase2 lock
		writeFileSync(
			join(root, ".jobs.json"),
			JSON.stringify([
				{
					name: "phase2",
					token: "lock",
					claimed_at: Date.now(),
					ttl_ms: 120_000,
					status: "running",
				},
			]),
			"utf-8",
		);
		const res = runPhase2({ memoriesRoot: root });
		expect(res.ok).toBe(true);
		expect(res.skipped).toBe(true);
	});

	it("redactSecrets strips API keys before write path", () => {
		const cleaned = redactSecrets("token sk-abcdefghijklmnopqrstuvwxyz password=supersecret");
		expect(cleaned).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
		expect(cleaned).toContain("[REDACTED_SECRET]");
	});

	it("writeStage1Record + markSelected via phase2", () => {
		const root = tempRoot();
		const rec = extractStage1FromContent({
			thread_id: "t-mark",
			rollout_path: "/r.jsonl",
			cwd: "/c",
			content: "prefer eslint\n",
			source_updated_at: new Date().toISOString(),
		});
		writeStage1Record(root, rec);
		const p2 = runPhase2({ memoriesRoot: root });
		expect(p2.selected).toBeGreaterThanOrEqual(1);
		const updated = loadStage1Records(root).find((r) => r.thread_id === "t-mark");
		expect(updated?.selected_for_phase2).toBe(true);
	});

	it("runMemoryStartup from jsonl fixtures", () => {
		const root = tempRoot();
		const sessionDir = mkdtempSync(join(tmpdir(), "quake-sess-"));
		dirs.push(sessionDir);
		writeFileSync(
			join(sessionDir, "fixture-thread.jsonl"),
			JSON.stringify({ type: "message", text: "prefer bun runtime always" }) + "\nerror failed\n",
			"utf-8",
		);
		const result = runMemoryStartup({
			memoriesRoot: root,
			sessionDir,
			cwd: "/proj",
			minIdleMs: 0,
			maxJobs: 4,
			now: Date.now() + 60_000,
		});
		expect(result.enabled).toBe(true);
		expect(result.phase1?.claimed).toBeGreaterThanOrEqual(1);
		expect(existsSync(join(root, "memory_summary.md"))).toBe(true);
	});

	it("recordMemoryRead persists usage", () => {
		const root = tempRoot();
		recordMemoryRead("MEMORY.md", root);
		recordMemoryRead("MEMORY.md", root);
		const usage = loadReadUsage(root);
		expect(usage.find((u) => u.path === "MEMORY.md")?.count).toBe(2);
	});
});
