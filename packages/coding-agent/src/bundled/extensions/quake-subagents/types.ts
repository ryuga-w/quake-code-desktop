/**
 * types.ts — Type definitions for the subagent system.
 */

import type { ThinkingLevel } from "@mrquake/quakecode-agent-core";
import type { ImageContent } from "@mrquake/quakecode-ai";
import type { AgentSession } from "@mrquake/quakecode-cli";

export type { ThinkingLevel };

/** Agent type: any string name (built-in defaults or user-defined). */
export type SubagentType = string;

/** Names of the Codex-compatible built-in roles. */
export const CODEX_AGENT_NAMES = ["default", "explorer", "worker"] as const;

/** Legacy Quake roles retained for opt-in compatibility. */
export const LEGACY_AGENT_NAMES = ["general-purpose", "Explore", "Plan"] as const;

/** Memory scope for persistent agent memory. */
export type MemoryScope = "user" | "project" | "local";

/** Isolation mode for agent execution. */
export type IsolationMode = "worktree";

export type SubagentProtocol = "legacy" | "codex-v1" | "codex-v2";

/** Unified agent configuration — used for both default and user-defined agents. */
export interface AgentConfig {
	name: string;
	displayName?: string;
	description: string;
	builtinToolNames?: string[];
	/** Tool denylist — these tools are removed even if `builtinToolNames` or extensions include them. */
	disallowedTools?: string[];
	/** true = inherit all, string[] = only listed, false = none */
	extensions: true | string[] | false;
	/** true = inherit all, string[] = only listed, false = none */
	skills: true | string[] | false;
	model?: string;
	thinking?: ThinkingLevel;
	maxTurns?: number;
	systemPrompt: string;
	promptMode: "replace" | "append";
	/** Default for spawn: fork parent conversation. undefined = caller decides. */
	inheritContext?: boolean;
	/** Default for spawn: run in background. undefined = caller decides. */
	runInBackground?: boolean;
	/** Default for spawn: no extension tools. undefined = caller decides. */
	isolated?: boolean;
	/** Persistent memory scope — agents with memory get a persistent directory and MEMORY.md */
	memory?: MemoryScope;
	/** Isolation mode — "worktree" runs the agent in a temporary git worktree */
	isolation?: IsolationMode;
	/** true = this is an embedded default agent (informational) */
	isDefault?: boolean;
	/** Optional Codex-style nickname pool for this role. */
	nicknameCandidates?: string[];
	/** false = agent is hidden from the registry */
	enabled?: boolean;
	/** Where this agent was loaded from */
	source?: "default" | "project" | "global";
}

export type JoinMode = "async" | "group" | "smart";

export type AgentStatus =
	| "queued"
	| "running"
	| "completed"
	| "steered"
	| "aborted"
	| "stopped"
	| "interrupted"
	| "shutdown"
	| "error";

export interface AgentRecord {
	id: string;
	/** Meaningful instance name explicitly chosen by the parent agent. */
	name: string;
	type: SubagentType;
	description: string;
	status: AgentStatus;
	protocol?: SubagentProtocol;
	/** Parent agent in the shared Codex-style thread tree. Undefined means root-owned. */
	parentId?: string;
	/** Caller-provided local task name. */
	taskName: string;
	/** Stable canonical path, for example /root/auth_review. */
	taskPath: string;
	/** One-based spawn depth below /root. */
	depth: number;
	/** Most recent initial, steering, or follow-up instruction. */
	lastTaskMessage: string;
	/** Why the active turn was cancelled, when cancellation was intentional. */
	terminationIntent?: "stop" | "interrupt" | "shutdown";
	result?: string;
	error?: string;
	toolUses: number;
	/** Stable creation time; unlike startedAt this does not reset on follow-up turns. */
	createdAt?: number;
	startedAt: number;
	completedAt?: number;
	session?: AgentSession;
	abortController?: AbortController;
	promise?: Promise<string>;
	images?: ImageContent[];
	sessionFile?: string;
	/** V1 completion watchers notify only on the first terminal status. */
	completionNotified?: boolean;
	groupId?: string;
	joinMode?: JoinMode;
	/** Set when result was already consumed via get_subagent_result — suppresses completion notification. */
	resultConsumed?: boolean;
	/** Legacy steering queue retained for compatibility with existing callers. */
	pendingSteers?: string[];
	/** Codex-style messages queued before the child session is initialized. */
	pendingMessages?: Array<{
		message: string;
		mode: "steer" | "followUp";
		images?: ImageContent[];
	}>;
	/** Worktree info if the agent is running in an isolated worktree. */
	worktree?: { path: string; branch: string };
	/** Worktree cleanup result after agent completion. */
	worktreeResult?: { hasChanges: boolean; branch?: string };
	/** The tool_use_id from the original Agent tool call. */
	toolCallId?: string;
	/** Path to the streaming output transcript file. */
	outputFile?: string;
	/** Cleanup function for the output file stream subscription. */
	outputCleanup?: () => void;
}

/** Details attached to custom notification messages for visual rendering. */
export interface NotificationDetails {
	id: string;
	name: string;
	description: string;
	status: string;
	toolUses: number;
	turnCount: number;
	maxTurns?: number;
	totalTokens: number;
	durationMs: number;
	outputFile?: string;
	error?: string;
	resultPreview: string;
	/** Additional agents in a group notification. */
	others?: NotificationDetails[];
}

export interface EnvInfo {
	isGitRepo: boolean;
	branch: string;
	platform: string;
}
