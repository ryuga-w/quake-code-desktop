import { describe, expect, it } from "vitest";
import {
  formatCompactToolLogLine,
  getCompactToolLogPresentation,
} from "../src/core/tools/tool-log-line.js";

const cwd = "C:\\quake code";

describe("formatCompactToolLogLine", () => {
  it("formats read results with line ranges", () => {
    const line = formatCompactToolLogLine({
      toolName: "read",
      args: {
        path: "apps/quake-desktop/src/client/styles-responsive.css",
        offset: 2,
        limit: 100,
      },
      result: {
        content: [
          {
            type: "text",
            text: Array.from({ length: 100 }, (_, i) => `line ${i + 2}`).join(
              "\n",
            ),
          },
        ],
        isError: false,
        details: { truncation: { totalLines: 226, outputLines: 100 } },
      },
      status: "done",
      cwd,
    });
    expect(line).toContain("Read ");
    expect(line).toContain("styles-responsive.css");
    expect(line).toContain("(2-101 of 226)");
  });

  it("formats grep with match counts", () => {
    const line = formatCompactToolLogLine({
      toolName: "grep",
      args: { pattern: "grok", path: "apps/quake-desktop" },
      result: { content: [], isError: false },
      status: "done",
      cwd,
    });
    expect(line).toBe('Search "grok" in apps\\quake-desktop (no matches)');
  });

  it("formats ls as a compact list line", () => {
    const line = formatCompactToolLogLine({
      toolName: "ls",
      args: { path: "apps/quake-desktop/src/client" },
      result: { content: [{ type: "text", text: "a\nb\nc" }], isError: false },
      status: "done",
      cwd,
    });
    expect(line).toBe("List apps\\quake-desktop\\src\\client (3 entries)");
  });

  it("shows active suffix while running", () => {
    const line = formatCompactToolLogLine({
      toolName: "read",
      args: { path: "README.md" },
      status: "running",
      cwd,
    });
    expect(line).toBe("Read README.md..");
  });
});

describe("getCompactToolLogPresentation", () => {
  it("separates read action, subject, and result metadata", () => {
    const presentation = getCompactToolLogPresentation({
      toolName: "read",
      args: { path: "README.md" },
      result: {
        content: [{ type: "text", text: "one\ntwo" }],
        isError: false,
      },
      status: "done",
      cwd,
    });

    expect(presentation).toEqual({
      label: "READ",
      subject: "README.md",
      meta: "2 lines",
    });
  });

  it("uses concise live metadata for streaming shell output", () => {
    const presentation = getCompactToolLogPresentation({
      toolName: "bash",
      args: { command: "npm test" },
      result: {
        content: [{ type: "text", text: "suite one\nsuite two" }],
        isError: false,
      },
      status: "streaming",
      cwd,
    });

    expect(presentation).toEqual({
      label: "SHELL",
      subject: "$ npm test",
      meta: "2 lines · live",
    });
  });
});
