/**
 * Phase 1 (TS artifact contract): eligible session/rollout inputs → stage-1 JSON under
 * memoriesRoot/stage1/{thread_id}.json. No Codex state DB; claim via local job store.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { claimJob, completeJob, type JobStore } from "./job-store.js";
import { incMemoryMetric } from "./metrics.js";
import { redactSecrets } from "./redact.js";
import type { Stage1Record } from "./stage1-types.js";
import {
	STAGE_ONE_SYSTEM_PROMPT,
	buildStageOneInputMessage,
	parseStageOneModelJson,
} from "./write-prompts.js";

export interface Phase1RolloutInput {
	thread_id: string;
	rollout_path: string;
	cwd: string;
	/** Full text or JSONL lines from session */
	content: string;
	source_updated_at?: string;
}

/** Injectable model completer for Codex-style stage-one (host wires real LLM). */
export type StageOneCompleter = (args: {
	system: string;
	user: string;
	thread_id: string;
}) => Promise<string> | string;

export interface Phase1Options {
	memoriesRoot: string;
	/** Max rollouts to process this run */
	maxJobs?: number;
	/** Skip sources newer than this many ms (still-active) */
	minIdleMs?: number;
	/** Only consider sources updated within this age */
	maxAgeMs?: number;
	now?: number;
	jobStore?: JobStore;
	/** When set and llmStageOne enabled, prefer model extract with heuristic fallback */
	stageOneCompleter?: StageOneCompleter;
	useLlmStageOne?: boolean;
}

export interface Phase1Result {
	claimed: number;
	succeeded_with_output: number;
	succeeded_no_output: number;
	failed: number;
	records: Stage1Record[];
}

const DEFAULT_MAX_JOBS = 8;
const DEFAULT_MIN_IDLE_MS = 60_000;
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function stage1Dir(root: string): string {
	return join(root, "stage1");
}

