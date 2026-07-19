import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StickToBottom, type StickToBottomContext } from "use-stick-to-bottom";
import { Box, Copy, FileText } from "lucide-react";
import { textFromMessage } from "../../lib/render";
import {
  artifactTemplateMessageMeta,
  artifactTemplateRestorePrompt,
  type ArtifactTemplateMessageMeta,
} from "../../lib/artifact-template-message";
import { useAppStore, type ToolCardState } from "../../state/app-store";
import {
  computeTurnDurationMs,
  MarkdownMessage,
  StreamingThinkingIndicator,
  ToolCallNotice,
  TurnWorkDisclosure,
} from "../markdown/MarkdownMessage";
import {
  PendingMessagesInChat,
  TimelineAnnouncer,
  TimelineHeader,
  TimelineJumpBottom,
  type TimelineFilter,
  type TimelineHeaderContext,
} from "./TimelineChrome";
import { CreatedPlanCard } from "../plan/PlanTimelineCards";
import { useContextMenu } from "../chrome/ContextMenu";
import { imagesFromMessage } from "../../lib/client-ids";
import { copyTextWithToast } from "../../lib/copy-toast";
import { formatDuration, statusLabel } from "../../lib/format-utils";
import { summarizeToolArgs, toolDisplayName, toolPreviewText, toolSortTime } from "../../lib/tool-helpers";
import type { ComposerImage, QueuedUserMessage, TurnReviewView } from "../../types";
import {
  EMPTY_TOOL_STATE,
  TIMELINE_INITIAL_WINDOW,
  TIMELINE_WINDOW_STEP,
  TIMELINE_CANDIDATE_OVERSCAN,
} from "../../constants";
import {
  buildMessageToolHistory,
  buildAbortedTurnDurationMap,
  countConversationTurns,
  formatAbortedTurnLabel,
  formatUserBubbleTime,
  groupTimelineRows,
  isAbortedAssistantMessage,
  isPlanDocumentTimelineMessage,
  isHiddenTimelineMessage,
  isPlanProtocolToolName,
  isToolOnlyAssistantMessage,
  isUserMessageSentAsGoal,
  messageSortTime,
  messageTimelineKey,
  resolveTimelineTurnDiff,
  selectTimelineHistoryMessages,
  selectTimelineToolsView,
  selectTimelineVisibleMessages,
  stripGoalRuntimeEnvelope,
  type TimelineMessageItem,
  type TimelineRowItem,
  type TimelineToolItem,
} from "./timeline-logic";

export function LiveTimeline(props: {
  imageAttachments: Record<string, ComposerImage[]>;
  filter: TimelineFilter;
  onFilterChange: (filter: TimelineFilter) => void;
  conversationKey?: string;
  scrollRequest?: number;
  pendingMessages?: QueuedUserMessage[];
  onRemovePending?: (id: string) => void;
  onSendPending?: (item: QueuedUserMessage) => void;
  onInspectTool: (id: string) => void;
  onOpenFile: (path: string) => void;
  onOpenDiff?: (card: ToolCardState) => void;
  onReviewTurn?: (review: TurnReviewView) => void;
  onToast?: (message: string, type?: "info" | "success" | "warning" | "error") => void;
  onPreviewImage: (image: ComposerImage) => void;
  onOpenPlan: () => void;
  onOpenArtifactTemplateSkill?: (skillName: string) => void;
  onForkFromMessage?: (entryId: string) => void;
  forkingEntryId?: string | null;
  plan?: import("../../../../shared/protocol").WebPlanState;
  compactOverlay?: boolean;
  /** Codex turn/diff/updated — latest aggregated unified diff for file-change card */
  turnDiff?: TurnReviewView;
  /** Per conversation-turn snapshots for history restore */
  turnDiffsByTurn?: Record<string, TurnReviewView>;
}) {
  const messages = useAppStore((state) => state.messages);
  const streamingMessage = useAppStore((state) => state.streamingMessage);
  return <Timeline messages={messages} streamingMessage={streamingMessage} {...props} />;
}

