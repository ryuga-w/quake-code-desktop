import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertComputerUseToolAllowed,
	loadComputerUsePolicy,
	resetStepCount,
	saveComputerUsePolicy,
} from "../src/bundled/extensions/quake-computer-use/policy.js";

let tempDirs: string[] = [];

function tempCwd(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quake-computer-use-policy-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

describe("quake-computer-use policy", () => {
	it("defaults to read-only actuate disabled", () => {
		const cwd = tempCwd();
		const policy = loadComputerUsePolicy(cwd);
		expect(policy.actuateEnabled).toBe(false);
		expect(policy.stepLimit).toBe(40);
	});

	it("allows list_windows without actuate", () => {
		const cwd = tempCwd();
		resetStepCount(cwd);
		expect(() => assertComputerUseToolAllowed(cwd, "desktop_list_windows")).not.toThrow();
	});

	it("blocks actuate tools until enabled", () => {
		const cwd = tempCwd();
		resetStepCount(cwd);
		expect(() => assertComputerUseToolAllowed(cwd, "desktop_click")).toThrow(/Masaüstü etkileşim araçları kapalı/);
	});

	it("allows actuate tools when enabled", () => {
		const cwd = tempCwd();
		resetStepCount(cwd);
		saveComputerUsePolicy(cwd, { actuateEnabled: true });
		expect(() => assertComputerUseToolAllowed(cwd, "desktop_click")).not.toThrow();
	});

	it("enforces step limit", () => {
		const cwd = tempCwd();
		resetStepCount(cwd);
		saveComputerUsePolicy(cwd, { stepLimit: 2 });
		assertComputerUseToolAllowed(cwd, "desktop_screenshot");
		assertComputerUseToolAllowed(cwd, "desktop_screenshot");
		expect(() => assertComputerUseToolAllowed(cwd, "desktop_screenshot")).toThrow(/adım limiti/);
	});
});