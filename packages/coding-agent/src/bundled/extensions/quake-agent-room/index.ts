import type { ExtensionAPI } from "@mrquake/quakecode-cli";
import { Text } from "@mrquake/quakecode-tui";
import { Type } from "@sinclair/typebox";
import { AgentManager } from "../quake-subagents/agent-manager.js";
import { getAgentConfig, registerAgents, resolveType } from "../quake-subagents/agent-types.js";
import { loadCustomAgents } from "../quake-subagents/custom-agents.js";
import { resolveAgentInvocationConfig } from "../quake-subagents/invocation-config.js";
import { resolveModel } from "../quake-subagents/model-resolver.js";
import type { SubagentType } from "../quake-subagents/types.js";
import { buildRoomPrompt } from "./prompts.js";
import {
	addTask,
	appendMessage,
	claimTask,
	completeTask,
	createRoom,
	getRoom,
	getStatus,
	listTasks,
	readMessages,
	roomPath,
	updateTask,
} from "./store.js";
import type { AgentRoomMessageType, AgentRoomTaskPriority, AgentRoomTaskStatus } from "./types.js";

function textResult(text: string, details?: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

const MessageTypeSchema = Type.Union([
	Type.Literal("finding"),
	Type.Literal("decision"),
	Type.Literal("question"),
	Type.Literal("answer"),
	Type.Literal("task"),
	Type.Literal("status"),
	Type.Literal("risk"),
	Type.Literal("summary"),
	Type.Literal("system"),
]);

const ContextModeSchema = Type.Union([Type.Literal("compact"), Type.Literal("standard"), Type.Literal("full")]);

const TaskStatusSchema = Type.Union([
	Type.Literal("open"),
	Type.Literal("claimed"),
	Type.Literal("in_progress"),
	Type.Literal("blocked"),
	Type.Literal("done"),
	Type.Literal("cancelled"),
]);

const TaskPrioritySchema = Type.Union([Type.Literal("low"), Type.Literal("normal"), Type.Literal("high")]);

function taskStatusCountsText(counts: Record<string, number>): string {
	return Object.entries(counts)
		.map(([status, count]) => `${status}:${count}`)
		.join(", ");
}

function syncTaskFromAgentCompletion(
	cwd: string,
	roomId: string,
	taskId: string | undefined,
	record: { id: string; status: string },
) {
	if (!taskId) return;
	try {
		updateTask(cwd, roomId, taskId, {
			status: record.status === "completed" || record.status === "steered" ? "done" : "blocked",
			agentId: record.id,
			metadata: { agentStatus: record.status },
		});
	} catch {
		// Task sync is best-effort; room write-back should not break agent cleanup.
	}
}

const roomAgentLinks = new Map<string, { cwd: string; roomId: string; taskId?: string }>();

const manager = new AgentManager((record) => {
	const metadata = record.description?.match(/\[room:([^\]]+)\](?:\[task:([^\]]+)\])?/);
	const link = roomAgentLinks.get(record.id);
	const roomId = link?.roomId ?? metadata?.[1];
	const taskId = link?.taskId ?? metadata?.[2];
	const cwd = link?.cwd ?? process.cwd();
	if (!roomId) return;
	syncTaskFromAgentCompletion(cwd, roomId, taskId, record);
	try {
		appendMessage(cwd, roomId, {
			from: `${record.type}:${record.id}`,
			type: record.status === "error" ? "risk" : "summary",
			message: record.result || record.error || `Agent finished with status ${record.status}`,
			metadata: {
				agentId: record.id,
				status: record.status,
				toolUses: record.toolUses,
			},
		});
	} catch {
		// Room completion write-back must not break agent cleanup.
	} finally {
		roomAgentLinks.delete(record.id);
	}
});