export function ArtifactTemplateUserMessage({
  meta,
  onOpenSkill,
}: {
  meta: ArtifactTemplateMessageMeta;
  onOpenSkill?: (skillName: string) => void;
}) {
  return <div className="user-artifact-template-content">
    <span className="user-artifact-documents">
      <span className="user-artifact-documents-icon" aria-hidden="true"><FileText size={12} strokeWidth={2} /></span>
      <span>Documents</span>
    </span>
    <button
      type="button"
      className="user-artifact-skill"
      title={`${meta.displayName} SKILL.md dosyasını aç`}
      onClick={() => onOpenSkill?.(meta.skillName)}
    >
      <Box size={13} strokeWidth={1.8} aria-hidden="true" />
      <span>{meta.displayName}</span>
    </button>
    {meta.userText ? <span className="user-artifact-prompt">{meta.userText}</span> : null}
  </div>;
}

function userMessageClipboardText(meta: ArtifactTemplateMessageMeta | undefined, visibleText: string): string {
  if (!meta) return visibleText;
  return [`Documents · ${meta.displayName}`, meta.userText].filter(Boolean).join("\n");
}

export function TimelineInner({
  messages,
  streamingMessage,
  imageAttachments,
  filter,
  conversationKey,
  scrollRequest,
  pendingMessages = [],
  onRemovePending,
  onSendPending,
  onInspectTool,
  onOpenFile,
  onOpenDiff,
  onReviewTurn,
  onToast,
  onPreviewImage,
  onOpenPlan,
  onOpenArtifactTemplateSkill,
  onForkFromMessage,
  forkingEntryId = null,
  plan,
  compactOverlay = false,
  turnDiff,
  turnDiffsByTurn,
}: {
  messages: any[];
  streamingMessage?: any;
  imageAttachments: Record<string, ComposerImage[]>;
  filter: TimelineFilter;
  onFilterChange: (filter: TimelineFilter) => void;
  conversationKey?: string;
  scrollRequest?: number;
  pendingMessages?: QueuedUserMessage[];
  onRemovePending?: (id: string) => void;
  onSendPending?: (item: QueuedUserMessage) => void;
  onInspectTool: (id: string) => void;
  onOpenFile: (path: string) => void;
  onOpenDiff?: (card: ToolCardState) => void;
  onReviewTurn?: (review: TurnReviewView) => void;
  onToast?: (message: string, type?: "info" | "success" | "warning" | "error") => void;
  onPreviewImage: (image: ComposerImage) => void;
  onOpenPlan: () => void;
  onOpenArtifactTemplateSkill?: (skillName: string) => void;
  onForkFromMessage?: (entryId: string) => void;
  forkingEntryId?: string | null;
  plan?: import("../../../../shared/protocol").WebPlanState;
  compactOverlay?: boolean;
  turnDiff?: TurnReviewView;
  turnDiffsByTurn?: Record<string, TurnReviewView>;
}) {
  const [windowSize, setWindowSize] = useState(TIMELINE_INITIAL_WINDOW);
  const agentIsStreaming = useAppStore((state) => Boolean(state.state?.isStreaming));
  const toolState = useAppStore((state) => filter === "messages" ? EMPTY_TOOL_STATE : state.tools);
  // Bust MarkdownMessage memo when tools settle so turn file-change cards appear.
  const toolsEpoch = useAppStore((state) => {
    let epoch = 0;
    for (const id in state.tools) {
      const tool = state.tools[id];
      epoch = (epoch + (tool.updatedAt || 0) + (tool.status === "done" || tool.status === "error" ? 17 : 3)) | 0;
    }
    return epoch;
  });
  const errorCount = useAppStore((state) => {
    let count = 0;
    for (const tool of Object.values(state.tools)) {
      if (isPlanProtocolToolName(tool.toolName)) continue;
      if (tool.status === "error") count += 1;
    }
    return count;
  });
  const visibleSelection = useMemo(() => selectTimelineVisibleMessages(messages, filter, windowSize, plan), [messages, filter, windowSize, plan?.artifact?.id, plan?.artifact?.revision]);
  const toolView = useMemo(() => selectTimelineToolsView(toolState, filter, windowSize + TIMELINE_CANDIDATE_OVERSCAN), [filter, toolState, windowSize]);
  const timelineMessages = visibleSelection.messages;
  const abortedTurnDurations = useMemo(() => buildAbortedTurnDurationMap(messages), [messages]);
  const streamingText = useMemo(() => streamingMessage ? textFromMessage(streamingMessage) : "", [streamingMessage]);
  // Akan mesaj — virtualizer DISINDA, altta sabit render edilir (P1/P4).
  const streamingItem = useMemo(
    () => (streamingMessage && !isHiddenTimelineMessage(streamingMessage) && !isPlanDocumentTimelineMessage(streamingMessage, plan) && filter !== "tools" && filter !== "errors")
      ? { ...streamingMessage, __streaming: true }
      : undefined,
    [streamingMessage, filter, plan?.artifact?.id, plan?.artifact?.revision],
  );
  const activeStreamingTurnId = agentIsStreaming
    ? Number(streamingItem?.turnId || countConversationTurns(messages) || 0) || undefined
    : undefined;
  const timelineHistoryMessages = useMemo(() => selectTimelineHistoryMessages(messages, visibleSelection, windowSize), [messages, visibleSelection, windowSize]);
  // The default "Mesajlar" filter intentionally hides standalone tool cards.
  // Include the ephemeral assistant message here so a streamed apply_patch/write
  // still owns its file path, partial payload, and growing +/- counts before
  // message_end persists it into the regular history array.
  const messageToolHistory = useMemo(
    () => buildMessageToolHistory(timelineHistoryMessages, streamingItem),
    [streamingItem, timelineHistoryMessages],
  );
  const timelineTools = toolView.tools;
  const messageStartIndex = visibleSelection.startIndex;
  const totalTimelineCount = visibleSelection.total + toolView.total;
  const timelineItems = useMemo(() => [
    ...timelineMessages.map((message, index) => {
      const sourceIndex = messageStartIndex + index;
      return { kind: "message" as const, key: messageTimelineKey(message, sourceIndex), time: messageSortTime(message, sourceIndex), message };
    }),
    ...timelineTools.map((card) => ({ kind: "tool" as const, key: `t-${card.id}`, time: toolSortTime(card), card })),
  ].sort((a, b) => a.time - b.time), [messageStartIndex, timelineMessages, timelineTools]);
  const visibleTimelineItems = useMemo(() => timelineItems.length > windowSize ? timelineItems.slice(-windowSize) : timelineItems, [timelineItems, windowSize]);
  const hiddenTimelineCount = totalTimelineCount - visibleTimelineItems.length;
  // Stick-to-bottom: StackBlitz use-stick-to-bottom (AI chat streaming spring scroll).
  // Kullanici yukari kayinca serbest birakir; dipteyken icerik buyudukce alta kilitler.
  const stickContextRef = useRef<StickToBottomContext | null>(null);
  const pendingOlderAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const { open: openContextMenu, menu: contextMenu } = useContextMenu();
  const isToolOnlyItem = (item: TimelineRowItem) => {
    if (item.kind === "toolGroup") return true;
    if (item.kind !== "message" || item.message.role !== "assistant") return false;
    const itemText = item.message.__streaming ? streamingText : textFromMessage(item.message);
    return isToolOnlyAssistantMessage(itemText);
  };

  const renderTimelineItem = (item: TimelineRowItem): React.ReactNode => {
    if (item.kind === "tool") return <TimelineToolCard card={item.card} onInspect={() => onInspectTool(item.card.id)} />;
    if (item.kind === "toolGroup") {
      const groupTurnDiff = resolveTimelineTurnDiff(
        item.turnId,
        turnDiffsByTurn,
        item.pending ? turnDiff : undefined,
      );
      const workEntries = (
        <div className="turn-work-entries" aria-label="Çalışma akışı">
          {item.workEntries.map((entry) => (
            <div className={`turn-work-entry turn-work-entry-${entry.kind}`} key={entry.key}>
              {entry.kind === "message"
                ? renderTimelineItem(entry.item)
                : (
                  <ToolCallNotice
                    activityKey={entry.key}
                    names={entry.names}
                    turnId={item.turnId}
                    toolSnapshots={entry.toolSnapshots}
                    pendingOverride={entry.pending}
                    historyScope="snapshot"
                    traceEntries={entry.traceEntries}
                    thinkingPreview={entry.thinkingPreview}
                    thinkingActive={entry.thinkingActive}
                    turnDiff={groupTurnDiff}
                    onInspectFileChange={onReviewTurn}
                  />
                )}
            </div>
          ))}
        </div>
      );
      // Settled tool groups collapse under duration so past tasks stay compact.
      // File-change summary card is rendered on the final assistant answer (MarkdownMessage)
      // to avoid double cards for the same turn.
      const body = item.pending
        ? workEntries
        : (
          <TurnWorkDisclosure
            openKey={`group:${item.turnId ?? "x"}:${item.key}`}
            durationMs={computeTurnDurationMs(item.toolSnapshots)}
          >
            {workEntries}
          </TurnWorkDisclosure>
        );
      return <article className="message assistant clean-assistant tool-only-message">
        <div className="message-body">{body}</div>
      </article>;
    }
    // Akan mesaj icin metni yeniden uretme — yukarida bir kez hesaplandi (P3).
    let text = item.message.__streaming ? streamingText : textFromMessage(item.message);
    const persistedImages = item.message.role === "user" ? imagesFromMessage(item.message) : [];
    const attached = item.message.role === "user" ? imageAttachments[text] || persistedImages : [];
    const toolHistory = messageToolHistory.get(item.message);
    const turnId = toolHistory?.turnId || item.message.turnId;
    const toolSnapshots = toolHistory?.tools || [];
    const isAssistant = item.message.role === "assistant";
    // custom (extension) messages have no glyph column — use full-width like assistant
    const isCustom = item.message.role === "custom" || Boolean(item.message.customType);
    const toolOnly = isAssistant && isToolOnlyAssistantMessage(text);
    const isUser = item.message.role === "user";

    // Antigravity user bubble: soldan pill, hover'da saat + kopyala + geri al + dallandır
    if (isUser) {
      const timeLabel = formatUserBubbleTime(item.message);
      const sentAsGoal = isUserMessageSentAsGoal(item.message, text);
      const displayText = sentAsGoal ? stripGoalRuntimeEnvelope(text) : text;
      const artifactTemplate = artifactTemplateMessageMeta(item.message, displayText);
      const visibleUserText = artifactTemplate?.userText ?? displayText;
      const multiLine = visibleUserText.includes("\n") || visibleUserText.length > 72;
      // Stable session JSONL entry id from getTimelineMessages(); required by fork_session.
      const entryId = String(item.message?.messageId || item.message?.id || "").trim();
      const canFork = Boolean(entryId && onForkFromMessage && !item.message?.__localOptimistic);
      const forkBusy = Boolean(forkingEntryId && entryId && forkingEntryId === entryId);
      const forkAnyBusy = Boolean(forkingEntryId);
      const contextItems = [
        { id: "copy", label: "Metni kopyala", onSelect: () => { void navigator.clipboard?.writeText(userMessageClipboardText(artifactTemplate, visibleUserText)); } },
        ...(canFork
          ? [{
              id: "fork",
              label: forkBusy ? "Dallandırılıyor…" : "Buradan dallandır",
              onSelect: () => { if (!forkAnyBusy) onForkFromMessage?.(entryId); },
            }]
          : []),
      ];
      return (
        <article
          className={`message user clean-user ${attached.length ? "has-attachments" : ""} ${multiLine ? "user-multi" : ""} ${sentAsGoal ? "user-goal" : ""} ${artifactTemplate ? "user-artifact-template" : ""}`}
          tabIndex={0}
          aria-label="Kullanıcı mesajı"
          onContextMenu={(event) => {
            event.preventDefault();
            openContextMenu(event, contextItems);
          }}
        >
          {attached.length > 0 && <UserImageAttachments images={attached} onPreview={onPreviewImage} />}
          <div className="user-msg-bubble">
            {artifactTemplate
              ? <ArtifactTemplateUserMessage meta={artifactTemplate} onOpenSkill={onOpenArtifactTemplateSkill} />
              : <ExpandableUserMessage text={displayText} />}
            <div className="user-msg-actions">
              {timeLabel ? <span className="user-msg-time">{timeLabel}</span> : null}
              <button
                type="button"
                className="user-msg-action"
                aria-label="Kopyala"
                title="Kopyala"
                onClick={() => { void navigator.clipboard?.writeText(userMessageClipboardText(artifactTemplate, visibleUserText)); }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
              </button>
              <button
                type="button"
                className="user-msg-action"
                aria-label="Mesajı düzenle"
                title="Mesajı düzenle"
                onClick={() => {
                  try {
                    window.dispatchEvent(new CustomEvent("quake:restore-user-prompt", { detail: { text: artifactTemplate ? artifactTemplateRestorePrompt(artifactTemplate) : displayText } }));
                  } catch { /* ignore */ }
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>
              </button>
              {canFork && (
                <button
                  type="button"
                  className="user-msg-action"
                  aria-label="Buradan dallandır"
                  title="Buradan dallandır"
                  disabled={forkAnyBusy}
                  aria-busy={forkBusy || undefined}
                  onClick={() => onForkFromMessage?.(entryId)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8.5 7.5c2.5 0 5 2 5 6.5v2" /><path d="M15.5 7.5c-1.2 0-2.2.4-3 1.1" /><path d="M6 8.5v7" /></svg>
                </button>
              )}
            </div>
          </div>
          {sentAsGoal ? (
            <div className="user-goal-meta" aria-label="Hedef olarak gönderildi">
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2" /></svg>
              <span>Hedef olarak gönderildi</span>
            </div>
          ) : null}
        </article>
      );
    }

    if (item.message.customType === "plan-created") {
      const planId = String(item.message.details?.planId || "");
      const title = String(item.message.details?.title || text || "Uygulama Planı");
      const currentArtifact = plan?.artifact;
      const markdown = String(
        item.message.details?.markdown
          || (currentArtifact && String(currentArtifact.id) === planId ? currentArtifact.markdown : "")
          || "",
      );
      return <article className="message custom clean-assistant"><div className="message-body"><CreatedPlanCard title={title} markdown={markdown} onOpen={onOpenPlan} onOpenFile={onOpenFile} /></div></article>;
    }

    if (item.message.customType === "context-compaction") {
      const tokensBefore = Number(item.message.details?.tokensBefore);
      const hasTokenCount = Number.isFinite(tokensBefore) && tokensBefore > 0;
      const tokenLabel = hasTokenCount ? `${Math.round(tokensBefore).toLocaleString("tr-TR")} token` : "";
      return (
        <article
          className="timeline-compaction-event"
          role="status"
          aria-label={`Bağlam sıkıştırıldı${tokenLabel ? `, ${tokenLabel}` : ""}`}
        >
          <span className="timeline-compaction-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 3v4h4M16 17v-4h-4M8 7 3.5 2.5M12 13l4.5 4.5" />
            </svg>
          </span>
          <span className="timeline-compaction-copy">
            <strong>Bağlam sıkıştırıldı</strong>
            <small>Eski içerik özetlendi; tam timeline korunuyor.</small>
          </span>
          {tokenLabel ? <span className="timeline-compaction-meta">{tokenLabel}</span> : null}
        </article>
      );
    }

    const isAbortedAssistant = isAbortedAssistantMessage(item.message);
    const legacyAbortPlaceholder = isAbortedAssistant && /^_?\(Yanıt durduruldu\)_?$/i.test(text.trim());
    if (legacyAbortPlaceholder) text = "";
    const abortedStatusLabel = formatAbortedTurnLabel(abortedTurnDurations.get(item.message) || 0);
    const canCopyAssistant = isAssistant && !item.message.__streaming && !toolOnly && Boolean(text.trim());
    const isStreamingAssistant = Boolean(item.message.__streaming && isAssistant);
    const showStreamingThink = isStreamingAssistant && !text.trim();
    const isLatestAssistant =
      isAssistant &&
      (item.message.__streaming || item.key === latestAssistantKey || item.key === "m-streaming");
    const messageTurnDiff = resolveTimelineTurnDiff(
      turnId,
      turnDiffsByTurn,
      isLatestAssistant ? turnDiff : undefined,
    );
    return <article
      onContextMenu={(event) => { event.preventDefault(); openContextMenu(event, [{ id: "copy", label: "Metni kopyala", onSelect: () => copyTextWithToast(text, "Yanıt kopyalandı") }]); }}
      className={`message ${item.message.role || "assistant"} ${isAssistant || isCustom ? "clean-assistant" : ""} ${toolOnly ? "tool-only-message" : ""} ${attached.length ? "has-attachments" : ""} ${item.message.__streaming ? "streaming" : ""} ${isAbortedAssistant ? "aborted" : ""}`}
      tabIndex={isAssistant ? 0 : undefined}
      aria-label={isAssistant ? (item.message.__streaming ? "Quake yanıtlıyor" : isAbortedAssistant ? abortedStatusLabel : "Quake yanıtı") : undefined}
      data-aborted={isAbortedAssistant ? "true" : undefined}
    >
      <div className="message-body">
        {showStreamingThink && <StreamingThinkingIndicator />}
        {(text.trim() || (!item.message.__streaming && toolSnapshots.length > 0)) && (
          <MarkdownMessage
            text={text}
            turnId={turnId}
            toolSnapshots={toolSnapshots}
            toolsEpoch={toolsEpoch}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
            onReviewTurn={onReviewTurn}
            onToast={onToast}
            showToolActivity={!item.suppressToolActivity}
            showThinkingActivity={!item.suppressThinkingActivity}
            isStreaming={Boolean(item.message.__streaming)}
            turnDiff={messageTurnDiff}
            reviewLabel={isLatestAssistant ? "Son tur" : (turnId ? `Tur #${turnId}` : "Seçili tur")}
          />
        )}
        {isAbortedAssistant && (
          <div className={`aborted-message-status ${text.trim() ? "has-response" : ""}`} role="status">
            <span>{abortedStatusLabel}</span>
          </div>
        )}
        {canCopyAssistant && (
          <div className="assistant-message-actions">
            <button type="button" onClick={() => copyTextWithToast(text, "Yanıt kopyalandı")}>
              <Copy size={14} aria-hidden="true" />
              <span>Kopyala</span>
            </button>
          </div>
        )}
      </div>
    </article>;
  };

  // Akan mesaji SON veri ogesi yap. Virtuoso onu olculen listenin ICINDE tutar;
  // tanstack'teki "akan satir virtualizer disinda + settle'da key degisimi +
  // estimateSize:140 + smooth-scroll yarisi" zinciri (2-tik yukari ziplama) biter.
  const rows = useMemo(
    () => streamingItem
      ? [...visibleTimelineItems, { kind: "message" as const, key: "m-streaming", time: Number.MAX_SAFE_INTEGER, message: streamingItem }]
      : visibleTimelineItems,
    [visibleTimelineItems, streamingItem],
  );
  const timelineRows = useMemo(
    () => groupTimelineRows(rows as Array<TimelineMessageItem | TimelineToolItem>, streamingText, messageToolHistory, activeStreamingTurnId),
    [activeStreamingTurnId, messageToolHistory, rows, streamingText],
  );
  // Attach turn/diff/updated snapshot to the latest assistant answer (Codex history cell).
  const latestAssistantKey = useMemo(() => {
    for (let i = timelineRows.length - 1; i >= 0; i -= 1) {
      const row = timelineRows[i];
      if (row.kind === "message" && row.message?.role === "assistant") {
        return row.key;
      }
    }
    if (streamingItem) return "m-streaming";
    return null;
  }, [timelineRows, streamingItem]);
  const renderedTimelineRows = useMemo(() => {
    if (!compactOverlay) return timelineRows;
    const latestAssistant = [...timelineRows].reverse().find((item) =>
      item.kind === "message" && item.message?.role === "assistant" && !isToolOnlyItem(item),
    );
    return latestAssistant ? [latestAssistant] : [];
  }, [compactOverlay, timelineRows, streamingText]);

  // Sticky kullanıcı mesajları aynı top noktasında üst üste biner. Scroll konumuna
  // göre yalnızca en yeni yapışan satırı görünür tutup eskisini yumuşakça devreden
  // çıkar; böylece kısa balon uzun balonun içine girmiş gibi görünmez.
  useEffect(() => {
    const scrollElement = stickContextRef.current?.scrollRef.current;
    if (!scrollElement) return;
    let frame = 0;
    const syncStickyUserRows = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const scrollRect = scrollElement.getBoundingClientRect();
        // Sticky rows settle against the scroll container's padded content edge,
        // not its raw border-box top. Comparing against only `top + 8` therefore
        // missed every stuck row while the timeline had its normal 18px top
        // padding, leaving consecutive user bubbles visibly stacked.
        const scrollPaddingTop = Number.parseFloat(getComputedStyle(scrollElement).paddingTop) || 0;
        const stickyEdge = scrollRect.top + scrollPaddingTop + 2;
        const rows = Array.from(scrollElement.querySelectorAll<HTMLElement>(".timeline-row-user"));
        const stuckRows = rows.filter((row) => row.getBoundingClientRect().top <= stickyEdge);
        const activeRow = stuckRows.at(-1);
        for (const row of rows) {
          row.classList.toggle("is-sticky-active", row === activeRow);
          row.classList.toggle("is-sticky-covered", row !== activeRow && stuckRows.includes(row));
        }
      });
    };
    syncStickyUserRows();
    scrollElement.addEventListener("scroll", syncStickyUserRows, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(syncStickyUserRows);
    resizeObserver?.observe(scrollElement);
    return () => {
      cancelAnimationFrame(frame);
      scrollElement.removeEventListener("scroll", syncStickyUserRows);
      resizeObserver?.disconnect();
    };
  }, [conversationKey, renderedTimelineRows.length]);

  // Sohbet degisince / zorla alta isteginde aninda dibe kilitlen.
  useLayoutEffect(() => {
    void stickContextRef.current?.scrollToBottom({ animation: "instant" });
    const r = requestAnimationFrame(() => {
      void stickContextRef.current?.scrollToBottom({ animation: "smooth" });
    });
    return () => cancelAnimationFrame(r);
  }, [conversationKey]);

  useLayoutEffect(() => {
    if (!scrollRequest) return;
    void stickContextRef.current?.scrollToBottom({ animation: "smooth" });
  }, [scrollRequest]);

  // Streaming metin buyudukce: zaten dipteyse (preserve) alta kaydir.
  // use-stick-to-bottom ResizeObserver da yonetir; bu ekstra token-chunk garantisi.
  useEffect(() => {
    if (!streamingItem) return;
    void stickContextRef.current?.scrollToBottom({
      animation: { damping: 0.72, stiffness: 0.08, mass: 0.9 },
      preserveScrollPosition: true,
    });
  }, [streamingItem, streamingText, timelineRows.length]);

  useEffect(() => {
    if (!pendingMessages.length) return;
    void stickContextRef.current?.scrollToBottom({ animation: "smooth" });
  }, [pendingMessages.length]);

  useEffect(() => setWindowSize(TIMELINE_INITIAL_WINDOW), [filter]);

  useLayoutEffect(() => {
    const anchor = pendingOlderAnchorRef.current;
    if (!anchor) return;
    pendingOlderAnchorRef.current = null;
    const scrollElement = stickContextRef.current?.scrollRef.current;
    if (!scrollElement) return;
    const addedHeight = scrollElement.scrollHeight - anchor.scrollHeight;
    scrollElement.scrollTop = Math.max(0, anchor.scrollTop + addedHeight);
  }, [windowSize]);

  const nextOlderCount = Math.min(hiddenTimelineCount, TIMELINE_WINDOW_STEP);
  const loadOlderTimeline = useCallback(() => {
    const context = stickContextRef.current;
    const scrollElement = context?.scrollRef.current;
    if (scrollElement) {
      context?.stopScroll();
      pendingOlderAnchorRef.current = {
        scrollHeight: scrollElement.scrollHeight,
        scrollTop: scrollElement.scrollTop,
      };
    }
    setWindowSize((value) => value + TIMELINE_WINDOW_STEP);
  }, []);
  const timelineContext = useMemo<TimelineHeaderContext>(() => ({
    hiddenTimelineCount,
    nextOlderCount,
    onLoadOlder: loadOlderTimeline,
  }), [hiddenTimelineCount, loadOlderTimeline, nextOlderCount]);

  const showPending = pendingMessages.length > 0 && filter !== "tools" && filter !== "errors";
  const isTimelineStreaming = Boolean(streamingItem);
  const activityCount = renderedTimelineRows.length + (showPending ? pendingMessages.length : 0);

  if (rows.length === 0 && !showPending) {
    return (
      <section id="timeline" className="timeline timeline-filter-empty" aria-label="Sohbet timeline">
        <div className="timeline-filter-empty-state" role="status">
          <strong>Bu görünümde kayıt yok</strong>
          <span>Başka bir timeline görünümü seçebilirsiniz.</span>
        </div>
      </section>
    );
  }
  return (
    <>
    <StickToBottom
      id="timeline"
      className={`timeline stick-to-bottom ${compactOverlay ? "timeline-compact-overlay" : ""}`}
      contextRef={stickContextRef}
      resize="smooth"
      initial="smooth"
      damping={0.7}
      stiffness={0.06}
      mass={1.05}
    >
      <StickToBottom.Content className="timeline-stick-content" scrollClassName="timeline-scroll">
        <TimelineHeader context={timelineContext} />
        <div className="timeline-thread">
          {renderedTimelineRows.map((item) => {
            const isUserRow = item.kind === "message" && item.message?.role === "user";
            const userText = isUserRow ? textFromMessage(item.message) : "";
            const userAttachments = isUserRow ? imageAttachments[userText] || imagesFromMessage(item.message) : [];
            const userLineCount = userText ? userText.split("\n").length : 0;
            const canStickUserRow = isUserRow && userAttachments.length === 0 && userText.length <= 240 && userLineCount <= 4;
            return (
              <div
                key={item.key}
                className={[
                  "timeline-row",
                  isToolOnlyItem(item) ? "tool-only-row" : "",
                  canStickUserRow ? "timeline-row-user" : "",
                  isUserRow && !canStickUserRow ? "timeline-row-user-static" : "",
                ].filter(Boolean).join(" ")}
              >
                {renderTimelineItem(item)}
              </div>
            );
          })}
          {showPending && (
            <div className="timeline-row pending-messages-row" key="pending-messages">
              <PendingMessagesInChat
                items={pendingMessages}
                onRemove={onRemovePending}
                onSendNow={onSendPending}
              />
            </div>
          )}
        </div>
      </StickToBottom.Content>
      <TimelineJumpBottom activityCount={activityCount} errorCount={errorCount} isStreaming={isTimelineStreaming} />
      <TimelineAnnouncer isStreaming={isTimelineStreaming} errorCount={errorCount} />
    </StickToBottom>
    {contextMenu}
    </>
  );
}

export const Timeline = React.memo(TimelineInner);

export function UserImageAttachments({ images, onPreview }: { images: ComposerImage[]; onPreview: (image: ComposerImage) => void }) {
  return <div className={`message-images ${images.length > 1 ? "multi" : "single"}`}>{images.map((image) => <button type="button" key={image.id} onClick={() => onPreview(image)}><img src={image.previewUrl} alt={image.name} /></button>)}</div>;
}

export function ExpandableUserMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = text.length > 420 || text.split("\n").length > 8;
  return <div className={`user-msg-expandable ${collapsible && !expanded ? "collapsed" : ""}`}><div className="user-msg-text">{text}</div>{collapsible && <button type="button" className="user-msg-more" aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }}>{expanded ? "Daha az göster" : "Daha fazla göster"}</button>}</div>;
}

