import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentManager } from "../src/bundled/extensions/quake-subagents/agent-manager.js";
import subagentsExtension from "../src/bundled/extensions/quake-subagents/index.js";
import { runWithSubagentRuntimeScope } from "../src/bundled/extensions/quake-subagents/runtime-scope.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("quake-subagents extension surface", () => {
	it("exposes only the Codex V1 lifecycle tools by default", async () => {
		vi.stubEnv("QUAKE_CODE_LEGACY_SUBAGENT_TOOLS", "0");
		vi.stubEnv("QUAKE_CODE_SPAWN_CSV", "0");
		const manager = new AgentManager();
		const tools: string[] = [];
		const api = {
			registerMessageRenderer: vi.fn(),
			registerTool: (tool: { name: string }) => tools.push(tool.name),
			registerCommand: vi.fn(),
			on: vi.fn(),
			appendEntry: vi.fn(),
			sendMessage: vi.fn(),
			events: {
				emit: vi.fn(),
			},
		} as any;

		await runWithSubagentRuntimeScope(
			{
				manager,
				currentAgentId: randomUUID(),
				currentAgentPath: "/root",
				depth: 0,
				multiAgentVersion: "v1",
				maxDepth: 1,
			},
			async () => {
				subagentsExtension(api);
			},
		);

		expect(tools).toEqual(["spawn_agent", "send_input", "wait_agent", "close_agent", "resume_agent"]);
		manager.dispose();
	});
});
