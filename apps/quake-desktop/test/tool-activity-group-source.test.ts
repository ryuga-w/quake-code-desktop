import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const toolActivityNotice = readFileSync(join(process.cwd(), "src/client/src/components/markdown/ToolActivityNotice.tsx"), "utf8");
const toolRunDetails = readFileSync(join(process.cwd(), "src/client/src/components/markdown/ToolRunDetails.tsx"), "utf8");
const openState = readFileSync(join(process.cwd(), "src/client/src/components/markdown/tool-activity-open-state.ts"), "utf8");
const toolActivity = [toolActivityNotice, toolRunDetails, openState].join("\n");
const styles = readFileSync(join(process.cwd(), "src/client/src/components/markdown/MarkdownMessage.module.css"), "utf8");

describe("compact tool activity group source contract", () => {
  it("groups file mutations and terminal commands under one Codex-style summary", () => {
    expect(toolActivity).toContain("const inlineActivityBatch = mutationRows.length > 0");
    expect(toolActivity).toContain("toolFileMutationsModel(tool).length > 0 || isCommandTool(tool.toolName)");
    expect(toolActivity).toContain("<FileMutationBatchSummary");
    expect(toolActivity).toContain("rows={mutationRows}");
    expect(toolActivity).toContain("commands={inlineCommandTools}");
    expect(toolActivity).toContain("compactCommand={inlineActivityBatch || isCommandTool(tool.toolName)}");
    expect(toolActivity).toContain('`Ran ${commands.length} ${commands.length === 1 ? "command" : "commands"}`');
    expect(toolActivity).toContain("function CommandTerminalIcon");
  });

  it("keeps rows compact, closed until requested, and free of settled checkmarks", () => {
    expect(toolActivity).toContain("useDetailsOpen(activityKey ? `notice:${activityKey}` : noticeOpenKey(turnId, names), false)");
    expect(toolActivity).toContain("if (defaultOpen && !CLOSED_TOOL_DETAILS.has(id)) OPEN_TOOL_DETAILS.add(id)");
    expect(toolActivity).toContain("return parts.at(-1) || path");
    expect(toolActivity).toContain("const action = mutationActionLabel(mutation.kind, active, failed)");
    expect(toolActivity).toContain("compactMutation");
    expect(toolActivity).toContain("<MutationPencilIcon compact />");
    expect(toolActivity).toContain("actionOverride={action}");
    expect(toolActivity).toContain('className={`${inlineActivityBatch ? styles.fileMutationRunList : styles.toolRunList}');
    expect(toolActivity).toContain('return active ? "Düzenleniyor" : "Düzenlendi"');
    expect(toolActivity).toContain('return active ? "Oluşturuluyor" : "Oluşturuldu"');
    expect(toolActivity).not.toContain('return "Düzenlenen dosya"');
    expect(toolActivity).not.toContain("styles.fileMutationCard");
    expect(toolActivity).not.toContain("MutationDeltaBadge");
    expect(toolActivity).not.toContain('aria-label="Tamamlandı">✓');
    expect(styles).toContain(".toolNotice.inlineActivityNotice > summary");
    expect(styles).toContain(".compactCommandRun summary::after");
    expect(styles).toContain(".compactCommandIcon svg");
  });

  it("keeps expanded tool-card identity thin and on one line", () => {
    expect(styles).toMatch(/\.toolExecutionCard:not\(\[data-mutation-snippet="true"\]\) \{[\s\S]*?gap: 0;[\s\S]*?padding: 0 0 5px;/);
    expect(styles).toMatch(/\.toolExecutionHeader \{[\s\S]*?min-height: 34px;[\s\S]*?padding: 4px 10px;/);
    expect(styles).toMatch(/\.toolExecutionIdentity \{[\s\S]*?display: flex;[\s\S]*?align-items: baseline;[\s\S]*?white-space: nowrap;/);
    expect(styles).not.toMatch(/\.toolExecutionIdentity \{[^}]*display: grid;/);
  });

  it("prevents the scroll-fade observer from retriggering itself", () => {
    expect(toolActivity).toContain('attributeFilter: ["open"]');
    expect(toolActivity).not.toContain("mutationObserver?.observe(body, { childList: true, subtree: true, attributes: true });");
  });

  it("lets an opened virtual detail list derive its visible height", () => {
    expect(styles).toContain("contain: layout paint style");
    expect(styles).not.toMatch(/^\s*contain:\s*strict;/m);
  });
});
