/**
 * Gating tests for MCP elicitation bus (shipped code path).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingMcpElicitations,
  listPendingMcpElicitations,
  requestMcpElicitation,
  respondMcpElicitation,
  setMcpElicitationEmitter,
  type McpElicitationRequestUi,
} from "../src/server/mcp/elicitation-bus.js";

describe("MCP elicitation bus", () => {
  let emitted: McpElicitationRequestUi[] = [];

  beforeEach(() => {
    clearPendingMcpElicitations();
    emitted = [];
    setMcpElicitationEmitter({
      emit: (req) => {
        emitted.push(req);
      },
    });
  });

  afterEach(() => {
    clearPendingMcpElicitations();
    setMcpElicitationEmitter(undefined);
  });

  it("emits form elicitation and resolves accept with field content", async () => {
    const pending = requestMcpElicitation({
      serverId: "srv1",
      serverName: "Test Server",
      params: {
        mode: "form",
        message: "Confirm delete?",
        requestedSchema: {
          type: "object",
          required: ["confirm"],
          properties: {
            confirm: { type: "boolean", title: "Confirm", default: false },
            note: { type: "string", title: "Note" },
          },
        },
      },
      timeoutMs: 5_000,
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].message).toBe("Confirm delete?");
    expect(emitted[0].fields.some((f) => f.name === "confirm" && f.required)).toBe(true);
    expect(listPendingMcpElicitations()).toHaveLength(1);

    const id = emitted[0].id;
    expect(respondMcpElicitation(id, { action: "accept", content: { confirm: true, note: "ok" } })).toBe(true);

    const result = await pending;
    expect(result.action).toBe("accept");
    expect(result.content).toEqual({ confirm: true, note: "ok" });
    expect(listPendingMcpElicitations()).toHaveLength(0);
  });

  it("resolves decline without content", async () => {
    const pending = requestMcpElicitation({
      serverId: "srv1",
      serverName: "S",
      params: { message: "Need input", mode: "form", requestedSchema: { type: "object", properties: {} } },
      timeoutMs: 5_000,
    });
    const id = emitted[0].id;
    expect(respondMcpElicitation(id, { action: "decline" })).toBe(true);
    await expect(pending).resolves.toEqual({ action: "decline" });
  });

  it("resolves cancel", async () => {
    const pending = requestMcpElicitation({
      serverId: "srv1",
      serverName: "S",
      params: { message: "x", mode: "form" },
      timeoutMs: 5_000,
    });
    respondMcpElicitation(emitted[0].id, { action: "cancel" });
    await expect(pending).resolves.toEqual({ action: "cancel" });
  });

  it("timeout without respond cancels (does not hang)", async () => {
    vi.useFakeTimers();
    try {
      const pending = requestMcpElicitation({
        serverId: "srv1",
        serverName: "S",
        params: { message: "wait", mode: "form" },
        timeoutMs: 50,
      });
      expect(listPendingMcpElicitations()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(60);
      await expect(pending).resolves.toEqual({ action: "cancel" });
      expect(listPendingMcpElicitations()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("url mode exposes url and empty fields", async () => {
    const pending = requestMcpElicitation({
      serverId: "srv1",
      serverName: "Auth",
      params: {
        mode: "url",
        message: "Login required",
        url: "https://example.com/oauth",
        elicitationId: "el-1",
      },
      timeoutMs: 5_000,
    });
    expect(emitted[0].mode).toBe("url");
    expect(emitted[0].url).toBe("https://example.com/oauth");
    expect(emitted[0].fields).toEqual([]);
    expect(emitted[0].elicitationId).toBe("el-1");
    respondMcpElicitation(emitted[0].id, { action: "accept", content: {} });
    await expect(pending).resolves.toMatchObject({ action: "accept" });
  });

  it("respond with unknown id returns false", () => {
    expect(respondMcpElicitation("missing", { action: "accept" })).toBe(false);
  });
});
