import { describe, expect, it } from "vitest";
import {
	resolveDefaultAgentIsolation,
	resolveSpawnIsolation,
} from "./codex-parity.js";

describe("Codex-style agent isolation defaults", () => {
	it("defaults to worktree when env unset", () => {
		expect(resolveDefaultAgentIsolation({})).toBe("worktree");
	});

	it("honors QUAKE_CODE_AGENT_ISOLATION=none", () => {
		expect(resolveDefaultAgentIsolation({ QUAKE_CODE_AGENT_ISOLATION: "none" })).toBe("none");
		expect(resolveDefaultAgentIsolation({ QUAKE_CODE_AGENT_ISOLATION: "off" })).toBe("none");
	});

	it("explicit param beats agent config and env", () => {
		expect(
			resolveSpawnIsolation({
				explicit: "none",
				agentIsolation: "worktree",
			}),
		).toBe("none");
		expect(
			resolveSpawnIsolation({
				explicit: "worktree",
				agentIsolation: undefined,
			}),
		).toBe("worktree");
	});

	it("agent config worktree is used when param omitted", () => {
		expect(
			resolveSpawnIsolation({
				explicit: undefined,
				agentIsolation: "worktree",
			}),
		).toBe("worktree");
	});
});
