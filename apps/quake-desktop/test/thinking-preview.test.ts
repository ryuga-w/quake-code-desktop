import { describe, expect, it } from "vitest";
import { latestPublishedThinkingSummary } from "../src/client/src/lib/thinking-preview";

describe("thinking preview", () => {
  it("removes continuation dots from the live headline", () => {
    expect(latestPublishedThinkingSummary("... Evaluating code adjustments")).toBe("Evaluating code adjustments");
    expect(latestPublishedThinkingSummary("…… Considering tool activity")).toBe("Considering tool activity");
    expect(latestPublishedThinkingSummary("⋯⋯ Reasoning: Inspecting the render path")).toBe("Inspecting the render path");
  });

  it("keeps the newest long thought without adding a leading ellipsis", () => {
    const preview = latestPublishedThinkingSummary(
      `Initial context ${"earlier detail ".repeat(18)}latest meaningful thought`,
    );

    expect(preview).toContain("latest meaningful thought");
    expect(preview).not.toMatch(/^(?:\.{2,}|…|⋯)/);
    expect(preview.length).toBeLessThanOrEqual(156);
  });
});
