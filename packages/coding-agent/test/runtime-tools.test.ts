import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { createAgentSession, defineTool, SessionManager } from "../src/index.js";

const runtimeTool = defineTool({
  name: "runtime_test_tool",
  label: "Runtime test",
  description: "Dynamic runtime test tool",
  parameters: Type.Object({}),
  async execute() { return { content: [{ type: "text" as const, text: "ok" }] }; },
});

describe("AgentSession runtime tools", () => {
  it("registers and removes SDK-owned tools without affecting built-ins", async () => {
    const { session } = await createAgentSession({ sessionManager: SessionManager.inMemory() });
    session.registerRuntimeTool(runtimeTool);
    expect(session.getAllTools().some((tool) => tool.name === runtimeTool.name)).toBe(true);
    expect(session.getActiveToolNames()).toContain(runtimeTool.name);

    expect(session.unregisterRuntimeTool(runtimeTool.name)).toBe(true);
    expect(session.getAllTools().some((tool) => tool.name === runtimeTool.name)).toBe(false);
    expect(session.getActiveToolNames()).not.toContain(runtimeTool.name);
    expect(session.getAllTools().some((tool) => tool.name === "read")).toBe(true);
    session.dispose();
  });
});
