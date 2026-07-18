/**
 * Lightweight rollout store (Codex rollout/state spirit) — JSONL under quake home.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type RolloutEventType =
	| "session_start"
	| "session_end"
	| "turn_start"
	| "turn_end"
	| "turn_aborted"
	| "turn_diff"
	| "tool_call"
	| "tool_result"
	| "message"
	| "error"
	| "goal_update"
	| "memory_startup"
	| "guardian"
	| "approval_decision"
	| "custom";

export interface RolloutEvent {
	ts: string;
	type: RolloutEventType;
	session_id: string;
	payload?: Record<string, unknown>;
}

export interface RolloutStoreOptions {
	rootDir?: string;
	sessionId: string;
}

export function defaultRolloutRoot(): string {
	return join(homedir(), ".quake-code", "rollouts");
}

export class RolloutStore {
	readonly root: string;
	readonly sessionId: string;
	readonly filePath: string;

	constructor(options: RolloutStoreOptions) {
		this.root = options.rootDir ?? defaultRolloutRoot();
		this.sessionId = options.sessionId;
		mkdirSync(this.root, { recursive: true });
		const safe = sessionSafeId(this.sessionId);
		this.filePath = join(this.root, `${safe}.jsonl`);
	}

	append(type: RolloutEventType, payload?: Record<string, unknown>): RolloutEvent {
		const event: RolloutEvent = {
			ts: new Date().toISOString(),
			type,
			session_id: this.sessionId,
			payload,
		};
		appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, "utf-8");
		return event;
	}

	readAll(): RolloutEvent[] {
		if (!existsSync(this.filePath)) return [];
		return readFileSync(this.filePath, "utf-8")
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.parse(line) as RolloutEvent;
				} catch {
					return undefined;
				}
			})
			.filter(Boolean) as RolloutEvent[];
	}

	summary(): { path: string; events: number; types: Record<string, number> } {
		const events = this.readAll();
		const types: Record<string, number> = {};
		for (const e of events) types[e.type] = (types[e.type] || 0) + 1;
		return { path: this.filePath, events: events.length, types };
	}
}

function sessionSafeId(id: string): string {
	return id.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "session";
}

export function listRolloutFiles(root = defaultRolloutRoot()): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root)
		.filter((n) => n.endsWith(".jsonl"))
		.sort();
}

/** Write a compact index of recent rollouts */
export function writeRolloutIndex(root = defaultRolloutRoot(), limit = 50): string {
	mkdirSync(root, { recursive: true });
	const files = listRolloutFiles(root).slice(-limit);
	const indexPath = join(root, "index.json");
	writeFileSync(
		indexPath,
		JSON.stringify(
			{
				updated_at: new Date().toISOString(),
				files,
			},
			null,
			2,
		),
		"utf-8",
	);
	return indexPath;
}
