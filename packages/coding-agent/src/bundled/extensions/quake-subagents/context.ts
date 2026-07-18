/**
 * context.ts — Extract parent conversation context for subagent inheritance.
 */

import type { AgentMessage, ThinkingLevel } from "@mrquake/quakecode-agent-core";
import type { ExtensionContext, SessionManager } from "@mrquake/quakecode-cli";

/** Extract text from a message content block array. */
export function extractText(content: unknown[]): string {
	return content
		.filter((c: any) => c.type === "text")
		.map((c: any) => c.text ?? "")
		.join("\n");
}

/**
 * Build a text representation of the parent conversation context.
 * Used when inherit_context is true to give the subagent visibility
 * into what has been discussed/done so far.
 */
export function buildParentContext(ctx: ExtensionContext, forkTurns: "all" | number = "all"): string {
	const entries = ctx.sessionManager.getBranch();
	if (!entries || entries.length === 0) return "";

	const rendered: Array<{ text: string; turn: number }> = [];
	let currentTurn = 0;

	for (const entry of entries) {
		if (entry.type === "message") {
			const msg = entry.message;
			if (msg.role === "user") {
				currentTurn += 1;
				const text = typeof msg.content === "string" ? msg.content : extractText(msg.content);
				if (text.trim()) rendered.push({ text: `[User]: ${text.trim()}`, turn: currentTurn });
			} else if (msg.role === "assistant") {
				const text = extractText(msg.content);
				if (text.trim()) rendered.push({ text: `[Assistant]: ${text.trim()}`, turn: currentTurn });
			}
			// Tool results are intentionally omitted: they are noisy and can contain huge payloads.
		} else if (entry.type === "compaction" && forkTurns === "all" && entry.summary) {
			rendered.push({ text: `[Summary]: ${entry.summary}`, turn: currentTurn });
		}
	}

	const firstTurn = forkTurns === "all" ? 0 : Math.max(1, currentTurn - forkTurns + 1);
	const parts = rendered.filter((entry) => entry.turn >= firstTurn).map((entry) => entry.text);
	if (parts.length === 0) return "";

	return `# Parent Conversation Context
The following is the inherited parent-session history for this delegated task.
Use it as background context; do not repeat work that is already complete.

${parts.join("\n\n")}

---
# Your Task (below)
`;
}

export function getParentThinkingLevel(ctx: ExtensionContext): ThinkingLevel | undefined {
	const entries = ctx.sessionManager.getBranch();
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type === "thinking_level_change") {
			return entry.thinkingLevel as ThinkingLevel;
		}
	}
	return undefined;
}

/**
 * Seed a child SessionManager with the model-visible portion of the parent
 * thread. Codex full-history forks retain user/developer context and final
 * assistant text while dropping tool calls, tool results, and reasoning.
 */
export function seedForkedSession(
	ctx: ExtensionContext,
	sessionManager: SessionManager,
	forkTurns: "all" | number = "all",
): void {
	const entries = ctx.sessionManager.getBranch();
	let currentTurn = 0;
	const messages: Array<{ message: AgentMessage; turn: number }> = [];

	for (const entry of entries) {
		if (entry.type === "message") {
			const message = entry.message;
			if (message.role === "user") {
				currentTurn += 1;
				messages.push({ message, turn: currentTurn });
				continue;
			}
			if (message.role === "assistant") {
				const textContent = message.content.filter((content) => content.type === "text");
				if (textContent.length > 0) {
					messages.push({
						message: { ...message, content: textContent },
						turn: currentTurn,
					});
				}
			}
			continue;
		}

		if (entry.type === "compaction" && forkTurns === "all" && entry.summary.trim()) {
			messages.push({
				message: {
					role: "user",
					content: [
						{
							type: "text",
							text: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${entry.summary}\n</summary>`,
						},
					],
					timestamp: new Date(entry.timestamp).getTime(),
				},
				turn: currentTurn,
			});
		}
	}

	const firstTurn = forkTurns === "all" ? 0 : Math.max(1, currentTurn - forkTurns + 1);
	for (const { message, turn } of messages) {
		if (turn < firstTurn) continue;
		sessionManager.appendMessage(message as Parameters<SessionManager["appendMessage"]>[0]);
	}
}
