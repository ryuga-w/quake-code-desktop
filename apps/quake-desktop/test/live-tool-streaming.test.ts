import { describe, expect, it } from "vitest";
import { toolCallStreamSignature } from "../src/client/src/lib/tool-helpers";

function streamedPatch(patch: string) {
  return {
    role: "assistant",
    content: [{
      type: "toolCall",
      id: "call-1",
      name: "apply_patch",
      arguments: { patch },
    }],
  };
}

describe("live tool-call argument synchronization", () => {
  it("changes the dedup signature while apply_patch arguments grow", () => {
    const first = toolCallStreamSignature(streamedPatch("*** Update File: src/example.tsx\n+one"));
    const second = toolCallStreamSignature(streamedPatch("*** Update File: src/example.tsx\n+one\n+two"));

    expect(first).not.toBe(second);
    expect(toolCallStreamSignature(streamedPatch("*** Update File: src/example.tsx\n+one\n+two"))).toBe(second);
  });

  it("ignores plan protocol tools in the render signature", () => {
    expect(toolCallStreamSignature({
      content: [{ type: "toolCall", id: "plan-1", name: "update_plan", arguments: { plan: [] } }],
    })).toBe("");
  });
});
