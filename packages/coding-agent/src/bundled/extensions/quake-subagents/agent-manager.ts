/**
 * agent-manager.ts — Codex-style subagent control plane.
 *
 * Agents live in one canonical task tree, retain resumable sessions, can receive
 * steering/follow-up input, and expose bounded lifecycle waits. Background
 * starts remain concurrency-limited; foreground calls bypass the spawn queue.
 */

import { randomUUID } from "node:crypto";
import type { ImageContent, Model } from "@mrquake/quakecode-ai";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@mrquake/quakecode-cli";
import { resumeAgent, runAgent, type ToolActivity } from "./agent-runner.js";
import { CODEX_AGENT_NAMES } from "./codex-agent-names.js";
import {
	CODEX_V1_MAX_DEPTH,
	CODEX_V1_MAX_THREADS,
	type CodexAgentStatus,
	codexStatus,
	formatCodexNickname,
	isCodexFinalStatus,
	isUuid,
} from "./codex-parity.js";
import type { PersistedAgentRecord } from "./persistence.js";
import type { AgentJobRuntimeContext } from "./runtime-scope.js";
import type {
	AgentRecord,
	AgentStatus,
	IsolationMode,
	SubagentProtocol,
	SubagentType,
	ThinkingLevel,
} from "./types.js";
import { cleanupWorktree, createWorktree, pruneWorktrees } from "./worktree.js";

export type OnAgentComplete = (record: AgentRecord) => void;
export type OnAgentStart = (record: AgentRecord) => void;
export type OnAgentChange = (record: AgentRecord) => void;

export interface AgentActivityUpdate {
	sequence: number;
	agentId: string;
	taskPath: string;
	kind: "spawned" | "status" | "message" | "removed";
	status: AgentStatus;
}

export interface AgentStatusSnapshot {
	id: string;
	taskName: string;
	taskPath: string;
	name: string;
	status: AgentStatus;
	parentId?: string;
	result?: string;
	error?: string;
}

function linkAbortSignal(source: AbortSignal | undefined, target: AbortController): () => void {
	if (!source) return () => {};
	if (source.aborted) {
		target.abort(source.reason);
		return () => {};
	}
	const onAbort = () => target.abort(source.reason);
	source.addEventListener("abort", onAbort, { once: true });
	return () => source.removeEventListener("abort", onAbort);
}

function taskNameFromDisplayName(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return normalized || "agent";
}

function validateTaskName(value: string): string {
	const taskName = value.trim();
	if (!/^[a-z0-9_]+$/.test(taskName)) {
		throw new Error("task_name must contain only lowercase letters, digits, and underscores");
	}
	return taskName;
}

function isActiveStatus(status: AgentStatus): boolean {
	return status === "queued" || status === "running";
}

function isFinalStatus(status: AgentStatus): boolean {
	return !isActiveStatus(status);
}

/** Default max concurrent background agents. */
const DEFAULT_MAX_CONCURRENT = 4;
/** Codex-compatible recursive delegation guard. */
const DEFAULT_MAX_DEPTH = 4;

interface SpawnArgs {
	quake: ExtensionAPI;
	ctx: ExtensionContext;
	type: SubagentType;
	prompt: string;
	options: SpawnOptions;
}

export interface SpawnOptions {
	/** Meaningful instance name explicitly chosen by the caller. */
	name: string;
	description: string;
	model?: Model<any>;
	maxTurns?: number;
	isolated?: boolean;
	inheritContext?: boolean;
	/** Recent parent turns to inherit. Used by Codex V2 fork_turns. */
	forkTurns?: "all" | number;
	forkAsSession?: boolean;
	persistSession?: boolean;
	resumeSessionFile?: string;
	thinkingLevel?: ThinkingLevel;
	images?: ImageContent[];
	signal?: AbortSignal;
	isBackground?: boolean;
	protocol?: SubagentProtocol;
	maxDepth?: number;
	maxResidentAgents?: number;
	queueWhenBusy?: boolean;
	/** Parent node in the shared task tree. */
	parentId?: string;
	/** Strict local task segment. Legacy callers may omit this and use name-derived paths. */
	taskName?: string;
	/** Worker-only report channel for spawn_agents_on_csv. */
	runtimeJob?: AgentJobRuntimeContext;
	/** Isolation mode — "worktree" creates a temp git worktree for the agent. */
	isolation?: IsolationMode;
	/** Called on tool start/end with activity info (for streaming progress to UI). */
	onToolActivity?: (activity: ToolActivity) => void;
	/** Called on streaming text deltas from the assistant response. */
	onTextDelta?: (delta: string, fullText: string) => void;
	/** Called when the agent session is created (for accessing session stats). */
	onSessionCreated?: (session: AgentSession) => void;
	/** Called at the end of each agentic turn with the cumulative count. */
	onTurnEnd?: (turnCount: number) => void;
}

export class AgentManager {
	private agents = new Map<string, AgentRecord>();
	private cleanupInterval: ReturnType<typeof setInterval>;
	private onComplete?: OnAgentComplete;
	private onStart?: OnAgentStart;
	private onChange?: OnAgentChange;
	private maxConcurrent: number;
	private maxDepth = DEFAULT_MAX_DEPTH;
	private stateListeners = new Set<() => void>();
	private activitySequence = 0;
	private activityLog: AgentActivityUpdate[] = [];
	private rootMessenger?: (message: string) => void;
	private readonly rootRecord: AgentRecord = {
		id: "root",
		name: "root",
		type: "general-purpose",
		description: "Main thread",
		status: "running",
		taskName: "root",
		taskPath: "/root",
		depth: 0,
		lastTaskMessage: "Main thread",
		toolUses: 0,
		startedAt: Date.now(),
	};
	/** Original spawn definitions retained so an interrupted pre-init thread can be resumed. */
	private spawnDefinitions = new Map<string, SpawnArgs>();

