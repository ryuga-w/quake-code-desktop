import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const markdownMessage = readFileSync(join(root, "src/client/src/components/markdown/MarkdownMessage.tsx"), "utf8");
const markdownContent = readFileSync(join(root, "src/client/src/components/markdown/MarkdownContent.tsx"), "utf8");
const toolActivity = readFileSync(join(root, "src/client/src/components/markdown/ToolActivityNotice.tsx"), "utf8");
const semanticFlow = readFileSync(join(root, "src/client/src/components/markdown/SemanticFlow.tsx"), "utf8");
const toolRunDetails = readFileSync(join(root, "src/client/src/components/markdown/ToolRunDetails.tsx"), "utf8");
const openState = readFileSync(join(root, "src/client/src/components/markdown/tool-activity-open-state.ts"), "utf8");

describe("markdown responsibility boundaries", () => {
  it("retains the React runtime binding required by the desktop Vite transform", () => {
    for (const source of [markdownMessage, markdownContent, toolActivity, semanticFlow, toolRunDetails]) {
      expect(source).toMatch(/^import React(?:,| from)/);
    }
    expect(markdownContent).toContain("React.useMemo<Components>");
  });

  it("keeps MarkdownMessage as the timeline-facing orchestrator", () => {
    expect(markdownMessage).toContain('from "./MarkdownContent"');
    expect(markdownMessage).toContain('from "./ToolActivityNotice"');
    expect(markdownMessage).toContain("<MarkdownContent");
    expect(markdownMessage).toContain("<TurnSemanticFlow");
    expect(markdownMessage).not.toContain('from "streamdown"');
    expect(markdownMessage).not.toContain("useVirtualizer");
    expect(markdownMessage).not.toContain("getToolExecutionBody");
  });

  it("owns Streamdown and file-link transforms in MarkdownContent", () => {
    expect(markdownContent).toContain('from "streamdown"');
    expect(markdownContent).toContain("remarkQuakeFileLinks");
    expect(markdownContent).toContain("transformFilePathTextNodes");
    expect(markdownContent).toContain('securityLevel: "strict"');
  });

  it("keeps activity, semantic transitions, heavy details, and open state separate", () => {
    expect(toolActivity).toContain('from "./SemanticFlow"');
    expect(toolActivity).toContain('from "./ToolRunDetails"');
    expect(toolActivity).toContain('from "./tool-activity-open-state"');
    expect(semanticFlow).toContain("function SemanticHeadlineTransition");
    expect(toolRunDetails).toContain("getToolExecutionBody");
    expect(openState).toContain("OPEN_TOOL_DETAILS");
    expect(openState).toContain("CLOSED_TOOL_DETAILS");
  });

  it("does not retain the removed duplicate preview implementation", () => {
    expect(markdownMessage).not.toContain("function toolPatchPreview");
    expect(toolActivity).not.toContain("function toolPatchPreview");
    expect(toolRunDetails).not.toContain("function toolPatchPreview");
    expect(toolRunDetails).toContain("getToolExecutionBody(tool)");
  });
});
