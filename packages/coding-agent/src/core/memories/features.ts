/**
 * Codex Feature::MemoryTool style gates for the memories stack.
 */

export interface MemoryFeatureConfig {
	/** Master switch (Codex Feature::MemoryTool) */
	memoryTool: boolean;
	/** Run Phase1/Phase2 consolidation on session start */
	startupPipeline: boolean;
	/** Prefer injectable LLM completer for stage-1 when available */
	llmStageOne: boolean;
	/** Skip pipeline when rate-limit remaining is below threshold (0–100) */
	minRateLimitRemainingPercent: number;
	/** Skip for subagent / ephemeral sessions when host marks them */
	skipNonRootSessions: boolean;
}

const DEFAULTS: MemoryFeatureConfig = {
	memoryTool: true,
	startupPipeline: true,
	llmStageOne: true,
	minRateLimitRemainingPercent: 5,
	skipNonRootSessions: true,
};

export function loadMemoryFeatureConfig(env: NodeJS.ProcessEnv = process.env): MemoryFeatureConfig {
	const off = (k: string) => env[k] === "0" || env[k] === "false";
	const on = (k: string) => env[k] === "1" || env[k] === "true";
	const cfg = { ...DEFAULTS };
	if (off("QUAKE_MEMORY_TOOL") || off("QUAKE_MEMORY_STARTUP")) {
		// QUAKE_MEMORY_STARTUP=0 historically disabled startup; keep that + add tool master switch
		if (off("QUAKE_MEMORY_TOOL")) cfg.memoryTool = false;
		if (off("QUAKE_MEMORY_STARTUP")) cfg.startupPipeline = false;
	}
	if (on("QUAKE_MEMORY_TOOL")) cfg.memoryTool = true;
	if (on("QUAKE_MEMORY_STARTUP")) cfg.startupPipeline = true;
	if (off("QUAKE_MEMORY_LLM_STAGE1")) cfg.llmStageOne = false;
	if (on("QUAKE_MEMORY_LLM_STAGE1")) cfg.llmStageOne = true;
	const min = Number.parseInt(env.QUAKE_MEMORY_MIN_RATE_LIMIT_PCT || "", 10);
	if (Number.isFinite(min)) cfg.minRateLimitRemainingPercent = Math.min(100, Math.max(0, min));
	return cfg;
}

export function shouldRunMemoryStartup(options: {
	env?: NodeJS.ProcessEnv;
	ephemeral?: boolean;
	isSubagent?: boolean;
	feature?: MemoryFeatureConfig;
}): boolean {
	const feature = options.feature ?? loadMemoryFeatureConfig(options.env);
	if (!feature.memoryTool || !feature.startupPipeline) return false;
	if (feature.skipNonRootSessions && (options.ephemeral || options.isSubagent)) return false;
	return true;
}
