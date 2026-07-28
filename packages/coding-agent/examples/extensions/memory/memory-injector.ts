/**
 * Memory Injector - Working memory injection via context event.
 *
 * Her turdan önce context event'i ile ilgili memory'leri
 * user message olarak inject eder.
 */

import type { AgentMessage } from "@mrquake/quakecode-agent-core";
import { getMemorySystemPromptSection } from "./memory-prompts.js";
import type { MemoryStore } from "./memory-store.js";

export interface InjectorOptions {
	maxInjectTokens: number;
	enabled: boolean;
}

export const DEFAULT_INJECTOR_OPTIONS: InjectorOptions = {
	maxInjectTokens: 2048,
	enabled: true,
};

/**
 * Inject memories into context by prepending a user message
 * with relevant memory summaries.
 */
export function injectMemories(
	messages: AgentMessage[],
	memoryStore: MemoryStore,
	options: InjectorOptions = DEFAULT_INJECTOR_OPTIONS,
): AgentMessage[] {
	if (!options.enabled) return messages;
	if (memoryStore.getAllEntries().length === 0) return messages;

	const memoryText = memoryStore.getFormattedSummary(options.maxInjectTokens);
	if (!memoryText) return messages;

	const memoryMessage = {
		role: "user" as const,
		content: [
			{
				type: "text" as const,
				text: `[🧠 Persistent Memory - Available Knowledge]\n\nThe following memories from previous sessions may be relevant:\n\n${memoryText}\n\nUse \`recall()\` to get full details on any of these. Use \`remember()\` to save new information.`,
			},
		],
		timestamp: Date.now(),
	};

	// Prepend as early message so it's visible but doesn't override system prompt
	const result = [memoryMessage, ...messages];
	return result;
}

export function getMemorySystemPrompt(): string {
	return getMemorySystemPromptSection();
}
