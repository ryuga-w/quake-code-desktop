import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StickToBottom, type StickToBottomContext } from "use-stick-to-bottom";
import { Box, FileText } from "lucide-react";
import { textFromMessage } from "../../lib/render";
import {
  artifactTemplateMessageMeta,
  artifactTemplateRestorePrompt,
  type ArtifactTemplateMessageMeta,
} from "../../lib/artifact-template-message";
import { useAppStore, type ToolCardState } from "../../state/app-store";
import { useI18n } from "../../i18n";
import {
  computeTurnDurationMs,
  LiveTurnWorkStatus,
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

const EMPTY_TIMELINE_IMAGES: Record<string, ComposerImage[]> = {};
const EMPTY_TIMELINE_TOOLS: Record<string, ToolCardState> = {};

/**
 * The canonical Quake conversation surface for isolated runtimes. Side
 * conversations and subagents feed their own messages/runtime state through
 * this adapter instead of maintaining separate Markdown/tool renderers.
 */
export function ConversationTimeline({
  messages,
  streamingMessage,
  isStreaming,
  tools = EMPTY_TIMELINE_TOOLS,
  conversationKey,
  onOpenFile,
  onToast,
}: {
  messages: any[];
  streamingMessage?: any;
  isStreaming: boolean;
  tools?: Record<string, ToolCardState>;
  conversationKey?: string;
  onOpenFile: (path: string) => void;
  onToast?: (message: string, type?: "info" | "success" | "warning" | "error") => void;
}) {
  const timelineId = `timeline-${String(conversationKey || "isolated").replace(/[^a-z0-9_-]+/gi, "-")}`;
  return (
    <Timeline
      messages={messages}
      streamingMessage={streamingMessage}
      runtimeIsStreaming={isStreaming}
      runtimeTools={tools}
      timelineId={timelineId}
      imageAttachments={EMPTY_TIMELINE_IMAGES}
      filter="messages"
      onFilterChange={() => {}}
      conversationKey={conversationKey}
      onInspectTool={() => {}}
      onOpenFile={onOpenFile}
      onToast={onToast}
      onPreviewImage={() => {}}
      onOpenPlan={() => {}}
    />
  );
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

// Anchor-to-top (ChatGPT tarzi: yeni mesaji tepeye sabitle + CSS bosluk).
// false yaparsan klasik "en altta kal" davranisina doner.
const ANCHOR_TO_TOP_ENABLED = false;
// Anchor'lanan user satirinin tepeyle arasinda birakilan kucuk nefes payi (px).
// Scroll padding'i (28px) kadar bosluk birakinca onceki cevabin alti gorunuyordu;
// bunun yerine bu kucuk sabiti kullaniyoruz -> mesaj neredeyse tam tepede.
const ANCHOR_TOP_GAP = 0;

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
  runtimeIsStreaming,
  runtimeTools,
  timelineId = "timeline",
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
  /** Optional isolated runtime state used by side conversations and subagents. */
  runtimeIsStreaming?: boolean;
  runtimeTools?: Record<string, ToolCardState>;
  timelineId?: string;
}) {
  const [windowSize, setWindowSize] = useState(TIMELINE_INITIAL_WINDOW);
  const storeAgentIsStreaming = useAppStore((state) => Boolean(state.state?.isStreaming));
  const storeTools = useAppStore((state) => state.tools);
  const agentIsStreaming = runtimeIsStreaming ?? storeAgentIsStreaming;
  const selectedTools = runtimeTools ?? storeTools;
  const toolState = filter === "messages" ? EMPTY_TOOL_STATE : selectedTools;
  // Bust MarkdownMessage memo when tools settle so turn file-change cards appear.
  const toolsEpoch = useMemo(() => {
    let epoch = 0;
    for (const id in selectedTools) {
      const tool = selectedTools[id];
      epoch = (epoch + (tool.updatedAt || 0) + (tool.status === "done" || tool.status === "error" ? 17 : 3)) | 0;
    }
    return epoch;
  }, [selectedTools]);
  const errorCount = useMemo(() => {
    let count = 0;
    for (const tool of Object.values(selectedTools)) {
      if (isPlanProtocolToolName(tool.toolName)) continue;
      if (tool.status === "error") count += 1;
    }
    return count;
  }, [selectedTools]);
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
  // ChatGPT tarzi "yeni mesaji tepeye sabitle" durumu (CSS-first, JS minimal).
  const anchorSpacerRef = useRef<HTMLDivElement | null>(null);
  const prevPendingLenRef = useRef(0);
  const prevUserRowKeyRef = useRef<string | null>(null);
  const justSwitchedConversationRef = useRef(true);
  // Aktif turn anchor'landi mi (mesaj tepede, altinda bosluk). Follow moduna gecince
  // kutuphaneye devredilir; sohbet degisince/yeni turn'de sifirlanir.
  const anchorEngagedRef = useRef(false);
  const followingRef = useRef(false);
  // Anchor aktifken kutuphanenin "dip" hedefini bu sabit scrollTop'a kilitleriz.
  // Boylece stream buyudukce kutuphane icerigi dibe cekmez; user satiri tepede kalir,
  // cevap ASAGI (composer'a) dogru buyur. null iken kutuphane normal dibe-kilit yapar.
  const anchoredScrollTopRef = useRef<number | null>(null);
  // Anchor aktifken tepeye kilitlenen hedef user satiri. Pin dongusu her frame BUNU
  // yeniden olcup gercek tepesine oturtur -> tool karti eklenip layout kayinca bile
  // sabit piksel yerine CANLI olcum kullanildigi icin "pat yukari ziplama" olmaz.
  const anchorTargetElRef = useRef<HTMLElement | null>(null);
  // use-stick-to-bottom targetScrollTop override: anchor aktifken sabit konum dondur.
  const resolveTargetScrollTop = useCallback((targetScrollTop: number) => {
    const locked = anchoredScrollTopRef.current;
    if (locked === null) return targetScrollTop; // normal davranis (gercek dip)
    // Anchor kilitliyken SABIT locked dondur. `Math.min(locked, targetScrollTop)`
    // stream sirasinda targetScrollTop'un locked etrafinda 1-2px salinmasina izin
    // verip mesaji her frame oynatiyordu (kucuk titreme). Sabit locked -> mesaj
    // tepede tas gibi durur, kutuphane dibe cekemez.
    return locked;
  }, []);
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
        ? (
          <div className="turn-work-live">
            <LiveTurnWorkStatus tools={item.toolSnapshots} fallbackStartedAt={item.time} />
            {workEntries}
          </div>
        )
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
          data-timeline-user-row="true"
          className={`message user clean-user ${attached.length ? "has-attachments" : ""} ${multiLine ? "user-multi" : ""} ${sentAsGoal ? "user-goal" : ""} ${artifactTemplate ? "user-artifact-template" : ""}`}
          tabIndex={0}
          aria-label="Kullanıcı mesajı"
          onContextMenu={(event) => {
            event.preventDefault();
            openContextMenu(event, contextItems);
          }}
        >
          <div className="user-msg-bubble">
            {attached.length > 0 && <UserImageAttachments images={attached} onPreview={onPreviewImage} />}
            <div className="user-msg-row">
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
    () => groupTimelineRows(rows as Array<TimelineMessageItem | TimelineToolItem>, streamingText, messageToolHistory, activeStreamingTurnId, agentIsStreaming),
    [activeStreamingTurnId, agentIsStreaming, messageToolHistory, rows, streamingText],
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

  // Anchor hedefi: render edilen satirlardaki son kullanici mesajinin key'i.
  const lastUserRowKey = useMemo(() => {
    for (let i = renderedTimelineRows.length - 1; i >= 0; i--) {
      const item = renderedTimelineRows[i];
      if (item.kind === "message" && item.message?.role === "user") return item.key;
    }
    return null;
  }, [renderedTimelineRows]);

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

  // ===== ChatGPT tarzi anchor-to-top (CSS-first, JS minimal) =====
  // Yontem: Aktif turn'un altina CSS ile viewport-bosluk verilir (min-height, JS'siz).
  // Yeni mesaj gonderilince TEK BIR scrollIntoView ile user satiri tepeye alinir.
  // Stream sirasinda HICBIR JS scroll/olcum YOK -> titreme fiziksel olarak imkansiz.
  // Bosluk .timeline-anchor-spacer CSS'inde (min-height) tanimli; JS dokunmaz.

  // Yeni kullanici mesajini (son user satirini) bir kez tepeye kaydir.
  const scrollUserRowToTop = useCallback((behavior: ScrollBehavior) => {
    const scrollElement = stickContextRef.current?.scrollRef.current;
    if (!scrollElement) return;
    const rows = scrollElement.querySelectorAll<HTMLElement>("[data-timeline-user-row='true'], .timeline-row-user, .timeline-row-user-static, .pending-messages-row");
    const target = rows[rows.length - 1];
    if (!target) { void stickContextRef.current?.scrollToBottom({ animation: "smooth" }); return; }
    anchorTargetElRef.current = target; // pin dongusu her frame bunu canli olcup tepeye oturtur
    stickContextRef.current?.stopScroll();
    // Kutuphanenin dibe-kilit spring'ini tamamen sustur ki bizim anchor'la savasmasin.
    // KRITIK: sadece escapedFromLock yetmez; ResizeObserver'in pozitif-resize dalindaki
    // otomatik scrollToBottom'i `state.isAtBottom` true iken calisir. Anchor sirasinda
    // isAtBottom'i da false'a cekmezsek her stream token'inda icerik dibe kilitlenir
    // (mesaj tepede durmaz, yukari akar). Ikisini birden kapatiyoruz.
    // NOT: `isNearBottom` kutuphanede getter-only (scrollDifference'tan turer) -> yazILAMAZ.
    // Sadece yazilabilir olan escapedFromLock ve isAtBottom'i set ediyoruz; isNearBottom
    // otomatik olarak scroll konumundan hesaplanir.
    const st = stickContextRef.current?.state as { escapedFromLock?: boolean; isAtBottom?: boolean } | undefined;
    if (st) { st.escapedFromLock = true; st.isAtBottom = false; }
    // Anchor devreye girdi, follow henuz baslamadi.
    anchorEngagedRef.current = true;
    followingRef.current = false;
    // KRITIK: `offsetTop` satirin offsetParent'ina goredir; scroll konteyneriyle ayni
    // katman olmayabilir (StickToBottom ic sarmalayicilari) -> yanlis hedef, mesaj tam
    // tepeye gitmez. getBoundingClientRect farkiyla scroll-BAGIMSIZ gercek offset'i bul:
    // hedefin su anki scrollTop'a gore konteyner icindeki mutlak ust konumu.
    const scrollRect = scrollElement.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetOffsetInScroll = (targetRect.top - scrollRect.top) + scrollElement.scrollTop;
    // Bosluk (spacer) yuksekligini BIR KEZ set et: user satiri tepeye gelince altinda
    // viewport'u dolduracak alan olsun. Stream sirasinda ASLA yeniden dokunulmaz.
    const spacer = anchorSpacerRef.current;
    if (spacer) {
      const viewport = scrollElement.clientHeight;
      const spacerH = spacer.offsetHeight;
      const contentBelow = (scrollElement.scrollHeight - spacerH) - targetOffsetInScroll; // turn yuksekligi (spacer haric)
      spacer.style.height = `${Math.max(0, Math.round(viewport - contentBelow - ANCHOR_TOP_GAP))}px`;
    }
    // KRITIK: `- paddingTop` cikarinca mesaj tepeden ~28px asagida durur ve o boslukta
    // ONCEKI cevabin alt ucu gorunur kalir. Bunun yerine kucuk SABIT bir nefes payi
    // (ANCHOR_TOP_GAP) birak; boylece user satiri neredeyse tam tepeye oturur ve
    // onceki turn goruntuden tamamen cikar.
    const anchorTop = Math.max(0, targetOffsetInScroll - ANCHOR_TOP_GAP);
    // Kutuphanenin "dip" hedefini bu konuma kilitle: stream buyurken icerik dibe
    // cekilmez, user satiri tepede kalir, cevap asagi (composer'a) dogru buyur.
    anchoredScrollTopRef.current = anchorTop;
    // KRITIK: spacer.style.height yeni set edildi. `smooth` (async) scroll, spacer'in
    // yeni yuksekligi layout'a yansimadan calisirsa scroll alani daha yokken yarida
    // kalir -> mesaj tam tepeye gitmez, onceki turn gorunur kalir (kisa konusmada bariz).
    // Once SENKRON scrollTop yaz (reflow'u zorlar, spacer'i uygular, kesin oturur).
    scrollElement.scrollTop = anchorTop;
    // NOT: Eskiden burada bir rAF settle vardi (hedefi tekrar olcup scrollTop yazardi).
    // Ama pin dongusu ARTIK her frame ayni olcumu yapip sabitliyor -> bu rAF ile pin
    // ilk frame'de CIFT duzeltme yapip "bir tik titreme" olusturuyordu. Kaldirdik;
    // canli pin dongusu ilk frame'den itibaren hedefi tepede tutar (titreme yok).
  }, []);

  // Sohbet degisince: bosluk sifirla, normal dibe kilitlen.
  useLayoutEffect(() => {
    prevUserRowKeyRef.current = null;
    justSwitchedConversationRef.current = true;
    anchoredScrollTopRef.current = null; // dip kilidini ac -> normal davranis
    if (anchorSpacerRef.current) anchorSpacerRef.current.style.height = "0px";
    void stickContextRef.current?.scrollToBottom({ animation: "instant" });
    const r = requestAnimationFrame(() => { void stickContextRef.current?.scrollToBottom({ animation: "smooth" }); });
    return () => cancelAnimationFrame(r);
  }, [conversationKey]);

  useLayoutEffect(() => {
    if (!scrollRequest) return;
    void stickContextRef.current?.scrollToBottom({ animation: "smooth" });
  }, [scrollRequest]);

  // Yeni kullanici mesaji gonderilince (pending balon): anchor acikken tepeye,
  // kapaliyken normal dibe kaydir. TEK sefer, stream'de tekrar yok.
  useLayoutEffect(() => {
    const prev = prevPendingLenRef.current;
    prevPendingLenRef.current = pendingMessages.length;
    if (pendingMessages.length > prev) {
      if (ANCHOR_TO_TOP_ENABLED) scrollUserRowToTop("smooth");
      else void stickContextRef.current?.scrollToBottom({ animation: "smooth" });
    }
  }, [pendingMessages.length, scrollUserRowToTop]);

  // Pending -> gercek turn satiri gecisinde bir kez daha hizala (yeni user key).
  useLayoutEffect(() => {
    if (lastUserRowKey === prevUserRowKeyRef.current) return;
    const justSwitched = justSwitchedConversationRef.current;
    justSwitchedConversationRef.current = false;
    prevUserRowKeyRef.current = lastUserRowKey;
    if (!justSwitched && lastUserRowKey && ANCHOR_TO_TOP_ENABLED) scrollUserRowToTop("instant");
  }, [lastUserRowKey, scrollUserRowToTop]);

  // KRITIK: Anchor kilitliyken kutuphane (use-stick-to-bottom) KENDI rAF spring
  // dongusuyle her frame scrollTop'u dibe cekiyor. React render'i her frame olmadigi
  // icin useLayoutEffect yetmez -> aradaki frame'lerde kutuphane kazanir ve icerik
  // YUKARI kacar (user satiri tepeden yukari kayar). Cozum: anchor aktifken KENDI rAF
  // dongumuzle her frame scrollTop'u kilitli konuma zorla. resolveTargetScrollTop zaten
  // locked donduruyor -> ikisi cakismaz, mesaj tepede tas gibi durur, cevap ASAGI
  // (composer'a) dogru buyur. Follow moduna gecince (locked=null) dongu kendini durdurur.
  useEffect(() => {
    if (!ANCHOR_TO_TOP_ENABLED) return;
    let frame = 0;
    const pin = () => {
      const locked = anchoredScrollTopRef.current;
      if (locked !== null && anchorEngagedRef.current && !followingRef.current) {
        const ctx = stickContextRef.current;
        const scrollElement = ctx?.scrollRef.current;
        if (scrollElement) {
          // KRITIK: Sadece scrollTop'u sabitlemek yetmiyor; kutuphane her frame
          // isAtBottom'i yeniden hesaplayip kendi spring'iyle dibe cekiyor. O yuzden
          // her frame stick-to-bottom durumunu da kapatiyor ve animasyonu durduruyoruz.
          const st = ctx?.state as { escapedFromLock?: boolean; isAtBottom?: boolean } | undefined;
          if (st && (st.isAtBottom || !st.escapedFromLock)) {
            ctx?.stopScroll();
            st.escapedFromLock = true;
            st.isAtBottom = false;
          }
          // CANLI OLCUM: sabit `locked` piksel, tool karti eklenip layout kayinca bir frame
          // yanlis kalir -> goze "pat yukari ziplama". Bunun yerine hedef satiri her frame
          // yeniden olcup gercek tepesine oturt; layout ne kadar kayarsa kaysin mesaj
          // fiziksel olarak tepede sabit kalir. locked'i de guncelle (release/resize icin).
          const targetEl = anchorTargetElRef.current;
          let desired = locked;
          if (targetEl && scrollElement.contains(targetEl)) {
            const sr = scrollElement.getBoundingClientRect();
            const tr = targetEl.getBoundingClientRect();
            desired = Math.max(0, ((tr.top - sr.top) + scrollElement.scrollTop) - ANCHOR_TOP_GAP);
            anchoredScrollTopRef.current = desired;
          }
          if (Math.abs(scrollElement.scrollTop - desired) > 0.5) {
            scrollElement.scrollTop = desired;
          }
        }
      }
      frame = requestAnimationFrame(pin);
    };
    frame = requestAnimationFrame(pin);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Stream sirasinda "composer'a yaklasinca yukari ak" davranisi (RESPONSIVE).
  // Once mesaj tepede SABIT durur. Cevap buyudukce icerigin ALT kenari composer'a
  // yaklasir; esige girince dibe-kilit kutuphaneye BIR KEZ devredilir ve o andan
  // itibaren kutuphane yumusakca takip eder. Devir tek sefer -> her token'da yeni
  // animasyon acilmaz -> titreme olmaz.
  //
  // Esik responsive: viewport'un ~%18'i (min 90, max 220 px). Boylece kucuk ekranda
  // da buyuk ekranda da composer'a "orantili" mesafede takip baslar.
  useEffect(() => {
    if (!ANCHOR_TO_TOP_ENABLED) return;
    // NOT: `streamingItem` sadece asistan METNI akarken dolu. Ama turn'de once TOOL
    // calisir (metin yok) ve tool kartlari eklendikce icerik buyur. O donemde de esik
    // kontrolu lazim; yoksa tool kartlari birikince anchor konumu kayar. Bu yuzden
    // `agentIsStreaming` (gercek streaming sinyali) veya streamingItem varsa devam et.
    if (!agentIsStreaming && !streamingItem) return;
    if (!anchorEngagedRef.current || followingRef.current) return; // henuz anchor yoksa veya zaten takip ediyorsak cik
    const scrollElement = stickContextRef.current?.scrollRef.current;
    if (!scrollElement) return;
    const spacerH = anchorSpacerRef.current?.offsetHeight ?? 0;
    const viewport = scrollElement.clientHeight;
    const threshold = Math.min(220, Math.max(90, Math.round(viewport * 0.18)));
    // Icerik alt kenari (spacer haric) ile viewport dibi (composer ustu) mesafesi.
    const contentBottom = scrollElement.scrollHeight - spacerH;
    const viewBottom = scrollElement.scrollTop + viewport;
    // Icerik alt kenari (composer ustu = viewBottom) ile arasindaki isaretli mesafe.
    // Cevap kisayken NEGATIF (icerik viewport'tan kisa); buyudukce 0'a dogru artar.
    // Alt kenar composer'a `threshold` px yaklasinca (>= -threshold) takibe devret.
    // NOT: eski kod `<= threshold` idi -> negatif deger hep kucuk oldugu icin stream'in
    // ILK token'inda devrediyor, anchor'i bozuyordu (isaret hatasi).
    const distanceToComposer = contentBottom - viewBottom;
    if (distanceToComposer >= -threshold) {
      // Esige girildi: takip moduna gec. Spacer'i sifirlarken GORSEL SICRAMA olmasin
      // diye scrollTop'u spacer kadar azalt (icerik ayni yerde kalir). Sonra dibe-kilidi
      // ac ve kutuphaneye devret; bundan sonra kutuphane akisi yumusakca yonetir.
      followingRef.current = true;
      anchorEngagedRef.current = false;
      anchoredScrollTopRef.current = null; // dip kilidini ac -> kutuphane dibe kilitlensin
      const prevScrollTop = scrollElement.scrollTop;
      if (anchorSpacerRef.current && spacerH > 0) {
        anchorSpacerRef.current.style.height = "0px";
        // Spacer kaldirildi -> scrollHeight kuculdu; konumu koru (sicrama yok).
        scrollElement.scrollTop = Math.max(0, prevScrollTop);
      }
      const st = stickContextRef.current?.state as { escapedFromLock?: boolean } | undefined;
      if (st) st.escapedFromLock = false;
      void stickContextRef.current?.scrollToBottom({ animation: "smooth" });
    }
  }, [streamingText, streamingItem, agentIsStreaming, renderedTimelineRows.length]);

  // Stream bitince anchor/follow bayraklarini sifirla (bir sonraki turn temiz baslasin).
  // KRITIK: Kisa cevaplarda follow'a HIC gecmeden stream biter; bu an hala anchor
  // konumundayiz. Kilidi (anchoredScrollTopRef) aniden null yapip birakirsak kutuphane
  // icerigi dibe ceker -> mesaj bir tik YUKARI kayar (kullanicinin gordugu bug).
  // Cozum: hala anchor aktifken bittiyse, mevcut scroll konumunu koru ve kutuphaneye
  // "dipte degilsin" de (escapedFromLock=true, isAtBottom=false) -> sicrama olmaz.
  // KRITIK: `streamingItem` sadece asistan METNI akarken dolar. Turn basinda TOOL
  // asamasinda (metin henuz yok) streamingItem BOS olur -> bu reset yanlislikla
  // tetiklenir, kilidi acar ve tool kartlari eklendikce icerik YUKARI kayar (bug).
  // Bu yuzden gercek streaming sinyali `agentIsStreaming` de false olana kadar
  // reset yapmiyoruz (yani turn tamamen bitince).
  useEffect(() => {
    if (!ANCHOR_TO_TOP_ENABLED) {
      // Anchor kapaliyken olasi artik bosluk kalmasin.
      if (anchorSpacerRef.current) anchorSpacerRef.current.style.height = "0px";
      return;
    }
    if (streamingItem || agentIsStreaming) return;
    const wasAnchored = anchorEngagedRef.current && !followingRef.current;
    anchorEngagedRef.current = false;
    followingRef.current = false;
    anchoredScrollTopRef.current = null;
    const scrollElement = stickContextRef.current?.scrollRef.current;
    // KRITIK: Turn bitince anchor SPACER'ini (aktif turn'un altindaki bosluk) DOGRU
    // yukseklige getir. Iki hatali uc nokta vardi:
    //  - Bosluk hic temizlenmezse: cevap uzunken alt taraf gereginden fazla bos kalir,
    //    asagi inince cevabin yarisi yukarida kalir (bir onceki bug).
    //  - Bosluk 0'a cekilip scrollTop azaltilirsa: scroll yukari kayar, ESKI mesajlar
    //    gorunur (kullanicinin son gordugu bug).
    // DOGRU: spacer mesajin ALTINDA -> yuksekligini degistirmek mesajin konumunu
    // (scrollTop cinsinden) ETKILEMEZ. O yuzden scrollTop'a DOKUNMADAN spacer'i,
    // "user satirini tepede tutacak minimum bosluk" degerine yeniden hesapliyoruz:
    //   kisa cevap -> bir miktar bosluk kalir, mesaj tepede durur (ChatGPT gibi).
    //   uzun cevap -> contentBelow >= viewport -> bosluk 0 olur, fazlalik gider.
    const spacer = anchorSpacerRef.current;
    // KRITIK: Kalici bosluk her turn sonunda hesaplanmali. Kisa cevaplarda stream
    // sirasinda erkenden "follow" moduna gecilir (wasAnchored=false) ve eski kod bu
    // durumda spacer'i 0 yapip bosluk kaybolmasina yol aciyordu. Artik follow'a
    // gecilmis olsa bile son user satirini tepeye getiren KALICI spacer'i set ediyoruz.
    if (scrollElement && spacer) {
      const rows = scrollElement.querySelectorAll<HTMLElement>("[data-timeline-user-row='true'], .timeline-row-user, .timeline-row-user-static, .pending-messages-row");
      const target = rows[rows.length - 1];
      const viewport = scrollElement.clientHeight;
      if (target) {
        // Bosluk KALICI olsun (yukari cikip inince kaybolmasin). contentBelow'u
        // SPACER 0 iken olcuyoruz ki eski spacer yuksekligi hesaba karismasin.
        spacer.style.height = "0px";
        void scrollElement.scrollHeight; // reflow
        const sr = scrollElement.getBoundingClientRect();
        const tr = target.getBoundingClientRect();
        const targetOffset = (tr.top - sr.top) + scrollElement.scrollTop;
        const contentBelow = scrollElement.scrollHeight - targetOffset;
        const spacerH = Math.max(0, Math.round(viewport - contentBelow - ANCHOR_TOP_GAP));
        spacer.style.height = `${spacerH}px`;
        // scrollTop'u SADECE anchor hala aktifken (kullanici serbest kalmadiysa)
        // tepeye oturt. Kullanici stream sirasinda yukari kaydirip serbest kaldiysa
        // (wasAnchored=false) konumuna DOKUNMA; sadece kalici bosluk korunur.
        if (wasAnchored) {
          scrollElement.scrollTop = Math.max(0, targetOffset - ANCHOR_TOP_GAP);
        }
      } else {
        spacer.style.height = "0px";
      }
    }
    if (wasAnchored) {
      const st = stickContextRef.current?.state as { escapedFromLock?: boolean; isAtBottom?: boolean } | undefined;
      if (scrollElement && st) {
        stickContextRef.current?.stopScroll();
        st.escapedFromLock = true;
        st.isAtBottom = false;
      }
      // KRITIK: Pin dongusu artik durdu (locked=null). Stream bitince tool kartinin
      // FINAL render'i + spacer degisimi bir sonraki frame'de layout'u son kez oynatip
      // mesaji "azicik yukari" atiyor. Reset'ten sonra bir frame daha hedefi canli olcup
      // scrollTop'u tam tepeye sabitle -> son kayma da kapanir.
      const targetEl = anchorTargetElRef.current;
      requestAnimationFrame(() => {
        if (!scrollElement || !targetEl || !scrollElement.contains(targetEl)) return;
        const s2 = stickContextRef.current?.state as { escapedFromLock?: boolean; isAtBottom?: boolean } | undefined;
        if (s2) { stickContextRef.current?.stopScroll(); s2.escapedFromLock = true; s2.isAtBottom = false; }
        // Kalici spacer set edildi; user satirini tepede tutan konumu son bir kez
        // olcup sabitle (layout tool kartinin final render'iyla oynamis olabilir).
        const sr = scrollElement.getBoundingClientRect();
        const tr = targetEl.getBoundingClientRect();
        const settled = Math.max(0, ((tr.top - sr.top) + scrollElement.scrollTop) - ANCHOR_TOP_GAP);
        if (Math.abs(scrollElement.scrollTop - settled) > 0.5) scrollElement.scrollTop = settled;
      });
    }
  }, [streamingItem, agentIsStreaming]);

  // Kullanici stream sirasinda ELLE yukari kaydirirsa anchor'i birak (mudahaleye saygi).
  // KRITIK: Onceden burada spacer'i aninda 0'a cekip scrollTop'u resetliyorduk. Ama bu,
  // kullanicinin O ANDAKI tekerlek hareketiyle CAKISIP onu bos alana/garip konuma
  // atiyordu (kullanicinin bildirdigi bug). Cozum: yukari kaydirinca SADECE kilidi
  // birak; scrollTop'a ve spacer'a DOKUNMA. Native scroll dogal aksin. Spacer zaten
  // stream bitince temizleniyor; stream boyunca kalmasi bir sorun degil (asagida bosluk).
  useEffect(() => {
    if (!ANCHOR_TO_TOP_ENABLED) return;
    const scrollElement = stickContextRef.current?.scrollRef.current;
    if (!scrollElement) return;
    const releaseAnchor = () => {
      if (!anchorEngagedRef.current && !followingRef.current && anchoredScrollTopRef.current === null) return;
      anchorEngagedRef.current = false;
      followingRef.current = false;
      anchoredScrollTopRef.current = null; // kilidi ac -> kutuphane/biz artik konuma karismayiz
      // Kutuphaneye "kullanici serbest" de: dibe kilitleme, kullanici nerede kaldiysa orada kalsin.
      const st = stickContextRef.current?.state as { escapedFromLock?: boolean; isAtBottom?: boolean } | undefined;
      if (st) { st.escapedFromLock = true; st.isAtBottom = false; }
      stickContextRef.current?.stopScroll();
    };
    // Sadece GERCEK yukari hareket anchor'i birakir; asagi/yatay minik olayları yoksay.
    const onWheel = (e: WheelEvent) => { if (e.deltaY < 0) releaseAnchor(); };
    const onTouch = () => releaseAnchor();
    scrollElement.addEventListener("wheel", onWheel, { passive: true });
    scrollElement.addEventListener("touchmove", onTouch, { passive: true });
    return () => {
      scrollElement.removeEventListener("wheel", onWheel);
      scrollElement.removeEventListener("touchmove", onTouch);
    };
  }, []);

  // RESPONSIVE: Pencere/panel yeniden boyutlanirsa (maximize, panel ac/kapa, klavye
  // acilmasi vb.) ve anchor hala aktifse, spacer'i yeni viewport'a gore YENIDEN olcup
  // user satirini tepede tut. Sadece resize aninda calisir (stream token'inda DEGIL),
  // o yuzden titretmez.
  useEffect(() => {
    if (!ANCHOR_TO_TOP_ENABLED) return;
    const scrollElement = stickContextRef.current?.scrollRef.current;
    if (!scrollElement || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      if (!anchorEngagedRef.current) return; // sadece anchor aktifken
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rows = scrollElement.querySelectorAll<HTMLElement>("[data-timeline-user-row='true'], .timeline-row-user, .timeline-row-user-static, .pending-messages-row");
        const target = rows[rows.length - 1];
        const spacer = anchorSpacerRef.current;
        if (!target || !spacer) return;
        const viewport = scrollElement.clientHeight;
        const spacerH = spacer.offsetHeight;
        // scroll-bagimsiz gercek offset (offsetParent farkina karsi guvenli).
        const scrollRect = scrollElement.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const targetOffsetInScroll = (targetRect.top - scrollRect.top) + scrollElement.scrollTop;
        const contentBelow = (scrollElement.scrollHeight - spacerH) - targetOffsetInScroll;
        spacer.style.height = `${Math.max(0, Math.round(viewport - contentBelow - ANCHOR_TOP_GAP))}px`;
        anchoredScrollTopRef.current = Math.max(0, targetOffsetInScroll - ANCHOR_TOP_GAP);
        scrollElement.scrollTop = Math.max(0, targetOffsetInScroll - ANCHOR_TOP_GAP);
      });
    });
    ro.observe(scrollElement);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  }, []);

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
      <section id={timelineId} className="timeline timeline-filter-empty" aria-label="Sohbet timeline">
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
      id={timelineId}
      className={`timeline stick-to-bottom ${compactOverlay ? "timeline-compact-overlay" : ""}`}
      contextRef={stickContextRef}
      resize={streamingItem ? "instant" : "smooth"}
      initial="smooth"
      damping={0.7}
      stiffness={0.06}
      mass={1.05}
      targetScrollTop={resolveTargetScrollTop}
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
                data-timeline-row-key={item.key}
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
          {filter !== "tools" && filter !== "errors" && (
            <div ref={anchorSpacerRef} className="timeline-anchor-spacer" aria-hidden="true" />
          )}
        </div>
      </StickToBottom.Content>
      {!compactOverlay && (
        <ConversationMinimap
          rows={renderedTimelineRows}
          streamingText={streamingText}
          conversationKey={conversationKey}
          contextRef={stickContextRef}
        />
      )}
      <TimelineJumpBottom activityCount={activityCount} errorCount={errorCount} isStreaming={isTimelineStreaming} />
      <TimelineAnnouncer isStreaming={isTimelineStreaming} errorCount={errorCount} />
    </StickToBottom>
    {contextMenu}
    </>
  );
}

