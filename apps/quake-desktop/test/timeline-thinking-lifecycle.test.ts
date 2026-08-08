import { describe, expect, it } from "vitest";
import {
  buildMessageToolHistory,
  groupTimelineRows,
  type TimelineMessageItem,
  type TimelineToolGroupItem,
} from "../src/client/src/components/timeline/timeline-logic";

function messageRow(message: any, index: number): TimelineMessageItem {
  return {
    kind: "message",
    key: message.__streaming ? "m-streaming" : `message:${index}`,
    time: Number(message.timestamp || index + 1),
    message,
  };
}

function toolGroup(rows: ReturnType<typeof groupTimelineRows>): TimelineToolGroupItem {
  const group = rows.find((row): row is TimelineToolGroupItem => row.kind === "toolGroup");
  expect(group).toBeDefined();
  return group!;
}

describe("timeline thinking lifecycle", () => {
  it("does not revive the previous tool turn when a new prompt starts", () => {
    const messages = [
      { role: "user", content: "İlk istek", timestamp: 1, turnId: 1 },
      { role: "assistant", content: "[tool call: update_plan]", timestamp: 2, turnId: 1 },
      { role: "assistant", content: "İlk yanıt tamamlandı.", timestamp: 3, turnId: 1 },
      { role: "user", content: "İkinci istek", timestamp: 4, turnId: 2 },
    ];
    const streaming = {
      role: "assistant",
      content: "",
      timestamp: 5,
      turnId: 2,
      __streaming: true,
    };
    const history = buildMessageToolHistory(messages);
    const rows = [...messages.map(messageRow), messageRow(streaming, messages.length)];

    const grouped = groupTimelineRows(rows, "", history, 2);
    const previousGroup = toolGroup(grouped);

    expect(previousGroup.turnId).toBe(1);
    expect(previousGroup.pending).toBe(false);
    expect(grouped.filter((row) => row.kind === "message" && row.message.__streaming)).toHaveLength(1);
  });

  it("settles tool activity once the turn ends and the trailing final answer arrives", () => {
    const messages = [
      { role: "user", content: "Planı güncelle", timestamp: 1, turnId: 1 },
      { role: "assistant", content: "[tool call: update_plan]", timestamp: 2, turnId: 1 },
      { role: "assistant", content: "7 adımın tamamı kapatıldı.", timestamp: 3, turnId: 1 },
    ];
    const history = buildMessageToolHistory(messages);
    // activeStreamingTurnId = 0 -> agent_end fired (turn truly finished). Only then
    // may the trailing narration be treated as the final answer and settle the work.
    const grouped = groupTimelineRows(messages.map(messageRow), "", history, 0);
    const group = toolGroup(grouped);

    expect(group.pending).toBe(false);
    expect(group.workEntries.some((entry) => entry.kind === "message" && entry.item.message === messages[2])).toBe(false);
    expect(group.workEntries.at(-1)?.kind).toBe("toolBatch");
    expect(grouped.some((row) => row.kind === "message" && row.message === messages[2])).toBe(true);
  });

  it("keeps the turn pending while the agent is still streaming after an interim narration", () => {
    // Multi-step turn: agent writes an interim narration, then (in the real stream)
    // calls more tools. While the agent is still streaming (activeStreamingTurnId set),
    // this interim text must NOT be treated as the final answer, otherwise the UI
    // flips to a "finished" (Xs worked) state and then back to running — the exact
    // "looked like it stopped but kept going" bug the user reported.
    const messages = [
      { role: "user", content: "Çok adımlı görev", timestamp: 1, turnId: 1 },
      { role: "assistant", content: "[tool call: read]", timestamp: 2, turnId: 1 },
      { role: "assistant", content: "Dosyayı inceledim, şimdi düzeltiyorum.", timestamp: 3, turnId: 1 },
    ];
    const history = buildMessageToolHistory(messages);
    // activeStreamingTurnId = 1 -> agent is STILL streaming this turn.
    const grouped = groupTimelineRows(messages.map(messageRow), "", history, 1);
    const group = toolGroup(grouped);

    expect(group.pending).toBe(true);
  });

  it("uses one grouped thinking surface between a tool and the next message", () => {
    const messages = [
      { role: "user", content: "Planı güncelle", timestamp: 1, turnId: 1 },
      { role: "assistant", content: "[tool call: update_plan]", timestamp: 2, turnId: 1 },
    ];
    const streaming = {
      role: "assistant",
      content: "",
      timestamp: 3,
      turnId: 1,
      __streaming: true,
    };
    const history = buildMessageToolHistory(messages);
    const grouped = groupTimelineRows(
      [...messages.map(messageRow), messageRow(streaming, messages.length)],
      "",
      history,
      1,
    );
    const group = toolGroup(grouped);

    expect(group.pending).toBe(true);
    expect(group.workEntries.filter((entry) => entry.kind === "toolBatch" && entry.pending)).toHaveLength(1);
    expect(grouped.some((row) => row.kind === "message" && row.message.__streaming)).toBe(false);
  });
});
