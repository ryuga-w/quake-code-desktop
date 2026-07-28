import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { McpConnectionManager } from "../src/server/mcp/manager";
import type { McpServerConfig } from "../src/server/mcp/types";

const fixture: McpServerConfig = {
  version: 1,
  id: "fixture",
  name: "Fixture",
  transport: "stdio",
  command: process.execPath,
  args: [resolve("test/fixtures/mcp-stdio-server.mjs")],
  enabled: true,
  autoStart: false,
  timeoutMs: 10_000,
  toolPolicy: { default: "allow" },
  reconnect: { enabled: false, maxAttempts: 0, baseDelayMs: 1_000 },
};

describe("MCP connection manager", () => {
  it("connects, discovers capabilities, calls a tool, and disconnects", async () => {
    const manager = new McpConnectionManager();
    await manager.reconcile([fixture]);
    const connected = await manager.connect(fixture.id);
    expect(connected.status).toBe("connected");
    expect(connected.tools[0]?.qualifiedName).toBe("mcp__fixture__echo");
    expect(connected.prompts[0]?.name).toBe("hello");
    expect(connected.resources[0]?.uri).toBe("fixture://readme");

    const result: any = await manager.callTool(fixture.id, "echo", { text: "works" });
    expect(result.content[0].text).toBe("echo:works");
    const resource: any = await manager.readResource(fixture.id, "fixture://readme");
    expect(resource.contents[0].text).toBe("fixture resource");
    const prompt: any = await manager.getPrompt(fixture.id, "hello");
    expect(prompt.messages[0].content.text).toBe("Hello from fixture");

    await manager.disconnect(fixture.id);
    expect(manager.get(fixture.id)?.snapshot.status).toBe("disconnected");
    await manager.dispose();
  }, 20_000);
});