	/** Queue of background agents waiting to start. */
	private queue: Array<{ id: string; args: SpawnArgs }> = [];
	/** Number of currently running background turns. */
	private runningBackground = 0;
	private usedAgentNicknames = new Set<string>();
	private nicknameResetCount = 0;

	constructor(
		onComplete?: OnAgentComplete,
		maxConcurrent = DEFAULT_MAX_CONCURRENT,
		onStart?: OnAgentStart,
		onChange?: OnAgentChange,
	) {
		this.onComplete = onComplete;
		this.onStart = onStart;
		this.onChange = onChange;
		this.maxConcurrent = Math.max(1, maxConcurrent);
		// Retain terminal sessions for resume, then clean them up after ten minutes.
		this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
	}

	private notifyStateChange(record?: AgentRecord, kind: AgentActivityUpdate["kind"] = "status"): void {
		if (record) {
			this.activitySequence += 1;
			this.activityLog.push({
				sequence: this.activitySequence,
				agentId: record.id,
				taskPath: record.taskPath,
				kind,
				status: record.status,
			});
			if (this.activityLog.length > 1_000) this.activityLog.splice(0, this.activityLog.length - 1_000);
			this.onChange?.(record);
		}
		for (const listener of [...this.stateListeners]) listener();
	}

	private setStatus(record: AgentRecord, status: AgentStatus): void {
		record.status = status;
		this.notifyStateChange(record, "status");
	}

	/** Update the max concurrent background agents limit. */
	setMaxConcurrent(value: number): void {
		this.maxConcurrent = Math.max(1, value);
		this.drainQueue();
	}

	getMaxConcurrent(): number {
		return this.maxConcurrent;
	}

	setMaxDepth(value: number): void {
		this.maxDepth = Math.max(1, Math.floor(value));
	}

	getMaxDepth(): number {
		return this.maxDepth;
	}

	reserveCodexNickname(candidates?: readonly string[]): string {
		const names = candidates?.length ? candidates : CODEX_AGENT_NAMES;
		const available = names
			.map((name) => formatCodexNickname(name, this.nicknameResetCount))
			.filter((name) => !this.usedAgentNicknames.has(name));
		let nickname = available[Math.floor(Math.random() * available.length)];
		if (!nickname) {
			this.usedAgentNicknames.clear();
			this.nicknameResetCount += 1;
			const base = names[Math.floor(Math.random() * names.length)] ?? "Agent";
			nickname = formatCodexNickname(base, this.nicknameResetCount);
		}
		this.usedAgentNicknames.add(nickname);
		return nickname;
	}

	private codexResidentCount(protocol: SubagentProtocol = "codex-v1"): number {
		return [...this.agents.values()].filter((record) => record.protocol === protocol && record.status !== "shutdown")
			.length;
	}

	restorePersisted(records: PersistedAgentRecord[], quake: ExtensionAPI, ctx: ExtensionContext): void {
		for (const persisted of records) {
			if (!persisted.protocol?.startsWith("codex-")) continue;
			if (this.agents.has(persisted.id)) continue;
			const status =
				persisted.status === "running" || persisted.status === "queued" ? "interrupted" : persisted.status;
			const record: AgentRecord = {
				id: persisted.id,
				name: persisted.name,
				type: persisted.type,
				description: persisted.description,
				status,
				protocol: persisted.protocol,
				parentId: persisted.parentId,
				taskName: persisted.taskName,
				taskPath: persisted.taskPath,
				depth: persisted.depth,
				lastTaskMessage: persisted.lastTaskMessage,
				result: persisted.result,
				error: persisted.error,
				toolUses: persisted.toolUses,
				createdAt: persisted.createdAt ?? persisted.startedAt,
				startedAt: persisted.startedAt,
				completedAt: persisted.completedAt,
				sessionFile: persisted.sessionFile,
				completionNotified: persisted.completionNotified,
			};
			this.agents.set(record.id, record);
			this.usedAgentNicknames.add(record.name);
			this.spawnDefinitions.set(record.id, {
				quake,
				ctx,
				type: record.type,
				prompt: record.lastTaskMessage,
				options: {
					name: record.name,
					description: record.description,
					parentId: record.parentId,
					taskName: record.taskName,
					isBackground: true,
					protocol: record.protocol,
					maxDepth: record.protocol === "codex-v1" ? CODEX_V1_MAX_DEPTH : Number.MAX_SAFE_INTEGER,
					maxResidentAgents: record.protocol === "codex-v1" ? CODEX_V1_MAX_THREADS : undefined,
					queueWhenBusy: record.protocol !== "codex-v1",
					persistSession: true,
					resumeSessionFile: record.sessionFile,
				},
			});
		}
	}

	setRootMessenger(messenger: ((message: string) => void) | undefined): void {
		this.rootMessenger = messenger;
	}