export function TimelineToolCardInner({ card, onInspect }: { card: ToolCardState; onInspect: () => void }) {
  const argsSummary = summarizeToolArgs(card.toolName, card.args) || statusLabel(card.status);
  const preview = toolPreviewText(card);
  const failed = card.status === "error";
  return <article className={`tool-card timeline-tool activity-item ${card.status}`} aria-label={`${toolDisplayName(card.toolName)} · ${statusLabel(card.status)}`}>
    <div className="tool-card-head">
      <div className="tool-card-title">
        <span className={`tool-status-dot ${card.status}`} aria-hidden="true" />
        <div>
          <span className="tool-card-kicker">Agent Activity</span>
          <strong>{toolDisplayName(card.toolName)}</strong>
          <small>Tur #{card.turnId || "?"} · <span className={failed ? "tool-card-error-label" : ""}>{statusLabel(card.status)}</span>{card.durationMs !== undefined ? ` · ${formatDuration(card.durationMs)}` : ""}</small>
        </div>
      </div>
      <button type="button" onClick={onInspect} aria-label={`${toolDisplayName(card.toolName)} ayrıntılarını incele`}>İncele</button>
    </div>
    <div className="tool-card-summary">{argsSummary}</div>
    {preview && <pre>{preview.slice(0, 900)}{preview.length > 900 ? "\n… tamamı için inceleyin." : ""}</pre>}
  </article>;
}
export const TimelineToolCard = React.memo(TimelineToolCardInner);
