import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isMemoriesBackend } from "./backend-interface.js";
import {
	attachTurnMemoryReadsCitation,
	isThreadIdLike,
	parseMemoryCitation,
	threadIdsFromMemoryCitation,
} from "./citations.js";
import {
	assertMemoryRootPreserved,
	clearMemoryRootContents,
	memoryRootIsEmpty,
} from "./control.js";
import { loadMemoryFeatureConfig, shouldRunMemoryStartup } from "./features.js";
import { rateLimitsOk, snapshotAllowsStartup } from "./guard.js";
import { LocalMemoriesBackend } from "./local-backend.js";
import { getMemoryMetrics, resetMemoryMetrics } from "./metrics.js";
import { extractStage1WithOptionalLlm, runPhase1Async, writeStage1Record } from "./phase1.js";
import { runPhase2 } from "./phase2.js";
import { rebuildFromStage1Dir } from "./storage.js";
import { runMemoryStartupAsync } from "./startup.js";
import {
	prepareMemoryWorkspace,
	resetMemoryWorkspaceBaseline,
	validateConsolidationArtifacts,
} from "./workspace.js";
import { parseStageOneModelJson } from "./write-prompts.js";

describe("residual Codex memory modules", () => {
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
		resetMemoryMetrics();
	});

	function temp(): string {
		const root = mkdtempSync(join(tmpdir(), "quake-mem-res-"));
		dirs.push(root);
		return root;
	}

	it("LocalMemoriesBackend satisfies MemoriesBackend interface", () => {
		expect(isMemoriesBackend(new LocalMemoriesBackend(temp()))).toBe(true);
	});

	it("feature flags skip subagent/ephemeral and respect env", () => {
		expect(shouldRunMemoryStartup({ ephemeral: true })).toBe(false);
		expect(shouldRunMemoryStartup({ isSubagent: true })).toBe(false);
		const cfg = loadMemoryFeatureConfig({ QUAKE_MEMORY_TOOL: "0" } as NodeJS.ProcessEnv);
		expect(cfg.memoryTool).toBe(false);
	});

	it("control clear preserves root directory", () => {
		const root = temp();
		writeFileSync(join(root, "MEMORY.md"), "x\n");
		clearMemoryRootContents(root);
		expect(assertMemoryRootPreserved(root)).toBe(true);
		expect(memoryRootIsEmpty(root)).toBe(true);
	});

	it("guard rate limit snapshot gate", async () => {
		expect(
			snapshotAllowsStartup(
				{ primary: { used_percent: 10 }, secondary: { used_percent: 20 } },
				5,
			),
		).toBe(true);
		expect(
			snapshotAllowsStartup(
				{ rate_limit_reached_type: "primary", primary: { used_percent: 0 } },
				5,
			),
		).toBe(false);
		const ok = await rateLimitsOk(
			{
				getSnapshots: () => [{ limit_id: "codex", primary: { used_percent: 99 } }],
			},
			20,
		);
		expect(ok).toBe(false);
	});

	it("workspace baseline diff + validation", () => {
		const root = temp();
		writeFileSync(join(root, "MEMORY.md"), "# MEMORY\n");
		writeFileSync(join(root, "memory_summary.md"), "v1\nsummary\n");
		resetMemoryWorkspaceBaseline(root);
		writeFileSync(join(root, "MEMORY.md"), "# MEMORY\nchanged\n");
		const diff = prepareMemoryWorkspace(root);
		expect(diff.has_changes).toBe(true);
		expect(existsSync(join(root, "phase2_workspace_diff.md"))).toBe(true);
		expect(validateConsolidationArtifacts(root).ok).toBe(true);
	});

	it("storage rebuild from stage1 records", () => {
		const root = temp();
		const rec = {
			thread_id: "t-store",
			rollout_path: "/r",
			cwd: "/c",
			source_updated_at: new Date().toISOString(),
			raw_memory: "# raw\n- prefer tabs\n",
			rollout_summary: "tabs pref",
			rollout_slug: "t-store",
			outcome: "succeeded" as const,
			generated_at: new Date().toISOString(),
		};
		writeStage1Record(root, rec);
		const { raw_path, summaries } = rebuildFromStage1Dir(root);
		expect(existsSync(raw_path)).toBe(true);
		expect(readFileSync(raw_path, "utf-8")).toContain("t-store");
		expect(summaries.written).toBe(1);
	});

	it("LLM stage-one completer path + parse", async () => {
		const parsed = parseStageOneModelJson(
			'```json\n{"rollout_summary":"s","rollout_slug":"slug","raw_memory":"# m\\n"}\n```',
		);
		expect(parsed?.rollout_slug).toBe("slug");
		const rec = await extractStage1WithOptionalLlm(
			{
				thread_id: "llm1",
				rollout_path: "/x",
				cwd: "/c",
				content: "noise",
			},
			async () =>
				'{"rollout_summary":"from-llm","rollout_slug":"from-llm","raw_memory":"# LLM mem\\n"}',
		);
		expect(rec.raw_memory).toContain("LLM mem");
		expect(rec.outcome).toBe("succeeded");
	});

	it("runPhase1Async with completer", async () => {
		const root = temp();
		const result = await runPhase1Async(
			[
				{
					thread_id: "async1",
					rollout_path: "/a",
					cwd: "/c",
					content: "hello",
					source_updated_at: new Date(Date.now() - 120_000).toISOString(),
				},
			],
			{
				memoriesRoot: root,
				minIdleMs: 0,
				useLlmStageOne: true,
				stageOneCompleter: () =>
					JSON.stringify({
						rollout_summary: "sum",
						rollout_slug: "async1",
						raw_memory: "# from async\n",
					}),
			},
		);
		expect(result.succeeded_with_output).toBe(1);
	});

	it("startup async skips when rate limited", async () => {
		const root = temp();
		const res = await runMemoryStartupAsync({
			memoriesRoot: root,
			rateLimitProvider: {
				getSnapshots: () => [
					{ rate_limit_reached_type: "primary", primary: { used_percent: 100 } },
				],
			},
		});
		expect(res.enabled).toBe(false);
		expect(res.skipped_reason).toBe("rate_limit");
	});

	it("thread id filter + turn citation attach", () => {
		const uuid = "550e8400-e29b-41d4-a716-446655440000";
		expect(isThreadIdLike(uuid)).toBe(true);
		expect(isThreadIdLike("not-uuid")).toBe(false);
		const cit = parseMemoryCitation([
			`<memory_citation>\n<rollout_ids>\n${uuid}\nnope\n</rollout_ids>\n</memory_citation>`,
		])!;
		expect(threadIdsFromMemoryCitation(cit)).toEqual([uuid]);
		const answer = attachTurnMemoryReadsCitation("Done.", ["MEMORY.md"], [uuid]);
		expect(answer).toContain("MEMORY.md:1-1");
		expect(answer).toContain(uuid);
	});

	it("phase2 writes workspace fields and metrics tick", () => {
		const root = temp();
		const p2 = runPhase2({ memoriesRoot: root });
		expect(p2.ok).toBe(true);
		expect(typeof p2.workspace_has_changes).toBe("boolean");
		expect(p2.artifacts_ok).toBe(true);
		expect(getMemoryMetrics().phase2_run).toBeGreaterThanOrEqual(1);
	});
});
