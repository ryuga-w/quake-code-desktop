import { describe, expect, it } from "vitest";
import { presentContextUsage } from "../src/client/src/components/composer/ContextUsageIndicator";

describe("composer context usage presentation", () => {
  it("derives percentages and the remaining context from real token counts", () => {
    expect(presentContextUsage({ tokens: 111_000, contextWindow: 998_000, percent: null })).toMatchObject({
      tokens: 111_000,
      contextWindow: 998_000,
      usedPercent: 11,
      remainingPercent: 89,
      level: "normal",
    });
  });

  it("clamps the ring and marks high context pressure", () => {
    expect(presentContextUsage({ tokens: 105_000, contextWindow: 100_000, percent: 105 })).toMatchObject({
      usedPercent: 105,
      remainingPercent: 0,
      ringPercent: 100,
      level: "critical",
    });
  });

  it("preserves the unknown post-compaction state", () => {
    expect(presentContextUsage({ tokens: null, contextWindow: 200_000, percent: null })).toMatchObject({
      tokens: null,
      usedPercent: null,
      remainingPercent: null,
      ringPercent: 0,
    });
  });
});
