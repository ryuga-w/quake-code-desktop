/**
 * Codex storage.rs — public helpers over stage-1 records → raw_memories / rollout_summaries.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadStage1Records } from "./phase1.js";
import { redactSecrets } from "./redact.js";
import type { Stage1Record } from "./stage1-types.js";

const DEFAULT_MAX = 40;

function rank(records: Stage1Record[], max: number): Stage1Record[] {
	const withOutput = records.filter((r) => r.outcome === "succeeded" && r.raw_memory.trim());
	withOutput.sort((a, b) => {
		const ta = Date.parse(a.source_updated_at) || 0;
		const tb = Date.parse(b.source_updated_at) || 0;
		return tb - ta || a.thread_id.localeCompare(b.thread_id);
	});
	return withOutput.slice(0, max).sort((a, b) => a.thread_id.localeCompare(b.thread_id));
}

export function rolloutSummaryFileStem(memory: Stage1Record): string {
	const slug = (memory.rollout_slug || memory.thread_id)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	return slug || memory.thread_id.slice(0, 32);
}

export function rebuildRawMemoriesFileFromMemories(
	root: string,
	memories: Stage1Record[],
	maxRaw = DEFAULT_MAX,
): string {
	mkdirSync(root, { recursive: true });
	const retained = rank(memories, maxRaw);
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
			body += `rollout_summary_file: ${rolloutSummaryFileStem(memory)}.md\n\n`;
			body += `${memory.raw_memory.trim()}\n\n`;
		}
	}
	const path = join(root, "raw_memories.md");
	writeFileSync(path, redactSecrets(body), "utf-8");
	return path;
}

export function syncRolloutSummariesFromMemories(
	root: string,
	memories: Stage1Record[],
	maxRaw = DEFAULT_MAX,
): { written: number; pruned: number } {
	mkdirSync(join(root, "rollout_summaries"), { recursive: true });
	const retained = rank(memories, maxRaw);
	const keep = new Set(retained.map(rolloutSummaryFileStem));
	let pruned = 0;
	const dir = join(root, "rollout_summaries");
	if (existsSync(dir)) {
		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".md")) continue;
			const stem = name.slice(0, -3);
			if (!keep.has(stem)) {
				rmSync(join(dir, name), { force: true });
				pruned += 1;
			}
		}
	}
	for (const memory of retained) {
		const stem = rolloutSummaryFileStem(memory);
		const path = join(dir, `${stem}.md`);
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
	return { written: retained.length, pruned };
}

/** Rebuild from on-disk stage1/*.json */
export function rebuildFromStage1Dir(root: string, maxRaw = DEFAULT_MAX): {
	raw_path: string;
	summaries: { written: number; pruned: number };
} {
	const memories = loadStage1Records(root);
	const raw_path = rebuildRawMemoriesFileFromMemories(root, memories, maxRaw);
	const summaries = syncRolloutSummariesFromMemories(root, memories, maxRaw);
	return { raw_path, summaries };
}
