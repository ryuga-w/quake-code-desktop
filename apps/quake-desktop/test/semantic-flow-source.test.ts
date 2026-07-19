import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const markdown = readFileSync(join(process.cwd(), "src/client/src/components/markdown/MarkdownMessage.tsx"), "utf8");
const toolActivity = readFileSync(join(process.cwd(), "src/client/src/components/markdown/ToolActivityNotice.tsx"), "utf8");
const semanticFlow = readFileSync(join(process.cwd(), "src/client/src/components/markdown/SemanticFlow.tsx"), "utf8");
const markdownRuntime = [markdown, toolActivity, semanticFlow].join("\n");
const markdownStyles = readFileSync(
  join(process.cwd(), "src/client/src/components/markdown/MarkdownMessage.module.css"),
  "utf8",
).replace(/\r\n?/g, "\n");
const thinkingPreview = readFileSync(join(process.cwd(), "src/client/src/lib/thinking-preview.ts"), "utf8");
const splash = readFileSync(join(process.cwd(), "src/client/src/components/chrome/SplashScreen.tsx"), "utf8");
const earlySplash = readFileSync(join(process.cwd(), "src/client/index.html"), "utf8");

describe("Semantic Flow source contract", () => {
  it("keeps thinking ephemeral while tool activity remains inspectable", () => {
    expect(markdownRuntime).toContain("function TurnSemanticFlow");
    expect(markdownRuntime).toContain("<TurnSemanticFlow");
    expect(markdownRuntime).not.toContain('subject: "İstek analiz ediliyor"');
    expect(markdownRuntime).toContain('verb: "", subject: "Düşünüyor", live: true');
    expect(markdownRuntime).toContain("StreamingThinkingIndicator");
    expect(markdownRuntime).toContain("streamingThinkShimmer");
    expect(markdownRuntime).toContain("function TurnWorkDisclosure");
    expect(markdownRuntime).toContain("boyunca çalıştı");
    expect(markdownRuntime).toContain("collapseWork");
    expect(markdownRuntime).toContain("computeTurnDurationMs");
    expect(markdownRuntime).toContain("TurnFileChangesCard");
    expect(markdownRuntime).toContain("collectTurnFileChanges");
    expect(markdownRuntime).toContain('showSemanticHeadline={false}');
    expect(markdownRuntime).toContain("function SemanticFlowSummary");
    expect(markdownRuntime).toContain("SEMANTIC_FLOW_MIN_HOLD_MS = 850");
    expect(markdownRuntime).toContain("SEMANTIC_FLOW_COALESCE_MS = 140");
    expect(markdownRuntime).toContain("SEMANTIC_FLOW_LIVE_MIN_HOLD_MS = 360");
    expect(markdownRuntime).toContain("SEMANTIC_FLOW_LIVE_COALESCE_MS = 70");
    expect(markdownRuntime).toContain("latestPublishedThinkingSummary");
    expect(markdownRuntime).toContain("thinkingPreview={thinkingPreview}");
    expect(thinkingPreview).toContain("stripLeadingContinuationMarker");
    expect(thinkingPreview).not.toContain("return `…${tail");
    expect(markdownRuntime).toContain("const thinkingActive = showThinkingActivity && isStreaming");
    expect(markdownRuntime).not.toContain("function ThinkingBlock");
    expect(markdownRuntime).not.toContain("ToolActivityThoughtRow");
    expect(markdownRuntime).toContain("live: true");
    expect(markdownRuntime).toContain("useLastMeaningfulToolHeadline(headline, pending)");
    expect(markdownRuntime).toContain("useSemanticFlowHeadline(stickyHeadline)");
    expect(markdownRuntime).toContain("isGenericThinkingFallback");
    expect(markdownRuntime).toContain('data-kind={headline.kind}');
    expect(markdownRuntime).toContain("buildConcurrentToolHeadline(activeTools)");
    expect(markdownRuntime).toContain('meta: `${activeTools.length} aktif`');
    expect(markdownRuntime).toContain("SEMANTIC_FLOW_LEAVE_MS = 240");
    expect(markdownRuntime).toContain("SEMANTIC_FLOW_ENTER_MS = 480");
    expect(markdownRuntime).toContain("SEMANTIC_FLOW_LIVE_LEAVE_MS = 110");
    expect(markdownRuntime).toContain("SEMANTIC_FLOW_LIVE_ENTER_MS = 220");
    expect(markdownRuntime).toContain("displayedRef.current = next");
    expect(markdownRuntime).toContain("return lastMeaningfulRef.current || headline");
    expect(markdownRuntime).toContain('kind: "summary", verb: "", subject: batch');
    expect(markdownRuntime).toContain('kind: "summary", verb: "", subject: "Yanıt hazır"');
    expect(markdownRuntime).toContain("toolSemanticSettled");
    expect(markdownRuntime).toContain("toolSemanticLine");
    expect(markdownRuntime).not.toContain('verb: "İşlem özeti"');
    expect(markdownRuntime).not.toContain("toolStatusSummaryCore");
    expect(markdownRuntime).not.toContain('verb: "Tamamlandı", subject: summarizeToolBatch');
    expect(markdownRuntime).not.toContain("toolSemanticSlot");
  });

  it("uses the selected Twin Signal shimmer for both thinking states", () => {
    expect(markdownStyles).toContain(".streamingThinkShimmer,\n.toolSemanticThoughtShimmer");
    expect(markdownStyles).toContain("background-size: 270% 100%");
    expect(markdownStyles).toContain("animation: twinSignalShimmer 2.7s linear infinite");
    expect(markdownStyles).toMatch(/@keyframes twinSignalShimmer \{\s*from \{ background-position: 135% 0; \}\s*to \{ background-position: -35% 0; \}/);
    expect(markdownStyles).not.toContain("premiumThinkShimmer");
  });

  it("renders only the Quake logo in both splash layers", () => {
    expect(splash).toContain('import React from "react"');
    expect(splash).toContain('src="/quake-code-q.png"');
    expect(splash).not.toContain("SPLASH_FLOW_STATES");
    expect(splash).not.toContain("semanticCopy");
    expect(splash).not.toContain("progress");
    expect(splash).not.toContain("Başlatılıyor");
    expect(earlySplash).toContain('class="quake-splash-logo"');
    expect(earlySplash).not.toContain("quake-semantic-copy");
    expect(earlySplash).not.toContain("quake-semantic-progress");
    expect(earlySplash).not.toContain("Quake Code hazırlanıyor");
    expect(earlySplash).not.toContain("quake-logo-glint");
  });

  it("allows Shiki WebAssembly without enabling JavaScript eval", () => {
    expect(earlySplash).toContain("'wasm-unsafe-eval'");
    expect(earlySplash).not.toContain("'unsafe-eval'");
  });
});
