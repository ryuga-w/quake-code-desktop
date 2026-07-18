import type { AgentMessage, ThinkingLevel } from "@mrquake/quakecode-agent-core";
import type {
	AgentSession,
	AgentSessionEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@mrquake/quakecode-cli";
import type { AgentManager } from "./agent-manager.js";
import { getAgentConfig, getAvailableTypes, resolveType } from "./agent-types.js";
import { resolveCodexMaxDepth, resolveCodexMaxThreads } from "./codex-parity.js";
import { getParentThinkingLevel } from "./context.js";
import { resolveModel } from "./model-resolver.js";
import type { AgentRecord } from "./types.js";

export const SUBAGENT_WEB_CONTROLS_KEY = Symbol.for("quake-subagents:web-controls");

export type SubagentWebSummary = {
	id: string;
	name: string;
	type: string;
	description: string;
	status: string;
	parentId?: string;
	taskPath: string;
	lastTaskMessage: string;
	createdAt: number;
	startedAt: number;
	completedAt?: number;
	durationMs: number;
	toolUses: number;
	totalTokens?: number;
	sessionFile?: string;
	isolation?: "worktree" | "none";
	worktreePath?: string;
	worktreeBranch?: string;
	resultPreview?: string;
	error?: string;
	model?: { provider: string; id: string; name?: string };
	thinkingLevel?: ThinkingLevel;
	isStreaming: boolean;
	messageCount: number;
};

export type SubagentWebActivity = {
	id: string;
	toolName: string;
	status: "running" | "completed" | "error";
	input?: string;
	output?: string;
	startedAt: number;
	updatedAt: number;
};

export type SubagentWebSnapshot = SubagentWebSummary & {
	messages: AgentMessage[];
	streamingMessage?: AgentMessage;
	/** Text deltas captured directly from the child session for reliable live rendering. */
	streamingText?: string;
	/** Bounded live tool timeline; raw payloads are compacted and secret-like values redacted. */
	activities: SubagentWebActivity[];
};

export type SubagentWebAgentType = {
	id: string;
	label: string;
	description: string;
};

export type SubagentWebCreateInput = {
	message: string;
	name?: string;
	agentType?: string;
	forkContext?: boolean;
	isolation?: "worktree" | "none";
};

export type SubagentWebControl = {
	sessionId: string;
	list(): SubagentWebSummary[];
	get(id: string): SubagentWebSnapshot | undefined;
	listTypes(): SubagentWebAgentType[];
	spawn(input: SubagentWebCreateInput): Promise<SubagentWebSnapshot>;
	sendInput(id: string, message: string, interrupt?: boolean): Promise<SubagentWebSnapshot>;
	abort(id: string): SubagentWebSnapshot;
};

type SubagentWebRegistry = Map<string, SubagentWebControl>;

function webRegistry(): SubagentWebRegistry {
	const target = globalThis as typeof globalThis & { [SUBAGENT_WEB_CONTROLS_KEY]?: SubagentWebRegistry };
	target[SUBAGENT_WEB_CONTROLS_KEY] ??= new Map<string, SubagentWebControl>();
	return target[SUBAGENT_WEB_CONTROLS_KEY]!;
}

function cleanOneLine(value: unknown, limit: number): string {
	const text = String(value ?? "").replace(/\s+/g, " ").trim();
	if (!text) return "";
	return text.length > limit ? `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…` : text;
}

const LIVE_ACTIVITY_LIMIT = 8;
const SECRET_FIELD_PATTERN = /(?:api[_-]?key|authorization|cookie|password|secret|token)/i;
const ACTIVITY_VALUE_KEYS = ["command", "path", "filePath", "query", "pattern", "url", "message", "text", "output"];

type LiveSubagentTracker = {
	session: AgentSession;
	unsubscribe: () => void;
	streamingText: string;
	activities: SubagentWebActivity[];
};

function redactActivityText(value: string): string {
	return value
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ••••")
		.replace(/\b(api[_-]?key|password|secret|token)\s*([=:])\s*([^\s,;]+)/gi, "$1$2••••");
}

function compactActivityValue(value: unknown, limit: number): string | undefined {
	let text = "";
	if (typeof value === "string") {
		text = value;
	} else if (typeof value === "number" || typeof value === "boolean") {
		text = String(value);
	} else if (Array.isArray(value)) {
		text = value
			.map((entry) => compactActivityValue(entry, limit))
			.filter((entry): entry is string => Boolean(entry))
			.join("\n");
	} else if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const key of ACTIVITY_VALUE_KEYS) {
			if (record[key] === undefined || SECRET_FIELD_PATTERN.test(key)) continue;
			const candidate = compactActivityValue(record[key], limit);
			if (candidate) {
				text = candidate;
				break;
			}
		}
		if (!text && Array.isArray(record.content)) {
			text = compactActivityValue(record.content, limit) || "";
		}
		if (!text) {
			try {
				text = JSON.stringify(value, (key, entry) => SECRET_FIELD_PATTERN.test(key) ? "[redacted]" : entry);
			} catch {
				text = String(value);
			}
		}
	}

	const normalized = redactActivityText(text).replace(/\r\n/g, "\n").trim();
	if (!normalized) return undefined;
	return normalized.length > limit ? `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}…` : normalized;
}

