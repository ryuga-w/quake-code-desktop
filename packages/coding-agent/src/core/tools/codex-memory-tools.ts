/**
 * Codex-compatible memories tools (namespace: memories).
 * Tools: list, read, search, add_ad_hoc_note
 */

import type { AgentTool } from "@mrquake/quakecode-agent-core";
import { Text } from "@mrquake/quakecode-tui";
import { type Static, Type } from "@sinclair/typebox";
import type { AgentToolResult, ToolDefinition } from "../extensions/types.js";
import {
	DEFAULT_LIST_MAX_RESULTS,
	DEFAULT_READ_MAX_TOKENS,
	DEFAULT_SEARCH_MAX_RESULTS,
	MAX_LIST_RESULTS,
	MAX_SEARCH_RESULTS,
	MEMORIES_ADD_AD_HOC_NOTE,
	MEMORIES_LIST,
	MEMORIES_READ,
	MEMORIES_SEARCH,
} from "../memories/constants.js";
import type { MemoriesBackend } from "../memories/backend-interface.js";
import { LocalMemoriesBackend, makeAdHocFilename } from "../memories/local-backend.js";
import { recordToolCall } from "../memories/metrics.js";
import { MemoriesError, type SearchMatchMode } from "../memories/types.js";
import { markTurnMemoryRead, recordMemoryRead } from "../memories/usage.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";

/** Default local backend; hosts may swap via setCodexMemoriesBackend (remote-ready). */
let backend: MemoriesBackend = new LocalMemoriesBackend();

export function setCodexMemoriesBackend(next: MemoriesBackend): void {
	backend = next;
}

export function getCodexMemoriesBackend(): MemoriesBackend {
	return backend;
}

function clamp(n: number | undefined, def: number, max: number): number {
	const v = n ?? def;
	return Math.min(Math.max(1, v), max);
}

function errResult(err: unknown, tool: "list" | "read" | "search" | "add_ad_hoc"): AgentToolResult<any> {
	recordToolCall(tool, false);
	const message = err instanceof Error ? err.message : String(err);
	return {
		details: { ok: false, error: message, code: err instanceof MemoriesError ? err.code : "io" },
		content: [{ type: "text", text: message }],
	};
}

// ── list ─────────────────────────────────────────────────────────────────────

const listSchema = Type.Object({
	path: Type.Optional(Type.String({ description: "Relative path under memories root (optional)." })),
	cursor: Type.Optional(Type.String({ description: "Pagination cursor from previous list." })),
	max_results: Type.Optional(Type.Integer({ minimum: 1, description: "Max entries (default 2000)." })),
});

const listDef: ToolDefinition<typeof listSchema> = {
	name: MEMORIES_LIST,
	label: "memories.list",
	description: "List immediate files and directories under a path in the Codex memories store.",
	parameters: listSchema,
	promptSnippet: "memories_list: List Codex memory files/dirs",
	promptGuidelines: [
		"Use memories_list to explore the memories root before read/search.",
		"Paths are relative to the memories store (e.g. extensions/ad_hoc/notes).",
	],
	renderCall(args, theme) {
		return new Text(`${theme.bold("memories.list")} ${theme.fg("dim", args.path || "/")}`, 0, 0);
	},
	async execute(_id, params) {
		try {
			const response = await Promise.resolve(
				backend.list({
					path: params.path,
					cursor: params.cursor,
					max_results: clamp(params.max_results, DEFAULT_LIST_MAX_RESULTS, MAX_LIST_RESULTS),
				}),
			);
			recordToolCall("list", true);
			const lines = response.entries.map((e) => `${e.entry_type === "directory" ? "dir " : "file"} ${e.path}`);
			const text = [
				`path: ${response.path ?? "."}`,
				`entries: ${response.entries.length}${response.truncated ? " (truncated)" : ""}`,
				...lines,
				response.next_cursor ? `next_cursor: ${response.next_cursor}` : "",
			]
				.filter(Boolean)
				.join("\n");
			return { details: response, content: [{ type: "text", text }] };
		} catch (err) {
			return errResult(err, "list");
		}
	},
};

// ── read ─────────────────────────────────────────────────────────────────────

const readSchema = Type.Object({
	path: Type.String({ description: "Relative path to a memory file." }),
	line_offset: Type.Optional(Type.Integer({ minimum: 1, description: "1-indexed start line (default 1)." })),
	max_lines: Type.Optional(Type.Integer({ minimum: 1, description: "Max lines to return." })),
});

