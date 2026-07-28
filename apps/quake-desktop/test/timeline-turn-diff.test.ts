import { describe, expect, it } from "vitest";
import { resolveTimelineTurnDiff } from "../src/client/src/components/timeline/timeline-logic";
import type { TurnReviewView } from "../src/client/src/types";

describe("timeline turn diff ownership", () => {
  const previousTurnDiff: TurnReviewView = {
    turnId: 1,
    files: [{ path: "src/previous.ts", kind: "modify", added: 2, removed: 1 }],
  };

  it("does not attach the previous latest diff to a newer assistant turn", () => {
    expect(resolveTimelineTurnDiff(2, {}, previousTurnDiff)).toBeUndefined();
  });

  it("uses the snapshot mapped to the exact conversation turn", () => {
    const currentTurnDiff: TurnReviewView = {
      turnId: 2,
      files: [{ path: "src/current.ts", kind: "modify", added: 1, removed: 0 }],
    };

    expect(resolveTimelineTurnDiff(2, { "1": previousTurnDiff, "2": currentTurnDiff }, previousTurnDiff))
      .toBe(currentTurnDiff);
  });

  it("accepts latest only when it explicitly owns the same turn", () => {
    const currentTurnDiff: TurnReviewView = { ...previousTurnDiff, turnId: 2 };

    expect(resolveTimelineTurnDiff(2, {}, currentTurnDiff)).toBe(currentTurnDiff);
  });

  it("rejects legacy latest snapshots with no owning turn", () => {
    const legacyLatest: TurnReviewView = { files: previousTurnDiff.files };

    expect(resolveTimelineTurnDiff(2, {}, legacyLatest)).toBeUndefined();
  });
});
