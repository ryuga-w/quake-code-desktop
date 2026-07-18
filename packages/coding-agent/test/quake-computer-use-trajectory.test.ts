import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendTrajectoryStep,
	createSessionId,
	endTrajectorySession,
	logToolStep,
	readTrajectorySteps,
	startTrajectorySession,
} from "../src/bundled/extensions/quake-computer-use/trajectory.js";

let tempDirs: string[] = [];

function tempCwd(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quake-computer-use-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

describe("quake-computer-use trajectory", () => {
	it("creates session id with cu- prefix", () => {
		expect(createSessionId()).toMatch(/^cu-/);
	});

	it("logs session start, tool steps, and session end", () => {
		const cwd = tempCwd();
		const sessionId = "cu-test-session";
		startTrajectorySession(cwd, sessionId);

		logToolStep({
			cwd,
			sessionId,
			kind: "screenshot",
			tool: "desktop_screenshot",
			ok: true,
			detail: { width: 1280, height: 800 },
		});

		const ended = endTrajectorySession(cwd, sessionId);
		expect(ended?.endedAt).toBeTruthy();
		expect(ended?.stepCount).toBeGreaterThanOrEqual(2);

		const steps = readTrajectorySteps(cwd, sessionId);
		expect(steps.some((s) => s.kind === "session_start")).toBe(true);
		expect(steps.some((s) => s.kind === "screenshot" && s.tool === "desktop_screenshot")).toBe(true);
		expect(steps.some((s) => s.kind === "session_end")).toBe(true);
	});

	it("appends standalone trajectory steps", () => {
		const cwd = tempCwd();
		const sessionId = "cu-append";
		startTrajectorySession(cwd, sessionId);
		appendTrajectoryStep(cwd, {
			at: new Date().toISOString(),
			sessionId,
			kind: "error",
			ok: false,
			error: "bridge_down",
		});
		const steps = readTrajectorySteps(cwd, sessionId);
		expect(steps.some((s) => s.kind === "error" && s.error === "bridge_down")).toBe(true);
	});
});