export const Timeline = React.memo(TimelineInner);

type ConversationMinimapEntry = {
  key: string;
  targetKey: string;
  prompt: string;
  response: string;
};

const MAX_CONVERSATION_MINIMAP_ENTRIES = 36;

function ConversationMinimap({
  rows,
  streamingText,
  conversationKey,
  contextRef,
}: {
  rows: TimelineRowItem[];
  streamingText: string;
  conversationKey?: string;
  contextRef: { current: StickToBottomContext | null };
}) {
  const { locale } = useI18n();
  const entries = useMemo(
    () => buildConversationMinimapEntries(rows, streamingText, locale),
    [locale, rows, streamingText],
  );
  const [activeKey, setActiveKey] = useState<string>();
  const [hoveredKey, setHoveredKey] = useState<string>();

  useEffect(() => {
    const scrollElement = contextRef.current?.scrollRef.current;
    if (!scrollElement || entries.length === 0) return undefined;
    let frame = 0;
    const syncActiveEntry = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const viewport = scrollElement.getBoundingClientRect();
        const focusY = viewport.top + Math.min(viewport.height * 0.42, 360);
        const rowElements = Array.from(
          scrollElement.querySelectorAll<HTMLElement>("[data-timeline-row-key]"),
        );
        const rowsByKey = new Map(rowElements.map((row) => [row.dataset.timelineRowKey || "", row]));
        let nextKey = entries[0]?.key;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const entry of entries) {
          const row = rowsByKey.get(entry.targetKey);
          if (!row) continue;
          const rect = row.getBoundingClientRect();
          const distance = Math.abs(rect.top - focusY);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nextKey = entry.key;
          }
        }
        setActiveKey((current) => current === nextKey ? current : nextKey);
      });
    };
    syncActiveEntry();
    scrollElement.addEventListener("scroll", syncActiveEntry, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(syncActiveEntry);
    resizeObserver?.observe(scrollElement);
    const thread = scrollElement.querySelector<HTMLElement>(".timeline-thread");
    if (thread) resizeObserver?.observe(thread);
    return () => {
      cancelAnimationFrame(frame);
      scrollElement.removeEventListener("scroll", syncActiveEntry);
      resizeObserver?.disconnect();
    };
  }, [contextRef, conversationKey, entries]);

  const jumpToEntry = useCallback((entry: ConversationMinimapEntry) => {
    const context = contextRef.current;
    const scrollElement = context?.scrollRef.current;
    if (!scrollElement) return;
    const target = Array.from(
      scrollElement.querySelectorAll<HTMLElement>("[data-timeline-row-key]"),
    ).find((row) => row.dataset.timelineRowKey === entry.targetKey);
    if (!target) return;
    context?.stopScroll();
    const viewport = scrollElement.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const paddingTop = Number.parseFloat(getComputedStyle(scrollElement).paddingTop) || 0;
    const top = scrollElement.scrollTop + targetRect.top - viewport.top - paddingTop - 8;
    scrollElement.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    setActiveKey(entry.key);
  }, [contextRef]);

  if (entries.length < 2) return null;
  const hoveredEntry = entries.find((entry) => entry.key === hoveredKey);
  const hoveredIndex = hoveredEntry ? entries.indexOf(hoveredEntry) : -1;
  const tooltipTop = hoveredIndex < 0 || entries.length < 2
    ? 50
    : (hoveredIndex / (entries.length - 1)) * 100;

  return (
    <nav
      className="conversation-minimap"
      aria-label={locale === "en" ? "Conversation map" : "Sohbet haritası"}
      onMouseLeave={() => setHoveredKey(undefined)}
    >
      <div
        className="conversation-minimap-track"
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (!bounds.height) return;
          const relativeY = Math.min(bounds.height, Math.max(0, event.clientY - bounds.top));
          const index = Math.min(
            entries.length - 1,
            Math.max(0, Math.round((relativeY / bounds.height) * (entries.length - 1))),
          );
          setHoveredKey(entries[index]?.key);
        }}
      >
        {entries.map((entry, index) => {
          const active = entry.key === activeKey;
          const hovered = entry.key === hoveredKey;
          const tickWidth = conversationMinimapTickWidth(index, hoveredIndex);
          return (
            <button
              type="button"
              key={entry.key}
              className={`conversation-minimap-tick ${active ? "is-active" : ""} ${hovered ? "is-hovered" : ""}`}
              style={{ "--conversation-minimap-tick-width": `${tickWidth}px` } as React.CSSProperties}
              aria-label={entry.prompt}
              aria-current={active ? "location" : undefined}
              onMouseEnter={() => setHoveredKey(entry.key)}
              onFocus={() => setHoveredKey(entry.key)}
              onBlur={() => setHoveredKey(undefined)}
              onClick={() => jumpToEntry(entry)}
            />
          );
        })}
      </div>
      {hoveredEntry && (
        <aside
          className="conversation-minimap-preview"
          role="tooltip"
          style={{ top: `${tooltipTop}%` }}
        >
          <strong>{hoveredEntry.prompt}</strong>
          <p>{hoveredEntry.response || (locale === "en" ? "Waiting for response…" : "Yanıt bekleniyor…")}</p>
        </aside>
      )}
    </nav>
  );
}

