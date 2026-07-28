/**
 * Central feature flags (Codex features crate spirit).
 */

export interface QuakeFeatures {
	memoryTool: boolean;
	memoryStartup: boolean;
	applyPatch: boolean;
	execPolicy: boolean;
	sandbox: boolean;
	guardian: boolean;
	rollout: boolean;
}

export function loadQuakeFeatures(env: NodeJS.ProcessEnv = process.env): QuakeFeatures {
	const off = (k: string) => env[k] === "0" || env[k] === "false";
	const on = (k: string) => env[k] === "1" || env[k] === "true";
	const f: QuakeFeatures = {
		memoryTool: !off("QUAKE_MEMORY_TOOL"),
		memoryStartup: !off("QUAKE_MEMORY_STARTUP"),
		applyPatch: !off("QUAKE_APPLY_PATCH"),
		execPolicy: !off("QUAKE_EXECPOLICY"),
		sandbox: !off("QUAKE_SANDBOX"),
		guardian: !off("QUAKE_GUARDIAN"),
		rollout: !off("QUAKE_ROLLOUT"),
	};
	if (on("QUAKE_MEMORY_TOOL")) f.memoryTool = true;
	if (on("QUAKE_APPLY_PATCH")) f.applyPatch = true;
	return f;
}