	/** Spawn an agent and return its stable ID immediately. */
	spawn(
		quake: ExtensionAPI,
		ctx: ExtensionContext,
		type: SubagentType,
		prompt: string,
		options: SpawnOptions,
	): string {
		const name = options.name.trim();
		if (!name) throw new Error("Subagent name is required. Choose a meaningful unique name.");

		const parent = options.parentId ? this.agents.get(options.parentId) : undefined;
		if (options.parentId && !parent) throw new Error(`Parent agent not found: ${options.parentId}`);
		if (parent?.status === "shutdown") throw new Error(`Parent agent is shut down: ${parent.taskPath}`);
		const protocol = options.protocol ?? "legacy";
		const maxResidentAgents = options.maxResidentAgents ?? CODEX_V1_MAX_THREADS;
		if (protocol === "codex-v1" && this.codexResidentCount(protocol) >= maxResidentAgents) {
			throw new Error(`Agent limit reached. Close an agent before spawning another (max ${maxResidentAgents}).`);
		}

		const duplicateName = [...this.agents.values()].find(
			(record) =>
				record.parentId === parent?.id &&
				record.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0 &&
				isActiveStatus(record.status),
		);
		if (duplicateName) {
			throw new Error(`Subagent name "${name}" is already active. Choose a different meaningful name.`);
		}

		const id = randomUUID();
		const taskName = options.taskName
			? validateTaskName(options.taskName)
			: protocol === "codex-v1"
				? id
				: taskNameFromDisplayName(name);
		const parentPath = parent?.taskPath ?? "/root";
		const taskPath = `${parentPath}/${taskName}`;
		const depth = (parent?.depth ?? 0) + 1;
		const maxDepth = options.maxDepth ?? this.maxDepth;
		if (depth > maxDepth) {
			throw new Error("Agent depth limit reached. Solve the task yourself.");
		}

		const duplicatePath = [...this.agents.values()].find(
			(record) => record.taskPath === taskPath && record.status !== "shutdown",
		);
		if (duplicatePath) {
			throw new Error(`Task path already exists: ${taskPath}. Choose a different task_name or close the old agent.`);
		}

		const abortController = new AbortController();
		const queueWhenBusy = options.queueWhenBusy ?? protocol === "legacy";
		const shouldQueue =
			Boolean(options.isBackground) && queueWhenBusy && this.runningBackground >= this.maxConcurrent;
		const record: AgentRecord = {
			id,
			name,
			type,
			description: options.description,
			status: shouldQueue ? "queued" : "running",
			protocol,
			parentId: parent?.id,
			taskName,
			taskPath,
			depth,
			lastTaskMessage: prompt,
			toolUses: 0,
			createdAt: Date.now(),
			startedAt: Date.now(),
			abortController,
			images: options.images,
		};

		// Codex-style isolation: create worktree synchronously so spawn_agent can return paths.
		// Fail-closed — do not silently fall back to the shared main tree.
		if (options.isolation === "worktree") {
			const worktree = createWorktree(ctx.cwd, id);
			if (!worktree) {
				throw new Error(
					"Worktree isolation failed (need a git repository with at least one commit). " +
						"Cannot spawn a parallel isolated agent without an isolated working tree. " +
						'Pass isolation: "none" only for intentional shared-tree work, or init/commit git first.',
				);
			}
			record.worktree = worktree;
		}

		this.agents.set(id, record);
		this.notifyStateChange(record, "spawned");

		const args: SpawnArgs = { quake, ctx, type, prompt, options };
		this.spawnDefinitions.set(id, args);
		if (shouldQueue) {
			this.queue.push({ id, args });
			return id;
		}

		this.startAgent(id, record, args);
		return id;
	}

	/** Actually start a new child turn (immediately or from the spawn queue). */
	private startAgent(id: string, record: AgentRecord, { quake, ctx, type, prompt, options }: SpawnArgs): void {
		if (record.abortController?.signal.aborted || record.status === "stopped" || record.status === "shutdown") return;
		record.terminationIntent = undefined;
		record.startedAt = Date.now();
		this.setStatus(record, "running");
		const queueManaged = Boolean(options.isBackground) && (options.queueWhenBusy ?? record.protocol === "legacy");
		if (queueManaged) this.runningBackground += 1;
		this.onStart?.(record);

		// Worktree is created in spawn() when isolation === "worktree" (fail-closed).
		const worktreeCwd = record.worktree?.path;
		const isolationNote = worktreeCwd
			? `\n\n[ISOLATION: You are running in an isolated git worktree at ${worktreeCwd}. Edit files only in this tree. List changed paths in your final answer. Changes will be saved to branch \`${record.worktree?.branch}\` on completion.]`
			: "";
		const effectivePrompt = isolationNote ? `${prompt}${isolationNote}` : prompt;
		const promise = runAgent(ctx, type, effectivePrompt, {
			quake,
			model: options.model,
			maxTurns: options.maxTurns,
			isolated: options.isolated,
			inheritContext: options.inheritContext,
			forkTurns: options.forkTurns,
			forkAsSession: options.forkAsSession,
			persistSession: options.persistSession,
			resumeSessionFile: options.resumeSessionFile,
			thinkingLevel: options.thinkingLevel,
			cwd: worktreeCwd,
			signal: record.abortController!.signal,
			runtimeScope: {
				manager: this,
				currentAgentId: record.id,
				currentAgentPath: record.taskPath,
				depth: record.depth,
				multiAgentVersion: record.protocol === "codex-v2" ? "v2" : "v1",
				maxDepth: options.maxDepth,
				job: options.runtimeJob,
			},
			onToolActivity: (activity) => {
				if (activity.type === "end") record.toolUses += 1;
				options.onToolActivity?.(activity);
			},
			onTurnEnd: options.onTurnEnd,
			onTextDelta: options.onTextDelta,
			images: options.images,
			onSessionCreated: (session) => {
				record.session = session;
				record.sessionFile = session.sessionFile;
				this.notifyStateChange(record);
				if (record.pendingSteers?.length) {
					for (const message of record.pendingSteers) void session.steer(message).catch(() => {});
					record.pendingSteers = undefined;
				}
				if (record.pendingMessages?.length) {
					for (const pending of record.pendingMessages) {
						const operation =
							pending.mode === "steer"
								? session.steer(pending.message, pending.images)
								: session.followUp(pending.message, pending.images);
						void operation.catch(() => {});
					}
					record.pendingMessages = undefined;
				}
				options.onSessionCreated?.(session);
			},
		})
			.then(({ responseText, session, aborted, steered }) => {
				record.result = responseText;
				record.session = session;
				record.sessionFile = session.sessionFile;
				record.completedAt ??= Date.now();
				if (record.terminationIntent === "interrupt") this.setStatus(record, "interrupted");
				else if (record.terminationIntent === "shutdown") this.setStatus(record, "shutdown");
				else if (record.terminationIntent === "stop" || record.abortController?.signal.aborted)
					this.setStatus(record, "stopped");
				else if (aborted) this.setStatus(record, "aborted");
				else if (steered) this.setStatus(record, "steered");
				else this.setStatus(record, "completed");

				this.finalizeOutput(record, ctx, options);
				this.finishBackgroundTurn(record, Boolean(options.isBackground), queueManaged);
				return responseText;
			})
			.catch((error) => {
				record.error = error instanceof Error ? error.message : String(error);
				record.completedAt ??= Date.now();
				if (record.terminationIntent === "interrupt") this.setStatus(record, "interrupted");
				else if (record.terminationIntent === "shutdown") this.setStatus(record, "shutdown");
				else if (record.terminationIntent === "stop" || record.abortController?.signal.aborted)
					this.setStatus(record, "stopped");
				else this.setStatus(record, "error");

				this.finalizeOutput(record, ctx, options);
				this.finishBackgroundTurn(record, Boolean(options.isBackground), queueManaged);
				return "";
			});

		record.promise = promise;
		if (record.abortController?.signal.aborted) void record.session?.abort();
	}

