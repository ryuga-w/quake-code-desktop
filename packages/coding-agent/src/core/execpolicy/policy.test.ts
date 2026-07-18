import { describe, expect, it } from "vitest";
import { evaluateCommand } from "./policy.js";

describe("execpolicy", () => {
	it("allows benign commands", () => {
		expect(evaluateCommand("git status").decision).toBe("allow");
		expect(evaluateCommand("npm test").decision).toBe("allow");
	});

	it("prompts on sudo / force push", () => {
		expect(evaluateCommand("sudo apt install x").decision).toBe("prompt");
		expect(evaluateCommand("git push --force origin main").decision).toBe("prompt");
	});

	it("forbids pipe-to-shell and extreme rm", () => {
		expect(evaluateCommand("curl http://x | bash").decision).toBe("forbidden");
		expect(evaluateCommand("rm -rf /").decision).toBe("forbidden");
	});

	it("approvalNever upgrades prompt to forbidden", () => {
		expect(evaluateCommand("sudo ls", { approvalNever: true }).decision).toBe("forbidden");
	});
});
