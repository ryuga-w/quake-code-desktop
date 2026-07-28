/**
 * Rebuild TurnDiffSnapshot from persisted tool details (history / session restore).
 */

import {
	splitApplyPatchToFileDiffs,
	TurnDiffAggregator,
	type TurnDiffSnapshot,
	type TurnFileChangeKind,
	type TurnFileDiffEntry,
} from "./aggregator.js";

export interface PersistedFileMutationDetail {
	path?: string;
	kind?: string;
	diff?: string;
	added?: number;
	removed?: number;
	previousPath?: string;
	content?: string;
	files?: Array<{
		path: string;
		kind?: string;
		diff?: string;
		added?: number;
		removed?: number;
		previousPath?: string;
	}>;
	/** apply_patch body */
	patch?: string;
}

/**
 * Rebuild a turn-level unified diff from zero or more tool `details` objects
 * (edit/write/apply_patch). Does not require a live agent process.
 */
export function rebuildTurnDiffFromDetails(
	detailsList: Array<PersistedFileMutationDetail | null | undefined>,
	turnId = "history",
): TurnDiffSnapshot {
	const agg = new TurnDiffAggregator();
	agg.beginTurn(turnId);

	for (const raw of detailsList) {
		if (!raw || typeof raw !== "object") continue;
		const d = raw;

		// apply_patch multi-file body
		const patchText =
			(typeof d.patch === "string" && d.patch) ||
			(typeof d.diff === "string" && d.diff.includes("***") ? d.diff : "");
		if (patchText.includes("*** Begin") || patchText.includes("*** Add") || patchText.includes("*** Update")) {
			agg.recordApplyPatchDetails({ patch: patchText, files: d.files as any });
			continue;
		}

		if (Array.isArray(d.files) && d.files.length) {
			for (const f of d.files) {
				if (!f?.path) continue;
				agg.record({
					path: f.path,
					kind: normalizeKind(f.kind),
					diff: f.diff,
					added: f.added,
					removed: f.removed,
					previousPath: f.previousPath,
				});
			}
			continue;
		}

		if (typeof d.path === "string" && d.path) {
			agg.record({
				path: d.path,
				kind: normalizeKind(d.kind),
				diff: typeof d.diff === "string" ? d.diff : undefined,
				added: d.added,
				removed: d.removed,
				previousPath: d.previousPath,
				content: typeof d.content === "string" ? d.content : undefined,
			});
		} else if (typeof d.diff === "string" && d.diff.trim()) {
			// Single unified diff without path
			agg.record({ path: "patch.diff", kind: "modify", diff: d.diff });
		}
	}

	return agg.snapshot();
}

function normalizeKind(kind?: string): TurnFileChangeKind {
	if (kind === "create" || kind === "delete") return kind;
	return "modify";
}

/** Serialize snapshot for session/rollout payload */
export function serializeTurnDiffSnapshot(snap: TurnDiffSnapshot): Record<string, unknown> {
	return {
		turnId: snap.turnId,
		diff: snap.diff,
		files: snap.files,
		totalAdded: snap.totalAdded,
		totalRemoved: snap.totalRemoved,
		updatedAt: snap.updatedAt,
	};
}

/** Deserialize and normalize a stored payload */
export function deserializeTurnDiffSnapshot(raw: unknown): TurnDiffSnapshot | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	const files = Array.isArray(o.files) ? (o.files as TurnFileDiffEntry[]) : [];
	if (!files.length && typeof o.diff !== "string") return null;
	return {
		turnId: String(o.turnId || "history"),
		diff: typeof o.diff === "string" ? o.diff : "",
		files: files.map((f) => ({
			path: String(f.path || ""),
			kind: normalizeKind(f.kind),
			diff: String(f.diff || ""),
			added: Number(f.added) || 0,
			removed: Number(f.removed) || 0,
			previousPath: f.previousPath ? String(f.previousPath) : undefined,
		})),
		totalAdded: Number(o.totalAdded) || 0,
		totalRemoved: Number(o.totalRemoved) || 0,
		updatedAt: Number(o.updatedAt) || Date.now(),
	};
}

/**
 * Rebuild turn-diff from session custom entries of type "turn-diff"
 * (written by desktop runtime on agent_end via SessionManager.appendCustomEntry).
 */
export function rebuildTurnDiffFromSessionEntries(
	entries: Array<{ type?: string; customType?: string; data?: unknown }>,
	turnId?: string,
): TurnDiffSnapshot | null {
	const custom = entries.filter(
		(e) => e.type === "custom" && (e as { customType?: string }).customType === "turn-diff",
	);
	if (!custom.length) return null;
	let last: TurnDiffSnapshot | null = null;
	for (const e of custom) {
		const snap = deserializeTurnDiffSnapshot((e as { data?: unknown }).data);
		if (!snap) continue;
		if (turnId && snap.turnId === turnId) return snap;
		last = snap;
	}
	return last;
}

export interface TurnDiffHistoryEntry {
	/** Conversation turn index (client buildMessageToolHistory alignment) */
	conversationTurn: number;
	lifecycleTurnId?: string;
	snapshot: TurnDiffSnapshot;
}

/**
 * Rebuild ALL turn-diff custom entries for session restore (not just last/one).
 * Prefer explicit `conversationTurn` on payload; else assign sequential 1..N by order.
 */
export function rebuildAllTurnDiffsFromBranch(
	entries: Array<{ type?: string; customType?: string; data?: unknown }>,
): TurnDiffHistoryEntry[] {
	const custom = entries.filter(
		(e) => e.type === "custom" && (e as { customType?: string }).customType === "turn-diff",
	);
	const out: TurnDiffHistoryEntry[] = [];
	let seq = 0;
	for (const e of custom) {
		const raw = (e as { data?: unknown }).data;
		const snap = deserializeTurnDiffSnapshot(raw);
		if (!snap || !snap.files.length) continue;
		seq += 1;
		const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
		const conversationTurn =
			Number(data.conversationTurn) > 0 ? Number(data.conversationTurn) : seq;
		const lifecycleTurnId =
			typeof data.lifecycleTurnId === "string"
				? data.lifecycleTurnId
				: snap.turnId || undefined;
		out.push({ conversationTurn, lifecycleTurnId, snapshot: snap });
	}
	return out;
}

/** Serialize with optional conversation join key for history rebuild. */
export function serializeTurnDiffSnapshotForHistory(
	snap: TurnDiffSnapshot,
	meta?: { conversationTurn?: number; lifecycleTurnId?: string },
): Record<string, unknown> {
	return {
		...serializeTurnDiffSnapshot(snap),
		conversationTurn: meta?.conversationTurn,
		lifecycleTurnId: meta?.lifecycleTurnId || snap.turnId,
	};
}

export { splitApplyPatchToFileDiffs };
