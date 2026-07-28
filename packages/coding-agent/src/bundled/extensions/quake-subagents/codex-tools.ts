import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { ImageContent } from "@mrquake/quakecode-ai";
import type { ExtensionAPI, ExtensionContext } from "@mrquake/quakecode-cli";
import { Type } from "@sinclair/typebox";
import type { AgentManager } from "./agent-manager.js";
import { getAgentConfig, getCodexRoleDescription, resolveType } from "./agent-types.js";
import {
	CODEX_DEFAULT_WAIT_TIMEOUT_MS,
	CODEX_MAX_WAIT_TIMEOUT_MS,
	CODEX_MIN_WAIT_TIMEOUT_MS,
	CODEX_V1_SPAWN_GUIDANCE,
	codexStatus,
	resolveCodexMaxDepth,
	resolveCodexMaxThreads,
	resolveCodexMultiAgentVersion,
	resolveSpawnIsolation,
} from "./codex-parity.js";
import { getParentThinkingLevel } from "./context.js";
import { resolveModel } from "./model-resolver.js";
import type { SubagentRuntimeScope } from "./runtime-scope.js";
import type { ThinkingLevel } from "./types.js";

const reasoningSchema = Type.Optional(
	Type.Union([
		Type.Literal("off"),
		Type.Literal("minimal"),
		Type.Literal("low"),
		Type.Literal("medium"),
		Type.Literal("high"),
		Type.Literal("xhigh"),
		Type.Literal("max"),
	]),
);

const v1TargetSchema = Type.String({
	description: "Agent id from spawn_agent.",
});

const v2TargetSchema = Type.String({
	description: "Agent ID, relative task name, or canonical task path such as /root/review_auth.",
});

const inputItemSchema = Type.Object(
	{
		type: Type.String({
			description: "Input item type: text, image, local_image, skill, or mention.",
		}),
		text: Type.Optional(Type.String({ description: "Text content when type is text." })),
		image_url: Type.Optional(Type.String({ description: "Image URL when type is image." })),
		url: Type.Optional(Type.String({ description: "Compatibility alias for image_url." })),
		path: Type.Optional(
			Type.String({
				description: "Path when type is local_image/skill, or structured mention target.",
			}),
		),
		name: Type.Optional(Type.String({ description: "Display name when type is skill or mention." })),
	},
	{ additionalProperties: false },
);

type InputItem = {
	type: string;
	text?: string;
	image_url?: string;
	url?: string;
	path?: string;
	name?: string;
};

function textResult(value: unknown, details?: unknown) {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return { content: [{ type: "text" as const, text }], details: details as any };
}

function conciseDescription(message: string): string {
	const firstLine = message.trim().split(/\r?\n/, 1)[0]!.replace(/\s+/g, " ");
	return firstLine.length > 96 ? `${firstLine.slice(0, 93)}...` : firstLine;
}

function mimeTypeForPath(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".gif":
			return "image/gif";
		case ".webp":
			return "image/webp";
		default:
			return "image/png";
	}
}

async function imageFromUrl(url: string, signal?: AbortSignal): Promise<ImageContent> {
	const dataUrl = /^data:([^;,]+);base64,(.+)$/i.exec(url);
	if (dataUrl) {
		return { type: "image", mimeType: dataUrl[1]!, data: dataUrl[2]! };
	}
	const response = await fetch(url, { signal });
	if (!response.ok) {
		throw new Error(`Failed to load image URL (${response.status}): ${url}`);
	}
	const mimeType = response.headers.get("content-type")?.split(";", 1)[0] || "image/png";
	const data = Buffer.from(await response.arrayBuffer()).toString("base64");
	return { type: "image", mimeType, data };
}

