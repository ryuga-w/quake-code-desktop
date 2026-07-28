/**
 * Codex LocalMemoriesBackend port — filesystem under ~/.quake-code/memories
 * (mirrors ~/.codex/memories layout: MEMORY.md, memory_summary.md, extensions/ad_hoc/notes, …).
 */

import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import {
	AD_HOC_NOTE_FILENAME_MAX,
	AD_HOC_NOTES_REL,
	DEFAULT_READ_MAX_TOKENS,
	MAX_LIST_RESULTS,
	MAX_SEARCH_RESULTS,
	MEMORIES_HOME_DIRNAME,
	TIMESTAMP_PREFIX_LEN,
} from "./constants.js";
import type { MemoriesBackend } from "./backend-interface.js";
import { seedExtensionInstructions } from "./extensions.js";
import type {
	AddAdHocMemoryNoteRequest,
	AddAdHocMemoryNoteResponse,
	ListMemoriesRequest,
	ListMemoriesResponse,
	MemoryDirEntry,
	MemorySearchMatch,
	ReadMemoryRequest,
	ReadMemoryResponse,
	SearchMatchMode,
	SearchMemoriesRequest,
	SearchMemoriesResponse,
} from "./types.js";
import { MemoriesError } from "./types.js";

export function defaultMemoriesRoot(): string {
	// Prefer Quake home; fall back to Codex path if user already has Codex memories.
	const quake = join(homedir(), ".quake-code", MEMORIES_HOME_DIRNAME);
	const codex = join(homedir(), ".codex", MEMORIES_HOME_DIRNAME);
	if (existsSync(quake)) return quake;
	if (existsSync(codex)) return codex;
	return quake;
}

export class LocalMemoriesBackend implements MemoriesBackend {
	constructor(readonly root: string = defaultMemoriesRoot()) {}

	ensureRoot(): void {
		mkdirSync(this.root, { recursive: true });
		mkdirSync(join(this.root, "rollout_summaries"), { recursive: true });
		mkdirSync(join(this.root, "skills"), { recursive: true });
		mkdirSync(join(this.root, "extensions", "ad_hoc", "notes"), { recursive: true });
		mkdirSync(join(this.root, "stage1"), { recursive: true });
		// Codex seed_extension_instructions (ad_hoc/instructions.md, create-once).
		try {
			seedExtensionInstructions(this.root);
		} catch {
			/* non-fatal */
		}
		// Seed Codex-shaped files so list/read always have a home.
		const memoryMd = join(this.root, "MEMORY.md");
		const summaryMd = join(this.root, "memory_summary.md");
		if (!existsSync(memoryMd)) {
			writeFileSync(
				memoryMd,
				"# MEMORY\n\nRegistry of durable notes. Prefer tools `memories_search` / `memories_read`.\n",
				"utf-8",
			);
		}
		if (!existsSync(summaryMd)) {
			writeFileSync(
				summaryMd,
				"v1\n# Memory summary\n\nNo consolidated summary yet. Ad-hoc notes and MEMORY.md still apply.\n",
				"utf-8",
			);
		}
	}

	private resolveScopedPath(relativePath?: string): string {
		if (!relativePath || relativePath === "." || relativePath === "") {
			return this.root;
		}
		const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
		if (normalized.includes("..") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
			throw new MemoriesError(`path '${relativePath}' must stay within the memories root`, "invalid_path");
		}
		const parts = normalized.split("/").filter(Boolean);
		if (parts.some((p) => p.startsWith("."))) {
			throw new MemoriesError(`path '${relativePath}' was not found`, "not_found");
		}
		return resolve(this.root, ...parts);
	}

	private displayRelative(absolute: string): string {
		const rel = relative(this.root, absolute).replace(/\\/g, "/");
		return rel === "" ? "." : rel;
	}

	private isHidden(name: string): boolean {
		return name.startsWith(".");
	}

	private rejectSymlink(path: string): void {
		try {
			if (lstatSync(path).isSymbolicLink()) {
				throw new MemoriesError(`path '${path}' was not found`, "not_found");
			}
		} catch (err) {
			if (err instanceof MemoriesError) throw err;
		}
	}

	list(request: ListMemoriesRequest): ListMemoriesResponse {
		this.ensureRoot();
		const maxResults = Math.min(Math.max(1, request.max_results), MAX_LIST_RESULTS);
		const start = this.resolveScopedPath(request.path);
		if (!existsSync(start)) {
			throw new MemoriesError(`path '${request.path ?? ""}' was not found`, "not_found");
		}
		this.rejectSymlink(start);
		const st = statSync(start);
		let entries: MemoryDirEntry[] = [];
		if (st.isFile()) {
			entries = [{ path: this.displayRelative(start), entry_type: "file" }];
		} else if (st.isDirectory()) {
			const names = readdirSync(start).filter((n) => !this.isHidden(n)).sort((a, b) => a.localeCompare(b));
			for (const name of names) {
				const full = join(start, name);
				try {
					this.rejectSymlink(full);
					const meta = statSync(full);
					if (meta.isDirectory()) entries.push({ path: this.displayRelative(full), entry_type: "directory" });
					else if (meta.isFile()) entries.push({ path: this.displayRelative(full), entry_type: "file" });
				} catch {
					/* skip */
				}
			}
		}
		const startIndex = request.cursor ? Number.parseInt(request.cursor, 10) : 0;
		if (!Number.isFinite(startIndex) || startIndex < 0) {
			throw new MemoriesError(`cursor '${request.cursor}' must be a non-negative integer`, "invalid_cursor");
		}
		if (startIndex > entries.length) {
			throw new MemoriesError(`cursor '${startIndex}' exceeds result count`, "invalid_cursor");
		}
		const endIndex = Math.min(startIndex + maxResults, entries.length);
		const next_cursor = endIndex < entries.length ? String(endIndex) : undefined;
		return {
			path: request.path,
			entries: entries.slice(startIndex, endIndex),
			next_cursor,
			truncated: Boolean(next_cursor),
		};
	}

