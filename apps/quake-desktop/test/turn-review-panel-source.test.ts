import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const main = readFileSync(join(root, "src/client/src/app/App.tsx"), "utf8");
const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");
const dock = readFileSync(join(root, "src/client/src/app/hooks/useRightDock.ts"), "utf8");
const rightTabs = readFileSync(join(root, "src/client/src/components/shell/RightPanelTabs.tsx"), "utf8");
const types = readFileSync(join(root, "src/client/src/types.ts"), "utf8");
const markdown = readFileSync(join(root, "src/client/src/components/markdown/MarkdownMessage.tsx"), "utf8");
const fileChanges = readFileSync(join(root, "src/client/src/components/tools/TurnFileChangesCard.tsx"), "utf8");
const fileSnippet = readFileSync(join(root, "src/client/src/components/tools/FileMutationSnippetCard.tsx"), "utf8");
const toolActivity = readFileSync(join(root, "src/client/src/components/markdown/ToolActivityNotice.tsx"), "utf8");
const timeline = readFileSync(join(root, "src/client/src/components/timeline/Timeline.tsx"), "utf8");
const reviewPanel = readFileSync(join(root, "src/client/src/components/dock/TurnReviewPanel.tsx"), "utf8");
const reviewStyles = readFileSync(join(root, "src/client/src/components/dock/TurnReviewPanel.module.css"), "utf8");

describe("turn review dock source contract", () => {
  it("opens the file-change review in a dedicated right-panel tab", () => {
    expect(types).toContain('"review"');
    expect(dock).toContain("function openTurnReview(review: TurnReviewView)");
    expect(dock).toContain('openRightPanel("review")');
    expect(shell).toContain("onReviewTurn={openTurnReview}");
    expect(shell).toContain('rightTab === "review" && turnReview');
    expect(main).toContain("openTurnReview");
    expect(rightTabs).toContain('tab === "review" ? "İnceleme"');
  });

  it("keeps both the review tab and its selected turn session-owned", () => {
    expect(dock).toContain("dockTabs: DockTab[]");
    expect(dock).toContain("review: TurnReviewView | null");
    expect(dock).toContain("review: turnReview");
    expect(dock).toContain("setTurnReview(snapshot?.review || null)");
  });

  it("routes İncele out of the timeline card instead of expanding an inline diff", () => {
    expect(markdown).toContain("onInspect={onReviewTurn}");
    expect(fileChanges).toContain("onInspect({");
    expect(fileChanges).toContain("<span>İncele</span>");
    expect(fileChanges).not.toContain("showFullTurnDiff");
    expect(fileChanges).not.toContain("data-turn-diff-full");
    expect(fileChanges).not.toContain("<ToolCodeBlock");
  });

  it("opens every clicked changed filename as a one-file review", () => {
    expect(timeline).toContain("onInspectFileChange={onReviewTurn}");
    expect(markdown).toContain("onInspectFileChange={onReviewTurn}");
    expect(toolActivity).toContain("buildMutationReview(row, turnDiff, turnId)");
    expect(toolActivity).toContain("değişikliğini İnceleme panelinde aç");
    expect(fileChanges).toContain("buildSingleFileReview({");
    expect(fileChanges).toContain("onInspect={onInspect ? () => handleInspectFile(row) : undefined}");
    expect(fileSnippet).toContain("if (onInspect) onInspect(snippet.path)");
  });

  it("keeps the selected file review attached to its live tool stream", () => {
    expect(types).toContain("liveSource?: TurnReviewLiveSource");
    expect(fileChanges).toContain("refreshLiveSingleFileReview");
    expect(fileChanges).toContain("toolId: row.tool.id");
    expect(toolActivity).toContain("toolId: row.tool.id");
    expect(reviewPanel).toContain("useAppStore");
    expect(reviewPanel).toContain("refreshLiveSingleFileReview(review, liveTool)");
    expect(reviewPanel).toContain('data-live={live ? "true" : undefined}');
  });

  it("renders a Codex-style per-file review with old and new line gutters", () => {
    expect(reviewPanel).toContain('data-turn-review-panel="true"');
    expect(reviewPanel).toContain("data-review-file={file.path}");
    expect(reviewPanel).toContain("styles.oldNumber");
    expect(reviewPanel).toContain("styles.newNumber");
    expect(reviewPanel).toContain('kind: "omitted"');
    expect(reviewStyles).toContain("grid-template-columns: 42px 42px 18px minmax(max-content, 1fr)");
    expect(reviewStyles).toContain(".lineAdd");
    expect(reviewStyles).toContain(".lineDelete");
  });
});
