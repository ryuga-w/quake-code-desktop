import { Text, type TUI, visibleWidth } from "@mrquake/quakecode-tui";
import { Type } from "@sinclair/typebox";
import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test } from "vitest";
import type { ToolDefinition } from "../src/core/extensions/types.js";
import {
  type BashOperations,
  createBashToolDefinition,
} from "../src/core/tools/bash.js";
import {
  createReadTool,
  createReadToolDefinition,
} from "../src/core/tools/read.js";
import { createWriteToolDefinition } from "../src/core/tools/write.js";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function createBaseToolDefinition(name = "custom_tool"): ToolDefinition {
  return {
    name,
    label: name,
    description: "custom tool",
    parameters: Type.Any(),
    execute: async () => ({
      content: [{ type: "text", text: "ok" }],
      details: {},
    }),
  };
}

function createFakeTui(): TUI {
  return {
    requestRender: () => {},
  } as unknown as TUI;
}

function compactLine(component: ToolExecutionComponent, width = 120): string {
  return stripAnsi(component.render(width).join("\n")).trim();
}

describe("ToolExecutionComponent compact log", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test("renders a compact activity row while queued", () => {
    const component = new ToolExecutionComponent(
      "read",
      "tool-1",
      { path: "README.md" },
      {},
      createReadToolDefinition(process.cwd()),
      createFakeTui(),
    );
    const rendered = compactLine(component);
    expect(rendered).toMatch(/^[○o]\s+READ\s+README\.md/);
    expect(rendered).toContain("waiting");
    expect(rendered).toMatch(/waiting [›>]$/);
  });

  test("renders settled read results without trailing active suffix", () => {
    const component = new ToolExecutionComponent(
      "read",
      "tool-2",
      { path: "README.md" },
      {},
      createReadToolDefinition(process.cwd()),
      createFakeTui(),
    );
    component.updateResult(
      {
        content: [{ type: "text", text: "one\ntwo\n" }],
        details: undefined,
        isError: false,
      },
      false,
    );
    const rendered = compactLine(component);
    expect(rendered).toMatch(/^[✓+]\s+READ\s+README\.md/);
    expect(rendered).toContain("2 lines");
    expect(rendered).toMatch(/2 lines [›>]$/);
    expect(rendered).not.toContain("one");
  });

  test("preserves legacy file_path args in compact lines", () => {
    const component = new ToolExecutionComponent(
      "read",
      "tool-3",
      { file_path: "README.md" },
      {},
      undefined,
      createFakeTui(),
    );
    const rendered = compactLine(component);
    expect(rendered).toMatch(/^[○o]\s+READ\s+README\.md/);
  });

  test("formats grep results as compact search lines", () => {
    const component = new ToolExecutionComponent(
      "grep",
      "tool-4",
      { pattern: "grok", path: "apps/quake-desktop" },
      {},
      undefined,
      createFakeTui(),
      process.cwd(),
    );
    component.markExecutionStarted();
    component.updateResult({ content: [], isError: false }, false);
    const rendered = compactLine(component);
    expect(rendered).toMatch(/^[✓+]\s+SEARCH\s+/);
    expect(rendered).toContain("grok");
    expect(rendered).toContain("apps\\quake-desktop");
    expect(rendered).toContain("no matches");

    component.setExpanded(true);
    const expanded = stripAnsi(component.render(120).join("\n"));
    expect(expanded).toContain("Completed with no matches");
    expect(expanded).not.toContain("Searching");
  });

  test("bash activity row shows working state before output arrives", async () => {
    const updates: Array<{
      content: Array<{ type: string; text?: string }>;
      details?: unknown;
    }> = [];
    const operations: BashOperations = {
      exec: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { exitCode: 0 };
      },
      onOutput: (_id, chunk) => {
        updates.push({ content: [{ type: "text", text: chunk }] });
      },
    };
    const bashTool = createBashToolDefinition(process.cwd(), { operations });
    const component = new ToolExecutionComponent(
      "bash",
      "tool-5",
      { command: "echo hello" },
      {},
      bashTool,
      createFakeTui(),
    );
    component.markExecutionStarted();
    const queued = compactLine(component);
    expect(queued).toMatch(/^[●>]\s+SHELL\s+/);
    expect(queued).toContain("$ echo hello");
    expect(queued).toContain("working");

    component.updateResult(
      { content: [{ type: "text", text: "hello" }], isError: false },
      false,
    );
    component.setExpanded(true);
    const expanded = stripAnsi(component.render(120).join("\n"));
    expect(expanded).toContain("Produced 1 line of output · $ echo hello");
    expect(expanded).not.toContain("bash · running");
  });

  test("shows only settled custom result detail when expanded", () => {
    const toolDefinition: ToolDefinition = {
      ...createBaseToolDefinition(),
      renderCall: () => new Text("custom call", 0, 0),
      renderResult: () => new Text("custom result", 0, 0),
    };

    const component = new ToolExecutionComponent(
      "custom_tool",
      "tool-6",
      {},
      {},
      toolDefinition,
      createFakeTui(),
    );
    component.updateResult(
      {
        content: [{ type: "text", text: "done" }],
        details: {},
        isError: false,
      },
      false,
    );

    const collapsed = compactLine(component);
    expect(collapsed).toMatch(/^[✓+]\s+TOOL\s+Custom Tool/);
    expect(collapsed).not.toContain("custom call");
    expect(collapsed).not.toContain("custom result");

    component.setExpanded(true);
    const expanded = stripAnsi(component.render(120).join("\n"));
    expect(expanded).not.toContain("custom call");
    expect(expanded).toContain("custom result");
  });

  test("expands generic done receipts with controlled output detail", () => {
    const output = Array.from(
      { length: 30 },
      (_, index) => `done line ${index + 1}`,
    ).join("\n");
    const component = new ToolExecutionComponent(
      "unknown_tool",
      "tool-7",
      { path: "README.md" },
      {},
      undefined,
      createFakeTui(),
    );
    component.markExecutionStarted();
    component.updateResult(
      { content: [{ type: "text", text: output }], isError: false },
      false,
    );
    component.setExpanded(true);

    const lines = component.render(80);
    const rendered = stripAnsi(lines.join("\n"));
    expect(rendered).toMatch(/^[✓+]\s+UNKNOWN\s+README\.md/m);
    expect(rendered).toMatch(/[│|]\s+Unknown Tool · done/);
    expect(rendered).not.toContain("Produced 30 lines of output");
    expect(rendered).not.toContain("receipt");
    expect(rendered).toContain("done line 1");
    expect(rendered).toContain("done line 16");
    expect(rendered).not.toContain("done line 17");
    for (const line of lines)
      expect(visibleWidth(line)).toBeLessThanOrEqual(80);
  });

  test("expands generic error incidents with metadata and controlled detail", () => {
    const output = Array.from(
      { length: 40 },
      (_, index) => `error line ${index + 1}`,
    ).join("\n");
    const component = new ToolExecutionComponent(
      "unknown_tool",
      "tool-8",
      { command: "bad" },
      {},
      undefined,
      createFakeTui(),
    );
    component.markExecutionStarted();
    component.updateResult(
      {
        content: [{ type: "text", text: output }],
        isError: true,
        details: { exitCode: 2, stderrBytes: 4096, phase: "compile" },
      },
      false,
    );
    component.setExpanded(true);

    const lines = component.render(80);
    const rendered = stripAnsi(lines.join("\n"));
    expect(rendered).toMatch(/^[×x]\s+UNKNOWN\s+\$ bad/m);
    expect(rendered).toMatch(/[│|]\s+Unknown Tool · failed/);
    expect(rendered).toContain("Tool returned 40 lines before failing");
    expect(rendered).not.toContain("incident");
    expect(rendered).toContain("metadata");
    expect(rendered).toContain('"exitCode": 2');
    for (const line of lines)
      expect(visibleWidth(line)).toBeLessThanOrEqual(80);
  });

  test("keeps the activity row within narrow terminal widths", () => {
    const component = new ToolExecutionComponent(
      "read",
      "tool-narrow",
      { path: "src/modes/interactive/components/tool-execution.ts" },
      {},
      createReadToolDefinition(process.cwd()),
      createFakeTui(),
    );
    component.markExecutionStarted();

    const lines = component.render(36);
    expect(lines).toHaveLength(1);
    expect(stripAnsi(lines[0] ?? "")).toContain("READ");
    expect(visibleWidth(lines[0] ?? "")).toBeLessThanOrEqual(36);
  });

  test("accepts mouse clicks on the compact tool line", () => {
    const component = new ToolExecutionComponent(
      "read",
      "tool-click",
      { path: "README.md" },
      {},
      createReadToolDefinition(process.cwd()),
      createFakeTui(),
    );
    component.render(80);
    expect(component.handleMouseClick(0)).toBe(true);
    expect(component.handleMouseClick(1)).toBe(false);
  });

  test("collectMouseRegions exposes only the compact header line", () => {
    const component = new ToolExecutionComponent(
      "read",
      "tool-regions",
      { path: "README.md" },
      {},
      createReadToolDefinition(process.cwd()),
      createFakeTui(),
    );
    const lines = component.render(80);
    const regions = component.collectMouseRegions({
      startLine: 42,
      width: 80,
      lineCount: lines.length,
    });
    expect(regions).toHaveLength(1);
    expect(regions[0]?.id).toBe("tool:tool-regions");
    expect(regions[0]?.contentLineStart).toBe(42);
    expect(regions[0]?.contentLineEnd).toBe(43);
  });

  test("does not schedule periodic renders while running", async () => {
    let renderRequests = 0;
    const tui = {
      requestRender: () => {
        renderRequests++;
      },
    } as unknown as TUI;
    const component = new ToolExecutionComponent(
      "custom_tool",
      "tool-9",
      {},
      {},
      createBaseToolDefinition(),
      tui,
    );

    component.markExecutionStarted();
    await new Promise((resolve) => setTimeout(resolve, 650));

    expect(renderRequests).toBeLessThanOrEqual(1);
  });
});