	read(request: ReadMemoryRequest): ReadMemoryResponse {
		this.ensureRoot();
		if (request.line_offset < 1) {
			throw new MemoriesError("line_offset must be a 1-indexed line number", "invalid_line_offset");
		}
		if (request.max_lines === 0) {
			throw new MemoriesError("max_lines must be >= 1 when provided", "invalid_max_lines");
		}
		const path = this.resolveScopedPath(request.path);
		if (!existsSync(path)) {
			throw new MemoriesError(`path '${request.path}' was not found`, "not_found");
		}
		this.rejectSymlink(path);
		if (!statSync(path).isFile()) {
			throw new MemoriesError(`path '${request.path}' is not a file`, "not_file");
		}
		const original = readFileSync(path, "utf-8");
		const lines = original.split(/\r?\n/);
		if (request.line_offset > lines.length) {
			throw new MemoriesError("line_offset exceeds file length", "line_offset_exceeds");
		}
		const startIdx = request.line_offset - 1;
		const slice = request.max_lines
			? lines.slice(startIdx, startIdx + request.max_lines)
			: lines.slice(startIdx);
		let content = slice.join("\n");
		const maxTokens = request.max_tokens || DEFAULT_READ_MAX_TOKENS;
		// Approximate tokens ≈ chars/4
		const maxChars = maxTokens * 4;
		let truncated = startIdx + slice.length < lines.length;
		if (content.length > maxChars) {
			content = content.slice(0, maxChars);
			truncated = true;
		}
		return {
			path: request.path,
			start_line_number: request.line_offset,
			content,
			truncated,
		};
	}

	search(request: SearchMemoriesRequest): SearchMemoriesResponse {
		this.ensureRoot();
		const queries = request.queries.map((q) => q.trim());
		if (!queries.length || queries.some((q) => !q)) {
			throw new MemoriesError("search query must not be empty", "empty_query");
		}
		if (request.match_mode.type === "all_within_lines" && request.match_mode.line_count < 1) {
			throw new MemoriesError("invalid match window", "invalid_match_window");
		}
		const maxResults = Math.min(Math.max(1, request.max_results), MAX_SEARCH_RESULTS);
		const start = this.resolveScopedPath(request.path);
		if (!existsSync(start)) {
			throw new MemoriesError(`path '${request.path ?? ""}' was not found`, "not_found");
		}
		this.rejectSymlink(start);
		const matches: MemorySearchMatch[] = [];
		const files = this.collectFiles(start);
		for (const file of files) {
			this.searchFile(file, queries, request, matches);
		}
		matches.sort((a, b) => a.path.localeCompare(b.path) || a.match_line_number - b.match_line_number);
		const startIndex = request.cursor ? Number.parseInt(request.cursor, 10) : 0;
		if (!Number.isFinite(startIndex) || startIndex < 0) {
			throw new MemoriesError(`cursor '${request.cursor}' must be a non-negative integer`, "invalid_cursor");
		}
		if (startIndex > matches.length) {
			throw new MemoriesError(`cursor '${startIndex}' exceeds result count`, "invalid_cursor");
		}
		const endIndex = Math.min(startIndex + maxResults, matches.length);
		const next_cursor = endIndex < matches.length ? String(endIndex) : undefined;
		return {
			queries,
			match_mode: request.match_mode,
			path: request.path,
			matches: matches.slice(startIndex, endIndex),
			next_cursor,
			truncated: Boolean(next_cursor),
		};
	}

	addAdHocNote(request: AddAdHocMemoryNoteRequest): AddAdHocMemoryNoteResponse {
		this.ensureRoot();
		validateAdHocFilename(request.filename);
		if (!request.note.trim()) {
			throw new MemoriesError("ad-hoc note must not be empty", "empty_note");
		}
		let dir = this.root;
		for (const part of AD_HOC_NOTES_REL) {
			dir = join(dir, part);
			mkdirSync(dir, { recursive: true });
		}
		const full = join(dir, request.filename);
		if (existsSync(full)) {
			throw new MemoriesError(`ad-hoc note '${request.filename}' already exists`, "already_exists");
		}
		writeFileSync(full, request.note, "utf-8");
		// Append a pointer into MEMORY.md registry (Codex consolidation style).
		appendRegistryLine(this.root, request.filename, request.note);
		return { path: this.displayRelative(full) };
	}

