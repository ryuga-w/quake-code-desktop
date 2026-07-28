import { describe, expect, it } from "vitest";
import { isSafeCommand } from "../src/bundled/extensions/plan-mode/utils.js";

describe("Plan mode command policy", () => {
	it("allows read-only inspection commands", () => {
		expect(isSafeCommand("git status")).toBe(true);
		expect(isSafeCommand("sed -n '1,20p' file.ts")).toBe(true);
		expect(isSafeCommand("npm run typecheck")).toBe(true);
	});

	it("allows quoted, chained, and piped read-only inspection commands", () => {
		expect(isSafeCommand("printf '%s\\n' '--- files ---'; cat package.json; sed -n '1,40p' tsconfig.json")).toBe(true);
		expect(isSafeCommand("rg --files -g '!node_modules' | sed -n '1,160p'")).toBe(true);
		expect(isSafeCommand("cat package.json && head -n 20 tsconfig.json")).toBe(true);
		expect(isSafeCommand("printf '%s; %s | %s\\n' 'quoted' 'shell' 'syntax'")).toBe(true);
		expect(isSafeCommand("Get-Content package.json | Select-String scripts")).toBe(true);
		expect(
			isSafeCommand(
				"find src -type f \\( -name '*.ts' -o -name '*.tsx' \\) -print0 | xargs -0 wc -l | sort -nr | sed -n '1,80p'",
			),
		).toBe(true);
	});

	it("blocks mutating or executable compound commands", () => {
		expect(isSafeCommand("rm -rf .")).toBe(false);
		expect(isSafeCommand("npm install")).toBe(false);
		expect(isSafeCommand("cat file | sh")).toBe(false);
		expect(isSafeCommand("cat file; rm -rf .")).toBe(false);
		expect(isSafeCommand("cat file && npm install")).toBe(false);
		expect(isSafeCommand("cat file | xargs rm")).toBe(false);
		expect(isSafeCommand("cat file; node mutate.js")).toBe(false);
		expect(isSafeCommand("cat $(touch changed.txt)")).toBe(false);
		expect(isSafeCommand("cat file & touch changed.txt")).toBe(false);
		expect(isSafeCommand("printf changed > file.txt")).toBe(false);
		expect(isSafeCommand("find . -exec echo {} \\;")).toBe(false);
		expect(isSafeCommand("printf 'unterminated")).toBe(false);
	});
});