async function normalizeInput(
	params: { message?: string; items?: InputItem[] },
	ctx: ExtensionContext,
	signal?: AbortSignal,
): Promise<{ message: string; images: ImageContent[] }> {
	if (params.message !== undefined && params.items !== undefined) {
		throw new Error("Provide either message or items, but not both");
	}
	if (params.message === undefined && params.items === undefined) {
		throw new Error("Provide one of: message or items");
	}
	if (params.message !== undefined) {
		if (!params.message.trim()) throw new Error("Empty message can't be sent to an agent");
		return { message: params.message, images: [] };
	}
	if (!params.items?.length) throw new Error("Items can't be empty");

	const parts: string[] = [];
	const images: ImageContent[] = [];
	for (const item of params.items) {
		switch (item.type) {
			case "text":
			case "input_text":
				if (!item.text?.trim()) throw new Error("text items require text");
				parts.push(item.text);
				break;
			case "local_image": {
				if (!item.path?.trim()) throw new Error("local_image items require path");
				const absolutePath = resolve(ctx.cwd, item.path);
				images.push({
					type: "image",
					data: readFileSync(absolutePath).toString("base64"),
					mimeType: mimeTypeForPath(absolutePath),
				});
				parts.push(`[local_image:${item.path}]`);
				break;
			}
			case "image":
			case "image_url": {
				const url = item.image_url?.trim() || item.url?.trim();
				if (!url) throw new Error("image items require image_url");
				images.push(await imageFromUrl(url, signal));
				parts.push(`[image:${url}]`);
				break;
			}
			case "skill": {
				if (!item.name?.trim()) throw new Error("skill items require name");
				if (item.path?.trim()) {
					const absolutePath = resolve(ctx.cwd, item.path);
					const content = readFileSync(absolutePath, "utf8");
					parts.push(`<skill name="${item.name}" location="${absolutePath}">\n${content}\n</skill>`);
				} else {
					parts.push(`Use the ${item.name.trim()} skill for this task.`);
				}
				break;
			}
			case "mention":
				if (!item.name?.trim()) throw new Error("mention items require name");
				parts.push(
					item.path?.trim() ? `[mention:${item.name.trim()}](${item.path.trim()})` : `@${item.name.trim()}`,
				);
				break;
			default:
				throw new Error(`Unsupported input item type: ${item.type}`);
		}
	}
	return { message: parts.join("\n\n"), images };
}

function resolveWaitTimeout(value: number | undefined): number {
	const timeout = value ?? CODEX_DEFAULT_WAIT_TIMEOUT_MS;
	if (!Number.isInteger(timeout)) throw new Error("timeout_ms must be an integer");
	if (timeout <= 0) throw new Error("timeout_ms must be greater than zero");
	return Math.min(CODEX_MAX_WAIT_TIMEOUT_MS, Math.max(CODEX_MIN_WAIT_TIMEOUT_MS, timeout));
}

function currentAgentId(scope: SubagentRuntimeScope | undefined): string | undefined {
	return scope?.currentAgentId;
}

function v1SpawnDescription(): string {
	return `${getCodexRoleDescription()}
Spawn a sub-agent for a well-scoped task. Returns the spawned agent id plus the user-facing nickname when available. Spawned agents inherit your current model by default. Omit \`model\` to use that preferred default; set \`model\` only when an explicit override is needed.

${CODEX_V1_SPAWN_GUIDANCE}`;
}

export interface RegisterCodexToolsOptions {
	manager: AgentManager;
	runtimeScope?: SubagentRuntimeScope;
}

export function registerCodexMultiAgentTools(quake: ExtensionAPI, options: RegisterCodexToolsOptions): void {
	const version = options.runtimeScope?.multiAgentVersion ?? resolveCodexMultiAgentVersion();
	if (version === "v2") {
		registerV2Tools(quake, options);
		return;
	}
	registerV1Tools(quake, options);
}

