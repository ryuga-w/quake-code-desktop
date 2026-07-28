/**
 * Codex MemoriesBackend trait (ext/memories/backend.rs) as a TypeScript interface.
 * LocalMemoriesBackend implements this; a remote backend could later satisfy the same contract.
 */

import type {
	AddAdHocMemoryNoteRequest,
	AddAdHocMemoryNoteResponse,
	ListMemoriesRequest,
	ListMemoriesResponse,
	ReadMemoryRequest,
	ReadMemoryResponse,
	SearchMemoriesRequest,
	SearchMemoriesResponse,
} from "./types.js";

export interface MemoriesBackend {
	list(request: ListMemoriesRequest): ListMemoriesResponse | Promise<ListMemoriesResponse>;
	read(request: ReadMemoryRequest): ReadMemoryResponse | Promise<ReadMemoryResponse>;
	search(request: SearchMemoriesRequest): SearchMemoriesResponse | Promise<SearchMemoriesResponse>;
	addAdHocNote(
		request: AddAdHocMemoryNoteRequest,
	): AddAdHocMemoryNoteResponse | Promise<AddAdHocMemoryNoteResponse>;
}

export function isMemoriesBackend(value: unknown): value is MemoriesBackend {
	if (!value || typeof value !== "object") return false;
	const v = value as MemoriesBackend;
	return (
		typeof v.list === "function" &&
		typeof v.read === "function" &&
		typeof v.search === "function" &&
		typeof v.addAdHocNote === "function"
	);
}
