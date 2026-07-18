import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSandbox } from "./policy.js";

describe("sandbox policy", () => {
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

	it("workspace-write allows in-root writes", () => {
		const root = mkdtempSync(join(tmpdir(), "quake-sb-"));
		dirs.push(root);
		const sb = createSandbox({ mode: "workspace-write", workspaceRoot: root });
		expect(sb.checkWritePath("src/a.ts").allowed).toBe(true);
		expect(sb.checkWritePath("C:\\Windows\\System32\\x").allowed).toBe(false);
	});

	it("read-only requires approval for shell (prompt, not hard forbid)", () => {
		const root = mkdtempSync(join(tmpdir(), "quake-sb-"));
		dirs.push(root);
		const sb = createSandbox({ mode: "read-only", workspaceRoot: root });
		const check = sb.checkCommand("ls");
		expect(check.allowed).toBe(false);
		expect(check.decision).toBe("prompt");
	});

	it("blocks forbidden exec", () => {
		const root = mkdtempSync(join(tmpdir(), "quake-sb-"));
		dirs.push(root);
		const sb = createSandbox({ mode: "workspace-write", workspaceRoot: root });
		expect(sb.checkCommand("rm -rf /").allowed).toBe(false);
	});
});