function registerV1Tools(quake: ExtensionAPI, { manager, runtimeScope }: RegisterCodexToolsOptions): void {
	const maxDepth = runtimeScope?.maxDepth ?? resolveCodexMaxDepth();
	if ((runtimeScope?.depth ?? 0) >= maxDepth) return;
	const maxThreads = resolveCodexMaxThreads();

	quake.registerTool({
		name: "spawn_agent",
		label: "spawn_agent",
		description: v1SpawnDescription(),
		promptSnippet: "Spawn a sub-agent for a concrete, bounded task",
		parameters: Type.Object(
			{
				message: Type.Optional(
					Type.String({
						description: "Initial plain-text task for the new agent. Use either message or items.",
					}),
				),
				items: Type.Optional(
					Type.Array(inputItemSchema, {
						description: "Structured input items. Use this to pass explicit mentions.",
					}),
				),
				agent_type: Type.Optional(Type.String({ description: getCodexRoleDescription() })),
				fork_context: Type.Optional(
					Type.Boolean({
						description:
							"True forks the current thread history into the new agent; false or omitted starts with only the initial prompt.",
					}),
				),
				model: Type.Optional(
					Type.String({
						description: "Model override for the new agent. Omit unless an explicit override is needed.",
					}),
				),
				reasoning_effort: reasoningSchema,
				service_tier: Type.Optional(
					Type.String({
						description: "Service tier override for the new agent. Omit unless explicitly requested.",
					}),
				),
				isolation: Type.Optional(
					Type.Union([Type.Literal("worktree"), Type.Literal("none")], {
						description:
							'Codex-style isolation. Default is "worktree" (isolated git copy). Use "none" for read-only explorers when sharing the main tree is intentional.',
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
			const params = rawParams as {
				message?: string;
				items?: InputItem[];
				agent_type?: string;
				fork_context?: boolean;
				model?: string;
				reasoning_effort?: ThinkingLevel;
				service_tier?: string;
				isolation?: "worktree" | "none";
			};
			if (params.fork_context && (params.agent_type || params.model || params.reasoning_effort)) {
				throw new Error(
					"Full-history forked agents inherit the parent agent type, model, and reasoning effort; omit agent_type, model, and reasoning_effort, or spawn without a full-history fork.",
				);
			}
			const input = await normalizeInput(params, ctx, signal);
			const parentRecord = runtimeScope ? manager.getRecord(runtimeScope.currentAgentId) : undefined;
			const requestedType = (params.fork_context ? parentRecord?.type : params.agent_type) ?? "default";
			const type = resolveType(requestedType);
			const config = type ? getAgentConfig(type) : undefined;
			if (!type || config?.enabled === false) {
				throw new Error(`unknown agent_type '${requestedType}'`);
			}

			const requestedModel = config?.model ?? params.model;
			let model: any;
			if (requestedModel) {
				const resolvedModel = resolveModel(requestedModel, ctx.modelRegistry);
				if (typeof resolvedModel === "string") throw new Error(resolvedModel);
				model = resolvedModel;
			}
			const thinkingLevel = config?.thinking ?? params.reasoning_effort ?? getParentThinkingLevel(ctx);
			const nickname = manager.reserveCodexNickname(config?.nicknameCandidates);
			const isolation = resolveSpawnIsolation({
				explicit: params.isolation,
				agentIsolation: config?.isolation,
			});
			const id = manager.spawn(quake, ctx, type, input.message, {
				name: nickname,
				description: conciseDescription(input.message),
				parentId: currentAgentId(runtimeScope),
				model,
				thinkingLevel,
				images: input.images,
				signal,
				isBackground: true,
				protocol: "codex-v1",
				maxDepth,
				maxResidentAgents: maxThreads,
				queueWhenBusy: false,
				inheritContext: params.fork_context === true,
				forkTurns: "all",
				forkAsSession: true,
				persistSession: true,
				isolation: isolation === "worktree" ? "worktree" : undefined,
			});
			const record = manager.getRecord(id);
			return textResult(
				{
					agent_id: id,
					nickname,
					isolation,
					worktree_path: record?.worktree?.path ?? null,
					worktree_branch: record?.worktree?.branch ?? null,
				},
				{
					agent_id: id,
					nickname,
					status: "running",
					isolation,
					worktree_path: record?.worktree?.path ?? null,
					worktree_branch: record?.worktree?.branch ?? null,
				},
			);
		},
	});

	quake.registerTool({
		name: "send_input",
		label: "send_input",
		description:
			"Send a message to an existing agent. Use interrupt=true to redirect work immediately. You should reuse the agent by send_input if you believe your assigned task is highly dependent on the context of a previous task.",
		promptSnippet: "Send input to an existing sub-agent",
		parameters: Type.Object(
			{
				target: v1TargetSchema,
				message: Type.Optional(
					Type.String({
						description: "Legacy plain-text message to send to the agent. Use either message or items.",
					}),
				),
				items: Type.Optional(Type.Array(inputItemSchema)),
				interrupt: Type.Optional(
					Type.Boolean({
						description:
							"True interrupts the current task and handles this message immediately; false or omitted queues it.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
			const params = rawParams as {
				target: string;
				message?: string;
				items?: InputItem[];
				interrupt?: boolean;
			};
			const input = await normalizeInput(params, ctx, _signal);
			const sent = await manager.sendInputById(params.target, input.message, {
				currentAgentId: currentAgentId(runtimeScope),
				interrupt: params.interrupt,
				images: input.images,
			});
			return textResult(
				{ submission_id: sent.submissionId },
				{ agent_id: sent.record.id, status: codexStatus(sent.record) },
			);
		},
	});

	quake.registerTool({
		name: "wait_agent",
		label: "wait_agent",
		description:
			"Wait for agents to reach a final status. Completed statuses may include the agent's final message. Returns empty status when timed out. Once the agent reaches a final status, a notification message will be received containing the same completed status.",
		promptSnippet: "Wait for one or more sub-agents",
		parameters: Type.Object(
			{
				targets: Type.Array(v1TargetSchema, {
					minItems: 1,
					description: "Agent ids to wait on. Pass multiple ids to wait for whichever finishes first.",
				}),
				timeout_ms: Type.Optional(
					Type.Integer({
						description: `Timeout in milliseconds. Defaults to ${CODEX_DEFAULT_WAIT_TIMEOUT_MS}, min ${CODEX_MIN_WAIT_TIMEOUT_MS}, max ${CODEX_MAX_WAIT_TIMEOUT_MS}. Prefer longer waits (minutes) to avoid busy polling.`,
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, signal) {
			const result = await manager.waitForCodexTargets(params.targets, {
				timeoutMs: resolveWaitTimeout(params.timeout_ms),
				signal,
			});
			return textResult(result, result);
		},
	});

	quake.registerTool({
		name: "close_agent",
		label: "close_agent",
		description:
			"Close an agent and any open descendants when they are no longer needed, and return the target agent's previous status before shutdown was requested. Completed agents remain open and count toward the concurrency limit until closed. Don't keep agents open for too long if they are not needed anymore.",
		promptSnippet: "Close a sub-agent thread",
		parameters: Type.Object({ target: v1TargetSchema }, { additionalProperties: false }),
		async execute(_toolCallId, params) {
			const closed = await manager.closeAgentById(params.target, currentAgentId(runtimeScope));
			return textResult(
				{ previous_status: codexStatus(closed.record, closed.previousStatus) },
				{ agent_id: closed.record.id, status: codexStatus(closed.record) },
			);
		},
	});

	quake.registerTool({
		name: "resume_agent",
		label: "resume_agent",
		description: "Resume a previously closed agent by id so it can receive send_input and wait_agent calls.",
		promptSnippet: "Resume a closed sub-agent thread",
		parameters: Type.Object(
			{ id: Type.String({ description: "Agent id to resume." }) },
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params) {
			const record = manager.resumeAgentById(params.id, {
				currentAgentId: currentAgentId(runtimeScope),
				maxResidentAgents: maxThreads,
			});
			return textResult({ status: codexStatus(record) }, { agent_id: record.id, status: codexStatus(record) });
		},
	});
}

function registerV2Tools(quake: ExtensionAPI, { manager, runtimeScope }: RegisterCodexToolsOptions): void {
	let activityCursor = manager.getActivityCursor();

	quake.registerTool({
		name: "spawn_agent",
		label: "spawn_agent",
		description:
			"Spawns an agent to work on a concrete, bounded task. The child receives a canonical /root/... task path, the same tools, and recursive delegation capability.",
		promptSnippet: "Spawn a named Codex V2 sub-agent",
		parameters: Type.Object(
			{
				task_name: Type.String({ pattern: "^[a-z0-9_]+$" }),
				message: Type.String({ minLength: 1 }),
				agent_type: Type.Optional(Type.String()),
				model: Type.Optional(Type.String()),
				reasoning_effort: reasoningSchema,
				fork_turns: Type.Optional(
					Type.Union([Type.Literal("all"), Type.Literal("none"), Type.String({ pattern: "^[1-9][0-9]*$" })]),
				),
				service_tier: Type.Optional(Type.String()),
				isolation: Type.Optional(
					Type.Union([Type.Literal("worktree"), Type.Literal("none")], {
						description: 'Default "worktree" for Codex-style isolated parallel agents; "none" to share main tree.',
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!params.message.trim()) throw new Error("Empty message can't be sent to an agent");
			const forkTurns = params.fork_turns ?? "all";
			if (forkTurns === "all" && (params.agent_type || params.model || params.reasoning_effort)) {
				throw new Error(
					"Full-history forked agents inherit the parent agent type, model, and reasoning effort; omit overrides or use a partial/no fork.",
				);
			}
			const parentRecord = runtimeScope ? manager.getRecord(runtimeScope.currentAgentId) : undefined;
			const requestedType = (forkTurns === "all" ? parentRecord?.type : params.agent_type) ?? "default";
			const type = resolveType(requestedType);
			const config = type ? getAgentConfig(type) : undefined;
			if (!type || config?.enabled === false) {
				throw new Error(`unknown agent_type '${requestedType}'`);
			}
			let model: any;
			if (params.model) {
				const resolvedModel = resolveModel(params.model, ctx.modelRegistry);
				if (typeof resolvedModel === "string") throw new Error(resolvedModel);
				model = resolvedModel;
			}
			const nickname = manager.reserveCodexNickname(config?.nicknameCandidates);
			const isolation = resolveSpawnIsolation({
				explicit: (params as { isolation?: string }).isolation,
				agentIsolation: config?.isolation,
			});
			const numericForkTurns =
				typeof forkTurns === "string" && /^[1-9][0-9]*$/.test(forkTurns)
					? Number.parseInt(forkTurns, 10)
					: forkTurns;
			const id = manager.spawn(quake, ctx, type, params.message, {
				name: nickname,
				taskName: params.task_name,
				description: conciseDescription(params.message),
				parentId: currentAgentId(runtimeScope),
				model,
				thinkingLevel: params.reasoning_effort,
				signal,
				isBackground: true,
				protocol: "codex-v2",
				maxDepth: Number.MAX_SAFE_INTEGER,
				queueWhenBusy: false,
				inheritContext: numericForkTurns !== "none",
				forkTurns: typeof numericForkTurns === "number" ? numericForkTurns : "all",
				forkAsSession: true,
				persistSession: true,
				isolation: isolation === "worktree" ? "worktree" : undefined,
			});
			const record = manager.getRecord(id)!;
			return textResult(
				{
					task_name: record.taskPath,
					nickname,
					isolation,
					worktree_path: record.worktree?.path ?? null,
					worktree_branch: record.worktree?.branch ?? null,
				},
				{
					agent_id: id,
					task_name: record.taskPath,
					nickname,
					isolation,
					worktree_path: record.worktree?.path ?? null,
					worktree_branch: record.worktree?.branch ?? null,
				},
			);
		},
	});

	quake.registerTool({
		name: "send_message",
		label: "send_message",
		description:
			"Send a message to an existing agent. The message will be delivered promptly. Does not trigger a new turn.",
		promptSnippet: "Queue a message for a sub-agent",
		parameters: Type.Object(
			{ target: v2TargetSchema, message: Type.String({ minLength: 1 }) },
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params) {
			await manager.sendMessage(params.target, params.message, currentAgentId(runtimeScope));
			return textResult("");
		},
	});

	quake.registerTool({
		name: "followup_task",
		label: "followup_task",
		description: "Send a follow-up task to an existing non-root target agent and trigger a turn if it is idle.",
		promptSnippet: "Assign a follow-up task to a sub-agent",
		parameters: Type.Object(
			{ target: v2TargetSchema, message: Type.String({ minLength: 1 }) },
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params) {
			await manager.followupTask(params.target, params.message, currentAgentId(runtimeScope));
			return textResult("");
		},
	});

	quake.registerTool({
		name: "wait_agent",
		label: "wait_agent",
		description: "Wait for a mailbox update from any live agent. Does not return final content.",
		promptSnippet: "Wait for sub-agent mailbox activity",
		parameters: Type.Object(
			{
				timeout_ms: Type.Optional(
					Type.Integer({
						minimum: CODEX_MIN_WAIT_TIMEOUT_MS,
						maximum: CODEX_MAX_WAIT_TIMEOUT_MS,
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, signal) {
			const activity = await manager.waitForActivity(activityCursor, {
				currentAgentId: currentAgentId(runtimeScope),
				timeoutMs: params.timeout_ms ?? CODEX_DEFAULT_WAIT_TIMEOUT_MS,
				signal,
			});
			activityCursor = activity.cursor;
			return textResult({
				message: activity.timedOut ? "Wait timed out." : "Wait completed.",
				timed_out: activity.timedOut,
			});
		},
	});

	quake.registerTool({
		name: "list_agents",
		label: "list_agents",
		description: "List live agents in the current root thread tree. Optionally filter by task-path prefix.",
		promptSnippet: "List sub-agent task-tree status",
		parameters: Type.Object({ path_prefix: Type.Optional(Type.String()) }, { additionalProperties: false }),
		async execute(_toolCallId, params) {
			const requestedPrefix = params.path_prefix?.replace(/\/$/, "");
			const prefix = requestedPrefix
				? requestedPrefix.startsWith("/")
					? requestedPrefix
					: `${runtimeScope?.currentAgentPath ?? "/root"}/${requestedPrefix}`
				: undefined;
			const agents = manager
				.listAgents()
				.filter((record) => record.status !== "shutdown")
				.filter((record) => !prefix || record.taskPath === prefix || record.taskPath.startsWith(`${prefix}/`))
				.map((record) => ({
					agent_name: record.taskPath,
					agent_status: codexStatus(record),
					last_task_message: record.lastTaskMessage || null,
				}));
			if (!prefix || prefix === "/root") {
				agents.unshift({
					agent_name: "/root",
					agent_status: "running",
					last_task_message: "Main thread",
				});
			}
			return textResult({ agents }, { agents });
		},
	});

	quake.registerTool({
		name: "interrupt_agent",
		label: "interrupt_agent",
		description:
			"Interrupt an agent's current turn, if any, and return its previous status. The agent remains available for messages and follow-up tasks.",
		promptSnippet: "Interrupt a running sub-agent",
		parameters: Type.Object({ target: v2TargetSchema }, { additionalProperties: false }),
		async execute(_toolCallId, params) {
			const interrupted = await manager.interruptAgent(params.target, currentAgentId(runtimeScope));
			return textResult({
				previous_status: codexStatus(interrupted.record, interrupted.previousStatus),
			});
		},
	});
}
