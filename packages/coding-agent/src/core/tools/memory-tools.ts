/**
 * Agent memory tools — layered remember / recall / forget / list.
 */

import type { AgentTool } from "@mrquake/quakecode-agent-core";
import { Text } from "@mrquake/quakecode-tui";
import { type Static, Type } from "@sinclair/typebox";
import type { AgentToolResult, ExtensionContext, ToolDefinition } from "../extensions/types.js";
import {
	forgetEntry,
	formatEntryForDisplay,
	getDefaultAgentName,
	getEntry,
	listEntries,
	type MemoryEntryType,
	type MemoryScope,
	rememberEntry,
	searchEntries,
} from "../memory/memory-store.js";
import {
	formatForgetCall,
	formatForgetResult,
	formatRecallCall,
	formatRecallResult,
	formatRememberCall,
	formatRememberResult,
	type MemoryRenderStyle,
	memoryStatusFromContext,
} from "./memory-render.js";

function memoryRenderStyle(context: { state?: unknown }): MemoryRenderStyle {
	const state = context.state as { ephemeralFaded?: boolean } | undefined;
	return { faded: Boolean(state?.ephemeralFaded) };
}

import { wrapToolDefinition } from "./tool-definition-wrapper.js";

const scopeSchema = Type.Optional(
	Type.Union([Type.Literal("user"), Type.Literal("project"), Type.Literal("local"), Type.Literal("session")]),
);

/** Session cwd bound at runtime via createMemoryToolDefinitions(). */
let boundMemoryCwd = process.cwd();

function resolveCwd(ctx?: ExtensionContext): string {
	return ctx?.sessionManager?.getCwd() ?? ctx?.cwd ?? boundMemoryCwd;
}

// ── memory_remember ──────────────────────────────────────────────────────────

const rememberSchema = Type.Object({
	name: Type.String({ description: "Unique entry name (alphanumeric, hyphens, underscores, dots)." }),
	description: Type.String({ description: "One-line description." }),
	content: Type.String({ description: "Memory body text." }),
	scope: scopeSchema,
	type: Type.Optional(
		Type.Union([
			Type.Literal("preference"),
			Type.Literal("fact"),
			Type.Literal("convention"),
			Type.Literal("feedback"),
			Type.Literal("reference"),
			Type.Literal("session"),
		]),
	),
	overwrite: Type.Optional(Type.Boolean({ description: "Replace existing entry with same name in scope." })),
});

type RememberInput = Static<typeof rememberSchema>;

const rememberDef: ToolDefinition<typeof rememberSchema> = {
	name: "memory_remember",
	label: "Memory Remember",
	description:
		"Save a durable memory entry. Scopes: user (global), project (repo), local (machine-only), session (episodic). Use when the user corrects you or you learn stable conventions.",
	parameters: rememberSchema,
	promptSnippet: "memory_remember: Save preference or lesson to layered memory",
	promptGuidelines: [
		"Call memory_recall before saving to avoid duplicates.",
		"Use scope=user for personal preferences, project for repo conventions, session for temporary context.",
		"When the user corrects you, save with type=feedback.",
	],
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatRememberCall(args, theme, memoryStatusFromContext(context), context.expanded));
		return text;
	},
	renderResult(result, options, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(
			formatRememberResult(
				context.args,
				result as any,
				options,
				theme,
				memoryStatusFromContext(context),
				memoryRenderStyle(context),
			),
		);
		return text;
	},
	async execute(_id, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<any>> {
		try {
			const result = rememberEntry(getDefaultAgentName(), resolveCwd(ctx), {
				name: params.name,
				description: params.description,
				content: params.content,
				scope: (params.scope ?? "project") as MemoryScope,
				type: (params.type ?? "fact") as MemoryEntryType,
				overwrite: params.overwrite,
			});
			const verb = result.created ? "Saved" : "Updated";
			return {
				details: result,
				content: [{ type: "text", text: `${verb} memory "${params.name}" in ${result.scope} scope.` }],
			};
		} catch (err) {
			return {
				details: undefined,
				content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
			};
		}
	},
};

// ── memory_recall ────────────────────────────────────────────────────────────

const recallSchema = Type.Object({
	query: Type.Optional(Type.String({ description: "Keyword search across all scopes." })),
	name: Type.Optional(Type.String({ description: "Exact entry name." })),
	scope: scopeSchema,
});

