import { describe, expect, it } from "vitest";
import {
	rebuildTurnDiffFromDetails,
	rebuildAllTurnDiffsFromBranch,
	serializeTurnDiffSnapshot,
	serializeTurnDiffSnapshotForHistory,
	deserializeTurnDiffSnapshot,
} from "./history.js";

describe("rebuildTurnDiffFromDetails (history)", () => {
	it("rebuilds multi-file apply_patch after the fact", () => {
		const patch = `*** Begin Patch
*** Add File: a.ts
+export const a = 1;
*** Update File: b.ts
@@
-old
+new
*** End Patch`;
		const snap = rebuildTurnDiffFromDetails([{ patch, diff: patch }], "hist-1");
		expect(snap.turnId).toBe("hist-1");
		expect(snap.files.length).toBeGreaterThanOrEqual(2);
		expect(snap.files.some((f) => f.path === "a.ts")).toBe(true);
		expect(snap.files.some((f) => f.path === "b.ts")).toBe(true);
		expect(snap.files.every((f) => f.diff && f.diff.length > 0)).toBe(true);
		expect(snap.diff).toContain("a.ts");

		const ser = serializeTurnDiffSnapshot(snap);
		const back = deserializeTurnDiffSnapshot(ser);
		expect(back?.files.length).toBe(snap.files.length);
		expect(back?.files[0].diff).toBeTruthy();
	});

	it("merges edit + write details", () => {
		const snap = rebuildTurnDiffFromDetails(
			[
				{
					path: "x.ts",
					kind: "modify",
					diff: "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@\n-a\n+b\n",
				},
				{ path: "y.ts", kind: "create", content: "hello\n" },
			],
			"t2",
		);
		expect(snap.files.map((f) => f.path).sort()).toEqual(["x.ts", "y.ts"]);
		expect(snap.totalAdded).toBeGreaterThan(0);
	});

	it("rebuildTurnDiffFromSessionEntries prefers matching turnId", async () => {
		const { rebuildTurnDiffFromSessionEntries } = await import("./history.js");
		const a = serializeTurnDiffSnapshot(
			rebuildTurnDiffFromDetails([{ path: "a.ts", kind: "create", content: "a\n" }], "turn-a"),
		);
		const b = serializeTurnDiffSnapshot(
			rebuildTurnDiffFromDetails([{ path: "b.ts", kind: "create", content: "b\n" }], "turn-b"),
		);
		const entries = [
			{ type: "custom", customType: "turn-diff", data: a },
			{ type: "custom", customType: "turn-diff", data: b },
		];
		const snap = rebuildTurnDiffFromSessionEntries(entries, "turn-a");
		expect(snap?.turnId).toBe("turn-a");
		expect(snap?.files.some((f) => f.path === "a.ts")).toBe(true);
	});

	it("rebuildAllTurnDiffsFromBranch returns all conversation turns", () => {
		const a = serializeTurnDiffSnapshotForHistory(
			rebuildTurnDiffFromDetails([{ path: "a.ts", kind: "create", content: "a\n" }], "life-a"),
			{ conversationTurn: 1, lifecycleTurnId: "life-a" },
		);
		const b = serializeTurnDiffSnapshotForHistory(
			rebuildTurnDiffFromDetails([{ path: "b.ts", kind: "create", content: "b\n" }], "life-b"),
			{ conversationTurn: 3, lifecycleTurnId: "life-b" },
		);
		const all = rebuildAllTurnDiffsFromBranch([
			{ type: "custom", customType: "turn-diff", data: a },
			{ type: "custom", customType: "turn-diff", data: b },
		]);
		expect(all).toHaveLength(2);
		expect(all[0].conversationTurn).toBe(1);
		expect(all[1].conversationTurn).toBe(3);
		expect(all[1].snapshot.files.some((f) => f.path === "b.ts")).toBe(true);
	});
});
