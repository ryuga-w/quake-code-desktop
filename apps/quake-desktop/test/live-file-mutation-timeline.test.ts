import { describe, expect, it } from "vitest";
import {
  buildMessageToolHistory,
  groupTimelineRows,
  type TimelineMessageItem,
  type TimelineToolGroupItem,
} from "../src/client/src/components/timeline/timeline-logic";
import { textFromMessage } from "../src/client/src/lib/render";
import { toolFileMutations } from "../src/client/src/lib/tool-activity";

function messageRow(message: any, index: number): TimelineMessageItem {
  return {
    kind: "message",
    key: message.__streaming ? "m-streaming" : `message:${index}`,
    time: Number(message.timestamp || index + 1),
    message,
  };
}

function liveProjection(patch: string) {
  const userMessage = { role: "user", content: "Dosyayı düzenle", timestamp: 1, turnId: 1 };
  const streamingMessage = {
    role: "assistant",
    content: [{
      type: "toolCall",
      id: "call-live-patch",
      name: "apply_patch",
      arguments: { patch },
    }],
    timestamp: 2,
    turnId: 1,
    __streaming: true,
  };
  const history = buildMessageToolHistory([userMessage], streamingMessage);
  const rows = groupTimelineRows(
    [messageRow(userMessage, 0), messageRow(streamingMessage, 1)],
    textFromMessage(streamingMessage),
    history,
    1,
  );
  const group = rows.find((row): row is TimelineToolGroupItem => row.kind === "toolGroup");
  expect(group).toBeDefined();
  return { group: group!, streamingMessage, history };
}

describe("live file mutation timeline projection", () => {
  it("attaches an in-flight tool snapshot before message_end", () => {
    const patch = "*** Begin Patch\n*** Update File: src/example.tsx\n@@\n-old\n+new\n*** End Patch";
    const { group, history, streamingMessage } = liveProjection(patch);

    expect(history.get(streamingMessage)?.tools).toHaveLength(1);
    expect(group.pending).toBe(true);
    expect(group.toolSnapshots).toHaveLength(1);
    expect(group.toolSnapshots[0]).toMatchObject({
      id: "call-live-patch",
      toolName: "apply_patch",
      status: "running",
      turnId: 1,
    });
    expect(toolFileMutations(group.toolSnapshots[0])).toEqual([
      { path: "src/example.tsx", kind: "modify", added: 1, removed: 1 },
    ]);
  });

  it("projects growing partial patch counters without a settled message", () => {
    const first = liveProjection("*** Begin Patch\n*** Update File: src/example.tsx\n@@\n-old\n+one");
    const second = liveProjection("*** Begin Patch\n*** Update File: src/example.tsx\n@@\n-old\n+one\n+two\n+three");

    expect(toolFileMutations(first.group.toolSnapshots[0])[0]).toMatchObject({ added: 1, removed: 1 });
    expect(toolFileMutations(second.group.toolSnapshots[0])[0]).toMatchObject({ added: 3, removed: 1 });
  });
});
