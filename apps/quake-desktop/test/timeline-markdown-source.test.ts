import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const main = readFileSync(join(process.cwd(), "src/client/src/app/App.tsx"), "utf8");
const sse = readFileSync(join(process.cwd(), "src/client/src/app/sse/createServerEventHandlers.ts"), "utf8");
const timeline = readFileSync(join(process.cwd(), "src/client/src/components/timeline/Timeline.tsx"), "utf8");
const timelineLogic = readFileSync(join(process.cwd(), "src/client/src/components/timeline/timeline-logic.ts"), "utf8");
const markdown = readFileSync(join(process.cwd(), "src/client/src/components/markdown/MarkdownMessage.tsx"), "utf8");
const markdownContent = readFileSync(join(process.cwd(), "src/client/src/components/markdown/MarkdownContent.tsx"), "utf8");
const toolActivity = readFileSync(join(process.cwd(), "src/client/src/components/markdown/ToolActivityNotice.tsx"), "utf8");
const markdownStyles = readFileSync(join(process.cwd(), "src/client/src/components/markdown/MarkdownMessage.module.css"), "utf8");
const timelineStyles = readFileSync(join(process.cwd(), "src/client/src/components/timeline/timeline.css"), "utf8");
const turnFileChangesStyles = readFileSync(join(process.cwd(), "src/client/src/components/tools/TurnFileChangesCard.module.css"), "utf8");
const tailwind = readFileSync(join(process.cwd(), "src/client/tailwind.css"), "utf8");
const styles = readFileSync(join(process.cwd(), "src/client/styles.css"), "utf8");

