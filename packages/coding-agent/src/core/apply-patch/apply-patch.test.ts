import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyPatchText } from "./apply.js";
import { parsePatch } from "./parser.js";

describe("Codex apply_patch", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const d of dirs) {
			try {
				rmSync(d, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
		dirs.length = 0;
	});

	function temp(): string {
		const root = mkdtempSync(join(tmpdir(), "quake-patch-"));
		dirs.push(root);
		return root;
	}

	it("parses add/update/delete hunks", () => {
		const patch = `*** Begin Patch
*** Add File: hello.txt
+hi
*** Update File: hello.txt
@@
-hi
+hello world
*** Delete File: gone.txt
*** End Patch
`;
		const args = parsePatch(patch);
		expect(args.hunks).toHaveLength(3);
		expect(args.hunks[0].type).toBe("add");
		expect(args.hunks[1].type).toBe("update");
		expect(args.hunks[2].type).toBe("delete");
	});

	it("applies add + update to disk", () => {
		const root = temp();
		const patch = `*** Begin Patch
*** Add File: a.txt
+line1
+line2
*** End Patch
`;
		const r1 = applyPatchText(root, patch);
		expect(r1.added).toContain("a.txt");
		expect(readFileSync(join(root, "a.txt"), "utf-8")).toContain("line1");

		const patch2 = `*** Begin Patch
*** Update File: a.txt
@@
-line1
-line2
+line1
+line2 changed
*** End Patch
`;
		const r2 = applyPatchText(root, patch2);
		expect(r2.updated).toContain("a.txt");
		expect(readFileSync(join(root, "a.txt"), "utf-8")).toContain("changed");
	});

	it("deletes files", () => {
		const root = temp();
		writeFileSync(join(root, "x.txt"), "x\n");
		const patch = `*** Begin Patch
*** Delete File: x.txt
*** End Patch
`;
		applyPatchText(root, patch);
		expect(existsSync(join(root, "x.txt"))).toBe(false);
	});
});