	private finalizeOutput(record: AgentRecord, ctx: ExtensionContext, options: SpawnOptions): void {
		if (record.outputCleanup) {
			try {
				record.outputCleanup();
			} catch {
				// Best effort only.
			}
			record.outputCleanup = undefined;
		}

		if (!record.worktree) return;
		try {
			const worktreeResult = cleanupWorktree(ctx.cwd, record.worktree, options.description);
			record.worktreeResult = worktreeResult;
			if (worktreeResult.hasChanges && worktreeResult.branch) {
				record.result =
					(record.result ?? "") +
					`\n\n---\nChanges saved to branch \`${worktreeResult.branch}\`. Merge with: \`git merge ${worktreeResult.branch}\``;
			}
		} catch {
			// Cleanup must never hide the agent result.
		}
	}

	private finishBackgroundTurn(record: AgentRecord, wasBackground: boolean, queueManaged = wasBackground): void {
		if (!wasBackground) return;
		if (queueManaged) this.runningBackground = Math.max(0, this.runningBackground - 1);
		if (record.terminationIntent !== "interrupt") {
			this.deliverFinalToParent(record);
			this.onComplete?.(record);
		}
		this.drainQueue();
	}

	private deliverFinalToParent(record: AgentRecord): void {
		if (!record.parentId) return;
		const parent = this.agents.get(record.parentId);
		if (!parent?.session || parent.status !== "running") return;
		if (record.protocol === "codex-v1") {
			if (record.completionNotified || !isCodexFinalStatus(record.status)) return;
			record.completionNotified = true;
			const status =
				record.status === "shutdown"
					? "shutdown"
					: record.status === "completed" || record.status === "steered"
						? { completed: record.result ?? null }
						: { errored: record.error ?? "Agent failed" };
			const notification = `<subagent_notification>\n${JSON.stringify({
				agent_path: record.id,
				status,
			})}\n</subagent_notification>`;
			void parent.session.steer(notification).catch(() => {});
			this.notifyStateChange(record);
			return;
		}
		const payload = record.error || record.result || "Agent completed without output.";
		const message = `Message Type: FINAL_ANSWER\nTask name: ${parent.taskPath}\nSender: ${record.taskPath}\nPayload:\n${payload}`;
		void parent.session.steer(message).catch(() => {});
	}

	private drainQueue(): void {
		while (this.queue.length > 0 && this.runningBackground < this.maxConcurrent) {
			const next = this.queue.shift()!;
			const record = this.agents.get(next.id);
			if (!record || record.status !== "queued") continue;
			this.startAgent(next.id, record, next.args);
		}
	}

	/** Spawn an agent and wait for completion. Foreground starts bypass the queue. */
	async spawnAndWait(
		quake: ExtensionAPI,
		ctx: ExtensionContext,
		type: SubagentType,
		prompt: string,
		options: Omit<SpawnOptions, "isBackground">,
	): Promise<AgentRecord> {
		const id = this.spawn(quake, ctx, type, prompt, { ...options, isBackground: false });
		const record = this.agents.get(id)!;
		const cleanupAbort = linkAbortSignal(options.signal, record.abortController!);
		try {
			await record.promise;
			if (options.signal?.aborted && record.status !== "error") {
				record.terminationIntent = "stop";
				record.completedAt ??= Date.now();
				this.setStatus(record, "stopped");
			}
		} finally {
			cleanupAbort();
		}
		return record;
	}

