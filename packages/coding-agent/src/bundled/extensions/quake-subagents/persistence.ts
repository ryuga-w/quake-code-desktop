import type { AgentRecord, AgentStatus, SubagentProtocol } from "./types.js";

export const SUBAGENT_RECORD_ENTRY = "subagents:record";

export interface PersistedAgentRecord {
	version: 2;
	id: string;
	name: string;
	type: string;
	description: string;
	status: AgentStatus;
	protocol?: SubagentProtocol;
	parentId?: string;
	taskName: string;
	taskPath: string;
	depth: number;
	lastTaskMessage: string;
	result?: string;
	error?: string;
	toolUses: number;
	createdAt?: number;
	startedAt: number;
	completedAt?: number;
	sessionFile?: string;
	completionNotified?: boolean;
}

export function serializeAgentRecord(record: AgentRecord): PersistedAgentRecord {
	return {
		version: 2,
		id: record.id,
		name: record.name,
		type: record.type,
		description: record.description,
		status: record.status,
		protocol: record.protocol,
		parentId: record.parentId,
		taskName: record.taskName,
		taskPath: record.taskPath,
		depth: record.depth,
		lastTaskMessage: record.lastTaskMessage,
		result: record.result,
		error: record.error,
		toolUses: record.toolUses,
		createdAt: record.createdAt ?? record.startedAt,
		startedAt: record.startedAt,
		completedAt: record.completedAt,
		sessionFile: record.sessionFile,
		completionNotified: record.completionNotified,
	};
}

export function loadPersistedAgentRecords(entries: readonly unknown[]): PersistedAgentRecord[] {
	const latest = new Map<string, PersistedAgentRecord>();
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry as {
			type?: unknown;
			customType?: unknown;
			data?: unknown;
		};
		if (candidate.type !== "custom" || candidate.customType !== SUBAGENT_RECORD_ENTRY) continue;
		const record = normalizePersistedRecord(candidate.data);
		if (record) latest.set(record.id, record);
	}
	return [...latest.values()];
}

function normalizePersistedRecord(value: unknown): PersistedAgentRecord | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Partial<PersistedAgentRecord>;
	if (
		typeof record.id !== "string" ||
		typeof record.name !== "string" ||
		typeof record.type !== "string" ||
		typeof record.description !== "string" ||
		typeof record.status !== "string"
	) {
		return undefined;
	}
	const taskName = typeof record.taskName === "string" ? record.taskName : record.id;
	const taskPath = typeof record.taskPath === "string" ? record.taskPath : `/root/${taskName}`;
	return {
		version: 2,
		id: record.id,
		name: record.name,
		type: record.type,
		description: record.description,
		status: record.status,
		protocol: record.protocol,
		parentId: typeof record.parentId === "string" ? record.parentId : undefined,
		taskName,
		taskPath,
		depth: typeof record.depth === "number" ? record.depth : 1,
		lastTaskMessage: typeof record.lastTaskMessage === "string" ? record.lastTaskMessage : record.description,
		result: typeof record.result === "string" ? record.result : undefined,
		error: typeof record.error === "string" ? record.error : undefined,
		toolUses: typeof record.toolUses === "number" ? record.toolUses : 0,
		createdAt: typeof record.createdAt === "number" ? record.createdAt : record.startedAt,
		startedAt: typeof record.startedAt === "number" ? record.startedAt : Date.now(),
		completedAt: typeof record.completedAt === "number" ? record.completedAt : undefined,
		sessionFile: typeof record.sessionFile === "string" ? record.sessionFile : undefined,
		completionNotified: record.completionNotified === true ? true : undefined,
	};
}
