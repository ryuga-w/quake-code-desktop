import { describe, expect, it } from "vitest";
import {
	splitApplyPatchToFileDiffs,
	TurnDiffAggregator,
} from "./aggregator.js";

describe("splitApplyPatchToFileDiffs", () => {
	it("splits multi-file apply_patch into per-file unified diffs", () => {
		const patch = `*** Begin Patch
*** Add File: src/a.ts
+export const a = 1;
*** Update File: src/b.ts
@@
-export const b = 0;
+export const b = 1;
*** Delete File: src/c.ts
*** End Patch`;
		const files = splitApplyPatchToFileDiffs(patch);
		expect(files).toHaveLength(3);
		expect(files[0].path).toBe("src/a.ts");
		expect(files[0].kind).toBe("create");
		expect(files[0].added).toBeGreaterThan(0);
		expect(files[0].diff).toContain("+++ b/src/a.ts");
		expect(files[0].diff).toContain("+export const a = 1;");
		expect(files[1].path).toBe("src/b.ts");
		expect(files[1].kind).toBe("modify");
		expect(files[1].diff).toContain("-export const b = 0;");
		expect(files[1].diff).toContain("+export const b = 1;");
		expect(files[2].path).toBe("src/c.ts");
		expect(files[2].kind).toBe("delete");
	});
});

describe("TurnDiffAggregator", () => {
	it("emits a single unified turn snapshot from apply_patch", () => {
		const agg = new TurnDiffAggregator();
		agg.beginTurn("turn-1");
		const snap = agg.recordApplyPatchDetails({
			patch: `*** Begin Patch
*** Update File: foo.ts
@@
-old
+new
*** End Patch`,
		});
		expect(snap.turnId).toBe("turn-1");
		expect(snap.files).toHaveLength(1);
		expect(snap.files[0].path).toBe("foo.ts");
		expect(snap.diff).toContain("foo.ts");
		expect(snap.totalAdded).toBeGreaterThan(0);
		expect(snap.totalRemoved).toBeGreaterThan(0);
	});

	it("merges edit + write into one turn diff", () => {
		const agg = new TurnDiffAggregator();
		agg.beginTurn("t2");
		agg.record({
			path: "a.ts",
			kind: "modify",
			diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@\n-old\n+new\n",
		});
		agg.record({
			path: "b.ts",
			kind: "create",
			content: "hello\n",
		});
		const snap = agg.snapshot();
		expect(snap.files.map((f) => f.path).sort()).toEqual(["a.ts", "b.ts"]);
		expect(snap.diff).toContain("a.ts");
		expect(snap.diff).toContain("b.ts");
	});
});
