/**
 * Gating tests for MCP tool approval policy + buses (shipped entry points).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllMcpApprovals,
  isMcpToolApproved,
  rememberMcpToolApproval,
} from "../src/server/mcp/approval-cache.js";
import {
  clearPendingMcpToolApprovals,
  listPendingMcpToolApprovals,
  requestMcpToolApprovalUi,
  respondMcpToolApproval,
  setMcpToolApprovalEmitter,
  type McpToolApprovalRequestUi,
} from "../src/server/mcp/tool-approval-bus.js";
import {
  createMcpToolDefinition,
  enforceMcpToolPolicy,
  mcpToolNeedsApprovalPrompt,
  type McpToolApprovalDecision,
} from "../src/server/mcp/tool-adapter.js";
import type { McpToolSummary } from "../src/server/mcp/types.js";

function tool(partial: Partial<McpToolSummary> & Pick<McpToolSummary, "name" | "decision">): McpToolSummary {
  return {
    name: partial.name,
    qualifiedName: partial.qualifiedName || `mcp__test__${partial.name}`,
    title: partial.title || partial.name,
    description: partial.description || "test",
    inputSchema: { type: "object", properties: {} },
    decision: partial.decision,
    annotations: {
      readOnly: partial.annotations?.readOnly ?? false,
      destructive: partial.annotations?.destructive ?? false,
      idempotent: partial.annotations?.idempotent ?? false,
      openWorld: partial.annotations?.openWorld ?? false,
    },
  };
}

describe("mcpToolNeedsApprovalPrompt (Codex auto)", () => {
  it("allow + readOnly → no prompt", () => {
    expect(
      mcpToolNeedsApprovalPrompt(
        tool({ name: "read_thing", decision: "allow", annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false } }),
      ),
    ).toBe(false);
  });

  it("allow + destructive → prompt", () => {
    expect(
      mcpToolNeedsApprovalPrompt(
        tool({ name: "delete", decision: "allow", annotations: { readOnly: false, destructive: true, idempotent: false, openWorld: false } }),
      ),
    ).toBe(true);
  });

  it("allow + openWorld non-readOnly → prompt", () => {
    expect(
      mcpToolNeedsApprovalPrompt(
        tool({ name: "web", decision: "allow", annotations: { readOnly: false, destructive: false, idempotent: false, openWorld: true } }),
      ),
    ).toBe(true);
  });

  it("ask always prompts even if readOnly", () => {
    expect(
      mcpToolNeedsApprovalPrompt(
        tool({ name: "secret", decision: "ask", annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false } }),
      ),
    ).toBe(true);
  });
});

describe("enforceMcpToolPolicy", () => {
  beforeEach(() => {
    clearAllMcpApprovals();
  });

  afterEach(() => {
    clearAllMcpApprovals();
  });

  it("deny always blocks", async () => {
    const err = await enforceMcpToolPolicy(
      { mode: "agent" },
      "srv",
      tool({ name: "x", decision: "deny" }),
      {},
    );
    expect(err).toMatch(/engellendi/i);
  });

  it("plan mode rejects non-readOnly", async () => {
    const err = await enforceMcpToolPolicy(
      { mode: "plan" },
      "srv",
      tool({ name: "write", decision: "allow", annotations: { readOnly: false, destructive: true, idempotent: false, openWorld: false } }),
      {},
    );
    expect(err).toMatch(/Plan Mode/i);
  });

  it("plan mode allows readOnly", async () => {
    const err = await enforceMcpToolPolicy(
      { mode: "plan" },
      "srv",
      tool({ name: "read", decision: "allow", annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false } }),
      {},
    );
    expect(err).toBeUndefined();
  });

  it("readOnly allow auto without requestApproval", async () => {
    const err = await enforceMcpToolPolicy(
      { mode: "agent" },
      "srv",
      tool({ name: "get", decision: "allow", annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false } }),
      {},
    );
    expect(err).toBeUndefined();
  });

  it("destructive allow prompts; accept runs once", async () => {
    const calls: string[] = [];
    const err = await enforceMcpToolPolicy(
      {
        mode: "agent",
        requestApproval: async () => {
          calls.push("prompt");
          return "accept";
        },
      },
      "srv",
      tool({ name: "del", decision: "allow", annotations: { readOnly: false, destructive: true, idempotent: false, openWorld: false } }),
      { id: 1 },
    );
    expect(err).toBeUndefined();
    expect(calls).toEqual(["prompt"]);
    expect(isMcpToolApproved("srv", "del")).toBe(false); // accept does not remember
  });

  it("acceptForSession skips second prompt", async () => {
    let prompts = 0;
    const t = tool({ name: "write", decision: "allow", annotations: { readOnly: false, destructive: true, idempotent: false, openWorld: false } });
    const ctx = {
      mode: "agent" as const,
      requestApproval: async () => {
        prompts += 1;
        return "acceptForSession" as McpToolApprovalDecision;
      },
    };
    expect(await enforceMcpToolPolicy(ctx, "srv", t, {})).toBeUndefined();
    expect(prompts).toBe(1);
    expect(isMcpToolApproved("srv", "write")).toBe(true);

    // second call should not prompt
    const ctx2 = {
      mode: "agent" as const,
      requestApproval: async () => {
        prompts += 1;
        return "decline" as McpToolApprovalDecision;
      },
    };
    expect(await enforceMcpToolPolicy(ctx2, "srv", t, {})).toBeUndefined();
    expect(prompts).toBe(1);
  });

  it("acceptAlways skips later prompts", async () => {
    clearAllMcpApprovals();
    rememberMcpToolApproval("srv", "always_tool", "always");
    let prompts = 0;
    const err = await enforceMcpToolPolicy(
      {
        mode: "agent",
        requestApproval: async () => {
          prompts += 1;
          return "decline";
        },
      },
      "srv",
      tool({ name: "always_tool", decision: "ask", annotations: { readOnly: false, destructive: true, idempotent: false, openWorld: true } }),
      {},
    );
    expect(err).toBeUndefined();
    expect(prompts).toBe(0);
  });

  it("decline blocks with clear denial", async () => {
    const err = await enforceMcpToolPolicy(
      {
        mode: "agent",
        requestApproval: async () => "decline",
      },
      "srv",
      tool({ name: "x", decision: "ask", annotations: { readOnly: false, destructive: false, idempotent: false, openWorld: false } }),
      {},
    );
    expect(err).toMatch(/reddetti/i);
  });

  it("cancel blocks with cancel message", async () => {
    const err = await enforceMcpToolPolicy(
      {
        mode: "agent",
        requestApproval: async () => "cancel",
      },
      "srv",
      tool({ name: "x", decision: "ask" }),
      {},
    );
    expect(err).toMatch(/iptal/i);
  });
});

describe("createMcpToolDefinition execute path", () => {
  beforeEach(() => {
    clearAllMcpApprovals();
  });

  afterEach(() => {
    clearAllMcpApprovals();
  });

  it("calls manager.callTool after accept; does not call after decline", async () => {
    const calls: unknown[] = [];
    const manager = {
      callTool: async (_sid: string, name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { content: [{ type: "text", text: "ok" }] };
      },
    } as any;

    const def = createMcpToolDefinition(
      manager,
      "srv",
      tool({ name: "mutate", decision: "ask", annotations: { readOnly: false, destructive: true, idempotent: false, openWorld: true } }),
      () => ({
        mode: "agent",
        requestApproval: async () => "decline" as McpToolApprovalDecision,
      }),
    );

    const denied = await (def as any).execute("tc1", { a: 1 });
    expect(denied.isError).toBe(true);
    expect(String(denied.content?.[0]?.text || "")).toMatch(/reddetti/i);
    expect(calls).toHaveLength(0);

    const def2 = createMcpToolDefinition(
      manager,
      "srv",
      tool({ name: "mutate", decision: "ask", annotations: { readOnly: false, destructive: true, idempotent: false, openWorld: true } }),
      () => ({
        mode: "agent",
        requestApproval: async () => "accept" as McpToolApprovalDecision,
      }),
    );
    const ok = await (def2 as any).execute("tc2", { a: 2 });
    expect(ok.isError).toBeFalsy();
    expect(calls).toEqual([{ name: "mutate", args: { a: 2 } }]);
  });
});

describe("MCP tool-approval bus", () => {
  let emitted: McpToolApprovalRequestUi[] = [];

  beforeEach(() => {
    clearPendingMcpToolApprovals();
    emitted = [];
    setMcpToolApprovalEmitter({ emit: (req) => emitted.push(req) });
  });

  afterEach(() => {
    clearPendingMcpToolApprovals();
    setMcpToolApprovalEmitter(undefined);
  });

  it("emit + respond accept", async () => {
    const t = tool({ name: "x", decision: "ask" });
    const pending = requestMcpToolApprovalUi({
      serverId: "s",
      tool: t,
      params: { q: 1 },
      reason: "test",
      risk: "high",
      timeoutMs: 5_000,
    });
    expect(emitted).toHaveLength(1);
    expect(listPendingMcpToolApprovals()).toHaveLength(1);
    expect(respondMcpToolApproval(emitted[0].id, "accept")).toBe(true);
    await expect(pending).resolves.toBe("accept");
  });

  it("timeout declines without hang", async () => {
    vi.useFakeTimers();
    try {
      const pending = requestMcpToolApprovalUi({
        serverId: "s",
        tool: tool({ name: "x", decision: "ask" }),
        params: {},
        reason: "t",
        risk: "medium",
        timeoutMs: 40,
      });
      await vi.advanceTimersByTimeAsync(50);
      await expect(pending).resolves.toBe("decline");
    } finally {
      vi.useRealTimers();
    }
  });
});
