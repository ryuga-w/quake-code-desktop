/**
 * Codex TurnDiffUpdated spirit — aggregate per-file unified diffs for the current turn.
 */

export type TurnFileChangeKind = "create" | "modify" | "delete";

export interface TurnFileDiffEntry {
	path: string;
	kind: TurnFileChangeKind;
	/** Unified diff or content snippet */
	diff: string;
	added: number;
	removed: number;
	previousPath?: string;
}

export interface TurnDiffSnapshot {
	turnId: string;
	/** Aggregated multi-file unified-style text */
	diff: string;
	files: TurnFileDiffEntry[];
	totalAdded: number;
	totalRemoved: number;
	updatedAt: number;
}

function countDiffLines(text: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of text.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) continue;
		if (line.startsWith("+")) added += 1;
		else if (line.startsWith("-")) removed += 1;
	}
	return { added, removed };
}

function fileHeader(path: string, kind: TurnFileChangeKind, previousPath?: string): string {
	const from = previousPath || path;
	if (kind === "create") {
		return `diff --git a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n`;
	}
	if (kind === "delete") {
		return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ /dev/null\n`;
	}
	if (previousPath && previousPath !== path) {
		return `diff --git a/${from} b/${path}\n--- a/${from}\n+++ b/${path}\n`;
	}
	return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`;
}

/**
 * Convert Codex apply_patch body into per-file unified-style diffs for TurnDiffUpdated UI.
 */
export function splitApplyPatchToFileDiffs(patch: string): TurnFileDiffEntry[] {
	const files: TurnFileDiffEntry[] = [];
	let current: {
		path: string;
		kind: TurnFileChangeKind;
		previousPath?: string;
		body: string[];
	} | null = null;

	const flush = () => {
		if (!current) return;
		const body = current.body;
		const counted = countDiffLines(body.map((l) => (l.startsWith("+") || l.startsWith("-") || l.startsWith(" ") ? l : ` ${l}`)).join("\n"));
		// Normalize body lines: ensure +/- / space prefix for Shiki diff
		const normalizedBody = body
			.map((line) => {
				if (line.startsWith("@@")) return line;
				if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) return line;
				// Apply-patch content without prefix shouldn't happen; treat as context
				return ` ${line}`;
			})
			.join("\n");
		const hasHunk = normalizedBody.includes("@@");
		const hunk = hasHunk ? normalizedBody : `@@\n${normalizedBody}`;
		const diff = `${fileHeader(current.path, current.kind, current.previousPath)}${hunk}\n`;
		files.push({
			path: current.path,
			kind: current.kind,
			diff,
			added: counted.added,
			removed: counted.removed,
			previousPath: current.previousPath,
		});
		current = null;
	};

	for (const raw of String(patch || "")
		.replace(/\r\n/g, "\n")
		.split("\n")) {
		const line = raw;
		const add = line.match(/^\*\*\*\s+Add File:\s*(.+?)\s*$/i);
		const del = line.match(/^\*\*\*\s+Delete File:\s*(.+?)\s*$/i);
		const upd = line.match(/^\*\*\*\s+Update File:\s*(.+?)\s*$/i);
		const move = line.match(/^\*\*\*\s+Move to:\s*(.+?)\s*$/i);
		if (add) {
			flush();
			current = { path: add[1].trim().replace(/\\/g, "/"), kind: "create", body: [] };
			continue;
		}
		if (del) {
			flush();
			current = { path: del[1].trim().replace(/\\/g, "/"), kind: "delete", body: [] };
			continue;
		}
		if (upd) {
			flush();
			current = { path: upd[1].trim().replace(/\\/g, "/"), kind: "modify", body: [] };
			continue;
		}
		if (move && current) {
			current.previousPath = current.path;
			current.path = move[1].trim().replace(/\\/g, "/");
			continue;
		}
		if (/^\*\*\*\s+(Begin|End)\s+Patch/i.test(line)) continue;
		if (!current) continue;
		if (line.startsWith("***")) continue;
		current.body.push(line);
	}
	flush();
	return files;
}

export class TurnDiffAggregator {
	private turnId = "0";
	private files = new Map<string, TurnFileDiffEntry>();

	beginTurn(turnId: string): void {
		this.turnId = String(turnId || "0");
		this.files.clear();
	}