function upsertLiveActivity(
	tracker: LiveSubagentTracker,
	event: Extract<AgentSessionEvent, { type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end" }>,
): void {
	const now = Date.now();
	const current = tracker.activities.find((activity) => activity.id === event.toolCallId);
	const status = event.type === "tool_execution_end"
		? event.isError ? "error" : "completed"
		: "running";
	const next: SubagentWebActivity = {
		id: event.toolCallId,
		toolName: event.toolName,
		status,
		input: compactActivityValue("args" in event ? event.args : undefined, 420) || current?.input,
		output: compactActivityValue(
			event.type === "tool_execution_update"
				? event.partialResult
				: event.type === "tool_execution_end"
					? event.result
					: undefined,
			700,
		) || current?.output,
		startedAt: current?.startedAt || now,
		updatedAt: now,
	};
	tracker.activities = [
		...tracker.activities.filter((activity) => activity.id !== event.toolCallId),
		next,
	].slice(-LIVE_ACTIVITY_LIMIT);
}

function createLiveTracker(session: AgentSession): LiveSubagentTracker {
	const tracker: LiveSubagentTracker = {
		session,
		unsubscribe: () => {},
		streamingText: "",
		activities: [],
	};
	tracker.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
		if (event.type === "turn_start") {
			tracker.streamingText = "";
			tracker.activities = [];
			return;
		}
		if (event.type === "message_start" && event.message.role === "assistant") {
			tracker.streamingText = "";
			return;
		}
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			tracker.streamingText += event.assistantMessageEvent.delta;
			return;
		}
		if (event.type === "message_end" && event.message.role === "assistant") {
			tracker.streamingText = "";
			return;
		}
		if (
			event.type === "tool_execution_start"
			|| event.type === "tool_execution_update"
			|| event.type === "tool_execution_end"
		) {
			upsertLiveActivity(tracker, event);
		}
	});
	return tracker;
}

function visibleMessages(record: AgentRecord): AgentMessage[] {
	const session = record.session;
	if (!session) return [];
	const branch = session.sessionManager.getBranch();
	const messages: AgentMessage[] = [];
	const conversationStartedAt = Number(record.createdAt || 0);
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		const message = entry.message as AgentMessage;
		if (message.role !== "user" && message.role !== "assistant") continue;
		const timestamp = Number(message.timestamp || new Date(entry.timestamp).getTime() || 0);
		// fork_context seeds the parent timeline into the child session. The split
		// workspace must show only the child's own thread, never duplicate main chat.
		if (conversationStartedAt && timestamp < conversationStartedAt - 100) continue;
		messages.push(message.timestamp ? message : ({ ...message, timestamp } as AgentMessage));
	}
	return messages;
}

function streamingMessage(record: AgentRecord): AgentMessage | undefined {
	const message = (record.session as any)?.agent?.state?.streamingMessage;
	return message && typeof message === "object" ? (message as AgentMessage) : undefined;
}

function tokenTotal(record: AgentRecord): number | undefined {
	try {
		const total = Number(record.session?.getSessionStats().tokens?.total || 0);
		return total > 0 ? total : undefined;
	} catch {
		return undefined;
	}
}

function modelSummary(record: AgentRecord): SubagentWebSummary["model"] {
	const model = record.session?.model;
	if (!model?.provider || !model.id) return undefined;
	return { provider: model.provider, id: model.id, name: model.name };
}

function toSummary(record: AgentRecord): SubagentWebSummary {
	const messages = visibleMessages(record);
	const now = Date.now();
	const resultPreview = cleanOneLine(record.result, 240) || undefined;
	return {
		id: record.id,
		name: record.name,
		type: record.type,
		description: record.description,
		status: record.status,
		parentId: record.parentId,
		taskPath: record.taskPath,
		lastTaskMessage: record.lastTaskMessage,
		createdAt: record.createdAt || record.startedAt,
		startedAt: record.startedAt,
		completedAt: record.completedAt,
		durationMs: Math.max(0, (record.completedAt ?? now) - record.startedAt),
		toolUses: record.toolUses,
		totalTokens: tokenTotal(record),
		sessionFile: record.sessionFile,
		isolation: record.worktree ? "worktree" : "none",
		worktreePath: record.worktree?.path,
		worktreeBranch: record.worktreeResult?.branch || record.worktree?.branch,
		resultPreview,
		error: record.error,
		model: modelSummary(record),
		thinkingLevel: record.session?.thinkingLevel,
		isStreaming: record.status === "running" || record.status === "queued" || Boolean(record.session?.isStreaming),
		messageCount: messages.length,
	};
}

