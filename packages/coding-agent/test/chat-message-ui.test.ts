import type { AssistantMessage, Message } from "@mrquake/quakecode-ai";
import { visibleWidth } from "@mrquake/quakecode-tui";
import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, it } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.js";
import {
	buildUserRenderablePartsFromMessage,
	UserMessageComponent,
} from "../src/modes/interactive/components/user-message.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function expectWithinWidth(lines: string[], width: number): void {
	for (let i = 0; i < lines.length; i++) {
		expect(visibleWidth(lines[i]), `line ${i}: ${stripAnsi(lines[i])}`).toBeLessThanOrEqual(width);
	}
}

describe("chat message UI rendering", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("renders completed assistant text without decorative rails", () => {
		const message = {
			role: "assistant",
			content: [
				{ type: "text", text: "First assistant paragraph with enough words to wrap in narrow terminals." },
				{ type: "text", text: "Second assistant paragraph keeps the same visual rail." },
			],
			stopReason: "stop",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
		} as unknown as AssistantMessage;

		const component = new AssistantMessageComponent(message);
		const lines = component.render(44);
		const plain = stripAnsi(lines.join("\n"));

		expect(plain).toContain("First assistant paragraph");
		expect(plain).toContain("Second assistant paragraph");
		expect(plain).not.toContain("✦");
		expect(plain).not.toContain("│");
		expect(lines.map((line) => stripAnsi(line))).toContain("");
		expectWithinWidth(lines, 44);
	});

	it("honors hidden thinking labels while streaming", () => {
		const message = {
			role: "assistant",
			content: [{ type: "thinking", thinking: "private reasoning", redacted: false }],
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
		} as unknown as AssistantMessage;

		const component = new AssistantMessageComponent(message, true, undefined, "Thinking hidden");
		const rendered = stripAnsi(component.render(80).join("\n"));

		expect(rendered).toContain("thinking");
		expect(rendered).toContain("Thinking hidden");
		expect(rendered).not.toContain("private reasoning");
		expect(rendered).not.toContain("◇");
	});

	it("renders visible thinking with animated gutter while streaming", () => {
		const message = {
			role: "assistant",
			content: [{ type: "thinking", thinking: "checking constraints", redacted: false }],
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
		} as unknown as AssistantMessage;

		const component = new AssistantMessageComponent(message, false);
		const rendered = stripAnsi(component.render(80).join("\n"));

		expect(rendered).toContain("reasoning");
		expect(rendered).toContain("checking constraints");
		expect(rendered).not.toContain("◇");
	});

	it("renders assistant errors as status lines", () => {
		const message = {
			role: "assistant",
			content: [],
			stopReason: "error",
			errorMessage: "Provider unavailable",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
		} as unknown as AssistantMessage;

		const component = new AssistantMessageComponent(message);
		const lines = component.render(60);
		const rendered = stripAnsi(lines.join("\n"));

		expect(rendered).toContain("!  error · Provider unavailable");
		expectWithinWidth(lines, 60);
	});

	it("renders assistant aborts as status lines", () => {
		const message = {
			role: "assistant",
			content: [],
			stopReason: "aborted",
			errorMessage: "User cancelled",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
		} as unknown as AssistantMessage;

		const component = new AssistantMessageComponent(message);
		const lines = component.render(60);
		const rendered = stripAnsi(lines.join("\n"));

		expect(rendered).toContain("x  aborted · User cancelled");
		expectWithinWidth(lines, 60);
	});

	it("renders user messages as a full-width bar with prefix and timestamp", () => {
		const message = {
			role: "user",
			content: "yap deneyelim bi",
			timestamp: new Date("2026-06-25T10:13:00").getTime(),
		} as Message;
		const parts = buildUserRenderablePartsFromMessage(message);
		const component = new UserMessageComponent(parts, {
			showRoleLabel: false,
			timestamp: message.timestamp,
		});
		const lines = component.render(60);
		const plain = stripAnsi(lines.join("\n"));

		expect(lines[0]).toContain("\x1b]133;A\x07");
		expect(lines[lines.length - 2]).toContain("\x1b]133;B\x07\x1b]133;C\x07");
		expect(lines[lines.length - 1]).toBe("");
		expect(plain).toContain("› yap deneyelim bi");
		expect(plain).toContain("10:13 AM");
		expect(plain).not.toContain("you");
		expect(plain).not.toContain("◆");
		expectWithinWidth(lines, 60);
	});
});