	private restartWithoutSession(
		record: AgentRecord,
		prompt: string,
		background: boolean,
		images?: ImageContent[],
	): void {
		const definition = this.spawnDefinitions.get(record.id);
		if (!definition) throw new Error(`Agent session cannot be recreated: ${record.taskPath}`);
		record.abortController = new AbortController();
		record.terminationIntent = undefined;
		record.lastTaskMessage = prompt;
		record.completedAt = undefined;
		record.result = undefined;
		record.error = undefined;
		this.startAgent(record.id, record, {
			...definition,
			prompt,
			options: {
				...definition.options,
				isBackground: background,
				inheritContext: false,
				resumeSessionFile: record.sessionFile ?? definition.options.resumeSessionFile,
				images,
			},
		});
	}

	private startResume(
		record: AgentRecord,
		prompt: string,
		signal?: AbortSignal,
		background = false,
		images?: ImageContent[],
	): Promise<string> {
		if (!record.session) throw new Error(`Agent session is not available: ${record.taskPath}`);
		if (isActiveStatus(record.status)) throw new Error(`Agent is already active: ${record.taskPath}`);
		if (record.status === "shutdown")
			throw new Error(`Agent is shut down; call resume_agent first: ${record.taskPath}`);

		record.abortController = new AbortController();
		const cleanupExternalAbort = linkAbortSignal(signal, record.abortController);
		record.terminationIntent = undefined;
		record.lastTaskMessage = prompt;
		record.startedAt = Date.now();
		record.completedAt = undefined;
		record.result = undefined;
		record.error = undefined;
		this.setStatus(record, "running");
		const queueManaged = background && record.protocol === "legacy";
		if (queueManaged) this.runningBackground += 1;
		this.onStart?.(record);

		const promise = resumeAgent(record.session, prompt, {
			onToolActivity: (activity) => {
				if (activity.type === "end") record.toolUses += 1;
			},
			signal: record.abortController.signal,
			images,
		})
			.then((responseText) => {
				record.result = responseText;
				record.completedAt = Date.now();
				if (record.terminationIntent === "interrupt") this.setStatus(record, "interrupted");
				else if (record.terminationIntent === "shutdown") this.setStatus(record, "shutdown");
				else if (record.terminationIntent === "stop" || record.abortController?.signal.aborted)
					this.setStatus(record, "stopped");
				else this.setStatus(record, "completed");
				this.finishBackgroundTurn(record, background, queueManaged);
				return responseText;
			})
			.catch((error) => {
				record.error = error instanceof Error ? error.message : String(error);
				record.completedAt = Date.now();
				if (record.terminationIntent === "interrupt") this.setStatus(record, "interrupted");
				else if (record.terminationIntent === "shutdown") this.setStatus(record, "shutdown");
				else if (record.terminationIntent === "stop" || record.abortController?.signal.aborted)
					this.setStatus(record, "stopped");
				else this.setStatus(record, "error");
				this.finishBackgroundTurn(record, background, queueManaged);
				return "";
			})
			.finally(cleanupExternalAbort);
		record.promise = promise;
		return promise;
	}

	/** Resume an existing session and wait for its next turn. */
	async resume(id: string, prompt: string, signal?: AbortSignal): Promise<AgentRecord | undefined> {
		const record = this.agents.get(id);
		if (!record?.session || isActiveStatus(record.status) || record.status === "shutdown") return undefined;
		await this.startResume(record, prompt, signal, false);
		return record;
	}

	/** Queue input for an active agent, or start a new turn for an idle resumable agent. */
	async sendInput(
		target: string,
		message: string,
		options: {
			currentAgentId?: string;
			interrupt?: boolean;
			images?: ImageContent[];
		} = {},
	): Promise<{ submissionId: string; record: AgentRecord }> {
		const record = this.resolveTarget(target, options.currentAgentId);
		if (record.id === "root") throw new Error("send_input cannot target the root agent");
		if (record.id === options.currentAgentId) throw new Error("An agent cannot send input to itself");
		if (!message.trim()) throw new Error("message must be non-empty");
		if (record.status === "shutdown") throw new Error(`Agent is shut down: ${record.taskPath}`);

		if (record.status === "queued") {
			record.pendingMessages ??= [];
			record.pendingMessages.push({ message, mode: "steer", images: options.images });
			record.lastTaskMessage = message;
		} else if (record.status === "running") {
			if (options.interrupt) {
				await this.interruptRecord(record);
				if (record.session) this.startResume(record, message, undefined, true, options.images);
				else this.restartWithoutSession(record, message, true, options.images);
			} else if (record.session) {
				await record.session.steer(message, options.images);
				record.lastTaskMessage = message;
			} else {
				record.pendingMessages ??= [];
				record.pendingMessages.push({ message, mode: "steer", images: options.images });
			}
		} else if (record.session) {
			this.startResume(record, message, undefined, true, options.images);
		} else {
			this.restartWithoutSession(record, message, true, options.images);
		}

		this.notifyStateChange(record, "message");
		return { submissionId: randomUUID(), record };
	}