type RecallInput = Static<typeof recallSchema>;

const recallDef: ToolDefinition<typeof recallSchema> = {
	name: "memory_recall",
	label: "Memory Recall",
	description: "Search or fetch memory entries. Provide name for exact lookup, or query for keyword search.",
	parameters: recallSchema,
	promptSnippet: "memory_recall: Search layered memory",
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatRecallCall(args, theme, memoryStatusFromContext(context)));
		return text;
	},
	renderResult(result, options, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(
			formatRecallResult(
				result,
				options,
				theme,
				memoryStatusFromContext(context),
				context.args,
				memoryRenderStyle(context),
			),
		);
		return text;
	},
	async execute(_id, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<any>> {
		try {
			const cwd = resolveCwd(ctx);
			const agent = getDefaultAgentName();

			if (params.name) {
				const entry = getEntry(agent, cwd, params.name, params.scope as MemoryScope | undefined);
				if (!entry) {
					return { details: undefined, content: [{ type: "text", text: `No memory entry "${params.name}".` }] };
				}
				return { details: entry, content: [{ type: "text", text: formatEntryForDisplay(entry) }] };
			}

			if (params.query) {
				const hits = searchEntries(agent, cwd, params.query, 10);
				if (hits.length === 0) {
					return {
						details: undefined,
						content: [{ type: "text", text: `No memories matching "${params.query}".` }],
					};
				}
				const text = hits.map((h) => formatEntryForDisplay(h)).join("\n\n");
				return { details: hits, content: [{ type: "text", text }] };
			}

			const all = listEntries(agent, cwd, { scope: params.scope as MemoryScope | undefined, limit: 30 });
			if (all.length === 0) {
				return { details: undefined, content: [{ type: "text", text: "Memory is empty." }] };
			}
			const text = all.map((e) => `- ${e.scope}/${e.name} (${e.type}): ${e.description}`).join("\n");
			return { details: all, content: [{ type: "text", text: `Memory entries (${all.length}):\n${text}` }] };
		} catch (err) {
			return {
				details: undefined,
				content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
			};
		}
	},
};

// ── memory_forget ──────────────────────────────────────────────────────────

const forgetSchema = Type.Object({
	name: Type.String({ description: "Entry name to delete." }),
	scope: scopeSchema,
});

const forgetDef: ToolDefinition<typeof forgetSchema> = {
	name: "memory_forget",
	label: "Memory Forget",
	description: "Delete a memory entry by name. Optionally restrict to a scope.",
	parameters: forgetSchema,
	promptSnippet: "memory_forget: Remove a memory entry",
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatForgetCall(args, theme, memoryStatusFromContext(context)));
		return text;
	},
	renderResult(result, options, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(
			formatForgetResult(
				context.args,
				result as any,
				options,
				theme,
				memoryStatusFromContext(context),
				memoryRenderStyle(context),
			),
		);
		return text;
	},
	async execute(_id, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<any>> {
		const ok = forgetEntry(
			getDefaultAgentName(),
			resolveCwd(ctx),
			params.name,
			params.scope as MemoryScope | undefined,
		);
		return {
			details: { deleted: ok },
			content: [{ type: "text", text: ok ? `Deleted "${params.name}".` : `No entry "${params.name}" found.` }],
		};
	},
};

// ── Legacy aliases (memory_read / memory_write / memory_delete) ─────────────

const readSchema = Type.Object({
	name: Type.Optional(Type.String()),
	max_entries: Type.Optional(Type.Number()),
});

const readDef: ToolDefinition<typeof readSchema> = {
	name: "memory_read",
	label: "Memory Read",
	description: "Legacy alias for memory_recall. List or fetch memory entries.",
	parameters: readSchema,
	promptSnippet: recallDef.promptSnippet,
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatRecallCall({ name: args.name }, theme, memoryStatusFromContext(context)));
		return text;
	},
	renderResult(result, options, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(
			formatRecallResult(
				result,
				options,
				theme,
				memoryStatusFromContext(context),
				{ name: context.args.name, scope: undefined },
				memoryRenderStyle(context),
			),
		);
		return text;
	},
	async execute(id, params, signal, onUpdate, ctx) {
		const cwd = resolveCwd(ctx);
		const agent = getDefaultAgentName();
		if (params.name) {
			return recallDef.execute!(id, { name: params.name, scope: undefined }, signal, onUpdate, ctx);
		}
		const limit = Math.min(params.max_entries ?? 20, 50);
		const all = listEntries(agent, cwd, { limit });
		const text =
			all.length === 0
				? "No memory entries."
				: `Memory entries (${all.length}):\n${all.map((e) => `- ${e.scope}/${e.name} (${e.type}): ${e.description}`).join("\n")}`;
		return { details: all, content: [{ type: "text", text }] };
	},
};

