/**
 * Phase 2 (TS artifact contract): stage-1 records → raw_memories.md, rollout_summaries/,
 * memory_summary.md, MEMORY.md registry sync. No-op success when workspace unchanged.
 */

import {
	createHash,
} from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pruneOldExtensionResources, seedExtensionInstructions } from "./extensions.js";
import { claimJob, completeJob, type JobStore } from "./job-store.js";
import { incMemoryMetric } from "./metrics.js";
import { loadStage1Records } from "./phase1.js";
import { redactSecrets } from "./redact.js";
import type { Stage1Record } from "./stage1-types.js";
import {
	prepareMemoryWorkspace,
	resetMemoryWorkspaceBaseline,
	validateConsolidationArtifacts,
} from "./workspace.js";

export interface Phase2Options {
	memoriesRoot: string;
	maxRawMemories?: number;
	jobStore?: JobStore;
	/** For tests: fixed "now" for extension resource prune */
	now?: number;
}

export interface Phase2Result {
	/** Whether any file content changed */
	changed: boolean;
	/** true when lock was taken and run finished without error */
	ok: boolean;
	/** skipped because another phase2 holds the lock */
	skipped?: boolean;
	selected: number;
	pruned_summaries: number;
	/** Extension resources pruned (Codex prune_old_extension_resources) */
	pruned_extension_resources: number;
	/** Workspace had changes vs baseline */
	workspace_has_changes?: boolean;
	/** Consolidation artifact validation after run */
	artifacts_ok?: boolean;
}

const DEFAULT_MAX_RAW = 40;

export function ensureLayout(root: string): void {
	mkdirSync(root, { recursive: true });
	mkdirSync(join(root, "rollout_summaries"), { recursive: true });
	mkdirSync(join(root, "skills"), { recursive: true });
	mkdirSync(join(root, "extensions", "ad_hoc", "notes"), { recursive: true });
	mkdirSync(join(root, "stage1"), { recursive: true });
	// Codex seed_extension_instructions
	try {
		seedExtensionInstructions(root);
	} catch {
		/* seed best-effort */
	}
}

function fingerprintWorkspace(root: string): string {
	const parts: string[] = [];
	for (const name of ["raw_memories.md", "memory_summary.md", "MEMORY.md"]) {
		const p = join(root, name);
		if (existsSync(p)) parts.push(`${name}:${readFileSync(p, "utf-8")}`);
	}
	const sumDir = join(root, "rollout_summaries");
	if (existsSync(sumDir)) {
		for (const f of readdirSync(sumDir).filter((n) => n.endsWith(".md")).sort()) {
			parts.push(`${f}:${readFileSync(join(sumDir, f), "utf-8")}`);
		}
	}
	return createHash("sha256").update(parts.join("\n---\n")).digest("hex");
}

function rankStage1(records: Stage1Record[], max: number): Stage1Record[] {
	const withOutput = records.filter((r) => r.outcome === "succeeded" && r.raw_memory.trim());
	withOutput.sort((a, b) => {
		const ta = Date.parse(a.source_updated_at) || 0;
		const tb = Date.parse(b.source_updated_at) || 0;
		return tb - ta || a.thread_id.localeCompare(b.thread_id);
	});
	// Stable ascending thread id for raw_memories body (Codex style), but selection is top-N by recency.
	const selected = withOutput.slice(0, max);
	return selected.sort((a, b) => a.thread_id.localeCompare(b.thread_id));
}

function summaryStem(record: Stage1Record): string {
	const slug = (record.rollout_slug || record.thread_id)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	return slug || record.thread_id.slice(0, 32);
}

function writeRawMemories(root: string, retained: Stage1Record[]): void {
	let body = "# Raw Memories\n\n";
	if (!retained.length) {
		body += "No raw memories yet.\n";
	} else {
		body += "Merged stage-1 raw memories (stable ascending thread-id order):\n\n";
		for (const memory of retained) {
			body += `## Thread \`${memory.thread_id}\`\n`;
			body += `updated_at: ${memory.source_updated_at}\n`;
			body += `cwd: ${memory.cwd}\n`;
			body += `rollout_path: ${memory.rollout_path}\n`;
			body += `rollout_summary_file: ${summaryStem(memory)}.md\n\n`;
			body += `${memory.raw_memory.trim()}\n\n`;
		}
	}
	writeFileSync(join(root, "raw_memories.md"), redactSecrets(body), "utf-8");
}

function writeRolloutSummary(root: string, memory: Stage1Record): void {
	const stem = summaryStem(memory);
	const path = join(root, "rollout_summaries", `${stem}.md`);
	const body = [
		`thread_id: ${memory.thread_id}`,
		`updated_at: ${memory.source_updated_at}`,
		`cwd: ${memory.cwd}`,
		`rollout_path: ${memory.rollout_path}`,
		"",
		"## Summary",
		"",
		memory.rollout_summary.trim() || "(empty)",
		"",
		"## Raw memory",
		"",
		memory.raw_memory.trim() || "(empty)",
		"",
	].join("\n");
	writeFileSync(path, redactSecrets(body), "utf-8");
}