	/** Queue a message without starting an idle agent turn (Codex V2 send_message). */
	async sendMessage(
		target: string,
		message: string,
		currentAgentId?: string,
	): Promise<{ submissionId: string; record: AgentRecord }> {
		const record = this.resolveTarget(target, currentAgentId);
		if (record.id === currentAgentId || (record.id === "root" && !currentAgentId)) {
			throw new Error("An agent cannot send a message to itself");
		}
		if (!message.trim()) throw new Error("message must be non-empty");
		if (record.status === "shutdown") throw new Error(`Agent is shut down: ${record.taskPath}`);

		const senderPath = currentAgentId ? (this.agents.get(currentAgentId)?.taskPath ?? currentAgentId) : "/root";
		const envelope = `Message Type: MESSAGE\nTask name: ${record.taskPath}\nSender: ${senderPath}\nPayload:\n${message}`;
		if (record.id === "root") {
			if (!this.rootMessenger) throw new Error("Root agent mailbox is unavailable");
			this.rootMessenger(envelope);
			record.lastTaskMessage = message;
			this.notifyStateChange(record, "message");
			return { submissionId: randomUUID(), record };
		}
		if (!record.session) {
			record.pendingMessages ??= [];
			record.pendingMessages.push({ message: envelope, mode: "steer" });
		} else {
			await record.session.steer(envelope);
		}
		record.lastTaskMessage = message;
		this.notifyStateChange(record, "message");
		return { submissionId: randomUUID(), record };
	}

	/** Queue follow-up work and ensure the target executes it. */
	async followupTask(
		target: string,
		message: string,
		currentAgentId?: string,
	): Promise<{ submissionId: string; record: AgentRecord }> {
		const record = this.resolveTarget(target, currentAgentId);
		if (record.id === "root") throw new Error("Follow-up tasks cannot target the root agent");
		if (record.id === currentAgentId) throw new Error("An agent cannot assign a follow-up task to itself");
		if (!message.trim()) throw new Error("message must be non-empty");
		if (record.status === "shutdown") throw new Error(`Agent is shut down: ${record.taskPath}`);

		const senderPath = currentAgentId ? (this.agents.get(currentAgentId)?.taskPath ?? currentAgentId) : "/root";
		const envelope = `Message Type: NEW_TASK\nTask name: ${record.taskPath}\nSender: ${senderPath}\nPayload:\n${message}`;
		if (record.status === "queued") {
			record.pendingMessages ??= [];
			record.pendingMessages.push({ message: envelope, mode: "followUp" });
		} else if (record.status === "running") {
			if (!record.session) {
				record.pendingMessages ??= [];
				record.pendingMessages.push({ message: envelope, mode: "followUp" });
			} else {
				await record.session.followUp(envelope);
			}
		} else if (record.session) {
			this.startResume(record, envelope, undefined, true);
		} else {
			this.restartWithoutSession(record, envelope, true);
		}
		record.lastTaskMessage = message;
		this.notifyStateChange(record, "message");
		return { submissionId: randomUUID(), record };
	}

	getRecord(id: string): AgentRecord | undefined {
		return this.agents.get(id);
	}

	getCodexRecord(id: string): AgentRecord {
		if (!isUuid(id)) throw new Error(`invalid agent id ${id}`);
		const record = this.agents.get(id);
		if (!record) throw new Error(`agent with id ${id} not found`);
		return record;
	}

	async sendInputById(
		id: string,
		message: string,
		options: { currentAgentId?: string; interrupt?: boolean; images?: ImageContent[] } = {},
	): Promise<{ submissionId: string; record: AgentRecord }> {
		this.getCodexRecord(id);
		return this.sendInput(id, message, options);
	}

	async waitForCodexTargets(
		targets: string[],
		options: { timeoutMs: number; signal?: AbortSignal },
	): Promise<{ status: Record<string, CodexAgentStatus>; timedOut: boolean }> {
		if (targets.length === 0) throw new Error("agent ids must be non-empty");
		const records = targets.map((target) => {
			if (!isUuid(target)) throw new Error(`invalid agent id ${target}`);
			return { target, record: this.agents.get(target) };
		});
		const initial = records.filter((candidate) => !candidate.record || isCodexFinalStatus(candidate.record.status));
		if (initial.length > 0) {
			return {
				status: Object.fromEntries(
					initial.map(({ target, record }) => [target, record ? codexStatus(record) : "not_found"]),
				),
				timedOut: false,
			};
		}

		const deadline = Date.now() + options.timeoutMs;
		while (true) {
			const completed = records.filter(
				(candidate) => candidate.record && isCodexFinalStatus(candidate.record.status),
			);
			if (completed.length > 0) {
				return {
					status: Object.fromEntries(completed.map(({ target, record }) => [target, codexStatus(record!)])),
					timedOut: false,
				};
			}
			const remaining = deadline - Date.now();
			if (remaining <= 0) return { status: {}, timedOut: true };
			const changed = await this.waitForStateChange(remaining, options.signal);
			if (!changed) return { status: {}, timedOut: true };
		}
	}

	listAgents(): AgentRecord[] {
		return [...this.agents.values()].sort((first, second) => first.taskPath.localeCompare(second.taskPath));
	}

	listDescendants(currentAgentId?: string): AgentRecord[] {
		if (!currentAgentId) return this.listAgents();
		const current = this.agents.get(currentAgentId);
		if (!current) return [];
		const prefix = `${current.taskPath}/`;
		return this.listAgents().filter((record) => record.taskPath.startsWith(prefix));
	}

