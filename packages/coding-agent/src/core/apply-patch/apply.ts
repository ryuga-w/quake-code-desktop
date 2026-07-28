/**
 * Apply parsed Codex patch hunks to the filesystem.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { type ApplyPatchHunk, type UpdateFileChunk, parsePatch } from "./parser.js";

export interface ApplyPatchResult {
	added: string[];
	deleted: string[];
	updated: string[];
	moved: Array<{ from: string; to: string }>;
}

export class ApplyPatchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ApplyPatchError";
	}
}

/**
 * True only if `abs` is exactly `root` or a proper child path (separator after root).
 * Prevents sibling-prefix escape: C:\…\proj must NOT allow C:\…\projEVIL.
 */
export function isPathInsideRoot(absPath: string, rootPath: string): boolean {
	const abs = resolve(absPath);
	const root = resolve(rootPath);
	const a = abs.toLowerCase();
	const r = root.toLowerCase();
	if (a === r) return true;
	const sep = root.includes("\\") || abs.includes("\\") ? "\\" : "/";
	// Normalize both to use consistent separators for prefix check
	const aN = a.replace(/\//g, "\\");
	const rN = r.replace(/\//g, "\\");
	return aN.startsWith(rN + "\\") || aN.startsWith(rN + "/");
}

function resolvePath(cwd: string, path: string): string {
	const abs = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
	const root = resolve(cwd);
	if (!isPathInsideRoot(abs, root)) {
		throw new ApplyPatchError(`path escapes workspace: ${path}`);
	}
	return abs;
}

/** Resolve + validate a patch target under cwd (exported for gates/tests). */
export function resolveWorkspacePath(cwd: string, path: string): string {
	return resolvePath(cwd, path);
}

function findChunkStart(content: string, chunk: UpdateFileChunk): number {
	const lines = content.split(/\r?\n/);
	// Drop trailing empty from split if file ends with \n
	const fileLines =
		content.endsWith("\n") || content.endsWith("\r\n") ? lines.slice(0, -1) : lines;

	let searchFrom = 0;
	if (chunk.change_context) {
		const ctx = chunk.change_context;
		const idx = fileLines.findIndex((l, i) => i >= 0 && l.includes(ctx));
		if (idx < 0) {
			throw new ApplyPatchError(`change context not found: ${ctx}`);
		}
		searchFrom = idx + 1;
	}

	const old = chunk.old_lines;
	if (!old.length) {
		// pure insert — place after context or EOF
		if (chunk.is_end_of_file) return fileLines.length;
		return searchFrom;
	}

	for (let i = searchFrom; i <= fileLines.length - old.length; i += 1) {
		let match = true;
		for (let j = 0; j < old.length; j += 1) {
			if (fileLines[i + j] !== old[j]) {
				match = false;
				break;
			}
		}
		if (match) {
			if (chunk.is_end_of_file && i + old.length !== fileLines.length) {
				// prefer end match; continue searching
				continue;
			}
			return i;
		}
	}

	// eof tolerance: try trailing match ignoring final empty
	if (chunk.is_end_of_file) {
		for (let i = searchFrom; i <= fileLines.length - old.length; i += 1) {
			let match = true;
			for (let j = 0; j < old.length; j += 1) {
				if (fileLines[i + j] !== old[j]) {
					match = false;
					break;
				}
			}
			if (match) return i;
		}
	}

	throw new ApplyPatchError(
		`could not find expected lines to update:\n${old.slice(0, 5).join("\n")}${old.length > 5 ? "\n…" : ""}`,
	);
}

function applyUpdateChunks(original: string, chunks: UpdateFileChunk[]): string {
	let content = original;
	// Apply in reverse order by position so earlier indices stay valid — first compute all starts on original
	// Simple approach: sequential apply with re-find each time on evolving content
	for (const chunk of chunks) {
		const lines = content.split(/\r?\n/);
		const fileLines =
			content.endsWith("\n") || content === ""
				? content.endsWith("\n")
					? lines.slice(0, -1)
					: lines
				: lines;
		const start = findChunkStart(content, chunk);
		const next = [
			...fileLines.slice(0, start),
			...chunk.new_lines,
			...fileLines.slice(start + chunk.old_lines.length),
		];
		content = next.join("\n");
		if (original.endsWith("\n") || content.length > 0) {
			// preserve trailing newline habit
			if (!content.endsWith("\n") && (original.endsWith("\n") || chunk.new_lines.length)) {
				content += "\n";
			}
		}
	}
	return content;
}

export function applyHunks(cwd: string, hunks: ApplyPatchHunk[]): ApplyPatchResult {
	const result: ApplyPatchResult = { added: [], deleted: [], updated: [], moved: [] };

	for (const hunk of hunks) {
		if (hunk.type === "add") {
			const abs = resolvePath(cwd, hunk.path);
			mkdirSync(dirname(abs), { recursive: true });
			if (existsSync(abs)) throw new ApplyPatchError(`file already exists: ${hunk.path}`);
			writeFileSync(abs, hunk.contents, "utf-8");
			result.added.push(hunk.path);
			continue;
		}
		if (hunk.type === "delete") {
			const abs = resolvePath(cwd, hunk.path);
			if (!existsSync(abs)) throw new ApplyPatchError(`file not found: ${hunk.path}`);
			rmSync(abs, { force: true });
			result.deleted.push(hunk.path);
			continue;
		}
		// update
		const abs = resolvePath(cwd, hunk.path);
		if (!existsSync(abs)) throw new ApplyPatchError(`file not found: ${hunk.path}`);
		const original = readFileSync(abs, "utf-8");
		const next = applyUpdateChunks(original, hunk.chunks);
		if (hunk.move_path) {
			const dest = resolvePath(cwd, hunk.move_path);
			mkdirSync(dirname(dest), { recursive: true });
			writeFileSync(dest, next, "utf-8");
			rmSync(abs, { force: true });
			result.moved.push({ from: hunk.path, to: hunk.move_path });
			result.updated.push(hunk.move_path);
		} else {
			writeFileSync(abs, next, "utf-8");
			result.updated.push(hunk.path);
		}
	}

	return result;
}

export function applyPatchText(cwd: string, patch: string): ApplyPatchResult {
	const args = parsePatch(patch);
	return applyHunks(cwd, args.hunks);
}