	private collectFiles(start: string): string[] {
		const out: string[] = [];
		const stack = [start];
		while (stack.length) {
			const cur = stack.pop()!;
			if (!existsSync(cur)) continue;
			try {
				this.rejectSymlink(cur);
				const st = statSync(cur);
				if (st.isFile()) {
					if (cur.endsWith(".md") || cur.endsWith(".jsonl") || cur.endsWith(".txt")) out.push(cur);
					continue;
				}
				if (!st.isDirectory()) continue;
				const names = readdirSync(cur).filter((n) => !this.isHidden(n));
				for (const name of names) stack.push(join(cur, name));
			} catch {
				/* skip */
			}
		}
		return out.sort((a, b) => a.localeCompare(b));
	}

	private searchFile(
		file: string,
		queries: string[],
		request: SearchMemoriesRequest,
		matches: MemorySearchMatch[],
	): void {
		let text: string;
		try {
			text = readFileSync(file, "utf-8");
		} catch {
			return;
		}
		const lines = text.split(/\r?\n/);
		const norm = (s: string) =>
			request.normalized ? s.replace(/[_\-./\\]+/g, " ").replace(/\s+/g, " ").trim() : s;
		const prep = (s: string) => {
			const v = norm(s);
			return request.case_sensitive ? v : v.toLowerCase();
		};
		const qs = queries.map(prep);

		for (let i = 0; i < lines.length; i += 1) {
			const line = lines[i];
			const hay = prep(line);
			const matched = matchLine(hay, qs, request.match_mode, lines, i, prep);
			if (!matched) continue;
			const ctx = request.context_lines;
			const from = Math.max(0, i - ctx);
			const to = Math.min(lines.length - 1, i + ctx);
			matches.push({
				path: this.displayRelative(file),
				match_line_number: i + 1,
				content_start_line_number: from + 1,
				content: lines.slice(from, to + 1).join("\n"),
				matched_queries: matched,
			});
		}
	}
}

function matchLine(
	hay: string,
	qs: string[],
	mode: SearchMatchMode,
	lines: string[],
	index: number,
	prep: (s: string) => string,
): string[] | null {
	if (mode.type === "any") {
		const hit = qs.filter((q) => hay.includes(q));
		return hit.length ? hit : null;
	}
	if (mode.type === "all_on_same_line") {
		return qs.every((q) => hay.includes(q)) ? [...qs] : null;
	}
	// all_within_lines
	const window = mode.line_count;
	const from = Math.max(0, index - window + 1);
	const to = Math.min(lines.length - 1, index + window - 1);
	const blob = lines.slice(from, to + 1).map(prep).join("\n");
	return qs.every((q) => blob.includes(q)) ? [...qs] : null;
}

export function validateAdHocFilename(filename: string): void {
	if (filename.length > AD_HOC_NOTE_FILENAME_MAX) {
		throw new MemoriesError(`filename '${filename}' must be at most 128 bytes`, "invalid_filename");
	}
	const stem = filename.endsWith(".md") ? filename.slice(0, -3) : null;
	if (!stem) {
		throw new MemoriesError(`filename '${filename}' must end with .md`, "invalid_filename");
	}
	if (stem.length < TIMESTAMP_PREFIX_LEN) {
		throw new MemoriesError(
			`filename '${filename}' must use YYYY-MM-DDTHH-MM-SS-<slug>.md`,
			"invalid_filename",
		);
	}
	const ts = stem.slice(0, TIMESTAMP_PREFIX_LEN - 1); // without trailing -
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(ts)) {
		throw new MemoriesError(
			`filename '${filename}' must use YYYY-MM-DDTHH-MM-SS-<slug>.md`,
			"invalid_filename",
		);
	}
	const slug = stem.slice(TIMESTAMP_PREFIX_LEN);
	if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) {
		throw new MemoriesError(
			`filename '${filename}' slug must be lowercase letters, digits, hyphens`,
			"invalid_filename",
		);
	}
}

function appendRegistryLine(root: string, filename: string, note: string): void {
	const memoryMd = join(root, "MEMORY.md");
	const firstLine = note.split(/\r?\n/).find((l) => l.trim())?.replace(/^#+\s*/, "").slice(0, 120) || filename;
	const line = `\n- ad_hoc: extensions/ad_hoc/notes/${filename} — ${firstLine}\n`;
	try {
		const prev = existsSync(memoryMd) ? readFileSync(memoryMd, "utf-8") : "# MEMORY\n";
		writeFileSync(memoryMd, prev.endsWith("\n") ? prev + line.trimStart() : `${prev}\n${line.trimStart()}`, "utf-8");
	} catch {
		/* non-fatal */
	}
}

/** Helper for agent to generate valid ad-hoc filenames. */
export function makeAdHocFilename(slug: string, date = new Date()): string {
	const safe = slug
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80) || "note";
	const pad = (n: number) => String(n).padStart(2, "0");
	const ts = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
	return `${ts}-${safe}.md`;
}