	resolveTarget(target: string, currentAgentId?: string): AgentRecord {
		const value = target.trim();
		if (!value) throw new Error("agent target must be non-empty");

		if (value === "root" || value === "/root") return this.rootRecord;
		const byId = this.agents.get(value);
		if (byId) return byId;

		const byPath = [...this.agents.values()].find((record) => record.taskPath === value);
		if (byPath) return byPath;

		const current = currentAgentId ? this.agents.get(currentAgentId) : undefined;
		if (current && !value.includes("/")) {
			const directChild = [...this.agents.values()].find(
				(record) => record.parentId === current.id && (record.taskName === value || record.name === value),
			);
			if (directChild) return directChild;
		}

		if (!value.includes("/")) {
			const matches = [...this.agents.values()].filter(
				(record) =>
					record.taskName === value ||
					record.name.localeCompare(value, undefined, { sensitivity: "accent" }) === 0,
			);
			if (matches.length === 1) return matches[0]!;
			if (matches.length > 1) {
				throw new Error(`Agent target is ambiguous: ${value}. Use a canonical task path or agent ID.`);
			}
		}

		throw new Error(`Agent not found: ${value}`);
	}

	getStatusSnapshot(record: AgentRecord): AgentStatusSnapshot {
		return {
			id: record.id,
			taskName: record.taskName,
			taskPath: record.taskPath,
			name: record.name,
			status: record.status,
			parentId: record.parentId,
			result: record.result,
			error: record.error,
		};
	}