export function ensureStage1Dir(root: string): string {
	const dir = stage1Dir(root);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Extract structured stage-1 fields from rollout text without an LLM (bounded heuristic). */
export function extractStage1FromContent(input: Phase1RolloutInput): Stage1Record {
	const generated_at = new Date().toISOString();
	const source_updated_at = input.source_updated_at || generated_at;
	const text = redactSecrets(input.content || "");
	const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

	const preferenceLines = lines.filter((l) =>
		/\b(prefer|always|never|don't|do not|use tabs|use spaces|convention|please)\b/i.test(l),
	);
	const errorLines = lines.filter((l) =>
		/\b(error|failed|exception|bug|fix|regression)\b/i.test(l),
	);
	const pathLines = lines.filter((l) => /[\\/][\w.-]+\.[a-z]{1,8}\b/i.test(l)).slice(0, 12);

	const bullets: string[] = [];
	for (const l of preferenceLines.slice(0, 8)) bullets.push(`- Preference/steering: ${clip(l, 200)}`);
	for (const l of errorLines.slice(0, 6)) bullets.push(`- Failure signal: ${clip(l, 200)}`);
	for (const l of pathLines.slice(0, 6)) bullets.push(`- Path touchpoint: ${clip(l, 160)}`);

	const hasSignal = bullets.length > 0;
	const raw_memory = hasSignal
		? [`# Thread ${input.thread_id}`, "", ...bullets, ""].join("\n")
		: "";
	const rollout_summary = hasSignal
		? clip(
				[
					preferenceLines[0] || errorLines[0] || pathLines[0] || "Session activity",
					`(${bullets.length} signals)`,
				].join(" — "),
				180,
			)
		: "";
	const slugBase = (input.thread_id || basename(input.rollout_path) || "session")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);

	return {
		thread_id: input.thread_id,
		rollout_path: input.rollout_path,
		cwd: input.cwd,
		source_updated_at,
		raw_memory: redactSecrets(raw_memory),
		rollout_summary: redactSecrets(rollout_summary),
		rollout_slug: slugBase || null,
		outcome: hasSignal ? "succeeded" : "succeeded_no_output",
		selected_for_phase2: false,
		generated_at,
	};
}

/** Apply model JSON fields onto a Stage1Record (empty → succeeded_no_output). */
export function stage1FromModelJson(
	input: Phase1RolloutInput,
	parsed: { rollout_summary: string; rollout_slug: string; raw_memory: string },
): Stage1Record {
	const generated_at = new Date().toISOString();
	const source_updated_at = input.source_updated_at || generated_at;
	const raw_memory = redactSecrets(parsed.raw_memory || "");
	const rollout_summary = redactSecrets(parsed.rollout_summary || "");
	const hasSignal = Boolean(raw_memory.trim() || rollout_summary.trim());
	const slug =
		(parsed.rollout_slug || input.thread_id || "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || null;
	return {
		thread_id: input.thread_id,
		rollout_path: input.rollout_path,
		cwd: input.cwd,
		source_updated_at,
		raw_memory,
		rollout_summary,
		rollout_slug: slug,
		outcome: hasSignal ? "succeeded" : "succeeded_no_output",
		selected_for_phase2: false,
		generated_at,
	};
}

export async function extractStage1WithOptionalLlm(
	input: Phase1RolloutInput,
	completer?: StageOneCompleter,
): Promise<Stage1Record> {
	if (completer) {
		try {
			const user = buildStageOneInputMessage({
				thread_id: input.thread_id,
				cwd: input.cwd,
				rollout_path: input.rollout_path,
				content: redactSecrets(input.content || ""),
			});
			const raw = await completer({
				system: STAGE_ONE_SYSTEM_PROMPT,
				user,
				thread_id: input.thread_id,
			});
			const parsed = parseStageOneModelJson(typeof raw === "string" ? raw : String(raw));
			if (parsed) return stage1FromModelJson(input, parsed);
		} catch {
			/* fall through to heuristic */
		}
	}
	return extractStage1FromContent(input);
}

export function writeStage1Record(root: string, record: Stage1Record): string {
	const dir = ensureStage1Dir(root);
	const safeId = record.thread_id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
	const path = join(dir, `${safeId}.json`);
	writeFileSync(path, JSON.stringify(record, null, 2), "utf-8");
	return path;
}

export function loadStage1Records(root: string): Stage1Record[] {
	const dir = stage1Dir(root);
	if (!existsSync(dir)) return [];
	const out: Stage1Record[] = [];
	for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
		try {
			const raw = JSON.parse(readFileSync(join(dir, name), "utf-8")) as Stage1Record;
			if (raw?.thread_id) out.push(raw);
		} catch {
			/* skip bad */
		}
	}
	return out;
}

/**
 * Bounded Phase-1 run: claim job, extract from inputs, write stage-1 artifacts.
 * Skips inputs that fail idle/age filters. Idempotent per thread_id file overwrite with newer source.
 */
export function runPhase1(inputs: Phase1RolloutInput[], options: Phase1Options): Phase1Result {
	// Sync path: heuristic only (LLM completer is async — use runPhase1Async).
	return runPhase1Sync(inputs, { ...options, stageOneCompleter: undefined, useLlmStageOne: false });
}

function runPhase1Sync(inputs: Phase1RolloutInput[], options: Phase1Options): Phase1Result {
	const now = options.now ?? Date.now();
	const maxJobs = options.maxJobs ?? DEFAULT_MAX_JOBS;
	const minIdleMs = options.minIdleMs ?? DEFAULT_MIN_IDLE_MS;
	const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
	const root = options.memoriesRoot;
	mkdirSync(root, { recursive: true });
	incMemoryMetric("phase1_run");

	const claim = claimJob(root, "phase1", options.jobStore);
	if (!claim.claimed) {
		return { claimed: 0, succeeded_with_output: 0, succeeded_no_output: 0, failed: 0, records: [] };
	}

	const eligible = inputs
		.filter((input) => {
			const ts = Date.parse(input.source_updated_at || "") || now;
			const age = now - ts;
			if (age < minIdleMs) return false;
			if (age > maxAgeMs) return false;
			return Boolean(input.thread_id && input.content);
		})
		.slice(0, maxJobs);

	const result: Phase1Result = {
		claimed: eligible.length,
		succeeded_with_output: 0,
		succeeded_no_output: 0,
		failed: 0,
		records: [],
	};

	try {
		for (const input of eligible) {
			try {
				const existingPath = join(
					stage1Dir(root),
					`${input.thread_id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120)}.json`,
				);
				if (existsSync(existingPath)) {
					const prev = JSON.parse(readFileSync(existingPath, "utf-8")) as Stage1Record;
					const prevTs = Date.parse(prev.source_updated_at || "") || 0;
					const nextTs = Date.parse(input.source_updated_at || "") || now;
					if (nextTs <= prevTs && prev.outcome !== "failed") {
						result.records.push(prev);
						if (prev.outcome === "succeeded") result.succeeded_with_output += 1;
						else result.succeeded_no_output += 1;
						continue;
					}
				}
				const record = extractStage1FromContent(input);
				writeStage1Record(root, record);
				result.records.push(record);
				if (record.outcome === "succeeded") {
					result.succeeded_with_output += 1;
					incMemoryMetric("phase1_succeeded");
				} else if (record.outcome === "succeeded_no_output") {
					result.succeeded_no_output += 1;
					incMemoryMetric("phase1_no_output");
				} else {
					result.failed += 1;
					incMemoryMetric("phase1_failed");
				}
			} catch {
				result.failed += 1;
				incMemoryMetric("phase1_failed");
			}
		}
		completeJob(root, "phase1", true, options.jobStore);
	} catch {
		completeJob(root, "phase1", false, options.jobStore);
		throw new Error("phase1 failed");
	}

	return result;
}

/** Async Phase1 with optional Codex-style LLM stage-one completer. */
export async function runPhase1Async(
	inputs: Phase1RolloutInput[],
	options: Phase1Options,
): Promise<Phase1Result> {
	const useLlm = Boolean(options.useLlmStageOne && options.stageOneCompleter);
	if (!useLlm) return runPhase1Sync(inputs, options);

	const now = options.now ?? Date.now();
	const maxJobs = options.maxJobs ?? DEFAULT_MAX_JOBS;
	const minIdleMs = options.minIdleMs ?? DEFAULT_MIN_IDLE_MS;
	const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
	const root = options.memoriesRoot;
	mkdirSync(root, { recursive: true });
	incMemoryMetric("phase1_run");

	const claim = claimJob(root, "phase1", options.jobStore);
	if (!claim.claimed) {
		return { claimed: 0, succeeded_with_output: 0, succeeded_no_output: 0, failed: 0, records: [] };
	}

	const eligible = inputs
		.filter((input) => {
			const ts = Date.parse(input.source_updated_at || "") || now;
			const age = now - ts;
			if (age < minIdleMs) return false;
			if (age > maxAgeMs) return false;
			return Boolean(input.thread_id && input.content);
		})
		.slice(0, maxJobs);

	const result: Phase1Result = {
		claimed: eligible.length,
		succeeded_with_output: 0,
		succeeded_no_output: 0,
		failed: 0,
		records: [],
	};

	try {
		for (const input of eligible) {
			try {
				const record = await extractStage1WithOptionalLlm(input, options.stageOneCompleter);
				writeStage1Record(root, record);
				result.records.push(record);
				if (record.outcome === "succeeded") {
					result.succeeded_with_output += 1;
					incMemoryMetric("phase1_succeeded");
				} else if (record.outcome === "succeeded_no_output") {
					result.succeeded_no_output += 1;
					incMemoryMetric("phase1_no_output");
				} else {
					result.failed += 1;
					incMemoryMetric("phase1_failed");
				}
			} catch {
				result.failed += 1;
				incMemoryMetric("phase1_failed");
			}
		}
		completeJob(root, "phase1", true, options.jobStore);
	} catch {
		completeJob(root, "phase1", false, options.jobStore);
		throw new Error("phase1 failed");
	}
	return result;
}

function clip(s: string, n: number): string {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}
