/**
 * Memory consolidation — backward-compatible facade over memory-store.
 */

import {
	buildMemoryInjectionBlock,
	consolidateScope,
	getDefaultAgentName,
	getMemoryStatus,
	logActivity,
	MEMORY_INJECT_MAX_BYTES,
	MEMORY_INJECT_MAX_LINES,
	type MemoryScope,
	readScopeEntries,
	rememberEntry,
	searchEntries,
} from "./memory/memory-store.js";

export type { MemoryEntry, MemoryEntryType, MemoryScope } from "./memory/memory-store.js";
export {
	buildMemoryInjectionBlock,
	getMemoryStatus,
	logActivity,
	readScopeEntries as readMemoryEntries,
	searchEntries,
	getDefaultAgentName,
	MEMORY_INJECT_MAX_BYTES,
	MEMORY_INJECT_MAX_LINES,
};

export function needsConsolidation(agentName: string, scope: MemoryScope, cwd: string): boolean {
	const status = getMemoryStatus(agentName, cwd);
	return status.scopes.find((s) => s.scope === scope)?.needsConsolidation ?? false;
}

export interface ConsolidationResult {
	linesBefore: number;
	linesAfter: number;
	archivedCount: number;
	consolidated: boolean;
}

export function appendMemoryEntry(
	agentName: string,
	scope: MemoryScope,
	cwd: string,
	entry: { name: string; description: string; type: string; content: string },
): void {
	rememberEntry(agentName, cwd, {
		name: entry.name,
		description: entry.description,
		content: entry.content,
		scope,
		type: entry.type as import("./memory/memory-store.js").MemoryEntryType,
		overwrite: true,
	});
}

export function consolidateMemory(
	agentName: string,
	scope: MemoryScope,
	cwd: string,
	summarizer?: (content: string) => string,
): ConsolidationResult {
	const before = readScopeEntries(agentName, scope, cwd);
	const linesBefore = before.length;
	const result = consolidateScope(agentName, scope, cwd, summarizer);
	const after = readScopeEntries(agentName, scope, cwd);
	return {
		linesBefore,
		linesAfter: after.length,
		archivedCount: result.archivedCount,
		consolidated: result.consolidated,
	};
}

export function createMemorySummarizer(): (content: string) => string {
	return (content: string): string => {
		const lines = content.split("\n").filter((l) => l.trim() && !l.match(/^---|^name:|^description:|^type:|^scope:/));
		const bullets = lines
			.slice(0, 30)
			.map((l) => `- ${l.trim()}`)
			.join("\n");
		return `## Consolidated Memory\n\n${bullets}\n\n*Archived entries summarized automatically.*`;
	};
}