function conversationMinimapTickWidth(index: number, hoveredIndex: number): number {
  if (hoveredIndex < 0) return 10;
  const distance = Math.abs(index - hoveredIndex);
  const wave = [31, 27, 22, 17, 14, 12, 10];
  return wave[Math.min(distance, wave.length - 1)];
}

function buildConversationMinimapEntries(
  rows: TimelineRowItem[],
  streamingText: string,
  locale: "tr" | "en",
): ConversationMinimapEntry[] {
  const entries: ConversationMinimapEntry[] = [];
  let current: ConversationMinimapEntry | undefined;
  const consumeMessage = (message: any, targetKey: string) => {
    const role = String(message?.role || "");
    const rawText = message?.__streaming ? streamingText : textFromMessage(message);
    const preview = conversationPreviewText(rawText);
    if (!preview) return;
    if (role === "user") {
      current = {
        key: `${targetKey}:conversation:${entries.length}`,
        targetKey,
        prompt: preview,
        response: "",
      };
      entries.push(current);
      return;
    }
    if (role === "assistant" && current) current.response = preview;
  };

  for (const row of rows) {
    if (row.kind === "message") {
      consumeMessage(row.message, row.key);
      continue;
    }
    if (row.kind !== "toolGroup") continue;
    for (const workEntry of row.workEntries) {
      if (workEntry.kind === "message") consumeMessage(workEntry.item.message, row.key);
    }
    if (current && !current.response) {
      const thinking = conversationPreviewText(row.thinkingPreview || "");
      current.response = thinking || (locale === "en"
        ? `${row.toolSnapshots.length} tool action${row.toolSnapshots.length === 1 ? "" : "s"}`
        : `${row.toolSnapshots.length} araç işlemi`);
    }
  }
  return entries.slice(-MAX_CONVERSATION_MINIMAP_ENTRIES);
}

