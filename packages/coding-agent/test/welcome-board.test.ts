import { beforeAll, describe, expect, test } from "vitest";
import { visibleWidth } from "@mrquake/quakecode-tui";
import { WelcomeBoardComponent } from "../src/modes/interactive/components/welcome-board.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function createBoard(rows = 30): WelcomeBoardComponent {
  return new WelcomeBoardComponent({
    version: "1.11.2",
    displayName: "Quake Code",
    announcementTitle: "Renderer stabilized",
    announcementBody: "A calmer fixed-screen experience.",
    workspace: "C:/quake code",
    model: "azure/gpt-56-sol-deploy · thinking high",
    getTerminalRows: () => rows,
    onMenuAction: () => {},
    requestRender: () => {},
  });
}

describe("WelcomeBoardComponent", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test("renders a professional information hierarchy", () => {
    const output = createBoard().render(80).join("\n");

    expect(output).toContain("QUAKE CODE");
    expect(output).toContain("TERMINAL CODING AGENT");
    expect(output).toContain("WORKSPACE");
    expect(output).toContain("MODEL");
    expect(output).toContain("ACTIONS");
    expect(output).toContain("LATEST");
    expect(output).toContain("ctrl+w");
    expect(output).toContain("Start with a clean context");
  });

  test("keeps every rendered line within terminal width", () => {
    for (const width of [28, 40, 58, 80, 120]) {
      const lines = createBoard(24).render(width);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  test("does not expose mouse hit regions", () => {
    const board = createBoard();
    expect("collectMouseRegions" in board).toBe(false);
  });
});
