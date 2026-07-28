import { describe, expect, it } from "vitest";
import { projectSubagentTimeline } from "../src/client/src/components/agents/subagent-timeline";

describe("subagent canonical timeline projection", () => {
  it("projects activity events into the same toolCall/toolResult protocol used by the main timeline", () => {
    const messages = [
      { role: "user", content: "Dosyaları incele", timestamp: 100 },
    ];
    const projected = projectSubagentTimeline(messages, [{
      id: "tool-1",
      toolName: "grep",
      status: "completed",
      input: "TODO",
      output: "3 eşleşme",
      startedAt: 120,
      updatedAt: 180,
    }]);

    const toolCall = projected.find((message) =>
      message.role === "assistant"
      && Array.isArray(message.content)
      && message.content.some((part: any) => part.type === "toolCall" && part.id === "tool-1"),
    );
    const toolResult = projected.find((message) =>
      message.role === "toolResult" && message.toolCallId === "tool-1",
    );

    expect(toolCall?.turnId).toBe(1);
    expect(toolResult?.content).toBe("3 eşleşme");
    expect(toolResult?.isError).toBe(false);
  });

  it("adds a missing result without duplicating an existing tool call", () => {
    const messages = [
      { role: "user", content: "Kontrol et", timestamp: 100 },
      {
        role: "assistant",
        timestamp: 120,
        content: [{ type: "toolCall", id: "tool-2", name: "typecheck", arguments: "" }],
      },
    ];
    const projected = projectSubagentTimeline(messages, [{
      id: "tool-2",
      toolName: "typecheck",
      status: "error",
      output: "TS error",
      startedAt: 120,
      updatedAt: 200,
    }]);

    const calls = projected.flatMap((message) =>
      Array.isArray(message.content)
        ? message.content.filter((part: any) => part.type === "toolCall" && part.id === "tool-2")
        : [],
    );
    const results = projected.filter((message) =>
      message.role === "toolResult" && message.toolCallId === "tool-2",
    );

    expect(calls).toHaveLength(1);
    expect(results).toHaveLength(1);
    expect(results[0].isError).toBe(true);
  });
});
