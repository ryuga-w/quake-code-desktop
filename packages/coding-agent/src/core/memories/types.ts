export type MemoryEntryType = "file" | "directory";

export interface MemoryDirEntry {
	path: string;
	entry_type: MemoryEntryType;
}

export interface ListMemoriesRequest {
	path?: string;
	cursor?: string;
	max_results: number;
}

export interface ListMemoriesResponse {
	path?: string;
	entries: MemoryDirEntry[];
	next_cursor?: string;
	truncated: boolean;
}

export interface ReadMemoryRequest {
	path: string;
	line_offset: number;
	max_lines?: number;
	max_tokens: number;
}

export interface ReadMemoryResponse {
	path: string;
	start_line_number: number;
	content: string;
	truncated: boolean;
}

export type SearchMatchMode =
	| { type: "any" }
	| { type: "all_on_same_line" }
	| { type: "all_within_lines"; line_count: number };

export interface SearchMemoriesRequest {
	queries: string[];
	match_mode: SearchMatchMode;
	path?: string;
	cursor?: string;
	context_lines: number;
	case_sensitive: boolean;
	normalized: boolean;
	max_results: number;
}

export interface MemorySearchMatch {
	path: string;
	match_line_number: number;
	content_start_line_number: number;
	content: string;
	matched_queries: string[];
}

export interface SearchMemoriesResponse {
	queries: string[];
	match_mode: SearchMatchMode;
	path?: string;
	matches: MemorySearchMatch[];
	next_cursor?: string;
	truncated: boolean;
}

export interface AddAdHocMemoryNoteRequest {
	filename: string;
	note: string;
}

/**
 * Local backend create result (path for callers/tests).
 * Codex *tool* JSON output for add_ad_hoc_note is empty `{}` —
 * codex-memory-tools execute must not surface this path in tool details/content.
 */
export interface AddAdHocMemoryNoteResponse {
	path: string;
}

export class MemoriesError extends Error {
	constructor(
		message: string,
		readonly code:
			| "invalid_path"
			| "invalid_cursor"
			| "invalid_filename"
			| "not_found"
			| "not_file"
			| "empty_query"
			| "empty_note"
			| "already_exists"
			| "invalid_line_offset"
			| "invalid_max_lines"
			| "line_offset_exceeds"
			| "invalid_match_window"
			| "io",
	) {
		super(message);
		this.name = "MemoriesError";
	}
}
