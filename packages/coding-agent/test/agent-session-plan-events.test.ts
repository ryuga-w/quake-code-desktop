import { describe, expect, it, vi } from "vitest";
import { AgentSession } from "../src/core/agent-session.js";

function assistant(text: string) {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	} as any;
}

describe("AgentSession proposed plan events", () => {
	it("separates proposed plan text from assistant display events", () => {
		const emitted: any[] = [];
		const appendCustomEntry = vi.fn();
		const session = Object.create(AgentSession.prototype) as any;
		session._collaborationMode = "plan";
		session._turnIndex = 0;
		session._eventListeners = [(event: any) => emitted.push(event)];
		session.sessionManager = {
			getSessionId: () => "thread-1",
			appendCustomEntry,
		};

		expect(
			session._planDisplayEvents({
				type: "message_start",
				message: assistant(""),
			}),
		).toEqual([]);

		const streamed = assistant("<proposed_plan>\n- step\n</proposed_plan>\n");
		expect(
			session._planDisplayEvents({
				type: "message_update",
				message: streamed,
				assistantMessageEvent: {
					type: "text_delta",
					contentIndex: 0,
					delta: "<proposed_plan>\n- step\n</proposed_plan>\n",
					partial: streamed,
				},
			}),
		).toEqual([]);

		expect(emitted.map((event) => event.type)).toEqual([
			"item/started",
			"item/plan/delta",
		]);

		expect(
			session._planDisplayEvents({
				type: "message_end",
				message: streamed,
			}),
		).toEqual([]);

		expect(emitted.at(-1)).toMatchObject({
			type: "item/completed",
			item: { type: "plan", text: "- step\n" },
		});
		expect(appendCustomEntry).toHaveBeenCalledWith(
			"plan-item",
			expect.objectContaining({ text: "- step\n" }),
		);
	});
});