export default function (quake: ExtensionAPI) {
	quake.registerTool({
		name: "create_agent_room",
		label: "create_agent_room",
		description: "Create or update a shared file-backed AgentRoom for coordinating multiple agents.",
		promptSnippet: "Create a shared coordination room for agents",
		parameters: Type.Object({
			id: Type.Optional(Type.String({ description: "Stable room id. Defaults to a slug from name." })),
			name: Type.String({ description: "Human-readable room name." }),
			goal: Type.String({ description: "Room goal / mission." }),
			brief: Type.Optional(Type.String({ description: "Shared brief all spawned agents should see." })),
		}),
		renderCall(args, theme) {
			return new Text(`${theme.bold("AgentRoom")} ${theme.fg("dim", args.name)}`, 0, 0);
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const room = createRoom(ctx.cwd, params);
			appendMessage(ctx.cwd, room.id, {
				from: "room-system",
				type: "system",
				message: `Room created/updated. Goal: ${room.goal}`,
			});
			return textResult(`AgentRoom created: ${room.id}\nPath: ${roomPath(ctx.cwd, room.id)}`, { room });
		},
	});

	quake.registerTool({
		name: "agent_room_post",
		label: "agent_room_post",
		description: "Post a finding, decision, task, status update, question, or summary to an AgentRoom.",
		promptSnippet: "Post shared context to an AgentRoom",
		parameters: Type.Object({
			roomId: Type.String({ description: "Room id." }),
			from: Type.String({ description: "Author name or role." }),
			type: MessageTypeSchema,
			message: Type.String({ description: "Message to append to room memory." }),
			metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const message = appendMessage(ctx.cwd, params.roomId, {
				from: params.from,
				type: params.type as AgentRoomMessageType,
				message: params.message,
				metadata: params.metadata,
			});
			return textResult(`Posted to ${message.roomId}: ${message.type} by ${message.from}`, { message });
		},
	});

	quake.registerTool({
		name: "agent_room_add_task",
		label: "agent_room_add_task",
		description: "Add a persistent task to an AgentRoom task queue.",
		promptSnippet: "Add an AgentRoom task",
		parameters: Type.Object({
			roomId: Type.String({ description: "Room id." }),
			title: Type.String({ description: "Short task title." }),
			description: Type.Optional(Type.String({ description: "Detailed task description." })),
			priority: Type.Optional(TaskPrioritySchema),
			assignee: Type.Optional(Type.String({ description: "Initial assignee or role." })),
			metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const task = addTask(ctx.cwd, params.roomId, {
				title: params.title,
				description: params.description,
				priority: params.priority as AgentRoomTaskPriority | undefined,
				assignee: params.assignee,
				metadata: params.metadata,
			});
			appendMessage(ctx.cwd, task.roomId, {
				from: "room-system",
				type: "task",
				message: `Task added ${task.id}: ${task.title}`,
				metadata: { taskId: task.id, status: task.status, priority: task.priority },
			});
			return textResult(`Task added: ${task.id} [${task.status}/${task.priority}] ${task.title}`, { task });
		},
	});

	quake.registerTool({
		name: "agent_room_list_tasks",
		label: "agent_room_list_tasks",
		description: "List tasks in an AgentRoom, optionally filtered by status.",
		promptSnippet: "List AgentRoom tasks",
		parameters: Type.Object({
			roomId: Type.String({ description: "Room id." }),
			status: Type.Optional(TaskStatusSchema),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const tasks = listTasks(ctx.cwd, params.roomId, params.status as AgentRoomTaskStatus | undefined);
			const body = tasks.length
				? tasks
						.map((task) =>
							`${task.id} [${task.status}/${task.priority}]${task.assignee ? ` @${task.assignee}` : ""}: ${task.title}`,
						)
						.join("\n")
				: "No tasks.";
			return textResult(body, { tasks });
		},
	});

	quake.registerTool({
		name: "agent_room_claim_task",
		label: "agent_room_claim_task",
		description: "Claim an AgentRoom task for an assignee or role.",
		promptSnippet: "Claim an AgentRoom task",
		parameters: Type.Object({
			roomId: Type.String({ description: "Room id." }),
			taskId: Type.String({ description: "Task id." }),
			assignee: Type.String({ description: "Assignee or role claiming the task." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const task = claimTask(ctx.cwd, params.roomId, params.taskId, params.assignee);
			appendMessage(ctx.cwd, task.roomId, {
				from: "room-system",
				type: "status",
				message: `Task claimed ${task.id} by ${task.assignee}`,
				metadata: { taskId: task.id, status: task.status, assignee: task.assignee },
			});
			return textResult(`Task claimed: ${task.id} by ${task.assignee}`, { task });
		},
	});

	quake.registerTool({
		name: "agent_room_update_task",
		label: "agent_room_update_task",
		description: "Update an AgentRoom task status, assignee, priority, title, description, or metadata.",
		promptSnippet: "Update an AgentRoom task",
		parameters: Type.Object({
			roomId: Type.String({ description: "Room id." }),
			taskId: Type.String({ description: "Task id." }),
			title: Type.Optional(Type.String({ description: "New title." })),
			description: Type.Optional(Type.String({ description: "New description." })),
			status: Type.Optional(TaskStatusSchema),
			priority: Type.Optional(TaskPrioritySchema),
			assignee: Type.Optional(Type.String({ description: "New assignee." })),
			agentId: Type.Optional(Type.String({ description: "Associated agent id." })),
			metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const task = updateTask(ctx.cwd, params.roomId, params.taskId, {
				title: params.title,
				description: params.description,
				status: params.status as AgentRoomTaskStatus | undefined,
				priority: params.priority as AgentRoomTaskPriority | undefined,
				assignee: params.assignee,
				agentId: params.agentId,
				metadata: params.metadata,
			});
			appendMessage(ctx.cwd, task.roomId, {
				from: "room-system",
				type: "status",
				message: `Task updated ${task.id}: ${task.status}`,
				metadata: { taskId: task.id, status: task.status, assignee: task.assignee, agentId: task.agentId },
			});
			return textResult(`Task updated: ${task.id} [${task.status}/${task.priority}] ${task.title}`, { task });
		},
	});

	quake.registerTool({
		name: "agent_room_complete_task",
		label: "agent_room_complete_task",
		description: "Mark an AgentRoom task as done.",
		promptSnippet: "Complete an AgentRoom task",
		parameters: Type.Object({
			roomId: Type.String({ description: "Room id." }),
			taskId: Type.String({ description: "Task id." }),
			metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const task = completeTask(ctx.cwd, params.roomId, params.taskId, params.metadata);
			appendMessage(ctx.cwd, task.roomId, {
				from: "room-system",
				type: "status",
				message: `Task completed ${task.id}: ${task.title}`,
				metadata: { taskId: task.id, status: task.status },
			});
			return textResult(`Task completed: ${task.id} ${task.title}`, { task });
		},
	});

	quake.registerTool({
		name: "agent_room_read",
		label: "agent_room_read",
		description: "Read recent messages from an AgentRoom.",
		promptSnippet: "Read shared AgentRoom memory",
		parameters: Type.Object({
			roomId: Type.String({ description: "Room id." }),
			limit: Type.Optional(Type.Number({ description: "Maximum messages to return. Default 50." })),
			type: Type.Optional(MessageTypeSchema),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const messages = readMessages(
				ctx.cwd,
				params.roomId,
				params.limit ?? 50,
				params.type as AgentRoomMessageType | undefined,
			);
			const body = messages.length
				? messages.map((m) => `[${m.createdAt}] [${m.type}] ${m.from}: ${m.message}`).join("\n")
				: "No messages.";
			return textResult(body, { messages });
		},
	});

	quake.registerTool({
		name: "agent_room_status",
		label: "agent_room_status",
		description: "Return AgentRoom metadata, message counts, and recent activity.",
		promptSnippet: "Check AgentRoom status",
		parameters: Type.Object({ roomId: Type.String({ description: "Room id." }) }),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const status = getStatus(ctx.cwd, params.roomId);
			const counts = Object.entries(status.countsByType)
				.map(([type, count]) => `${type}:${count}`)
				.join(", ");
			const taskCounts = taskStatusCountsText(status.countsByTaskStatus);
			return textResult(
				`Room: ${status.room.name} (${status.room.id})\nGoal: ${status.room.goal}\nMessages: ${status.messageCount}${counts ? ` (${counts})` : ""}\nTasks: ${status.taskCount}${taskCounts ? ` (${taskCounts})` : ""}`,
				{ status },
			);
		},
	});

	quake.registerTool({
		name: "agent_room_spawn",
		label: "agent_room_spawn",
		description:
			"Spawn a room-aware subagent. The agent receives the room brief and recent shared memory; its final output is posted back to the room.",
		promptSnippet: "Spawn a room-aware agent",
		parameters: Type.Object({
			name: Type.String({ description: "Required meaningful unique instance name chosen by the parent agent." }),
			roomId: Type.String({ description: "Room id." }),
			task: Type.String({ description: "Task for the agent." }),
			role: Type.Optional(Type.String({ description: "Agent role label used in the room prompt." })),
			taskId: Type.Optional(Type.String({ description: "Optional AgentRoom task id this agent should work on." })),
			subagent_type: Type.Optional(Type.String({ description: "Subagent type. Defaults to general-purpose." })),
			description: Type.Optional(Type.String({ description: "Short task description." })),
			model: Type.Optional(Type.String({ description: "Optional model override, e.g. openai/gpt-5.5 or gpt-5.5." })),
			thinking: Type.Optional(Type.String({ description: "Thinking level override." })),
			max_turns: Type.Optional(Type.Number({ description: "Maximum agentic turns." })),
			run_in_background: Type.Optional(Type.Boolean({ description: "Run in background. Default true." })),
			inherit_context: Type.Optional(Type.Boolean({ description: "Whether to inherit parent context." })),
			isolated: Type.Optional(Type.Boolean({ description: "Disable extension/MCP tools for this agent." })),
			isolation: Type.Optional(Type.String({ description: "Optional isolation mode, e.g. worktree." })),
			context_mode: Type.Optional(ContextModeSchema),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const requestedName = params.name?.trim();
			if (!requestedName) return textResult("Room subagent name is required. Choose a meaningful unique name.");
			registerAgents(loadCustomAgents(ctx.cwd));
			const room = getRoom(ctx.cwd, params.roomId);
			const messages = readMessages(ctx.cwd, room.id, Number.MAX_SAFE_INTEGER);
			const tasks = listTasks(ctx.cwd, room.id);
			const rawType = (params.subagent_type ?? "general-purpose") as SubagentType;
			const subagentType = (resolveType(rawType) ?? "general-purpose") as SubagentType;
			const agentConfig = getAgentConfig(subagentType);
			const resolvedConfig = resolveAgentInvocationConfig(agentConfig, {
				...params,
				run_in_background: params.run_in_background ?? true,
			});

			let model = ctx.model;
			if (resolvedConfig.modelInput) {
				const resolvedModel = resolveModel(resolvedConfig.modelInput, ctx.modelRegistry);
				if (typeof resolvedModel === "string") return textResult(resolvedModel);
				model = resolvedModel;
			}

			const prompt = buildRoomPrompt({
				room,
				messages,
				tasks,
				role: params.role,
				task: params.task,
				contextMode: params.context_mode ?? "standard",
			});
			const description = `[room:${room.id}]${params.taskId ? `[task:${params.taskId}]` : ""} ${params.description ?? params.role ?? subagentType}`;
			appendMessage(ctx.cwd, room.id, {
				from: "room-system",
				type: "task",
				message: `Spawned ${subagentType}: ${params.task}`,
				metadata: { role: params.role, description, taskId: params.taskId },
			});

			if (resolvedConfig.runInBackground !== false) {
				const id = manager.spawn(quake, ctx, subagentType, prompt, {
					name: requestedName,
					description,
					model,
					maxTurns: resolvedConfig.maxTurns,
					thinkingLevel: resolvedConfig.thinking,
					inheritContext: resolvedConfig.inheritContext,
					isolated: resolvedConfig.isolated,
					isolation: resolvedConfig.isolation,
					isBackground: true,
				});
				roomAgentLinks.set(id, { cwd: ctx.cwd, roomId: room.id, taskId: params.taskId });
				if (params.taskId) {
					updateTask(ctx.cwd, room.id, params.taskId, {
						status: "in_progress",
						agentId: id,
						assignee: params.role ?? subagentType,
					});
				}
				return textResult(`Room agent spawned in background: ${id}`, { agentId: id, roomId: room.id, taskId: params.taskId });
			}

			const record = await manager.spawnAndWait(quake, ctx, subagentType, prompt, {
				name: requestedName,
				description,
				model,
				maxTurns: resolvedConfig.maxTurns,
				thinkingLevel: resolvedConfig.thinking,
				inheritContext: resolvedConfig.inheritContext,
				isolated: resolvedConfig.isolated,
				isolation: resolvedConfig.isolation,
			});
			syncTaskFromAgentCompletion(ctx.cwd, room.id, params.taskId, record);
			appendMessage(ctx.cwd, room.id, {
				from: `${record.name}:${record.type}:${record.id}`,
				type: record.status === "error" ? "risk" : "summary",
				message: record.result || record.error || `Agent finished with status ${record.status}`,
				metadata: { agentId: record.id, status: record.status, toolUses: record.toolUses, taskId: params.taskId },
			});
			return textResult(record.result || record.error || `Agent finished with status ${record.status}`, {
				agentId: record.id,
				status: record.status,
				roomId: room.id,
				taskId: params.taskId,
			});
		},
	});
}