const readDef: ToolDefinition<typeof readSchema> = {
	name: MEMORIES_READ,
	label: "memories.read",
	description:
		"Read a Codex memory file by relative path, optionally starting at a 1-indexed line offset and limiting the number of lines returned.",
	parameters: readSchema,
	promptSnippet: "memories_read: Read a memory file by path",
	renderCall(args, theme) {
		return new Text(`${theme.bold("memories.read")} ${theme.fg("dim", args.path)}`, 0, 0);
	},
	async execute(id, params) {
		try {
			const response = await Promise.resolve(
				backend.read({
					path: params.path,
					line_offset: params.line_offset ?? 1,
					max_lines: params.max_lines,
					max_tokens: DEFAULT_READ_MAX_TOKENS,
				}),
			);
			recordToolCall("read", true);
			try {
				recordMemoryRead(params.path);
				markTurnMemoryRead(String(id || "turn"), params.path);
			} catch {
				/* usage non-fatal */
			}
			const header = `# ${response.path} (from line ${response.start_line_number}${response.truncated ? ", truncated" : ""})\n\n`;
			return { details: response, content: [{ type: "text", text: header + response.content }] };
		} catch (err) {
			return errResult(err, "read");
		}
	},
};

// ── search ───────────────────────────────────────────────────────────────────

const matchModeSchema = Type.Optional(
	Type.Union([
		Type.Literal("any"),
		Type.Literal("all_on_same_line"),
		Type.Object({
			type: Type.Literal("all_within_lines"),
			line_count: Type.Integer({ minimum: 1 }),
		}),
	]),
);

const searchSchema = Type.Object({
	queries: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Substrings to search for." }),
	match_mode: matchModeSchema,
	path: Type.Optional(Type.String({ description: "Limit search to a relative path." })),
	cursor: Type.Optional(Type.String()),
	context_lines: Type.Optional(Type.Integer({ minimum: 0, description: "Lines of context around matches." })),
	case_sensitive: Type.Optional(Type.Boolean()),
	normalized: Type.Optional(Type.Boolean({ description: "Normalize separators before match." })),
	max_results: Type.Optional(Type.Integer({ minimum: 1 })),
});

function normalizeMatchMode(raw: Static<typeof searchSchema>["match_mode"]): SearchMatchMode {
	if (!raw || raw === "any") return { type: "any" };
	if (raw === "all_on_same_line") return { type: "all_on_same_line" };
	if (typeof raw === "object" && raw.type === "all_within_lines") {
		return { type: "all_within_lines", line_count: raw.line_count };
	}
	return { type: "any" };
}

const searchDef: ToolDefinition<typeof searchSchema> = {
	name: MEMORIES_SEARCH,
	label: "memories.search",
	description:
		"Search Codex memory files for substring matches, optionally normalizing separators or requiring all query substrings on the same line or within a line window.",
	parameters: searchSchema,
	promptSnippet: "memories_search: Search memory files",
	promptGuidelines: [
		"Prefer memories_search over full-directory scans.",
		"Use match_mode all_on_same_line when multiple keywords must co-occur.",
	],
	renderCall(args, theme) {
		return new Text(
			`${theme.bold("memories.search")} ${theme.fg("dim", (args.queries || []).join(" | "))}`,
			0,
			0,
		);
	},
	async execute(_id, params) {
		try {
			const response = await Promise.resolve(
				backend.search({
					queries: params.queries,
					match_mode: normalizeMatchMode(params.match_mode),
					path: params.path,
					cursor: params.cursor,
					context_lines: params.context_lines ?? 0,
					case_sensitive: params.case_sensitive ?? true,
					normalized: params.normalized ?? false,
					max_results: clamp(params.max_results, DEFAULT_SEARCH_MAX_RESULTS, MAX_SEARCH_RESULTS),
				}),
			);
			recordToolCall("search", true);
			if (!response.matches.length) {
				return {
					details: response,
					content: [{ type: "text", text: `No matches for: ${response.queries.join(", ")}` }],
				};
			}
			const blocks = response.matches.map(
				(m) =>
					`### ${m.path}:${m.match_line_number}\nqueries: ${m.matched_queries.join(", ")}\n${m.content}`,
			);
			const text = [
				`matches: ${response.matches.length}${response.truncated ? " (truncated)" : ""}`,
				response.next_cursor ? `next_cursor: ${response.next_cursor}` : "",
				...blocks,
			]
				.filter(Boolean)
				.join("\n\n");
			return { details: response, content: [{ type: "text", text }] };
		} catch (err) {
			return errResult(err, "search");
		}
	},
};

