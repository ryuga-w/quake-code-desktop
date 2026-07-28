import type { AgentRoom, AgentRoomTask } from "./types.js";

const ACTIVE_TASK_STATUSES = new Set(["claimed", "in_progress"]);

export function normalizeAllowedPaths(paths?: string[]): string[] | undefined {
	if (!paths?.length) return undefined;
	const normalized = paths.map((p) => p.trim().replace(/\\/g, "/")).filter(Boolean);
	return normalized.length > 0 ? normalized : undefined;
}

export function pathsOverlap(left?: string[], right?: string[]): boolean {
	const a = normalizeAllowedPaths(left);
	const b = normalizeAllowedPaths(right);
	if (!a?.length || !b?.length) return false;
	for (const pa of a) {
		for (const pb of b) {
			if (pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`)) return true;
		}
	}
	return false;
}

export function areTaskDependenciesMet(tasks: AgentRoomTask[], task: AgentRoomTask): boolean {
	const deps = task.dependsOn ?? [];
	if (deps.length === 0) return true;
	const byId = new Map(tasks.map((entry) => [entry.id, entry]));
	for (const depId of deps) {
		const dep = byId.get(depId);
		if (!dep || dep.status !== "done") return false;
	}
	return true;
}

export function getUnmetDependencies(tasks: AgentRoomTask[], task: AgentRoomTask): string[] {
	const deps = task.dependsOn ?? [];
	if (deps.length === 0) return [];
	const byId = new Map(tasks.map((entry) => [entry.id, entry]));
	return deps.filter((depId) => {
		const dep = byId.get(depId);
		return !dep || dep.status !== "done";
	});
}

export function findPathConflicts(tasks: AgentRoomTask[], candidate: AgentRoomTask, excludeTaskId?: string): AgentRoomTask[] {
	const scope = normalizeAllowedPaths(candidate.allowedPaths);
	if (!scope?.length) return [];
	return tasks.filter((task) => {
		if (task.id === excludeTaskId || task.id === candidate.id) return false;
		if (!ACTIVE_TASK_STATUSES.has(task.status)) return false;
		return pathsOverlap(scope, task.allowedPaths);
	});
}

export function assertRoomLeader(room: AgentRoom, sessionId?: string, action = "perform this operation"): void {
	if (!room.leaderSessionId) return;
	if (!sessionId || room.leaderSessionId !== sessionId) {
		throw new Error(`Only the room leader can ${action}. Leader session: ${room.leaderSessionId.slice(0, 8)}…`);
	}
}

export function buildWorkerScopeBlock(allowedPaths?: string[]): string {
	const paths = normalizeAllowedPaths(allowedPaths);
	if (!paths?.length) {
		return "Write scope: read-only unless the task explicitly requires a new file. Do not modify unrelated files.";
	}
	return [
		"Write scope (strict):",
		...paths.map((p) => `- ${p}`),
		"Do not edit, create, or delete files outside this scope.",
		"Post findings, risks, and a concise summary back to the room when done.",
	].join("\n");
}