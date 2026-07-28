import type { AgentRoom, AgentRoomContextMode, AgentRoomMessage, AgentRoomTask } from "./types.js";

function formatMessages(messages: AgentRoomMessage[]): string {
	if (messages.length === 0) return "Henüz oda mesajı yok.";
	return messages.map((message) => `- [${message.type}] ${message.from}: ${message.message}`).join("\n");
}

function formatTasks(tasks: AgentRoomTask[]): string {
	if (tasks.length === 0) return "No room tasks.";
	return tasks
		.map((task) => {
			const owner = task.assignee ? ` @${task.assignee}` : "";
			const agent = task.agentId ? ` agent:${task.agentId}` : "";
			const detail = task.description ? ` — ${task.description}` : "";
			return `- ${task.id} [${task.status}/${task.priority}]${owner}${agent}: ${task.title}${detail}`;
		})
		.join("\n");
}

export function buildRoomPrompt(input: {
	room: AgentRoom;
	messages: AgentRoomMessage[];
	tasks?: AgentRoomTask[];
	role?: string;
	task: string;
	contextMode: AgentRoomContextMode;
}): string {
	const messageBudget =
		input.contextMode === "full" ? input.messages.length : input.contextMode === "compact" ? 12 : 30;
	const taskBudget = input.contextMode === "full" ? input.tasks?.length ?? 0 : input.contextMode === "compact" ? 12 : 30;
	const selectedMessages = input.messages.slice(-messageBudget);
	const selectedTasks = (input.tasks ?? [])
		.filter((task) => input.contextMode === "full" || !["done", "cancelled"].includes(task.status))
		.slice(-taskBudget);

	return `You are joining a Quake Code AgentRoom. Coordinate through the shared room memory instead of assuming hidden context.

Room: ${input.room.name} (${input.room.id})
Goal: ${input.room.goal}
${input.room.brief ? `Brief:\n${input.room.brief}\n` : ""}
Your role: ${input.role || "specialist agent"}

Active room tasks:
${formatTasks(selectedTasks)}

Recent shared room memory:
${formatMessages(selectedMessages)}

Your task:
${input.task}

Instructions:
- Read the room context above before acting.
- Produce concrete findings, decisions, risks, and next steps.
- If you discover important context, say exactly what should be posted back to the room.
- Do not overwrite unrelated files. Prefer small, reviewable changes.
- If implementation is risky or ambiguous, explain the safest path.`;
}