const writeSchema = Type.Object({
	name: Type.String(),
	description: Type.String(),
	content: Type.String(),
	type: Type.Optional(Type.String()),
	overwrite: Type.Optional(Type.Boolean()),
});

const writeDef: ToolDefinition<typeof writeSchema> = {
	name: "memory_write",
	label: "Memory Write",
	description: "Legacy alias for memory_remember (project scope).",
	parameters: writeSchema,
	promptSnippet: rememberDef.promptSnippet,
	promptGuidelines: rememberDef.promptGuidelines,
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(
			formatRememberCall(
				{ ...args, scope: "project", type: args.type },
				theme,
				memoryStatusFromContext(context),
				context.expanded,
			),
		);
		return text;
	},
	renderResult(result, options, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(
			formatRememberResult(
				{ ...context.args, scope: "project" },
				result as any,
				options,
				theme,
				memoryStatusFromContext(context),
				memoryRenderStyle(context),
			),
		);
		return text;
	},
	async execute(id, params, signal, onUpdate, ctx) {
		return rememberDef.execute!(
			id,
			{
				name: params.name,
				description: params.description,
				content: params.content,
				scope: "project",
				type: (params.type as RememberInput["type"]) ?? "feedback",
				overwrite: params.overwrite,
			},
			signal,
			onUpdate,
			ctx,
		);
	},
};

const deleteSchema = Type.Object({ name: Type.String() });

const deleteDef: ToolDefinition<typeof deleteSchema> = {
	name: "memory_delete",
	label: "Memory Delete",
	description: "Legacy alias for memory_forget.",
	parameters: deleteSchema,
	promptSnippet: forgetDef.promptSnippet,
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatForgetCall({ name: args.name }, theme, memoryStatusFromContext(context)));
		return text;
	},
	renderResult(result, options, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(
			formatForgetResult(
				context.args,
				result as any,
				options,
				theme,
				memoryStatusFromContext(context),
				memoryRenderStyle(context),
			),
		);
		return text;
	},
	async execute(id, params, signal, onUpdate, ctx) {
		return forgetDef.execute!(id, { name: params.name, scope: undefined }, signal, onUpdate, ctx);
	},
};

export const memoryRememberTool: AgentTool<typeof rememberSchema> = wrapToolDefinition(rememberDef);
export const memoryRecallTool: AgentTool<typeof recallSchema> = wrapToolDefinition(recallDef);
export const memoryForgetTool: AgentTool<typeof forgetSchema> = wrapToolDefinition(forgetDef);
export const memoryReadTool: AgentTool<typeof readSchema> = wrapToolDefinition(readDef);
export const memoryWriteTool: AgentTool<typeof writeSchema> = wrapToolDefinition(writeDef);
export const memoryDeleteTool: AgentTool<typeof deleteSchema> = wrapToolDefinition(deleteDef);

export const memoryToolDefinitions = {
	memory_remember: rememberDef,
	memory_recall: recallDef,
	memory_forget: forgetDef,
	memory_read: readDef,
	memory_write: writeDef,
	memory_delete: deleteDef,
};

/** Bind session cwd for builtin memory tools (ctx is not passed by AgentSession). */
export function createMemoryToolDefinitions(cwd: string): typeof memoryToolDefinitions {
	boundMemoryCwd = cwd;
	return memoryToolDefinitions;
}

export const memoryTools = {
	memory_remember: memoryRememberTool,
	memory_recall: memoryRecallTool,
	memory_forget: memoryForgetTool,
	memory_read: memoryReadTool,
	memory_write: memoryWriteTool,
	memory_delete: memoryDeleteTool,
};

export type MemoryToolName = keyof typeof memoryTools;

/** Active by default in interactive sessions so agents do not fall back to edit/write on MEMORY.md. */
export const DEFAULT_MEMORY_ACTIVE_TOOL_NAMES = [
	"memory_remember",
	"memory_recall",
	"memory_forget",
] as const satisfies readonly MemoryToolName[];
