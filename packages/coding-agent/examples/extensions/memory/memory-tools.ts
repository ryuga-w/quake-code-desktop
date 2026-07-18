/**
 * Memory Extension - Tool definitions (remember, recall, forget, remember-multi)
 *
 * These tools are registered for LLM to call.
 * Uses defineTool() for proper type inference of execute params.
 */

import { defineTool } from "@mrquake/quakecode-cli";
import { Type } from "@sinclair/typebox";
import { formatMemoryForRecall, formatMemoryShort } from "./memory-prompts.js";
import type { MemoryStore } from "./memory-store.js";

// ============================================================================
// remember Tool
// ============================================================================

export function createRememberTool(memoryStore: MemoryStore) {
	return defineTool({
		name: "remember",
		label: "Remember",
		description:
			"Store a fact, decision, preference, learning, or pattern in persistent memory. " +
			"This information will be available in FUTURE conversations across sessions. " +
			"Use this to remember architecture decisions, user preferences, project conventions, " +
			"and important learnings. If a memory with the same key already exists, it will be updated.",
		promptSnippet:
			"remember(key, title, content, type?, namespace?, tags?) — Store information in persistent memory for future sessions",
		promptGuidelines: [
			"Prefer short, unique keys (e.g., 'arch-db-choice', 'build-command', 'test-framework')",
			"Set namespace: 'project' for code decisions, 'learnings' for bugs/solutions, 'user' for preferences",
			"Use summary parameter for a one-liner auto-injected into context",
		],
		parameters: Type.Object({
			key: Type.String({
				description:
					"Unique identifier in kebab-case (e.g., 'arch-db-choice', 'build-command'). " +
					"Using an existing key will UPDATE that memory.",
			}),
			title: Type.String({ description: "Short human-readable title" }),
			content: Type.String({ description: "Detailed information. What, why, context. 2-3 sentences." }),
			summary: Type.Optional(Type.String({ description: "One-line summary (max 120 chars)" })),
			type: Type.Optional(
				Type.Union([
					Type.Literal("fact"),
					Type.Literal("decision"),
					Type.Literal("preference"),
					Type.Literal("learning"),
					Type.Literal("pattern"),
				]),
			),
			namespace: Type.Optional(
				Type.Union([Type.Literal("project"), Type.Literal("user"), Type.Literal("learnings"), Type.Literal("wip")]),
			),
			tags: Type.Optional(Type.Array(Type.String(), { description: "Tags for retrieval" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const entry = memoryStore.addEntry({
				key: params.key,
				title: params.title,
				content: params.content,
				summary: params.summary || params.content.slice(0, 120),
				type: params.type || "fact",
				namespace: params.namespace || "project",
				scope: "project",
				tags: params.tags || [],
				sessionId: undefined,
				turnIndex: undefined,
				confidence: 1,
				sourceMessages: [],
				relatedKeys: [],
			});

			const result = `✅ Remembered: [${entry.namespace}/${entry.type}] **${entry.key}** — ${entry.title}\n\nThis memory will be available in future conversations. Use \`recall\` to find it later.`;

			return {
				content: [{ type: "text" as const, text: result }],
				details: { action: "remember", key: params.key, id: entry.id },
			};
		},
	});
}

// ============================================================================
// recall Tool
// ============================================================================

export function createRecallTool(memoryStore: MemoryStore) {
	return defineTool({
		name: "recall",
		label: "Recall",
		description:
			"Retrieve stored memories by key, namespace, tags, or full-text search. " +
			"Use this to remember past decisions, preferences, and learnings. " +
			"Returns matching memories sorted by relevance/recency.",
		promptSnippet:
			"recall(query?, key?, namespace?, tags?, type?, limit?) — Retrieve stored memories by search or filter",
		promptGuidelines: [
			"Use 'recall' at the start of a task to check for relevant past knowledge",
			"If you know the exact key, use key parameter for precise lookup",
			"Use query for natural language search across all memories",
			"Filter by namespace: 'project', 'learnings', 'user', 'wip'",
		],
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Natural language search query" })),
			key: Type.Optional(Type.String({ description: "Exact memory key to look up" })),
			namespace: Type.Optional(
				Type.Union([Type.Literal("project"), Type.Literal("user"), Type.Literal("learnings"), Type.Literal("wip")]),
			),
			tags: Type.Optional(Type.Array(Type.String(), { description: "Filter by tags" })),
			type: Type.Optional(
				Type.Union([
					Type.Literal("fact"),
					Type.Literal("decision"),
					Type.Literal("preference"),
					Type.Literal("learning"),
					Type.Literal("pattern"),
				]),
			),
			limit: Type.Optional(Type.Number({ description: "Max results (default: 5, max: 20)", default: 5 })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const limit = Math.min(params.limit ?? 5, 20);
			const result = memoryStore.query({
				key: params.key,
				namespace: params.namespace as any,
				tags: params.tags,
				type: params.type as any,
				search: params.query,
				limit,
			});

			if (result.entries.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `📭 No memories found. Try different search terms or use \`remember\` to save new information.`,
						},
					],
					details: { action: "recall", count: 0, query: params },
				};
			}

			const formatted = formatMemoryForRecall(result.entries);
			return {
				content: [{ type: "text" as const, text: `🧠 Found ${result.total} memory/memories:\n\n${formatted}` }],
				details: {
					action: "recall",
					count: result.entries.length,
					total: result.total,
					keys: result.entries.map((e) => e.key),
				},
			};
		},
	});
}

// ============================================================================
// forget Tool
// ============================================================================

export function createForgetTool(memoryStore: MemoryStore) {
	return defineTool({
		name: "forget",
		label: "Forget",
		description: "Delete a stored memory by its key. Use this when a memory is outdated or incorrect.",
		promptSnippet: "forget(key) — Delete a stored memory by its key",
		parameters: Type.Object({
			key: Type.String({ description: "Key of the memory to delete" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const existed = memoryStore.deleteEntryByKey(params.key);

			if (!existed) {
				return {
					content: [{ type: "text" as const, text: `❌ Memory with key '${params.key}' not found.` }],
					details: { action: "forget", key: params.key, found: false },
				};
			}

			return {
				content: [{ type: "text" as const, text: `🗑️ Forgotten: ${params.key}` }],
				details: { action: "forget", key: params.key, found: true },
			};
		},
	});
}

// ============================================================================
// remember-multi Tool
// ============================================================================

export function createRememberMultiTool(memoryStore: MemoryStore) {
	return defineTool({
		name: "remember-multi",
		label: "Remember Multiple",
		description:
			"Store multiple memories at once (max 10). Use this for bulk operations like saving extracted learnings.",
		promptSnippet: "remember-multi(entries) — Store multiple memories at once",
		parameters: Type.Object({
			entries: Type.Array(
				Type.Object({
					key: Type.String(),
					title: Type.String(),
					content: Type.String(),
					summary: Type.Optional(Type.String()),
					type: Type.Optional(
						Type.Union([
							Type.Literal("fact"),
							Type.Literal("decision"),
							Type.Literal("preference"),
							Type.Literal("learning"),
							Type.Literal("pattern"),
						]),
					),
					namespace: Type.Optional(
						Type.Union([
							Type.Literal("project"),
							Type.Literal("user"),
							Type.Literal("learnings"),
							Type.Literal("wip"),
						]),
					),
					tags: Type.Optional(Type.Array(Type.String())),
				}),
				{ minItems: 1, maxItems: 10 },
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const keys: string[] = [];

			for (const entry of params.entries.slice(0, 10)) {
				memoryStore.addEntry({
					key: entry.key,
					title: entry.title,
					content: entry.content,
					summary: entry.summary || entry.content.slice(0, 120),
					type: entry.type || "fact",
					namespace: entry.namespace || "project",
					scope: "project",
					tags: entry.tags || [],
					sessionId: undefined,
					turnIndex: undefined,
					confidence: 0.8,
					sourceMessages: [],
					relatedKeys: [],
				});
				keys.push(entry.key);
			}

			return {
				content: [{ type: "text" as const, text: `✅ Stored ${keys.length} memories: ${keys.join(", ")}` }],
				details: { action: "remember-multi", count: keys.length, keys },
			};
		},
	});
}
