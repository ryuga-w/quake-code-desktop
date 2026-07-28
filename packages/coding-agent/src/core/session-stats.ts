import type { AgentMessage } from "@mrquake/quakecode-agent-core";
import type { AssistantMessage } from "@mrquake/quakecode-ai";
import type { SessionStats } from "./agent-session.js";
import type { ContextUsage } from "./extensions/index.js";

export function calculateSessionStats(
	messages: AgentMessage[],
	options: {
		sessionFile: string | undefined;
		sessionId: string;
		contextUsage?: ContextUsage;
	},
): SessionStats {
	const userMessages = messages.filter((m) => m.role === "user").length;
	const assistantMessages = messages.filter((m) => m.role === "assistant").length;
	const toolResults = messages.filter((m) => m.role === "toolResult").length;

	let toolCalls = 0;
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalCost = 0;

	for (const message of messages) {
		if (message.role !== "assistant") continue;
		const assistantMsg = message as AssistantMessage;
		toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
		totalInput += assistantMsg.usage.input;
		totalOutput += assistantMsg.usage.output;
		totalCacheRead += assistantMsg.usage.cacheRead;
		totalCacheWrite += assistantMsg.usage.cacheWrite;
		totalCost += assistantMsg.usage.cost.total;
	}

	return {
		sessionFile: options.sessionFile,
		sessionId: options.sessionId,
		userMessages,
		assistantMessages,
		toolCalls,
		toolResults,
		totalMessages: messages.length,
		tokens: {
			input: totalInput,
			output: totalOutput,
			cacheRead: totalCacheRead,
			cacheWrite: totalCacheWrite,
			total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
		},
		cost: totalCost,
		contextUsage: options.contextUsage,
	};
}
