import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentManager } from "./agent-manager.js";
import type { CodexMultiAgentVersion } from "./codex-parity.js";

export interface AgentJobRuntimeContext {
	jobId: string;
	itemId: string;
	report(result: Record<string, unknown>, stop: boolean): boolean;
}

/**
 * Runtime identity inherited by nested subagent sessions.
 *
 * Codex models subagents as a single thread tree. Quake creates an isolated
 * AgentSession for every child, so AsyncLocalStorage carries the shared control
 * plane and canonical task identity while that child runtime is initialized.
 */
export interface SubagentRuntimeScope {
	manager: AgentManager;
	currentAgentId: string;
	currentAgentPath: string;
	depth: number;
	multiAgentVersion?: CodexMultiAgentVersion;
	maxDepth?: number;
	job?: AgentJobRuntimeContext;
}

const RUNTIME_SCOPE_KEY = Symbol.for("quake-subagents:runtime-scope");
const globalScope = globalThis as Record<PropertyKey, unknown>;
const existingRuntimeScope = globalScope[RUNTIME_SCOPE_KEY] as AsyncLocalStorage<SubagentRuntimeScope> | undefined;
const runtimeScope = existingRuntimeScope ?? new AsyncLocalStorage<SubagentRuntimeScope>();
if (!existingRuntimeScope) globalScope[RUNTIME_SCOPE_KEY] = runtimeScope;

export function getSubagentRuntimeScope(): SubagentRuntimeScope | undefined {
	return runtimeScope.getStore();
}

export function runWithSubagentRuntimeScope<T>(scope: SubagentRuntimeScope, operation: () => Promise<T>): Promise<T> {
	return runtimeScope.run(scope, operation);
}
