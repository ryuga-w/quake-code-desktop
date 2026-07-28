import type { AgentRecord, AgentStatus } from "./types.js";

export type CodexMultiAgentVersion = "v1" | "v2";

export type CodexAgentStatus =
	| "pending_init"
	| "running"
	| "interrupted"
	| "shutdown"
	| "not_found"
	| { completed: string | null }
	| { errored: string };

export const CODEX_V1_MAX_THREADS = 6;
export const CODEX_V1_MAX_DEPTH = 1;
export const CODEX_MIN_WAIT_TIMEOUT_MS = 10_000;
export const CODEX_DEFAULT_WAIT_TIMEOUT_MS = 30_000;
export const CODEX_MAX_WAIT_TIMEOUT_MS = 3_600_000;

export function resolveCodexMultiAgentVersion(
	value = process.env.QUAKE_CODE_MULTI_AGENT_VERSION,
): CodexMultiAgentVersion {
	return value?.trim().toLowerCase() === "v2" ? "v2" : "v1";
}

export function resolveCodexMaxThreads(value = process.env.QUAKE_CODE_AGENT_MAX_THREADS): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : CODEX_V1_MAX_THREADS;
}

export function resolveCodexMaxDepth(value = process.env.QUAKE_CODE_AGENT_MAX_DEPTH): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : CODEX_V1_MAX_DEPTH;
}

export function legacySubagentToolsEnabled(value = process.env.QUAKE_CODE_LEGACY_SUBAGENT_TOOLS): boolean {
	return value === "1" || value?.toLowerCase() === "true";
}

export function agentJobsEnabled(value = process.env.QUAKE_CODE_SPAWN_CSV): boolean {
	return value === "1" || value?.toLowerCase() === "true";
}

/**
 * Codex-app style parallel agents: default to git worktree isolation so concurrent
 * workers do not clobber the same files. Set QUAKE_CODE_AGENT_ISOLATION=none to disable.
 */
export type AgentIsolationSetting = "worktree" | "none";

export function resolveDefaultAgentIsolation(
	env: NodeJS.ProcessEnv = process.env,
): AgentIsolationSetting {
	const raw = String(env.QUAKE_CODE_AGENT_ISOLATION ?? "")
		.trim()
		.toLowerCase();
	if (raw === "none" || raw === "off" || raw === "0" || raw === "false") return "none";
	// Default ON (Codex app worktree multi-agent parity)
	return "worktree";
}

/** Resolve isolation for a spawn: explicit param > agent config > global default. */
export function resolveSpawnIsolation(input: {
	explicit?: string | null;
	agentIsolation?: AgentIsolationSetting | IsolationModeLike | null;
}): AgentIsolationSetting {
	const explicit = String(input.explicit || "")
		.trim()
		.toLowerCase();
	if (explicit === "worktree") return "worktree";
	if (explicit === "none" || explicit === "off") return "none";
	if (input.agentIsolation === "worktree") return "worktree";
	if (input.agentIsolation === "none") return "none";
	return resolveDefaultAgentIsolation();
}

type IsolationModeLike = "worktree" | "none";

export function isCodexFinalStatus(status: AgentStatus): boolean {
	return !(status === "queued" || status === "running" || status === "interrupted");
}

export function codexStatus(
	record: Pick<AgentRecord, "status" | "result" | "error">,
	status = record.status,
): CodexAgentStatus {
	switch (status) {
		case "queued":
			return "pending_init";
		case "running":
			return "running";
		case "interrupted":
			return "interrupted";
		case "shutdown":
			return "shutdown";
		case "completed":
		case "steered":
			return { completed: record.result ?? null };
		case "error":
			return { errored: record.error ?? "Agent failed" };
		case "aborted":
			return { errored: record.error ?? "Agent exceeded its turn limit" };
		case "stopped":
			return { errored: record.error ?? "Agent was stopped" };
	}
}

export function formatCodexV1Notification(record: AgentRecord): string {
	return `<subagent_notification>\n${JSON.stringify({
		agent_path: record.id,
		status: codexStatus(record),
	})}\n</subagent_notification>`;
}