function toSnapshot(record: AgentRecord, tracker?: LiveSubagentTracker): SubagentWebSnapshot {
	return {
		...toSummary(record),
		messages: visibleMessages(record),
		streamingMessage: streamingMessage(record),
		streamingText: tracker?.streamingText || undefined,
		activities: tracker?.activities ?? [],
	};
}

function normalizeName(value: unknown): string | undefined {
	const name = cleanOneLine(value, 48);
	return name || undefined;
}

function normalizeTask(value: unknown): string {
	const message = String(value ?? "").trim();
	if (!message) throw new Error("Subagent görevi boş olamaz");
	if (message.length > 120_000) throw new Error("Subagent görevi çok uzun");
	return message;
}

export function registerSubagentWebControl(options: {
	sessionId: string;
	quake: ExtensionAPI;
	manager: AgentManager;
	getContext: () => ExtensionContext | undefined;
}): () => void {
	const { sessionId, quake, manager, getContext } = options;
	const liveTrackers = new Map<string, LiveSubagentTracker>();
	const snapshotFor = (record: AgentRecord): SubagentWebSnapshot => {
		const session = record.session;
		let tracker = liveTrackers.get(record.id);
		if (!session || typeof (session as any).subscribe !== "function") {
			tracker?.unsubscribe();
			liveTrackers.delete(record.id);
			return toSnapshot(record);
		}
		if (tracker?.session !== session) {
			tracker?.unsubscribe();
			tracker = createLiveTracker(session);
			liveTrackers.set(record.id, tracker);
		}
		return toSnapshot(record, tracker);
	};
	const control: SubagentWebControl = {
		sessionId,
		list: () => manager.listAgents().map(toSummary).sort((left, right) => left.createdAt - right.createdAt),
		get: (id) => {
			const record = manager.getRecord(String(id || "").trim());
			return record ? snapshotFor(record) : undefined;
		},
		listTypes: () => getAvailableTypes().map((id) => {
			const config = getAgentConfig(id);
			return {
				id,
				label: config?.displayName || id,
				description: config?.description || id,
			};
		}),
		spawn: async (input) => {
			const ctx = getContext();
			if (!ctx) throw new Error("Aktif subagent oturumu bulunamadı");
			const message = normalizeTask(input.message);
			const requestedType = String(input.agentType || "default").trim() || "default";
			const type = resolveType(requestedType);
			const config = type ? getAgentConfig(type) : undefined;
			if (!type || config?.enabled === false) throw new Error(`Bilinmeyen ajan rolü: ${requestedType}`);

			let model;
			if (config?.model) {
				const resolved = resolveModel(config.model, ctx.modelRegistry);
				if (typeof resolved === "string") throw new Error(resolved);
				model = resolved;
			}
			const name = normalizeName(input.name) || manager.reserveCodexNickname(config?.nicknameCandidates);
			const isolation = input.isolation === "none" ? "none" : "worktree";
			const id = manager.spawn(quake, ctx, type, message, {
				name,
				description: cleanOneLine(message.split(/\r?\n/, 1)[0], 96),
				model,
				thinkingLevel: config?.thinking ?? getParentThinkingLevel(ctx),
				isBackground: true,
				protocol: "codex-v1",
				maxDepth: resolveCodexMaxDepth(),
				maxResidentAgents: resolveCodexMaxThreads(),
				queueWhenBusy: false,
				inheritContext: input.forkContext === true,
				forkTurns: "all",
				forkAsSession: true,
				persistSession: true,
				isolation: isolation === "worktree" ? "worktree" : undefined,
			});
			const record = manager.getRecord(id);
			if (!record) throw new Error("Subagent oluşturuldu ancak kaydı bulunamadı");
			return snapshotFor(record);
		},
		sendInput: async (id, message, interrupt = false) => {
			const text = normalizeTask(message);
			const sent = await manager.sendInputById(String(id || "").trim(), text, { interrupt });
			return snapshotFor(sent.record);
		},
		abort: (id) => {
			const target = String(id || "").trim();
			const record = manager.getRecord(target);
			if (!record) throw new Error("Subagent bulunamadı");
			if (!manager.abort(target) && record.status !== "stopped") {
				throw new Error("Subagent şu anda durdurulabilir durumda değil");
			}
			return snapshotFor(record);
		},
	};

	const registry = webRegistry();
	registry.set(sessionId, control);
	return () => {
		for (const tracker of liveTrackers.values()) tracker.unsubscribe();
		liveTrackers.clear();
		if (registry.get(sessionId) === control) registry.delete(sessionId);
	};
}
