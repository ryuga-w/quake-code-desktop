/**
 * Honest path-escape tests for apply_patch / applyPatchText.
 * Must drive shipped resolvePath + tool execute under Default/workspace-write.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { applyPatchText, isPathInsideRoot, resolveWorkspacePath, ApplyPatchError } from "./apply.js";
import { createApplyPatchToolDefinitionForCwd } from "../tools/apply-patch.js";
import { createSandbox, setActiveSandbox } from "../sandbox/index.js";
import { guardianRuntime } from "../guardian/index.js";
import { turnDiffAggregator } from "../turn-diff/index.js";

function makeWorkspace(): { ws: string; siblingEvil: string } {
	const parent = mkdtempSync(join(tmpdir(), "quake-ws-parent-"));
	const ws = join(parent, "proj");
	mkdirSync(ws);
	// Sibling that shares prefix with workspace name (the classic startsWith bug)
	const siblingEvil = join(parent, "projEVIL");
	mkdirSync(siblingEvil);
	return { ws, siblingEvil };
}

describe("isPathInsideRoot / resolveWorkspacePath", () => {
	it("rejects sibling-prefix absolute path", () => {
		const { ws, siblingEvil } = makeWorkspace();
		const evilFile = join(siblingEvil, "pwned.txt");
		expect(isPathInsideRoot(evilFile, ws)).toBe(false);
		expect(() => resolveWorkspacePath(ws, evilFile)).toThrow(/escapes workspace/);
	});

	it("rejects ../ relative escape", () => {
		const { ws } = makeWorkspace();
		expect(() => resolveWorkspacePath(ws, "../outside.txt")).toThrow(/escapes workspace/);
	});

	it("allows paths under workspace", () => {
		const { ws } = makeWorkspace();
		const inside = resolveWorkspacePath(ws, "src/a.ts");
		expect(isPathInsideRoot(inside, ws)).toBe(true);
	});
});

describe("applyPatchText path escape (shipped apply)", () => {
	it("does not write sibling-prefix absolute path outside workspace", () => {
		const { ws, siblingEvil } = makeWorkspace();
		const evilFile = join(siblingEvil, "pwned.txt");
		const patch = `*** Begin Patch
*** Add File: ${evilFile.replace(/\\/g, "/")}
+pwned
*** End Patch`;
		expect(() => applyPatchText(ws, patch)).toThrow(ApplyPatchError);
		expect(existsSync(evilFile)).toBe(false);
	});

	it("does not write via relative ../ escape", () => {
		const { ws } = makeWorkspace();
		const parent = dirname(ws);
		const outside = join(parent, "escaped.txt");
		const patch = `*** Begin Patch
*** Add File: ../escaped.txt
+pwned
*** End Patch`;
		expect(() => applyPatchText(ws, patch)).toThrow(/escapes workspace/);
		expect(existsSync(outside)).toBe(false);
	});
});

describe("apply_patch tool + gateToolExecution under Default/workspace-write", () => {
	beforeEach(() => {
		guardianRuntime.setPreset("auto");
		guardianRuntime.clearSessionApprovals();
		guardianRuntime.setUiHandler(undefined);
		guardianRuntime.endTurn();
		guardianRuntime.beginTurn("apply-escape-test");
	});

	it("tool execute denies sibling-prefix path under workspace-write", async () => {
		const { ws, siblingEvil } = makeWorkspace();
		setActiveSandbox(createSandbox({ mode: "workspace-write", workspaceRoot: ws }));
		guardianRuntime.setWorkspaceRoot(ws);
		// Auto-accept UI approval if reached — path gate must fail first
		guardianRuntime.setUiHandler(async () => "accept");

		const def = createApplyPatchToolDefinitionForCwd(ws);
		const evilFile = join(siblingEvil, "pwned-tool.txt");
		const patch = `*** Begin Patch
*** Add File: ${evilFile.replace(/\\/g, "/")}
+pwned-via-tool
*** End Patch`;
		const result = await def.execute("t1", { patch } as any);
		const text = result.content?.map((c: any) => c.text).join("\n") || "";
		expect(text).toMatch(/denied|escapes|outside sandbox/i);
		expect((result.details as any)?.ok).toBe(false);
		expect(existsSync(evilFile)).toBe(false);
	});

	it("tool execute denies ../ relative escape under workspace-write", async () => {
		const { ws } = makeWorkspace();
		setActiveSandbox(createSandbox({ mode: "workspace-write", workspaceRoot: ws }));
		guardianRuntime.setWorkspaceRoot(ws);
		guardianRuntime.setUiHandler(async () => "accept");

		const def = createApplyPatchToolDefinitionForCwd(ws);
		const patch = `*** Begin Patch
*** Add File: ../escaped-tool.txt
+nope
*** End Patch`;
		const result = await def.execute("t2", { patch } as any);
		const text = result.content?.map((c: any) => c.text).join("\n") || "";
		expect(text).toMatch(/denied|escapes|outside sandbox/i);
		expect((result.details as any)?.ok).toBe(false);
		const outside = join(dirname(ws), "escaped-tool.txt");
		expect(existsSync(outside)).toBe(false);
	});

	it("tool execute denies workdir that escapes session root", async () => {
		const { ws, siblingEvil } = makeWorkspace();
		setActiveSandbox(createSandbox({ mode: "workspace-write", workspaceRoot: ws }));
		guardianRuntime.setWorkspaceRoot(ws);

		const def = createApplyPatchToolDefinitionForCwd(ws);
		const patch = `*** Begin Patch
*** Add File: inside.txt
+x
*** End Patch`;
		const result = await def.execute("t3", { patch, workdir: siblingEvil } as any);
		expect((result.details as any)?.ok).toBe(false);
		expect(String((result.details as any)?.error || "")).toMatch(/workdir escapes|denied/i);
	});

	it("records deleted content so a settled turn can be reversed", async () => {
		const { ws } = makeWorkspace();
		setActiveSandbox(createSandbox({ mode: "workspace-write", workspaceRoot: ws }));
		guardianRuntime.setWorkspaceRoot(ws);
		guardianRuntime.setUiHandler(async () => "accept");
		turnDiffAggregator.beginTurn("apply-delete-undo-test");
		writeFileSync(join(ws, "deleted.txt"), "restore me\n", "utf8");

		const def = createApplyPatchToolDefinitionForCwd(ws);
		const result = await def.execute("t4", {
			patch: "*** Begin Patch\n*** Delete File: deleted.txt\n*** End Patch",
		} as any);
		const snapshot = turnDiffAggregator.snapshot();

		expect((result.details as any)?.ok).toBe(true);
		expect(existsSync(join(ws, "deleted.txt"))).toBe(false);
		expect(snapshot.files[0]).toMatchObject({ path: "deleted.txt", kind: "delete" });
		expect(snapshot.files[0]?.diff).toContain("-1 restore me");
	});
});