// ── add_ad_hoc_note ──────────────────────────────────────────────────────────

const CODEX_AD_HOC_FILENAME =
	/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]{0,79}\.md$/;

const adHocSchema = Type.Object({
	/** Codex requires this; Quake also accepts omit + slug auto-generate for ergonomics. */
	filename: Type.Optional(
		Type.String({
			minLength: 24,
			maxLength: 128,
			description:
				"YYYY-MM-DDTHH-MM-SS-<slug>.md (Codex-required shape). If omitted, generated from slug + now.",
			pattern: String.raw`^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]{0,79}\.md$`,
		}),
	),
	slug: Type.Optional(Type.String({ description: "Slug used when filename is omitted (lowercase-hyphen)." })),
	note: Type.String({ minLength: 1, description: "Verbatim Markdown note to store (append-only file)." }),
});

const adHocDef: ToolDefinition<typeof adHocSchema> = {
	name: MEMORIES_ADD_AD_HOC_NOTE,
	label: "memories.add_ad_hoc_note",
	description:
		"Create one append-only ad-hoc memory note after the user explicitly asks Codex/Quake to remember, forget, or update something. Filename: YYYY-MM-DDTHH-MM-SS-<slug>.md",
	parameters: adHocSchema,
	promptSnippet: "memories_add_ad_hoc_note: User-requested durable note",
	promptGuidelines: [
		"Only call when the user explicitly asks to remember/forget/update something durable.",
		"Do not use for ephemeral task notes; use layered memory_remember for structured entries if preferred.",
	],
	renderCall(args, theme) {
		return new Text(
			`${theme.bold("memories.add_ad_hoc_note")} ${theme.fg("dim", args.filename || args.slug || "note")}`,
			0,
			0,
		);
	},
	async execute(_id, params) {
		try {
			const filename = params.filename?.trim() || makeAdHocFilename(params.slug || "note");
			if (!CODEX_AD_HOC_FILENAME.test(filename)) {
				throw new MemoriesError(
					`filename '${filename}' must use YYYY-MM-DDTHH-MM-SS-<slug>.md`,
					"invalid_filename",
				);
			}
			// Side-effect only: create note under extensions/ad_hoc/notes.
			await Promise.resolve(backend.addAdHocNote({ filename, note: params.note }));
			recordToolCall("add_ad_hoc", true);
			// Codex AddAdHocMemoryNoteResponse is an empty object (JsonToolOutput {}).
			const empty: Record<string, never> = {};
			return {
				details: empty,
				content: [{ type: "text", text: "{}" }],
			};
		} catch (err) {
			return errResult(err, "add_ad_hoc");
		}
	},
};

export const codexMemoryToolDefinitions = {
	[MEMORIES_LIST]: listDef,
	[MEMORIES_READ]: readDef,
	[MEMORIES_SEARCH]: searchDef,
	[MEMORIES_ADD_AD_HOC_NOTE]: adHocDef,
};

export const codexMemoryTools = {
	[MEMORIES_LIST]: wrapToolDefinition(listDef) as AgentTool<any>,
	[MEMORIES_READ]: wrapToolDefinition(readDef) as AgentTool<any>,
	[MEMORIES_SEARCH]: wrapToolDefinition(searchDef) as AgentTool<any>,
	[MEMORIES_ADD_AD_HOC_NOTE]: wrapToolDefinition(adHocDef) as AgentTool<any>,
};

export type CodexMemoryToolName = keyof typeof codexMemoryTools;

export const DEFAULT_CODEX_MEMORY_ACTIVE_TOOL_NAMES = [
	MEMORIES_LIST,
	MEMORIES_READ,
	MEMORIES_SEARCH,
	MEMORIES_ADD_AD_HOC_NOTE,
] as const;

export function createCodexMemoryToolDefinitions(): typeof codexMemoryToolDefinitions {
	if (backend instanceof LocalMemoriesBackend) {
		backend.ensureRoot();
	}
	return codexMemoryToolDefinitions;
}
