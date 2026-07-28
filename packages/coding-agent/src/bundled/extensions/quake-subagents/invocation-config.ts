import { resolveSpawnIsolation } from "./codex-parity.js";
import type { AgentConfig, IsolationMode, JoinMode, ThinkingLevel } from "./types.js";

interface AgentInvocationParams {
	model?: string;
	thinking?: string;
	max_turns?: number;
	run_in_background?: boolean;
	inherit_context?: boolean;
	isolated?: boolean;
	isolation?: IsolationMode | "none" | string;
}

export function resolveAgentInvocationConfig(
	agentConfig: AgentConfig | undefined,
	params: AgentInvocationParams,
): {
	modelInput?: string;
	modelFromParams: boolean;
	thinking?: ThinkingLevel;
	maxTurns?: number;
	inheritContext: boolean;
	runInBackground: boolean;
	isolated: boolean;
	isolation?: IsolationMode;
} {
	const isolationSetting = resolveSpawnIsolation({
		explicit: params.isolation,
		agentIsolation: agentConfig?.isolation,
	});
	return {
		// Tool-call params are explicit user intent and must override agent defaults.
		// Agent config/frontmatter only supplies defaults when the call omits a field.
		modelInput: params.model ?? agentConfig?.model,
		modelFromParams: params.model != null,
		thinking: (params.thinking ?? agentConfig?.thinking) as ThinkingLevel | undefined,
		maxTurns: params.max_turns ?? agentConfig?.maxTurns,
		inheritContext: params.inherit_context ?? agentConfig?.inheritContext ?? false,
		runInBackground: params.run_in_background ?? agentConfig?.runInBackground ?? false,
		isolated: params.isolated ?? agentConfig?.isolated ?? false,
		// Codex-style: default worktree for parallel-safe agents (env can set none).
		isolation: isolationSetting === "worktree" ? "worktree" : undefined,
	};
}

export function resolveJoinMode(defaultJoinMode: JoinMode, runInBackground: boolean): JoinMode | undefined {
	return runInBackground ? defaultJoinMode : undefined;
}