describe("timeline markdown rendering contract", () => {
  it("uses the canonical MarkdownMessage renderer for both streaming and settled assistant text", () => {
    expect(timeline).toMatch(/<MarkdownMessage\s+text=\{text\}\s+turnId=\{turnId\}\s+toolSnapshots=\{toolSnapshots\}[\s\S]*?isStreaming=\{Boolean\(item\.message\.__streaming\)\}[\s\S]*?\/>/,
    );
    expect(timeline).not.toContain("<TypewriterMarkdown");
    expect(main).not.toContain('from "./components/markdown/StreamingMarkdown"');
    expect(markdown).toContain("<MarkdownContent");
    expect(markdownContent).toContain('from "streamdown"');
    expect(markdownContent).toContain('mode={isStreaming ? "streaming" : "static"}');
    expect(markdown).toContain("adaptiveSignalTrail={isStreaming}");
    expect(markdown).toContain("animated={isStreaming ? SIGNAL_TRAIL_STREAM_ANIMATION : false}");
    expect(markdown).not.toContain('caret={isStreaming ? "block" : undefined}');
    expect(markdownContent).toContain('animation: "signalTrail"');
    expect(markdownContent).toContain("signalTrailAnimationStartIndex");
    expect(markdownContent).toContain('querySelectorAll<HTMLElement>("[data-sd-animate]")');
    expect(markdownContent).toContain("new WeakSet<HTMLElement>()");
    expect(styles).toContain("@keyframes sd-signalTrailFast");
    expect(styles).toContain("@keyframes sd-signalTrail");
    expect(styles).toContain("@keyframes sd-signalTrailSlow");
    expect(styles).not.toContain("@keyframes response-stream-caret");
    expect(markdownContent).toContain("remarkQuakeFileLinks");
    expect(markdown).toContain("if (fence) continue");
    expect(markdownContent).toContain("Object.values(defaultRemarkPlugins)");
    expect(markdownContent).toContain('from "@streamdown/mermaid"');
    expect(markdownContent).toContain('from "@streamdown/math"');
    expect(markdownContent).toContain('import "katex/dist/katex.min.css"');
    expect(markdownContent).toContain('securityLevel: "strict"');
    expect(markdownContent).toContain('name !== "raw"');
    expect(markdownContent).toContain("remarkLiteralFootnotes");
    expect(markdownContent).toContain('`qc-md-ul ${className}`');
    expect(markdownContent).toContain('`qc-md-li ${className}`');
    expect(tailwind).toContain('@source "../../../../node_modules/streamdown/dist/*.js"');
    expect(tailwind).toContain('@source "../../../../node_modules/@streamdown/math/dist/*.js"');
    expect(tailwind).toContain('@source "../../../../node_modules/@streamdown/mermaid/dist/*.js"');
    expect(styles).not.toContain("--muted: var(--paper-soft)");
    expect(styles).toContain('[data-streamdown="code-block-actions"]');
    expect(styles).toContain('[data-streamdown="code-block-copy-button"]');
    expect(styles).toContain("flex: 0 0 28px !important");
    expect(styles).toMatch(
      /\.streamdown-scope :where\(:not\(pre\) > code\),\s*\.inline-code \{[\s\S]*?border-radius: 4px;[\s\S]*?background: color-mix\(in srgb, var\(--heading\) 7%, transparent\) !important;[\s\S]*?font-family: var\(--font-mono\);[\s\S]*?font-size: 0\.88em;/,
    );
    expect(styles).not.toMatch(
      /\.streamdown-scope :where\(:not\(pre\) > code\),\s*\.inline-code \{[^}]*background: transparent !important;/,
    );
    expect(styles).toContain("--chat-column-max-width: 736px;");
    expect(styles).toContain("--composer-max-width: 736px;");
    expect(styles).toContain("--codex-chat-copy: 15px;");
    expect(styles).toContain("--codex-chat-line: 1.62;");
    expect(styles).toContain("font: 13px/1.62 var(--font-mono);");
    expect(styles).toContain("font-size: 14px;");
    expect(styles).toContain('.qc-md-ul.contains-task-list > .qc-md-li.task-list-item');
    expect(styles).toContain('input[type="checkbox"]:checked');
    expect(styles).toContain("list-style-position: outside !important;");
    expect(styles).toContain("list-style-type: disc !important;");
    expect(styles).toContain("list-style-type: circle !important;");
    expect(styles).toContain("list-style-type: square !important;");
    expect(styles).toContain("list-style-type: decimal !important;");
    expect(styles).toContain("padding-inline-start: 1.55em !important;");
    expect(styles).toContain('.qc-md-li > [data-streamdown="code-block"]');
    expect(styles).not.toContain("counter-reset: qc-md-ol");
    expect(styles).toContain('[data-streamdown="code-block-body"]');
    expect(styles).toContain('[data-streamdown="table-wrapper"]');
    expect(styles).toContain(".streamdown-scope .katex-display");
    expect(styles).toContain(".streamdown-scope blockquote::before");
    expect(styles).toContain("padding: 1px 0 1px 24px !important;");
    expect(styles).toContain("width: 4px;");
    expect(styles).toContain(".streamdown-scope blockquote blockquote");
    expect(styles).not.toMatch(/\.user-msg-bubble:hover,\s*\.user-msg-bubble:focus-within\s*\{[^}]*background:/);
    expect(styles).not.toMatch(/\.user-msg-bubble:hover,\s*\.user-msg-bubble:focus-within\s*\{[^}]*border-color:/);
    expect(styles).toContain(".user-msg-bubble:hover .user-msg-actions");
    expect(styles).toContain("--user-bubble-bg: #1b1b1d;");
    expect(styles).not.toContain("--user-bubble-bg: color-mix");
    expect(styles).not.toContain("background: #e7e7e9");
    expect(styles).toMatch(/\.streamdown-scope \[data-streamdown="table-header"\] \{\s*background: transparent;\s*\}/);
    expect(styles).toMatch(/\.streamdown-scope th \{\s*background: transparent;/);
  });

  it("reveals assistant copy actions without changing row height", () => {
    expect(timelineStyles).toMatch(/\.assistant-message-actions \{[\s\S]*?min-height: 24px;[\s\S]*?max-height: 24px;[\s\S]*?margin-top: 4px;/);
    expect(timelineStyles).toMatch(/\.message\.assistant:hover \.assistant-message-actions,[\s\S]*?opacity: 1;[\s\S]*?pointer-events: auto;/);
    expect(timelineStyles).not.toMatch(/\.message\.assistant:hover \.assistant-message-actions,[\s\S]*?max-height:/);
    expect(timelineStyles).not.toContain("transition: opacity var(--duration-fast, 120ms) ease, max-height");
  });

  it("draws a stable divider below each worked-duration heading", () => {
    expect(markdownStyles).toMatch(
      /\.turnWorkSummary \{[\s\S]*?display: flex;[\s\S]*?width: 100%;[\s\S]*?border-bottom: 1px solid color-mix\(in srgb, var\(--heading\) 8%, transparent\);/,
    );
    expect(markdownStyles).toMatch(/\.turnWorkBody \{[\s\S]*?border-top: 0;/);
  });

  it("aligns the turn file-change card to the composer width", () => {
    expect(styles).toMatch(/\.timeline \{[\s\S]*?container-type: inline-size;/);
    expect(turnFileChangesStyles).toContain("var(--composer-max-width, 720px)");
    expect(turnFileChangesStyles).toContain("100cqi - (var(--chat-column-gutter, 24px) * 2)");
    expect(turnFileChangesStyles).toContain("transform: translateX(-50%)");
    expect(turnFileChangesStyles).toContain("box-shadow: none");
    expect(turnFileChangesStyles).toContain("min-height: 38px");
    expect(turnFileChangesStyles).not.toContain("width: min(520px, 100%)");
  });

  it("archives turn messages separately from tool history while keeping the final answer outside", () => {
    expect(main).toContain("const agentTurnActiveRef = useRef(false)");
    expect(main).toContain("const agentLifecycleActiveRef = useRef(false)");
    expect(sse).toContain('if (event?.type === "agent_start")');
    expect(main).toContain("createServerEventHandlers");
    expect(main).toContain("function ensureAgentTurn()");
    expect(main).not.toContain("currentTurnRef.current += 1");
    expect(timelineLogic).toContain("const turnGroups = new Map<string, ToolTurnAccumulator>()");
    expect(timelineLogic).toContain("const groupAnchorKeys = new Map<string, string>()");
    expect(timelineLogic).toContain("groupAnchorKeys.set(groupKey, item.key)");
    expect(timelineLogic).toContain("const isGroupAnchor = groupAnchorKeys.get(groupKey) === item.key");
    expect(timelineLogic).toContain("if (group && isGroupAnchor && !emittedGroups.has(groupKey))");
    expect(timelineLogic).toContain("group.traceEntries.push({ kind: \"tool\", key: toolKey, toolId: tool.id })");
    expect(timelineLogic).not.toContain('group.traceEntries.push({ kind: "thinking"');
    expect(timelineLogic).not.toContain('group.traceEntries.push({ kind: "narration"');
    expect(timelineLogic).toContain("const nestedWorkMessageKeys = new Set<string>()");
    expect(timelineLogic).toContain("const latestAssistantMessage = [...turnMessages].reverse().find");
    expect(timelineLogic).toContain("const finalAssistantMessage = latestAssistantMessage");
    expect(timelineLogic).toContain("group.pending = group.pending && !finalAssistantMessage");
    expect(timelineLogic).toContain('if (role === "user") {');
    expect(timelineLogic).toContain("const isFinalAssistant = item.key === finalAssistantMessage?.key");
    expect(timelineLogic).toContain("the previous tool batch closes before the message");
    expect(timelineLogic).toContain("currentBatch = undefined");
    expect(timelineLogic).toContain('key: `${group.key}:batch:${batchIndex}`');
    expect(timelineLogic).not.toContain('orderedEntries.at(-1)?.kind === "message"');
    expect(timelineLogic).toContain("batch !== latestBatch");
    expect(timelineLogic).toContain("if (nestedWorkMessageKeys.has(item.key)) continue");
    expect(timeline).toContain('className="turn-work-entries"');
    expect(timeline).toContain("renderTimelineItem(entry.item)");
    expect(timeline).toContain('historyScope="snapshot"');
    expect(timeline).toContain("{workEntries}");
    expect(timelineLogic).toContain("suppressToolActivity: true");
    expect(timelineLogic).toContain("suppressThinkingActivity: true");
    expect(timelineLogic).toContain("suppressedThinkingMessageKeys.add(item.key)");
    expect(timeline).toContain("showThinkingActivity={!item.suppressThinkingActivity}");
    expect(markdown).toContain("showThinkingActivity = true");
    expect(markdown).toContain("prev.showThinkingActivity === next.showThinkingActivity");
    expect(timeline).toContain("traceEntries={entry.traceEntries}");
    expect(timelineLogic).toContain("workEntries: group.workEntries");
    expect(timeline).toContain("thinkingActive={entry.thinkingActive}");
    expect(timelineLogic).toContain("if (activeStreamingTurnId)");
    expect(timelineLogic).toContain('turnGroups.get(`turn:${activeStreamingTurnId}`)');
    expect(timeline).toContain("activeStreamingTurnId");
    expect(timelineLogic).toContain("key: `tool-turn:${turnId ?? item.key}`");
    expect(toolActivity).toContain('export type ToolActivityTraceEntry = { kind: "tool"; key: string; toolId: string };');
    expect(toolActivity).toContain("only actual tool execution rows belong to history");
    expect(toolActivity).toContain('type ToolNoticeHistoryScope = "matching" | "all" | "snapshot"');
    expect(toolActivity).toContain("selectNoticeSnapshotLiveTools");
    expect(toolActivity).toContain('activityKey ? `notice:${activityKey}`');
    expect(toolActivity).not.toContain("function ToolActivityThoughtRow");
    expect(toolActivity).not.toContain("function ToolActivityNarrationRow");
    expect(toolActivity).not.toContain("<ThinkingBlock");
    expect(markdownStyles).not.toContain(".toolActivityThought");
    expect(markdownStyles).not.toContain(".toolActivityNarration");
    expect(timelineLogic).toContain('if (message?.role === "user") {');
    expect(timelineLogic).toContain("byMessage.set(message, { turnId, tools: [] })");
    expect(timelineLogic).toContain("conversationTurn = advanceConversationTurn(conversationTurn, message)");
    expect(markdown).toContain("showToolActivity = true");
  });
});
