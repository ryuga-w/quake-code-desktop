import React, { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, type ToolCardState } from "../../state/app-store";
import { latestPublishedThinkingSummary } from "../../lib/thinking-preview";
import {
  collectTurnFileChanges,
  mergeTurnTools,
  TurnFileChangesCard,
  type TurnDiffView,
} from "../tools/TurnFileChangesCard";
import { MarkdownContent, SIGNAL_TRAIL_STREAM_ANIMATION } from "./MarkdownContent";
import {
  computeTurnDurationMs,
  noticeOpenKey,
  ToolCallNotice,
  TurnSemanticFlow,
  TurnWorkDisclosure,
} from "./ToolActivityNotice";
import styles from "./MarkdownMessage.module.css";
import { collectToolNoticeBatch } from "./tool-notice-batch";

export {
  computeTurnDurationMs,
  formatTurnWorkDurationLabel,
  StreamingThinkingIndicator,
  ToolCallNotice,
  TurnWorkDisclosure,
} from "./ToolActivityNotice";
export type { ToolActivityTraceEntry } from "./ToolActivityNotice";
type MarkdownMessageProps = {
  text: string;
  onOpenFile: (path: string) => void;
  turnId?: number;
  toolSnapshots?: ToolCardState[];
  /** Parent-driven bust so memo re-renders when store tools settle. */
  toolsEpoch?: number;
  isStreaming?: boolean;
  onOpenDiff?: (tool: ToolCardState) => void;
  onReviewTurn?: (review: TurnDiffView) => void;
  onToast?: (message: string, type?: "info" | "success" | "warning" | "error") => void;
  /** Timeline can own one aggregated activity surface for the whole agent turn. */
  showToolActivity?: boolean;
  /** Thinking is live-only and can be suppressed when a turn-level surface owns it. */
  showThinkingActivity?: boolean;
  /** Codex turn/diff/updated snapshot for expandable unified diffs in the file-change card */
  turnDiff?: TurnDiffView;
  reviewLabel?: string;
};

type MarkdownSegment =
  | { type: "markdown"; content: string; key: string }
  | { type: "thinking"; content: string; key: string }
  | { type: "tools"; names: string[]; key: string };


export const MarkdownMessage = React.memo(function MarkdownMessage({
  text,
  onOpenFile,
  turnId,
  toolSnapshots = [],
  toolsEpoch: _toolsEpoch = 0,
  isStreaming = false,
  onOpenDiff,
  onReviewTurn,
  onToast,
  showToolActivity = true,
  showThinkingActivity = true,
  turnDiff,
  reviewLabel,
}: MarkdownMessageProps) {
  const segments = useMemo(() => splitMarkdownSegments(text || "", turnId), [text, turnId]);
  const thinkingSegments = showThinkingActivity
    ? segments.filter((segment): segment is Extract<MarkdownSegment, { type: "thinking" }> => segment.type === "thinking")
    : [];
  // Thinking is ephemeral: use only its short live Semantic Flow preview. Never
  // mount the full reasoning body in settled chat or historical tool details.
  const thinkingActive = showThinkingActivity && isStreaming && thinkingSegments.length > 0;
  const thinkingPreview = latestPublishedThinkingSummary(thinkingSegments.map((segment) => segment.content).join("\n"));
  const toolSegments = segments.filter((segment): segment is Extract<MarkdownSegment, { type: "tools" }> => segment.type === "tools");
  const visibleToolSegments = showToolActivity ? toolSegments : [];
  const turnToolNames = Array.from(new Set(visibleToolSegments.flatMap((segment) => segment.names)));
  const hasTools = showToolActivity && (visibleToolSegments.length > 0 || toolSnapshots.length > 0);
  const hasTurnFlow = thinkingActive || visibleToolSegments.length > 0;
  // Past turns: collapse tool work under "Xm Ys boyunca çalıştı". Live turns stay open.
  const collapseWork = !isStreaming && hasTools;
  const liveTurnTools = useAppStore(useShallow((state) => {
    if (!turnId) return [] as ToolCardState[];
    const matched: ToolCardState[] = [];
    for (const id in state.tools) {
      const tool = state.tools[id];
      if (tool.turnId === turnId) matched.push(tool);
    }
    return matched;
  }));
  const turnTools = useMemo(() => mergeTurnTools(toolSnapshots, liveTurnTools), [liveTurnTools, toolSnapshots]);
  const workDurationMs = useMemo(() => computeTurnDurationMs(turnTools), [turnTools]);
  // One persistent file-change card spans the live and settled phases. As soon
  // as mutation args/path arrive it opens the payload; the same rows then morph
  // from "Düzenleniyor" to "Düzenlendi" without remounting a second surface.
  const fileChanges = useMemo(
    () => (showToolActivity ? collectTurnFileChanges(turnTools, turnDiff) : []),
    [showToolActivity, turnTools, turnDiff],
  );
  const workBody = (
    <>
      {hasTurnFlow && (
        <TurnSemanticFlow
          hasThinking={thinkingActive}
          isStreaming={isStreaming}
          names={turnToolNames}
          thinkingPreview={thinkingPreview}
          toolSnapshots={showToolActivity ? toolSnapshots : []}
          turnId={showToolActivity ? turnId : undefined}
        />
      )}
      {segments.map((segment) => {
        if (segment.type === "tools") {
          return showToolActivity
            ? <ToolCallNotice
                names={segment.names}
                turnId={turnId}
                toolSnapshots={toolSnapshots}
                key={segment.key}
                showSemanticHeadline={false}
                turnDiff={turnDiff}
                onInspectFileChange={onReviewTurn}
              />
            : null;
        }
        return null;
      })}
    </>
  );

  return (
    <div className={`${styles.message} streamdown-msg`}>
      {collapseWork ? (
        <TurnWorkDisclosure openKey={`msg:${turnId ?? "x"}:${turnToolNames.join("|")}`} durationMs={workDurationMs}>
          {workBody}
        </TurnWorkDisclosure>
      ) : (
        workBody
      )}
      {segments.map((segment) => {
        if (segment.type === "thinking" || segment.type === "tools") return null;
        return <MarkdownContent
          adaptiveSignalTrail={isStreaming}
          animated={isStreaming ? SIGNAL_TRAIL_STREAM_ANIMATION : false}
          content={segment.content}
          isStreaming={isStreaming}
          key={segment.key}
          onOpenFile={onOpenFile}
        />;
      })}
      {fileChanges.length > 0 && (
        <TurnFileChangesCard
          tools={turnTools}
          turnDiff={turnDiff}
          turnId={turnId}
          reviewLabel={reviewLabel}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
          onInspect={onReviewTurn}
          onToast={onToast}
        />
      )}
    </div>
  );
}, areMarkdownMessagePropsEqual);