export function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function formatCodexNickname(name: string, resetCount: number): string {
	if (resetCount === 0) return name;
	const value = resetCount + 1;
	const suffix =
		value % 100 >= 11 && value % 100 <= 13
			? "th"
			: value % 10 === 1
				? "st"
				: value % 10 === 2
					? "nd"
					: value % 10 === 3
						? "rd"
						: "th";
	return `${name} the ${value}${suffix}`;
}

export const CODEX_V1_SPAWN_GUIDANCE = `This spawn_agent tool provides you access to sub-agents that inherit your current model by default. Do not set the \`model\` field unless the user explicitly asks for a different model or there is a clear task-specific reason. You should follow the rules and guidelines below to use this tool.

Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.
Requests for depth, thoroughness, research, investigation, or detailed codebase analysis do not count as permission to spawn.
Agent-role guidance below only helps choose which agent to use after spawning is already authorized; it never authorizes spawning by itself.

### Isolation (Codex-style parallel agents)
- By default each spawned agent runs in an **isolated git worktree** (separate working tree at HEAD). Concurrent agents do not share dirty files.
- On completion, changes are committed onto a branch named like \`quake-agent-<id>\`. Tell the user to merge with \`git merge <branch>\` when relevant.
- Read-only exploration may set isolation: "none" to skip worktree overhead. Coding workers should keep worktree isolation.
- If worktree creation fails (not a git repo / no commits), spawn fails closed rather than writing into the main tree.

### When to delegate vs. do the subtask yourself
- First, quickly analyze the overall user task and form a succinct high-level plan. Identify which tasks are immediate blockers on the critical path, and which tasks are sidecar tasks that are needed but can run in parallel without blocking the next local step. As part of that plan, explicitly decide what immediate task you should do locally right now. Do this planning step before delegating to agents so you do not hand off the immediate blocking task to a submodel and then waste time waiting on it.
- Use a subagent when a subtask is easy enough for it to handle and can run in parallel with your local work. Prefer delegating concrete, bounded sidecar tasks that materially advance the main task without blocking your immediate next local step.
- Do not delegate urgent blocking work when your immediate next step depends on that result. If the very next action is blocked on that task, the main rollout should usually do it locally to keep the critical path moving.
- Keep work local when the subtask is too difficult to delegate well and when it is tightly coupled, urgent, or likely to block your immediate next step.

### Designing delegated subtasks
- Subtasks must be concrete, well-defined, and self-contained.
- Delegated subtasks must materially advance the main task.
- Do not duplicate work between the main rollout and delegated subtasks.
- Avoid issuing multiple delegate calls on the same unresolved thread unless the new delegated task is genuinely different and necessary.
- Narrow the delegated ask to the concrete output you need next.
- For coding tasks, prefer delegating concrete code-change worker subtasks over read-only explorer analysis when the subagent can make a bounded patch in a clear write scope.
- When delegating coding work, instruct the submodel to edit files directly in its forked workspace and list the file paths it changed in the final answer.
- For code-edit subtasks, decompose work so each delegated task has a disjoint write set.

### After you delegate
- Call wait_agent very sparingly. Only call wait_agent when you need the result immediately for the next critical-path step and you are blocked until it returns.
- Do not redo delegated subagent tasks yourself; focus on integrating results or tackling non-overlapping work.
- While the subagent is running in the background, do meaningful non-overlapping work immediately.
- Do not repeatedly wait by reflex.
- When a delegated coding task returns, quickly review the uploaded changes, then integrate or refine them.

### Parallel delegation patterns
- Run multiple independent information-seeking subtasks in parallel when you have distinct questions that can be answered independently.
- Split implementation into disjoint codebase slices and spawn multiple agents in parallel when the write scopes do not overlap.
- Delegate verification only when it can run in parallel with ongoing implementation and is likely to catch a concrete risk before final integration.
- The key is to find opportunities to spawn multiple independent subtasks in parallel within the same round, while ensuring each subtask is well-defined, self-contained, and materially advances the main task.`;
