/**
 * Session-start memory pipeline (Codex start_memories_startup_task).
 * Feature flags + rate-limit guard + seed → Phase1 → Phase2.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { seedAdHocInstructions } from "./extensions.js";
import { loadMemoryFeatureConfig, shouldRunMemoryStartup } from "./features.js";
import { type RateLimitProvider, rateLimitsOk } from "./guard.js";
import { defaultMemoriesRoot } from "./local-backend.js";
import { incMemoryMetric } from "./metrics.js";
import { type Phase1RolloutInput, type StageOneCompleter, runPhase1, runPhase1Async } from "./phase1.js";
import { ensureLayout, runPhase2, type Phase2Result } from "./phase2.js";

export interface MemoryStartupOptions {
	sessionPaths?: string[];
	sessionDir?: string;
	cwd?: string;
	memoriesRoot?: string;
	enabled?: boolean;
	maxJobs?: number;
	minIdleMs?: number;
	maxAgeMs?: number;
	now?: number;
	ephemeral?: boolean;
	isSubagent?: boolean;
	rateLimitProvider?: RateLimitProvider;
	stageOneCompleter?: StageOneCompleter;
	/** Force LLM stage-one when completer provided */
	useLlmStageOne?: boolean;
}

export interface MemoryStartupResult {
	enabled: boolean;
	skipped_reason?: string;
	seeded_extensions?: boolean;
	phase1?: Awaited<ReturnType<typeof runPhase1Async>> | ReturnType<typeof runPhase1>;
	phase2?: Phase2Result;
}

function collectJsonlFiles(dir: string, limit = 40): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	const walk = (d: string) => {
		if (out.length >= limit) return;
		let names: string[] = [];
		try {
			names = readdirSync(d);
		} catch {
			return;
		}
		for (const name of names) {
			if (out.length >= limit) break;
			if (name.startsWith(".")) continue;
			const full = join(d, name);
			try {
				const st = statSync(full);
				if (st.isDirectory()) walk(full);
				else if (st.isFile() && name.endsWith(".jsonl")) out.push(full);
			} catch {
				/* skip */
			}
		}
	};
	walk(dir);
	return out;
}

function inputFromJsonl(path: string, cwd: string): Phase1RolloutInput | undefined {
	try {
		const content = readFileSync(path, "utf-8");
		if (!content.trim()) return undefined;
		const st = statSync(path);
		const thread_id = basename(path, ".jsonl").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
		return {
			thread_id,
			rollout_path: path,
			cwd,
			content: content.slice(0, 200_000),
			source_updated_at: new Date(st.mtimeMs).toISOString(),
		};
	} catch {
		return undefined;
	}
}

function collectInputs(options: MemoryStartupOptions, cwd: string): Phase1RolloutInput[] {
	const inputs: Phase1RolloutInput[] = [];
	for (const p of options.sessionPaths || []) {
		const input = inputFromJsonl(p, cwd);
		if (input) inputs.push(input);
	}
	if (options.sessionDir) {
		for (const p of collectJsonlFiles(options.sessionDir)) {
			const input = inputFromJsonl(p, cwd);
			if (input) inputs.push(input);
		}
	}
	return inputs;
}

/**
 * Sync startup (heuristic phase1). Prefer runMemoryStartupAsync when LLM completer exists.
 */
export function runMemoryStartup(options: MemoryStartupOptions = {}): MemoryStartupResult {
	const feature = loadMemoryFeatureConfig();
	if (options.enabled === false) {
		incMemoryMetric("startup_skipped_feature");
		return { enabled: false, skipped_reason: "disabled" };
	}
	if (
		!shouldRunMemoryStartup({
			feature,
			ephemeral: options.ephemeral,
			isSubagent: options.isSubagent,
		})
	) {
		incMemoryMetric("startup_skipped_feature");
		return { enabled: false, skipped_reason: "feature_or_session" };
	}

	const root = options.memoriesRoot ?? defaultMemoriesRoot();
	const cwd = options.cwd ?? process.cwd();
	ensureLayout(root);
	incMemoryMetric("startup_run");

	let seeded_extensions = false;
	try {
		seeded_extensions = seedAdHocInstructions(root).seeded;
	} catch {
		/* non-fatal */
	}

	const phase1 = runPhase1(collectInputs(options, cwd), {
		memoriesRoot: root,
		maxJobs: options.maxJobs,
		minIdleMs: options.minIdleMs ?? 0,
		maxAgeMs: options.maxAgeMs,
		now: options.now,
	});
	const phase2 = runPhase2({
		memoriesRoot: root,
		maxRawMemories: options.maxJobs ?? 40,
		now: options.now,
	});
	return { enabled: true, seeded_extensions, phase1, phase2 };
}

/** Full Codex-order async startup: feature → guard → seed → phase1(+LLM) → phase2. */
export async function runMemoryStartupAsync(
	options: MemoryStartupOptions = {},
): Promise<MemoryStartupResult> {
	const feature = loadMemoryFeatureConfig();
	if (options.enabled === false) {
		incMemoryMetric("startup_skipped_feature");
		return { enabled: false, skipped_reason: "disabled" };
	}
	if (
		!shouldRunMemoryStartup({
			feature,
			ephemeral: options.ephemeral,
			isSubagent: options.isSubagent,
		})
	) {
		incMemoryMetric("startup_skipped_feature");
		return { enabled: false, skipped_reason: "feature_or_session" };
	}

	const allowed = await rateLimitsOk(
		options.rateLimitProvider,
		feature.minRateLimitRemainingPercent,
	);
	if (!allowed) {
		incMemoryMetric("startup_skipped_rate_limit");
		return { enabled: false, skipped_reason: "rate_limit" };
	}

	const root = options.memoriesRoot ?? defaultMemoriesRoot();
	const cwd = options.cwd ?? process.cwd();
	ensureLayout(root);
	incMemoryMetric("startup_run");

	let seeded_extensions = false;
	try {
		seeded_extensions = seedAdHocInstructions(root).seeded;
	} catch {
		/* non-fatal */
	}

	const useLlm = Boolean(
		(options.useLlmStageOne ?? feature.llmStageOne) && options.stageOneCompleter,
	);
	const phase1 = useLlm
		? await runPhase1Async(collectInputs(options, cwd), {
				memoriesRoot: root,
				maxJobs: options.maxJobs,
				minIdleMs: options.minIdleMs ?? 0,
				maxAgeMs: options.maxAgeMs,
				now: options.now,
				stageOneCompleter: options.stageOneCompleter,
				useLlmStageOne: true,
			})
		: runPhase1(collectInputs(options, cwd), {
				memoriesRoot: root,
				maxJobs: options.maxJobs,
				minIdleMs: options.minIdleMs ?? 0,
				maxAgeMs: options.maxAgeMs,
				now: options.now,
			});

	const phase2 = runPhase2({
		memoriesRoot: root,
		maxRawMemories: options.maxJobs ?? 40,
		now: options.now,
	});
	return { enabled: true, seeded_extensions, phase1, phase2 };
}

export function defaultSessionScanDir(): string | undefined {
	const dir = join(homedir(), ".quake-code", "sessions");
	return existsSync(dir) ? dir : undefined;
}
