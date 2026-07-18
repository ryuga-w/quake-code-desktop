/**
 * Minimal local job claim store for Phase 1/2 (JSON under memories root).
 * Prevents double-run races without Codex state DB.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface JobLease {
	name: string;
	token: string;
	claimed_at: number;
	/** lease duration ms */
	ttl_ms: number;
	status: "running" | "succeeded" | "failed";
}

export type JobStore = Map<string, JobLease>;

function storePath(root: string): string {
	return join(root, ".jobs.json");
}

export function loadJobStore(root: string): JobStore {
	const file = storePath(root);
	const map: JobStore = new Map();
	if (!existsSync(file)) return map;
	try {
		const raw = JSON.parse(readFileSync(file, "utf-8")) as JobLease[];
		for (const job of raw) map.set(job.name, job);
	} catch {
		/* empty */
	}
	return map;
}

export function saveJobStore(root: string, store: JobStore): void {
	mkdirSync(root, { recursive: true });
	writeFileSync(storePath(root), JSON.stringify([...store.values()], null, 2), "utf-8");
}

export function claimJob(
	root: string,
	name: string,
	store?: JobStore,
	ttlMs = 120_000,
	now = Date.now(),
): { claimed: boolean; token: string; store: JobStore } {
	const s = store ?? loadJobStore(root);
	const existing = s.get(name);
	if (existing?.status === "running" && now - existing.claimed_at < existing.ttl_ms) {
		return { claimed: false, token: existing.token, store: s };
	}
	const token = `${name}-${now}-${Math.random().toString(36).slice(2, 10)}`;
	s.set(name, { name, token, claimed_at: now, ttl_ms: ttlMs, status: "running" });
	saveJobStore(root, s);
	return { claimed: true, token, store: s };
}

export function completeJob(
	root: string,
	name: string,
	ok: boolean,
	store?: JobStore,
	now = Date.now(),
): void {
	const s = store ?? loadJobStore(root);
	const existing = s.get(name);
	if (!existing) return;
	existing.status = ok ? "succeeded" : "failed";
	existing.claimed_at = now;
	s.set(name, existing);
	saveJobStore(root, s);
}
