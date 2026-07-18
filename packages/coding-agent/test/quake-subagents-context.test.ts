import { describe, expect, it } from "vitest";
import { getParentThinkingLevel, seedForkedSession } from "../src/bundled/extensions/quake-subagents/context.js";
import { SessionManager } from "../src/core/session-manager.js";

describe("Codex-style forked context", () => {
	it("keeps user and assistant text while dropping tool results and tool calls", () => {
		const parent = SessionManager.inMemory("C:/workspace");
		parent.appendThinkingLevelChange("high");
		parent.appendMessage({
			role: "user",
			content: [{ type: "text", text: "inspect auth" }],
			timestamp: 1,
		});
		parent.appendMessage({
			role: "assistant",
			content: [
				{ type: "text", text: "I found the entrypoint." },
				{ type: "toolCall", id: "call-1", name: "read", arguments: {} },
			],
			api: "openai-responses",
			provider: "openai",
			model: "gpt-test",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		} as any);
		parent.appendMessage({
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "read",
			content: [{ type: "text", text: "secret tool output" }],
			isError: false,
			timestamp: 3,
		});

		const child = SessionManager.inMemory("C:/workspace");
		const ctx = { sessionManager: parent } as any;
		seedForkedSession(ctx, child, "all");

		const messages = child.buildSessionContext().messages;
		expect(messages).toHaveLength(2);
		expect(messages[0]).toMatchObject({ role: "user" });
		expect(messages[1]).toMatchObject({
			role: "assistant",
			content: [{ type: "text", text: "I found the entrypoint." }],
		});
		expect(JSON.stringify(messages)).not.toContain("secret tool output");
		expect(getParentThinkingLevel(ctx)).toBe("high");
	});
});