function pruneRolloutSummaries(root: string, keep: Set<string>): number {
	const dir = join(root, "rollout_summaries");
	if (!existsSync(dir)) return 0;
	let pruned = 0;
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".md")) continue;
		const stem = name.slice(0, -3);
		if (!keep.has(stem)) {
			rmSync(join(dir, name), { force: true });
			pruned += 1;
		}
	}
	return pruned;
}

function writeMemorySummary(root: string, retained: Stage1Record[]): void {
	const lines = [
		"v1",
		"# Memory summary",
		"",
		`Updated: ${new Date().toISOString()}`,
		`Stage-1 selected: ${retained.length}`,
		"",
		"## Topics",
		"",
	];
	if (!retained.length) {
		lines.push("- (no consolidated rollouts yet)");
	} else {
		for (const m of retained.slice(0, 24)) {
			const sum = m.rollout_summary.replace(/\s+/g, " ").trim().slice(0, 140);
			lines.push(`- ${m.thread_id}: ${sum || "see raw_memories"}`);
		}
	}
	lines.push("", "Use memories_search / memories_read for details.", "");
	writeFileSync(join(root, "memory_summary.md"), lines.join("\n"), "utf-8");
}

function touchMemoryRegistry(root: string, retained: Stage1Record[]): void {
	const path = join(root, "MEMORY.md");
	const prev = existsSync(path) ? readFileSync(path, "utf-8") : "# MEMORY\n\n";
	const header = prev.includes("# MEMORY") ? prev.split("\n## Phase2 registry")[0].trimEnd() : "# MEMORY";
	const reg = ["", "## Phase2 registry", ""];
	for (const m of retained) {
		reg.push(`- thread ${m.thread_id} → rollout_summaries/${summaryStem(m)}.md — ${m.rollout_summary.slice(0, 100)}`);
	}
	if (!retained.length) reg.push("- (empty)");
	reg.push("");
	writeFileSync(path, `${header}\n${reg.join("\n")}`, "utf-8");
}

/** Mark selected stage-1 files for bookkeeping. */
function markSelected(root: string, retained: Stage1Record[]): void {
	const byId = new Map(retained.map((r) => [r.thread_id, r]));
	for (const rec of loadStage1Records(root)) {
		const selected = byId.has(rec.thread_id);
		const next = { ...rec, selected_for_phase2: selected };
		const safeId = rec.thread_id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
		writeFileSync(join(root, "stage1", `${safeId}.json`), JSON.stringify(next, null, 2), "utf-8");
	}
}

export function runPhase2(options: Phase2Options): Phase2Result {
	const root = options.memoriesRoot;
	const maxRaw = options.maxRawMemories ?? DEFAULT_MAX_RAW;
	ensureLayout(root);

	incMemoryMetric("phase2_run");
	const claim = claimJob(root, "phase2", options.jobStore);
	if (!claim.claimed) {
		return {
			changed: false,
			ok: true,
			skipped: true,
			selected: 0,
			pruned_summaries: 0,
			pruned_extension_resources: 0,
		};
	}

	try {
		// Codex: prepare workspace diff artifact before consolidation
		const workspaceDiff = prepareMemoryWorkspace(root);
		const before = fingerprintWorkspace(root);
		const all = loadStage1Records(root);
		const retained = rankStage1(all, maxRaw);
		writeRawMemories(root, retained);
		const keep = new Set(retained.map(summaryStem));
		for (const m of retained) writeRolloutSummary(root, m);
		const pruned = pruneRolloutSummaries(root, keep);
		writeMemorySummary(root, retained);
		touchMemoryRegistry(root, retained);
		markSelected(root, retained);
		// Codex phase2 also runs prune_old_extension_resources
		const extPrune = pruneOldExtensionResources(
			root,
			options.now !== undefined ? new Date(options.now) : new Date(),
		);
		const after = fingerprintWorkspace(root);
		const changed = before !== after || extPrune.pruned > 0;
		if (changed) {
			resetMemoryWorkspaceBaseline(root);
			incMemoryMetric("phase2_changed");
		} else {
			incMemoryMetric("phase2_noop");
		}
		const artifacts = validateConsolidationArtifacts(root);
		completeJob(root, "phase2", true, options.jobStore);
		return {
			changed,
			ok: true,
			selected: retained.length,
			pruned_summaries: pruned,
			pruned_extension_resources: extPrune.pruned,
			workspace_has_changes: workspaceDiff.has_changes,
			artifacts_ok: artifacts.ok,
		};
	} catch (err) {
		completeJob(root, "phase2", false, options.jobStore);
		throw err;
	}
}
