import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAbortedTurnDurationMap,
  buildMessageToolHistory,
  formatAbortedTurnLabel,
  groupTimelineRows,
  hasAbortedAssistantMessageForTurn,
  isSilentAssistantTimelineMessage,
  type TimelineMessageItem,
} from "../src/client/src/components/timeline/timeline-logic";

function messageRow(message: any, index: number): TimelineMessageItem {
  return {
    kind: "message",
    key: `message:${index}`,
    time: Number(message.timestamp || index + 1),
    message,
  };
}

describe("timeline abort status", () => {
  it("keeps one empty aborted response visible as a timeline row", () => {
    const messages = [
      { role: "user", content: "Uzun bir yanıt yaz", timestamp: 1_000, turnId: 1 },
      { role: "assistant", content: "", timestamp: 1_400, turnId: 1, __aborted: true, stopReason: "aborted" },
    ];
    const abortedMessage = messages[1];

    expect(isSilentAssistantTimelineMessage(abortedMessage, "")).toBe(false);
    const grouped = groupTimelineRows(
      messages.map(messageRow),
      "",
      buildMessageToolHistory(messages),
    );
    expect(grouped.some((row) => row.kind === "message" && row.message === abortedMessage)).toBe(true);
  });

  it("collapses duplicate abort confirmations for the same turn", () => {
    const messages = [
      { role: "user", content: "Uzun bir yanıt yaz", timestamp: 1_000, turnId: 1 },
      { role: "assistant", content: "Kısmi yanıt", timestamp: 1_300, turnId: 1, __aborted: true },
      { role: "assistant", content: "_(Yanıt durduruldu)_", timestamp: 1_400, turnId: 1, __aborted: true },
    ];
    const grouped = groupTimelineRows(
      messages.map(messageRow),
      "",
      buildMessageToolHistory(messages),
    );
    const abortedRows = grouped.filter((row) =>
      row.kind === "message" && row.message?.__aborted === true,
    );

    expect(abortedRows).toHaveLength(1);
    expect(abortedRows[0]?.kind === "message" ? abortedRows[0].message.content : "").toBe("Kısmi yanıt");
  });

  it("formats elapsed stop time like the reference UI", () => {
    expect(formatAbortedTurnLabel(0)).toBe("0s sonra durdurdunuz");
    expect(formatAbortedTurnLabel(999)).toBe("0s sonra durdurdunuz");
    expect(formatAbortedTurnLabel(1_999)).toBe("1s sonra durdurdunuz");
    expect(formatAbortedTurnLabel(65_000)).toBe("1m 5s sonra durdurdunuz");
  });

  it("prefers the captured duration and detects an already archived turn", () => {
    const userMessage = { role: "user", content: "Başla", timestamp: 10_000, turnId: 3 };
    const abortedMessage = {
      role: "assistant",
      content: "Kısmi yanıt",
      timestamp: 15_000,
      turnId: 3,
      __aborted: true,
      __abortedAfterMs: 2_400,
    };
    const messages = [userMessage, abortedMessage];

    expect(buildAbortedTurnDurationMap(messages).get(abortedMessage)).toBe(2_400);
    expect(hasAbortedAssistantMessageForTurn(messages, 3)).toBe(true);
    expect(hasAbortedAssistantMessageForTurn(messages, 4)).toBe(false);
  });

  it("wires the optimistic and server confirmations through one idempotent projection", () => {
    const app = readFileSync(join(process.cwd(), "src/client/src/app/App.tsx"), "utf8");
    const sse = readFileSync(join(process.cwd(), "src/client/src/app/sse/createServerEventHandlers.ts"), "utf8");
    const timeline = readFileSync(join(process.cwd(), "src/client/src/components/timeline/Timeline.tsx"), "utf8");

    expect(app).toContain("hasAbortedAssistantMessageForTurn(storeSnapshot.messages, turnId)");
    expect(app).not.toContain('"_(Yanıt durduruldu)_"');
    expect(sse).toContain("preserveStreamingMessageAfterAbort(Number(event.durationMs))");
    expect(timeline).toContain('className={`aborted-message-status');
    expect(timeline).not.toContain("Tur kesildi (interrupted)");
  });
});
