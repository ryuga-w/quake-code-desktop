/**
 * Codex memory citation parse/emit (codex-rs/memories/read citations.rs + oai-mem-citation).
 */

export interface MemoryCitationEntry {
	path: string;
	line_start: number;
	line_end: number;
	note: string;
}

export interface MemoryCitation {
	entries: MemoryCitationEntry[];
	rollout_ids: string[];
}

const ENTRY_LINE =
	/^(?<path>.+?):(?<start>\d+)-(?<end>\d+)\|note=\[(?<note>.*)\]\s*$/;

function extractBlock(text: string, open: string, close: string): string | undefined {
	const start = text.indexOf(open);
	if (start < 0) return undefined;
	const after = text.slice(start + open.length);
	const end = after.indexOf(close);
	if (end < 0) return undefined;
	return after.slice(0, end);
}

export function parseMemoryCitationEntry(line: string): MemoryCitationEntry | undefined {
	const trimmed = line.trim();
	if (!trimmed) return undefined;
	const match = trimmed.match(ENTRY_LINE);
	if (!match?.groups) return undefined;
	const line_start = Number.parseInt(match.groups.start, 10);
	const line_end = Number.parseInt(match.groups.end, 10);
	if (!Number.isFinite(line_start) || !Number.isFinite(line_end)) return undefined;
	return {
		path: match.groups.path.trim(),
		line_start,
		line_end,
		note: match.groups.note.trim(),
	};
}

/**
 * Parse one or more citation blob strings (full answers or isolated blocks).
 * Accepts `<memory_citation>` (Codex parser) and `<oai-mem-citation>` (prompt template).
 */
export function parseMemoryCitation(citations: string[]): MemoryCitation | undefined {
	const entries: MemoryCitationEntry[] = [];
	const rollout_ids: string[] = [];
	const seenIds = new Set<string>();

	for (const citation of citations) {
		const entriesBlock =
			extractBlock(citation, "<citation_entries>", "</citation_entries>") ??
			extractBlock(citation, "<citation-entries>", "</citation-entries>");
		if (entriesBlock) {
			for (const line of entriesBlock.split(/\r?\n/)) {
				const entry = parseMemoryCitationEntry(line);
				if (entry) entries.push(entry);
			}
		}

		const idsBlock =
			extractBlock(citation, "<rollout_ids>", "</rollout_ids>") ??
			extractBlock(citation, "<thread_ids>", "</thread_ids>") ??
			extractBlock(citation, "<rollout-ids>", "</rollout-ids>");
		if (idsBlock) {
			for (const id of idsBlock
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter(Boolean)) {
				if (!seenIds.has(id)) {
					seenIds.add(id);
					rollout_ids.push(id);
				}
			}
		}
	}

	if (entries.length === 0 && rollout_ids.length === 0) return undefined;
	return { entries, rollout_ids };
}

/** Extract citation block(s) from a full assistant final answer. */
export function extractMemoryCitationFromAnswer(answer: string): MemoryCitation | undefined {
	const blocks: string[] = [];
	for (const tag of ["memory_citation", "oai-mem-citation"] as const) {
		const open = `<${tag}>`;
		const close = `</${tag}>`;
		let rest = answer;
		while (true) {
			const start = rest.indexOf(open);
			if (start < 0) break;
			const after = rest.slice(start);
			const end = after.indexOf(close);
			if (end < 0) break;
			blocks.push(after.slice(0, end + close.length));
			rest = after.slice(end + close.length);
		}
	}
	// Also allow bare citation_entries without wrapper (Codex test fixture style).
	if (!blocks.length && answer.includes("<citation_entries>")) {
		blocks.push(answer);
	}
	if (!blocks.length) return undefined;
	return parseMemoryCitation(blocks);
}

/** Emit a Codex-compatible citation block for the end of a final answer. */
export function emitMemoryCitation(citation: MemoryCitation, tag: "memory_citation" | "oai-mem-citation" = "oai-mem-citation"): string {
	const lines: string[] = [`<${tag}>`];
	if (citation.entries.length) {
		lines.push("<citation_entries>");
		for (const e of citation.entries) {
			lines.push(`${e.path}:${e.line_start}-${e.line_end}|note=[${e.note}]`);
		}
		lines.push("</citation_entries>");
	}
	if (citation.rollout_ids.length) {
		lines.push("<rollout_ids>");
		for (const id of citation.rollout_ids) lines.push(id);
		lines.push("</rollout_ids>");
	}
	lines.push(`</${tag}>`);
	return lines.join("\n");
}

/** True when the answer already ends with a memory citation block. */
export function answerHasMemoryCitation(answer: string): boolean {
	return Boolean(extractMemoryCitationFromAnswer(answer));
}

/** Append citation block if missing and entries/ids present. */
export function attachMemoryCitationIfNeeded(answer: string, citation: MemoryCitation): string {
	if (!citation.entries.length && !citation.rollout_ids.length) return answer;
	if (answerHasMemoryCitation(answer)) return answer;
	const trimmed = answer.replace(/\s+$/, "");
	return `${trimmed}\n\n${emitMemoryCitation(citation)}`;
}

/** UUID-shaped thread ids (Codex ThreadId filter). */
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isThreadIdLike(id: string): boolean {
	return UUID_RE.test(id.trim());
}

/** Codex thread_ids_from_memory_citation — keep only UUID-like rollout ids. */
export function threadIdsFromMemoryCitation(citation: MemoryCitation): string[] {
	return citation.rollout_ids.filter(isThreadIdLike);
}

/** Build a citation from paths read this turn (usage-driven attach). */
export function citationFromReadPaths(
	paths: string[],
	opts?: { note?: string; rollout_ids?: string[] },
): MemoryCitation {
	const note = opts?.note ?? "memory_read";
	const entries: MemoryCitationEntry[] = paths.map((path) => ({
		path: path.replace(/\\/g, "/"),
		line_start: 1,
		line_end: 1,
		note,
	}));
	return {
		entries,
		rollout_ids: opts?.rollout_ids ?? [],
	};
}

/** Attach citations for turn memory reads if answer has no citation yet. */
export function attachTurnMemoryReadsCitation(
	answer: string,
	readPaths: string[],
	rolloutIds: string[] = [],
): string {
	if (!readPaths.length && !rolloutIds.length) return answer;
	const citation = citationFromReadPaths(readPaths, { rollout_ids: rolloutIds });
	return attachMemoryCitationIfNeeded(answer, citation);
}