function conversationPreviewText(value: string): string {
  const text = String(value || "")
    .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, " ")
    .replace(/\[tool call:\s*[^\]]+\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 260) return text;
  return `${text.slice(0, 257).trimEnd()}…`;
}

export function UserImageAttachments({ images, onPreview }: { images: ComposerImage[]; onPreview: (image: ComposerImage) => void }) {
  return <div className={`message-images ${images.length > 1 ? "multi" : "single"}`}>{images.map((image) => <button type="button" key={image.id} onClick={() => onPreview(image)}><img src={image.previewUrl} alt={image.name} /></button>)}</div>;
}

export function ExpandableUserMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = text.length > 420 || text.split("\n").length > 8;
  return <div className={`user-msg-expandable ${collapsible && !expanded ? "collapsed" : ""}`}><div className="user-msg-text">{text}</div>{collapsible && <button type="button" className="user-msg-more" aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }}>{expanded ? "Daha az göster" : "Daha fazla göster"}</button>}</div>;
}

export function TimelineToolCardInner({ card, onInspect }: { card: ToolCardState; onInspect: () => void }) {
  const { t, locale } = useI18n();
  const argsSummary = summarizeToolArgs(card.toolName, card.args, locale) || statusLabel(card.status, locale);
  const preview = toolPreviewText(card, locale);
  const failed = card.status === "error";
  return <article className={`tool-card timeline-tool activity-item ${card.status}`} aria-label={`${toolDisplayName(card.toolName, locale)} · ${statusLabel(card.status, locale)}`}>
    <div className="tool-card-head">
      <div className="tool-card-title">
        <span className={`tool-status-dot ${card.status}`} aria-hidden="true" />
        <div>
          <span className="tool-card-kicker">{locale === "en" ? "Agent activity" : "Ajan etkinliği"}</span>
          <strong>{toolDisplayName(card.toolName, locale)}</strong>
          <small>{t("tools.turn", { id: card.turnId || "?" })} · <span className={failed ? "tool-card-error-label" : ""}>{statusLabel(card.status, locale)}</span>{card.durationMs !== undefined ? ` · ${formatDuration(card.durationMs)}` : ""}</small>
        </div>
      </div>
      <button type="button" onClick={onInspect} aria-label={`${toolDisplayName(card.toolName, locale)} ${locale === "en" ? "inspect details" : "ayrıntılarını incele"}`}>{locale === "en" ? "Inspect" : "İncele"}</button>
    </div>
    <div className="tool-card-summary">{argsSummary}</div>
    {preview && <pre>{preview.slice(0, 900)}{preview.length > 900 ? `\n… ${locale === "en" ? "inspect for full output." : "tamamı için inceleyin."}` : ""}</pre>}
  </article>;
}
export const TimelineToolCard = React.memo(TimelineToolCardInner);
