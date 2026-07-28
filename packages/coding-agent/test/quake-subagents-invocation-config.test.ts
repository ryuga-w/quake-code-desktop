import { describe, expect, it } from "vitest";
import { resolveAgentInvocationConfig } from "../src/bundled/extensions/quake-subagents/invocation-config.js";
import type { AgentConfig } from "../src/bundled/extensions/quake-subagents/types.js";

const agentConfig: AgentConfig = {
	name: "Explore",
	description: "Fast codebase exploration agent",
	model: "anthropic/claude-haiku-4-5-20251001",
	thinking: "low",
	maxTurns: 3,
	inheritContext: false,
	runInBackground: false,
	isolated: false,
	isolation: undefined,
	extensions: true,
	skills: true,
	promptMode: "replace",
};

describe("quake subagents invocation config", () => {
	it("lets explicit tool-call params override agent defaults", () => {
		const resolved = resolveAgentInvocationConfig(agentConfig, {
			model: "openai/gpt-5.5",
			thinking: "high",
			max_turns: 10,
			run_in_background: true,
			inherit_context: true,
			isolated: true,
			isolation: "worktree",
		});

		expect(resolved.modelInput).toBe("openai/gpt-5.5");
		expect(resolved.modelFromParams).toBe(true);
		expect(resolved.thinking).toBe("high");
		expect(resolved.maxTurns).toBe(10);
		expect(resolved.runInBackground).toBe(true);
		expect(resolved.inheritContext).toBe(true);
		expect(resolved.isolated).toBe(true);
		expect(resolved.isolation).toBe("worktree");
	});

	it("lets explicit false booleans override truthy agent defaults", () => {
		const resolved = resolveAgentInvocationConfig(
			{
				...agentConfig,
				runInBackground: true,
				inheritContext: true,
				isolated: true,
				isolation: "worktree",
			},
			{
				run_in_background: false,
				inherit_context: false,
				isolated: false,
			},
		);

		expect(resolved.runInBackground).toBe(false);
		expect(resolved.inheritContext).toBe(false);
		expect(resolved.isolated).toBe(false);
		expect(resolved.isolation).toBe("worktree");
	});

	it("uses agent defaults when params are omitted", () => {
		const resolved = resolveAgentInvocationConfig(agentConfig, {});

		expect(resolved.modelInput).toBe("anthropic/claude-haiku-4-5-20251001");
		expect(resolved.modelFromParams).toBe(false);
		expect(resolved.thinking).toBe("low");
		expect(resolved.maxTurns).toBe(3);
		expect(resolved.runInBackground).toBe(false);
	});
});
