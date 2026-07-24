import { describe, expect, it } from "vitest";
import {
  getLeftSidebarMaximumWidth,
  getLeftSidebarSnapWidth,
  isLeftSidebarSize,
  leftSidebarSizeLabel,
  nearestLeftSidebarSize,
  nextLeftSidebarSize,
} from "../src/client/src/lib/layout-sizing";

describe("left sidebar snap sizes", () => {
  it("resolves quarter and half widths from the app viewport", () => {
    expect(getLeftSidebarSnapWidth("quarter", 1440)).toBe(360);
    expect(getLeftSidebarSnapWidth("half", 1440)).toBe(720);
    expect(getLeftSidebarMaximumWidth(1440)).toBe(720);
  });

  it("chooses the nearest stop after a drag", () => {
    expect(nearestLeftSidebarSize(345, 1440)).toBe("quarter");
    expect(nearestLeftSidebarSize(680, 1440)).toBe("half");
    expect(nearestLeftSidebarSize(1200, 1440)).toBe("half");
  });

  it("cycles through every named size", () => {
    expect(nextLeftSidebarSize("quarter")).toBe("half");
    expect(nextLeftSidebarSize("half")).toBe("quarter");
    expect(leftSidebarSizeLabel("half")).toBe("Yarım");
    expect(isLeftSidebarSize("half")).toBe(true);
    expect(isLeftSidebarSize("full")).toBe(false);
    expect(isLeftSidebarSize("wide")).toBe(false);
  });
});