function areMarkdownMessagePropsEqual(prev: MarkdownMessageProps, next: MarkdownMessageProps): boolean {
  return prev.text === next.text
    && prev.turnId === next.turnId
    && prev.toolSnapshots === next.toolSnapshots
    && prev.toolsEpoch === next.toolsEpoch
    && prev.isStreaming === next.isStreaming
    && prev.onOpenDiff === next.onOpenDiff
    && prev.onReviewTurn === next.onReviewTurn
    && prev.onToast === next.onToast
    && prev.showToolActivity === next.showToolActivity
    && prev.showThinkingActivity === next.showThinkingActivity
    && prev.turnDiff === next.turnDiff
    && prev.reviewLabel === next.reviewLabel;
}

function splitMarkdownSegments(text: string, turnId?: number): MarkdownSegment[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const segments: MarkdownSegment[] = [];
  let markdownStart = 0;
  const pushMarkdown = (end: number) => {
    const content = lines.slice(markdownStart, end).join("\n").trim();
    if (content) segments.push({ type: "markdown", content, key: `markdown-${markdownStart}` });
  };

  let fence: "```" | "~~~" | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const fenceMatch = trimmed.match(/^(```|~~~)/);
    if (fenceMatch) {
      const marker = fenceMatch[1] as "```" | "~~~";
      if (!fence) fence = marker;
      else if (fence === marker) fence = undefined;
      continue;
    }
    if (fence) continue;

    if (trimmed === "[thinking]") {
      pushMarkdown(index);
      const closeIndex = lines.findIndex((line, candidateIndex) => candidateIndex > index && line.trim() === "[/thinking]");
      const end = closeIndex === -1 ? lines.length : closeIndex;
      segments.push({ type: "thinking", content: lines.slice(index + 1, end).join("\n").trim(), key: `thinking-${index}` });
      index = closeIndex === -1 ? lines.length : closeIndex;
      markdownStart = index + 1;
      continue;
    }

    const toolBatch = collectToolNoticeBatch(lines, index);
    if (!toolBatch) continue;
    pushMarkdown(index);
    segments.push({
      type: "tools",
      names: toolBatch.names,
      key: noticeOpenKey(turnId, toolBatch.names),
    });
    index = toolBatch.nextIndex - 1;
    markdownStart = toolBatch.nextIndex;
  }

  pushMarkdown(lines.length);
  return segments;
}
