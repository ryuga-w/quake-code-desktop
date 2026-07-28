/**
 * Track memory read usage for citation / phase-2 ranking (Codex read usage idea).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultMemoriesRoot } from "./local-backend.js";
import { incMemoryMetric } from "./metrics.js";

export interface MemoryReadUsage {
	path: string;
	count: number;
	last_used_at: string;
}

const USAGE_FILE = "read_usage.json";

function usagePath(root = defaultMemoriesRoot()): string {
	return join(root, USAGE_FILE);
}

export function loadReadUsage(root = defaultMemoriesRoot()): MemoryReadUsage[] {
	const file = usagePath(root);
	if (!existsSync(file)) return [];
	try {
		const data = JSON.parse(readFileSync(file, "utf-8")) as MemoryReadUsage[];
		return Array.isArray(data) ? data : [];
	} catch {
		return [];
	}
}

export function recordMemoryRead(path: string, root = defaultMemoriesRoot()): MemoryReadUsage[] {
	mkdirSync(root, { recursive: true });
	const all = loadReadUsage(root);
	const key = path.replace(/\\/g, "/");
	const now = new Date().toISOString();
	const existing = all.find((u) => u.path === key);
	if (existing) {
		existing.count += 1;
		existing.last_used_at = now;
	} else {
		all.push({ path: key, count: 1, last_used_at: now });
	}
	writeFileSync(usagePath(root), JSON.stringify(all, null, 2), "utf-8");
	incMemoryMetric("read_usage_record");
	return all;
}

/** Rank memory paths by read count then recency (Phase2 / injection prioritization). */
export function rankPathsByUsage(root = defaultMemoriesRoot(), limit = 20): MemoryReadUsage[] {
	return [...loadReadUsage(root)]
		.sort((a, b) => b.count - a.count || b.last_used_at.localeCompare(a.last_used_at))
		.slice(0, limit);
}

/** Paths read this process turn (in-memory) for attaching citations. */
const turnReads = new Map<string, Set<string>>();

export function markTurnMemoryRead(turnId: string, path: string): void {
	let set = turnReads.get(turnId);
	if (!set) {
		set = new Set();
		turnReads.set(turnId, set);
	}
	set.add(path.replace(/\\/g, "/"));
}

export function consumeTurnMemoryReads(turnId: string): string[] {
	const set = turnReads.get(turnId);
	turnReads.delete(turnId);
	return set ? [...set] : [];
}
