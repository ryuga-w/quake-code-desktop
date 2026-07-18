import { describe, expect, it } from "vitest";
import { ChatPhaseTracker, getToolActivity } from "../src/modes/interactive/chat-phase.js";

describe("chat phase tracker", () => {
	it("classifies source inspection tools into operator-friendly phases", () => {
		expect(getToolActivity("read", { path: "src/index.ts" })).toMatchObject({
			phase: "reading",
			label: "Reading source",
			detail: "src/index.ts",
		});

		expect(getToolActivity("grep", { pattern: "SessionInfo" })).toMatchObject({
			phase: "searching",
			label: "Searching code",
			detail: "SessionInfo",
		});
	});

	it("distinguishes verification bash commands from inspection bash commands", () => {
		expect(getToolActivity("bash", { command: "npm run build" })).toMatchObject({
			phase: "verifying",
			label: "Verifying changes",
		});

		expect(getToolActivity("bash", { command: "git status --short" })).toMatchObject({
			phase: "inspecting",
			label: "Inspecting workspace",
		});
	});

	it("tracks queue size and response lifecycle", () => {
		const tracker = new ChatPhaseTracker();
		tracker.markSubmitting("please inspect the bug and patch it");
		expect(tracker.getState()).toMatchObject({
			phase: "submitting",
			label: "Submitting instruction",
		});

		tracker.applyEvent({ type: "queue_update", steering: ["one"], followUp: ["two"] });
		expect(tracker.getState().queueCount).toBe(2);

		tracker.applyEvent({ type: "agent_start" } as any);
		expect(tracker.getState()).toMatchObject({
			phase: "planning",
			label: "Planning next step",
		});

		tracker.applyEvent({
			type: "tool_execution_start",
			toolName: "edit",
			toolCallId: "tool-1",
			args: { path: "src/app.ts" },
		} as any);
		expect(tracker.getState()).toMatchObject({
			phase: "applying_changes",
			label: "Preparing targeted change",
			detail: "src/app.ts",
			queueCount: 2,
		});

		tracker.applyEvent({
			type: "message_end",
			message: {
				role: "assistant",
				stopReason: "endTurn",
				content: [],
			},
		} as any);
		expect(tracker.getState()).toMatchObject({
			phase: "done",
			label: "Response ready",
			queueCount: 2,
		});
	});
});
