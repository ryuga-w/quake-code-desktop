import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolCardState } from "../src/client/src/state/app-store";

let reviewModule: typeof import("../src/client/src/components/tools/TurnFileChangesCard");

beforeAll(async () => {
  vi.stubGlobal("window", { __QUAKE_WEB_TOKEN__: "" });
  reviewModule = await import("../src/client/src/components/tools/TurnFileChangesCard");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function tool(overrides: Partial<ToolCardState>): ToolCardState {
  return {
    id: "tool-1",
    toolName: "apply_patch",
    status: "done",
    updatedAt: 1,
    ...overrides,
  } as ToolCardState;
}

describe("per-file change review", () => {
  it("isolates the clicked file from a multi-file apply_patch", () => {
    const card = tool({
      args: {
        patch: [
          "*** Begin Patch",
          "*** Update File: src/a.ts",
          "@@",
          "-oldA",
          "+newA",
          "*** Add File: src/b.ts",
          "+export const b = true;",
          "*** End Patch",
        ].join("\n"),
      },
    });

    const diff = reviewModule.resolveRowDiff(card, "src/b.ts", undefined, "create");

    expect(diff).toContain("diff --git a/src/b.ts b/src/b.ts");
    expect(diff).toContain("+export const b = true;");
    expect(diff).not.toContain("src/a.ts");
  });

  it("synthesizes a review diff while a file is being created", () => {
    const card = tool({
      toolName: "write",
      status: "streaming",
      args: { path: "src/new-file.ts", content: "export const value = 1;\n" },
    });

    const diff = reviewModule.resolveRowDiff(card, "src/new-file.ts", undefined, "create");

    expect(diff).toContain("--- /dev/null");
    expect(diff).toContain("+++ b/src/new-file.ts");
    expect(diff).toContain("+export const value = 1;");
  });

  it("synthesizes a review diff from edit replacement arguments", () => {
    const card = tool({
      toolName: "edit",
      status: "streaming",
      args: { path: "src/existing.ts", oldText: "const oldValue = 1;", newText: "const newValue = 2;" },
    });

    const diff = reviewModule.resolveRowDiff(card, "src/existing.ts", undefined, "modify");

    expect(diff).toContain("--- a/src/existing.ts");
    expect(diff).toContain("-const oldValue = 1;");
    expect(diff).toContain("+const newValue = 2;");
  });

  it("builds a one-file review payload for the right-hand panel", () => {
    const review = reviewModule.buildSingleFileReview({
      path: "src/existing.ts",
      kind: "modify",
      diff: "@@\n-old\n+new\n",
      added: 1,
      removed: 1,
    }, { turnId: 7 });

    expect(review.turnId).toBe(7);
    expect(review.files).toHaveLength(1);
    expect(review.files?.[0].path).toBe("src/existing.ts");
    expect(review.totalAdded).toBe(1);
    expect(review.totalRemoved).toBe(1);
  });

  it("refreshes an open one-file review from the latest streaming tool arguments", () => {
    const initial = reviewModule.buildSingleFileReview({
      path: "src/live.ts",
      kind: "create",
      diff: "@@ -0,0 +1,1 @@\n+export const first = 1;\n",
      added: 1,
      removed: 0,
    }, {
      turnId: 9,
      liveSource: { toolId: "live-write", path: "src/live.ts", kind: "create" },
    });
    const streamingTool = tool({
      id: "live-write",
      toolName: "write",
      status: "streaming",
      args: {
        path: "src/live.ts",
        content: "export const first = 1;\nexport const second = 2;\n",
      },
    });

    const refreshed = reviewModule.refreshLiveSingleFileReview(initial, streamingTool);

    expect(refreshed.liveSource?.toolId).toBe("live-write");
    expect(refreshed.files?.[0].diff).toContain("+export const second = 2;");
    // Matches the live mutation card, which counts the trailing newline as an empty third line.
    expect(refreshed.totalAdded).toBe(3);
  });
});