	private waitForStateChange(timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
		if (timeoutMs <= 0) return Promise.resolve(false);
		return new Promise((resolve, reject) => {
			let settled = false;
			const finish = (changed: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.stateListeners.delete(onChange);
				signal?.removeEventListener("abort", onAbort);
				resolve(changed);
			};
			const onChange = () => finish(true);
			const onAbort = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.stateListeners.delete(onChange);
				reject(signal?.reason instanceof Error ? signal.reason : new Error("wait_agent aborted"));
			};
			const timer = setTimeout(() => finish(false), timeoutMs);
			this.stateListeners.add(onChange);
			if (signal?.aborted) onAbort();
			else signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	getActivityCursor(): number {
		return this.activitySequence;
	}

	getActivitiesSince(sequence: number, currentAgentId?: string): AgentActivityUpdate[] {
		const current = currentAgentId ? this.agents.get(currentAgentId) : undefined;
		const prefix = current ? `${current.taskPath}/` : undefined;
		return this.activityLog.filter(
			(update) =>
				update.sequence > sequence &&
				(!current || update.agentId === current.id || (prefix != null && update.taskPath.startsWith(prefix))),
		);
	}

	/** Wait for the next visible mailbox/tree activity event (Codex V2 wait_agent). */
	async waitForActivity(
		afterSequence: number,
		options: { currentAgentId?: string; timeoutMs: number; signal?: AbortSignal },
	): Promise<{ updates: AgentActivityUpdate[]; cursor: number; timedOut: boolean }> {
		const deadline = Date.now() + options.timeoutMs;
		while (true) {
			const updates = this.getActivitiesSince(afterSequence, options.currentAgentId);
			if (updates.length > 0) {
				return { updates, cursor: this.activitySequence, timedOut: false };
			}
			const remaining = deadline - Date.now();
			if (remaining <= 0) return { updates: [], cursor: this.activitySequence, timedOut: true };
			const changed = await this.waitForStateChange(remaining, options.signal);
			if (!changed) return { updates: [], cursor: this.activitySequence, timedOut: true };
		}
	}

	/** Wait until at least one target becomes terminal, or the bounded timeout expires. */
	async waitForTargets(
		targets: string[],
		options: { currentAgentId?: string; timeoutMs: number; signal?: AbortSignal },
	): Promise<{ records: AgentRecord[]; timedOut: boolean }> {
		const resolved = targets.map((target) => this.resolveTarget(target, options.currentAgentId));
		if (resolved.length === 0) throw new Error("wait_agent requires at least one target");
		const deadline = Date.now() + options.timeoutMs;

		while (true) {
			const finalRecords = resolved.filter((record) => isFinalStatus(record.status));
			if (finalRecords.length > 0) return { records: finalRecords, timedOut: false };
			const remaining = deadline - Date.now();
			if (remaining <= 0) return { records: resolved, timedOut: true };
			const changed = await this.waitForStateChange(remaining, options.signal);
			if (!changed) return { records: resolved, timedOut: true };
		}
	}

	private async interruptRecord(record: AgentRecord): Promise<void> {
		if (record.status === "queued") {
			this.queue = this.queue.filter((queued) => queued.id !== record.id);
			record.terminationIntent = "interrupt";
			record.abortController?.abort();
			record.completedAt = Date.now();
			this.setStatus(record, "interrupted");
			return;
		}
		if (record.status !== "running") return;
		record.terminationIntent = "interrupt";
		record.abortController?.abort();
		void record.session?.abort();
		await record.promise;
		if (record.status === "running") this.setStatus(record, "interrupted");
	}

	async interruptAgent(
		target: string,
		currentAgentId?: string,
	): Promise<{ previousStatus: AgentStatus; record: AgentRecord }> {
		const record = this.resolveTarget(target, currentAgentId);
		if (record.id === "root") throw new Error("The root agent cannot be interrupted by a subagent");
		if (record.id === currentAgentId) throw new Error("An agent cannot interrupt itself");
		const previousStatus = record.status;
		await this.interruptRecord(record);
		return { previousStatus, record };
	}

	/** Shut down a target and all descendants while retaining sessions for explicit resume. */
	async closeAgent(
		target: string,
		currentAgentId?: string,
	): Promise<{ previousStatus: AgentStatus; record: AgentRecord }> {
		const record = this.resolveTarget(target, currentAgentId);
		if (record.id === "root") throw new Error("The root agent cannot be closed");
		if (record.id === currentAgentId) throw new Error("An agent cannot close itself");
		const previousStatus = record.status;
		const prefix = `${record.taskPath}/`;
		const affected = this.listAgents()
			.filter((candidate) => candidate.id === record.id || candidate.taskPath.startsWith(prefix))
			.sort((first, second) => second.depth - first.depth);

		for (const candidate of affected) {
			if (candidate.status === "queued") this.queue = this.queue.filter((queued) => queued.id !== candidate.id);
			candidate.terminationIntent = "shutdown";
			candidate.abortController?.abort();
			void candidate.session?.abort();
			candidate.completedAt ??= Date.now();
			this.setStatus(candidate, "shutdown");
		}
		await Promise.allSettled(affected.map((candidate) => candidate.promise).filter(Boolean) as Promise<string>[]);
		return { previousStatus, record };
	}

	async closeAgentById(
		id: string,
		currentAgentId?: string,
	): Promise<{ previousStatus: AgentStatus; record: AgentRecord }> {
		this.getCodexRecord(id);
		return this.closeAgent(id, currentAgentId);
	}

	/** Reopen a shut-down thread so it can accept send_input/followup_task. */
	resumeAgentRecord(target: string, currentAgentId?: string): AgentRecord {
		const record = this.resolveTarget(target, currentAgentId);
		if (record.id === "root") throw new Error("The root agent does not need resume_agent");
		if (record.id === currentAgentId) throw new Error("An agent cannot resume itself");
		if (record.depth > this.maxDepth) throw new Error(`Maximum subagent depth exceeded (${this.maxDepth})`);
		if (record.status !== "shutdown") return record;
		record.terminationIntent = undefined;
		record.completedAt = Date.now();
		this.setStatus(record, "interrupted");
		return record;
	}

	resumeAgentById(
		id: string,
		options: {
			currentAgentId?: string;
			maxResidentAgents?: number;
		} = {},
	): AgentRecord {
		const record = this.getCodexRecord(id);
		if (record.id === options.currentAgentId) throw new Error("An agent cannot resume itself");
		if (
			record.status === "shutdown" &&
			this.codexResidentCount(record.protocol ?? "codex-v1") >= (options.maxResidentAgents ?? CODEX_V1_MAX_THREADS)
		) {
			throw new Error("Agent limit reached. Close an agent before resuming another.");
		}
		return this.resumeAgentRecord(id, options.currentAgentId);
	}

	/** Legacy immediate stop used by the existing Quake aliases and UI. */
	abort(id: string): boolean {
		const record = this.agents.get(id);
		if (!record) return false;
		if (record.status === "queued") {
			this.queue = this.queue.filter((queued) => queued.id !== id);
			record.terminationIntent = "stop";
			record.abortController?.abort();
			record.completedAt = Date.now();
			this.setStatus(record, "stopped");
			this.onComplete?.(record);
			return true;
		}
		if (record.status !== "running") return false;
		record.terminationIntent = "stop";
		record.abortController?.abort();
		void record.session?.abort();
		record.completedAt = Date.now();
		this.setStatus(record, "stopped");
		return true;
	}

	private removeRecord(id: string, record: AgentRecord): void {
		record.session?.dispose?.();
		record.session = undefined;
		this.agents.delete(id);
		this.spawnDefinitions.delete(id);
		this.notifyStateChange(record, "removed");
	}

	private cleanup(): void {
		const cutoff = Date.now() - 10 * 60_000;
		for (const [id, record] of this.agents) {
			if (record.protocol?.startsWith("codex-")) continue;
			if (isActiveStatus(record.status)) continue;
			if ((record.completedAt ?? 0) >= cutoff) continue;
			this.removeRecord(id, record);
		}
	}

	clearCompleted(): void {
		for (const [id, record] of this.agents) {
			if (record.protocol?.startsWith("codex-")) continue;
			if (isActiveStatus(record.status)) continue;
			this.removeRecord(id, record);
		}
	}

	hasRunning(): boolean {
		return [...this.agents.values()].some((record) => isActiveStatus(record.status));
	}

	abortAll(): number {
		let count = 0;
		for (const queued of this.queue) {
			const record = this.agents.get(queued.id);
			if (!record) continue;
			record.terminationIntent = "stop";
			record.abortController?.abort();
			record.completedAt = Date.now();
			this.setStatus(record, "stopped");
			this.onComplete?.(record);
			count += 1;
		}
		this.queue = [];
		for (const record of this.agents.values()) {
			if (record.status !== "running") continue;
			record.terminationIntent = "stop";
			record.abortController?.abort();
			void record.session?.abort();
			record.completedAt = Date.now();
			this.setStatus(record, "stopped");
			count += 1;
		}
		return count;
	}

	async waitForAll(): Promise<void> {
		while (true) {
			this.drainQueue();
			const active = [...this.agents.values()].filter((record) => isActiveStatus(record.status));
			if (active.length === 0) break;
			const pending = active
				.map((record) => record.promise)
				.filter((promise): promise is Promise<string> => Boolean(promise));
			if (pending.length === 0) {
				await new Promise((resolve) => setTimeout(resolve, 10));
				continue;
			}
			await Promise.allSettled(pending);
		}
	}

	dispose(): void {
		clearInterval(this.cleanupInterval);
		this.abortAll();
		for (const record of this.agents.values()) {
			record.outputCleanup?.();
			record.outputCleanup = undefined;
			record.session?.dispose();
		}
		this.agents.clear();
		this.spawnDefinitions.clear();
		this.stateListeners.clear();
		this.activityLog = [];
		try {
			pruneWorktrees(process.cwd());
		} catch {
			// Best-effort crash recovery.
		}
	}
}
