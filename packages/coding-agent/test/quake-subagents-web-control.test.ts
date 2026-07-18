import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerSubagentWebControl,
  SUBAGENT_WEB_CONTROLS_KEY,
  type SubagentWebControl,
} from "../src/bundled/extensions/quake-subagents/web-control.js";

const sessionId = "root-session-web-control";

afterEach(() => {
  const registry = (globalThis as any)[SUBAGENT_WEB_CONTROLS_KEY] as Map<string, SubagentWebControl> | undefined;
  registry?.delete(sessionId);
});

function fakeRecord() {
  const messages = [
    { role: "user", content: [{ type: "text", text: "parent message" }], timestamp: 100 },
    { role: "assistant", content: [{ type: "text", text: "parent answer" }], timestamp: 200 },
    { role: "user", content: [{ type: "text", text: "child task" }], timestamp: 1_010 },
    { role: "assistant", content: [{ type: "text", text: "child result" }], timestamp: 1_100 },
  ];
  const branch = messages.map((message, index) => ({
    type: "message",
    id: `m${index}`,
    timestamp: new Date(message.timestamp).toISOString(),
    message,
  }));
  return {
    id: "agent-1",
    name: "Gödel",
    type: "default",
    description: "child task",
    status: "completed",
    taskName: "agent-1",
    taskPath: "/root/agent-1",
    depth: 1,
    lastTaskMessage: "child task",
    result: "child result",
    toolUses: 2,
    createdAt: 1_000,
    startedAt: 1_000,
    completedAt: 1_200,
    sessionFile: "C:/tmp/agent-1.jsonl",
    session: {
      sessionManager: { getBranch: () => branch },
      getSessionStats: () => ({ tokens: { total: 321 } }),
      model: { provider: "test", id: "model", name: "Model" },
      thinkingLevel: "medium",
      isStreaming: false,
      agent: { state: {} },
    },
  } as any;
}

describe("subagent web control", () => {
  it("projects only the child thread and routes message/abort actions", async () => {
    const record = fakeRecord();
    const manager = {
      listAgents: vi.fn(() => [record]),
      getRecord: vi.fn((id: string) => id === record.id ? record : undefined),
      sendInputById: vi.fn(async () => ({ submissionId: "submission-1", record })),
      abort: vi.fn(() => true),
      reserveCodexNickname: vi.fn(() => "Gödel"),
      spawn: vi.fn(() => record.id),
    } as any;
    const unregister = registerSubagentWebControl({
      sessionId,
      quake: {} as any,
      manager,
      getContext: () => undefined,
    });
    const registry = (globalThis as any)[SUBAGENT_WEB_CONTROLS_KEY] as Map<string, SubagentWebControl>;
    const control = registry.get(sessionId)!;

    expect(control.list()).toMatchObject([{ id: "agent-1", name: "Gödel", createdAt: 1_000, totalTokens: 321 }]);
    const snapshot = control.get("agent-1")!;
    expect(snapshot.activities).toEqual([]);
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages.map((message: any) => message.content[0].text)).toEqual(["child task", "child result"]);

    await control.sendInput("agent-1", "continue", false);
    expect(manager.sendInputById).toHaveBeenCalledWith("agent-1", "continue", { interrupt: false });
    control.abort("agent-1");
    expect(manager.abort).toHaveBeenCalledWith("agent-1");

    unregister();
    expect(registry.has(sessionId)).toBe(false);
  });

  it("streams bounded text and tool activity from the live child session", () => {
    const record = fakeRecord();
    record.status = "running";
    record.completedAt = undefined;
    record.session.isStreaming = true;
    const listeners = new Set<(event: any) => void>();
    record.session.subscribe = vi.fn((listener: (event: any) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    const manager = {
      listAgents: vi.fn(() => [record]),
      getRecord: vi.fn((id: string) => id === record.id ? record : undefined),
      sendInputById: vi.fn(async () => ({ submissionId: "submission-1", record })),
      abort: vi.fn(() => true),
      reserveCodexNickname: vi.fn(() => "Gödel"),
      spawn: vi.fn(() => record.id),
    } as any;
    const unregister = registerSubagentWebControl({
      sessionId,
      quake: {} as any,
      manager,
      getContext: () => undefined,
    });
    const registry = (globalThis as any)[SUBAGENT_WEB_CONTROLS_KEY] as Map<string, SubagentWebControl>;
    const control = registry.get(sessionId)!;

    control.get(record.id); // attaches the live session tracker
    const emit = (event: any) => listeners.forEach((listener) => listener(event));
    emit({ type: "turn_start" });
    emit({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "echo token=super-secret" },
    });
    emit({
      type: "tool_execution_update",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "echo token=super-secret" },
      partialResult: { content: [{ type: "text", text: "first live line" }] },
    });
    emit({ type: "message_start", message: { role: "assistant", content: [] } });
    emit({
      type: "message_update",
      message: { role: "assistant", content: [] },
      assistantMessageEvent: { type: "text_delta", delta: "Canlı cevap" },
    });

    const live = control.get(record.id)!;
    expect(live.streamingText).toBe("Canlı cevap");
    expect(live.activities).toMatchObject([{
      id: "tool-1",
      toolName: "bash",
      status: "running",
      output: "first live line",
    }]);
    expect(live.activities[0]?.input).toBe("echo token=••••");

    emit({
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "done" }] },
      isError: false,
    });
    expect(control.get(record.id)?.activities[0]).toMatchObject({ status: "completed", output: "done" });

    unregister();
    expect(listeners.size).toBe(0);
  });
});
