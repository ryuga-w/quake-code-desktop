/**
 * Codex apply-patch format parser (codex-rs/apply-patch/src/parser.rs).
 *
 * Format:
 *   *** Begin Patch
 *   *** Add File: path
 *   +line...
 *   *** Delete File: path
 *   *** Update File: path
 *   *** Move to: newpath   (optional)
 *   @@ context
 *   -old
 *   +new
 *    keep
 *   *** End of File        (optional)
 *   *** End Patch
 */

export const BEGIN_PATCH_MARKER = "*** Begin Patch";
export const END_PATCH_MARKER = "*** End Patch";
export const ADD_FILE_MARKER = "*** Add File: ";
export const DELETE_FILE_MARKER = "*** Delete File: ";
export const UPDATE_FILE_MARKER = "*** Update File: ";
export const MOVE_TO_MARKER = "*** Move to: ";
export const EOF_MARKER = "*** End of File";
export const CHANGE_CONTEXT_MARKER = "@@ ";
export const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

export type ApplyPatchHunk =
	| { type: "add"; path: string; contents: string }
	| { type: "delete"; path: string }
	| {
			type: "update";
			path: string;
			move_path?: string;
			chunks: UpdateFileChunk[];
	  };

export interface UpdateFileChunk {
	change_context?: string;
	old_lines: string[];
	new_lines: string[];
	is_end_of_file: boolean;
}

export interface ApplyPatchArgs {
	patch: string;
	hunks: ApplyPatchHunk[];
	environment_id?: string;
}

export class ApplyPatchParseError extends Error {
	constructor(
		message: string,
		readonly line_number?: number,
	) {
		super(line_number != null ? `invalid hunk at line ${line_number}, ${message}` : `invalid patch: ${message}`);
		this.name = "ApplyPatchParseError";
	}
}

/** Strip heredoc wrappers GPT-4.1 sometimes emits (Codex lenient mode). */
function stripHeredocIfPresent(patch: string): string {
	const trimmed = patch.trim();
	const m = trimmed.match(/^<<['"]?EOF['"]?\r?\n([\s\S]*?)\r?\nEOF\s*$/);
	return m ? m[1].trim() : trimmed;
}

export function parsePatch(patchInput: string): ApplyPatchArgs {
	const patch = stripHeredocIfPresent(patchInput);
	const lines = patch.split(/\r?\n/);
	if (!lines.length) throw new ApplyPatchParseError("empty patch");

	let start = 0;
	while (start < lines.length && !lines[start].trim().startsWith(BEGIN_PATCH_MARKER)) start += 1;
	if (start >= lines.length) throw new ApplyPatchParseError("missing Begin Patch marker");

	let end = lines.length - 1;
	while (end > start && !lines[end].trim().startsWith(END_PATCH_MARKER)) end -= 1;
	if (end <= start) throw new ApplyPatchParseError("missing End Patch marker");

	const body = lines.slice(start + 1, end);
	const hunks: ApplyPatchHunk[] = [];
	let environment_id: string | undefined;
	let i = 0;

	while (i < body.length) {
		const line = body[i];
		const trimmed = line.trimEnd();
		if (!trimmed.trim()) {
			i += 1;
			continue;
		}
		if (trimmed.startsWith("*** Environment ID: ")) {
			environment_id = trimmed.slice("*** Environment ID: ".length).trim();
			i += 1;
			continue;
		}
		if (trimmed.startsWith(ADD_FILE_MARKER)) {
			const path = trimmed.slice(ADD_FILE_MARKER.length).trim();
			i += 1;
			const addLines: string[] = [];
			while (i < body.length) {
				const l = body[i];
				if (l.startsWith("*** ")) break;
				if (l.startsWith("+")) addLines.push(l.slice(1));
				else if (l.trim() === "") addLines.push("");
				else throw new ApplyPatchParseError("add file lines must start with +", start + 2 + i);
				i += 1;
			}
			hunks.push({ type: "add", path, contents: addLines.join("\n") + (addLines.length ? "\n" : "") });
			continue;
		}
		if (trimmed.startsWith(DELETE_FILE_MARKER)) {
			const path = trimmed.slice(DELETE_FILE_MARKER.length).trim();
			hunks.push({ type: "delete", path });
			i += 1;
			continue;
		}
		if (trimmed.startsWith(UPDATE_FILE_MARKER)) {
			const path = trimmed.slice(UPDATE_FILE_MARKER.length).trim();
			i += 1;
			let move_path: string | undefined;
			if (i < body.length && body[i].trimEnd().startsWith(MOVE_TO_MARKER)) {
				move_path = body[i].trimEnd().slice(MOVE_TO_MARKER.length).trim();
				i += 1;
			}
			const chunks: UpdateFileChunk[] = [];
			while (i < body.length && !body[i].startsWith("*** ") || body[i]?.startsWith(EOF_MARKER) || body[i]?.startsWith("@@")) {
				if (i >= body.length || (body[i].startsWith("*** ") && !body[i].startsWith(EOF_MARKER))) break;
				let change_context: string | undefined;
				if (body[i].startsWith(CHANGE_CONTEXT_MARKER) || body[i].trim() === EMPTY_CHANGE_CONTEXT_MARKER) {
					change_context =
						body[i].trim() === EMPTY_CHANGE_CONTEXT_MARKER
							? undefined
							: body[i].slice(CHANGE_CONTEXT_MARKER.length);
					i += 1;
				}
				const old_lines: string[] = [];
				const new_lines: string[] = [];
				let is_end_of_file = false;
				while (i < body.length) {
					const l = body[i];
					if (l.startsWith("@@") || (l.startsWith("*** ") && !l.startsWith(EOF_MARKER))) break;
					if (l.startsWith(EOF_MARKER)) {
						is_end_of_file = true;
						i += 1;
						break;
					}
					if (l.startsWith("-")) old_lines.push(l.slice(1));
					else if (l.startsWith("+")) new_lines.push(l.slice(1));
					else if (l.startsWith(" ")) {
						old_lines.push(l.slice(1));
						new_lines.push(l.slice(1));
					} else if (l.trim() === "") {
						// blank context
						old_lines.push("");
						new_lines.push("");
					} else {
						// treat as context
						old_lines.push(l);
						new_lines.push(l);
					}
					i += 1;
				}
				if (old_lines.length || new_lines.length || change_context) {
					chunks.push({ change_context, old_lines, new_lines, is_end_of_file });
				}
				if (is_end_of_file) break;
			}
			hunks.push({ type: "update", path, move_path, chunks });
			continue;
		}
		throw new ApplyPatchParseError(`unexpected line: ${trimmed}`, start + 2 + i);
	}

	if (!hunks.length) throw new ApplyPatchParseError("patch contains no hunks");
	return {
		patch: body.join("\n"),
		hunks,
		environment_id,
	};
}