	/** Record a file mutation for the active turn */
	record(entry: {
		path: string;
		kind: TurnFileChangeKind;
		diff?: string;
		added?: number;
		removed?: number;
		previousPath?: string;
		content?: string;
	}): TurnDiffSnapshot {
		const path = entry.path.replace(/\\/g, "/");
		let diff = entry.diff?.trim() || "";
		if (!diff && entry.content != null && entry.kind === "create") {
			diff =
				fileHeader(path, "create") +
				"@@\n" +
				entry.content
					.split("\n")
					.map((l) => `+${l}`)
					.join("\n");
			if (!diff.endsWith("\n")) diff += "\n";
		}
		const counted = diff ? countDiffLines(diff) : { added: 0, removed: 0 };
		const next: TurnFileDiffEntry = {
			path,
			kind: entry.kind,
			diff,
			added: entry.added ?? counted.added,
			removed: entry.removed ?? counted.removed,
			previousPath: entry.previousPath,
		};
		const key = path.toLowerCase();
		const prev = this.files.get(key);
		if (prev) {
			// Merge: prefer later kind; append diffs
			next.kind =
				entry.kind === "delete"
					? "delete"
					: prev.kind === "create" && entry.kind === "modify"
						? "create"
						: entry.kind;
			next.added = prev.added + next.added;
			next.removed = prev.removed + next.removed;
			next.diff = [prev.diff, next.diff].filter(Boolean).join("\n");
		}
		this.files.set(key, next);
		return this.snapshot();
	}

	/**
	 * Apply structured apply_patch details.
	 * Prefer full patch text so per-file unified diffs are available for UI expand.
	 */
	recordApplyPatchDetails(details: {
		files?: Array<{
			path: string;
			kind: string;
			added?: number;
			removed?: number;
			previousPath?: string;
			diff?: string;
		}>;
		added?: string[];
		updated?: string[];
		deleted?: string[];
		/** Full apply_patch body or multi-file unified diff */
		diff?: string;
		/** Alias for Codex apply_patch input */
		patch?: string;
	}): TurnDiffSnapshot {
		const patchText =
			(typeof details.patch === "string" && details.patch) ||
			(typeof details.diff === "string" && details.diff.includes("***") ? details.diff : "") ||
			"";

		if (patchText.includes("***")) {
			const split = splitApplyPatchToFileDiffs(patchText);
			if (split.length) {
				for (const f of split) this.record(f);
				return this.snapshot();
			}
		}

		if (Array.isArray(details.files) && details.files.length) {
			for (const f of details.files) {
				this.record({
					path: f.path,
					kind: f.kind === "create" || f.kind === "delete" ? f.kind : "modify",
					added: f.added,
					removed: f.removed,
					previousPath: f.previousPath,
					diff: f.diff,
				});
			}
			return this.snapshot();
		}
		for (const p of details.added || []) this.record({ path: p, kind: "create", added: 1, removed: 0 });
		for (const p of details.updated || []) this.record({ path: p, kind: "modify" });
		for (const p of details.deleted || []) this.record({ path: p, kind: "delete", added: 0, removed: 1 });
		if (typeof details.diff === "string" && details.diff.trim() && !details.diff.includes("***")) {
			this.record({ path: "patch.diff", kind: "modify", diff: details.diff });
		}
		return this.snapshot();
	}

	snapshot(): TurnDiffSnapshot {
		const files = [...this.files.values()].sort((a, b) => a.path.localeCompare(b.path));
		const totalAdded = files.reduce((s, f) => s + f.added, 0);
		const totalRemoved = files.reduce((s, f) => s + f.removed, 0);
		const parts: string[] = [];
		for (const f of files) {
			if (f.diff) parts.push(f.diff.trimEnd());
			else {
				parts.push(
					`${fileHeader(f.path, f.kind)}@@\n${f.kind === "delete" ? `-// deleted` : f.kind === "create" ? `+// created` : ` // modified`} (${f.added}+/${f.removed}-)\n`,
				);
			}
		}
		return {
			turnId: this.turnId,
			diff: parts.join("\n\n"),
			files,
			totalAdded,
			totalRemoved,
			updatedAt: Date.now(),
		};
	}

	clear(): void {
		this.files.clear();
	}
}

/** Process-global aggregator (agent tools + desktop share one process). */
export const turnDiffAggregator = new TurnDiffAggregator();
