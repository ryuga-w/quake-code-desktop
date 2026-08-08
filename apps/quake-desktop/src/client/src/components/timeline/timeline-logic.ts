import { textFromMessage, textFromToolResult } from "../../lib/render";
import { latestPublishedThinkingSummary } from "../../lib/thinking-preview";
import { hashText } from "../../lib/terminal-output";
import { toolSortTime, pushRecentToolBounded } from "../../lib/tool-helpers";
import type { ToolCardState } from "../../state/app-store";
import type { TimelineVisibleSelection, TimelineToolsView, TurnReviewView } from "../../types";
import type { ToolActivityTraceEntry } from "../markdown/MarkdownMessage";
import {
  EMPTY_TIMELINE_VISIBLE_SELECTION,
  MESSAGE_KEY_TEXT_LIMIT,
  TIMELINE_CANDIDATE_OVERSCAN,
  TIMELINE_HISTORY_CONTEXT_AFTER,
  TIMELINE_HISTORY_SCAN_LIMIT,
} from "../../constants";

export type TimelineMessageItem = {
  kind: "message";
  key: string;
  time: number;
  message: any;
  /** A turn-level group already renders this message's tool markers. */
  suppressToolActivity?: boolean;
  /** Thinking stays ephemeral in Semantic Flow and is omitted from this message. */
  suppressThinkingActivity?: boolean;
};
export type TimelineToolItem = { kind: "tool"; key: string; time: number; card: ToolCardState };
export type TimelineMessageHistory = { turnId: number; tools: ToolCardState[] };
export type TimelineToolBatchEntry = {
  kind: "toolBatch";
  key: string;
  names: string[];
  toolSnapshots: ToolCardState[];
  pending: boolean;
  traceEntries: ToolActivityTraceEntry[];
  thinkingPreview?: string;
  thinkingActive: boolean;
};
export type TimelineWorkEntry =
  | { kind: "message"; key: string; item: TimelineMessageItem }
  | TimelineToolBatchEntry;
export type TimelineToolGroupItem = {
  kind: "toolGroup";
  key: string;
  time: number;
  names: string[];
  turnId?: number;
  toolSnapshots: ToolCardState[];
  pending: boolean;
  traceEntries: ToolActivityTraceEntry[];
  /** User, intermediate assistant, and tool batches in their true turn order. */
  workEntries: TimelineWorkEntry[];
  thinkingPreview?: string;
  thinkingActive: boolean;
};
export type TimelineRowItem = TimelineMessageItem | TimelineToolItem | TimelineToolGroupItem;

export function messageSortTime(message: any, fallback: number): number {
  const timestamp = Number(message?.timestamp);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

/** Goal-mode user send (Codex “Hedef olarak gönderildi”). */
export function isUserMessageSentAsGoal(message: any, text: string): boolean {
  if (message?.__sentAsGoal) return true;
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/^\/goal\b/i.test(raw)) return true;
  if (/GOAL RUNTIME/i.test(raw)) return true;
  if (/^Goal:\s+/m.test(raw) && /UNATTENDED EXECUTION|update_goal/i.test(raw)) return true;
  return false;
}

/** Prefer short objective when the host expanded /goal into a runtime envelope. */
export function stripGoalRuntimeEnvelope(text: string): string {
  const raw = String(text || "");
  if (/^\/goal\s+/i.test(raw.trim())) return raw.replace(/^\/goal\s+/i, "").trim();
  const goalLine = raw.match(/^Goal:\s*(.+)$/m);
  if (goalLine?.[1]) return goalLine[1].trim();
  const objective = raw.match(/<objective>\s*([\s\S]*?)\s*<\/objective>/i);
  if (objective?.[1]) return objective[1].trim();
  // Expanded runtime prompts are huge — fall back to last non-empty short line.
  if (/GOAL RUNTIME/i.test(raw) && raw.length > 240) {
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const last = [...lines].reverse().find((line) => line.length > 0 && line.length < 200 && !line.startsWith("#") && !line.startsWith("-"));
    if (last) return last.replace(/^Goal:\s*/i, "").trim();
  }
  return raw;
}

/** Codex user bubble timestamp: "Cuma 21:42" */
export function formatUserBubbleTime(message: any): string {
  const raw = Number(message?.timestamp);
  const ts = Number.isFinite(raw) && raw > 0 ? raw : 0;
  if (!ts) return "";
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return "";
  const weekday = new Intl.DateTimeFormat("tr-TR", { weekday: "long" }).format(date);
  const time = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${time}`;
}

export function messageTimelineKey(message: any, fallback: number): string {
  if (message?.__streaming) return "m-streaming";
  const role = String(message?.role || "message");
  const explicit = message?.id || message?.messageId || message?.turnId || message?.timestamp;
  if (explicit) return `m-${role}-${String(explicit)}-${fallback}`;
  const text = compactMessageKeyText(message);
  const fingerprint = hashText(`${role}|${text}`);
  return `m-${role}-${fingerprint}-${fallback}`;
}

export function compactMessageKeyText(message: any): string {
  const text = textFromMessage(message).replace(/\s+/g, " ").trim();
  if (text.length <= MESSAGE_KEY_TEXT_LIMIT) return text;
  const edge = Math.floor(MESSAGE_KEY_TEXT_LIMIT / 2);
  return `${text.slice(0, edge)}|${text.length}|${text.slice(-edge)}`;
}

export function stripThinkingBlocks(value: string): string {
  return value.replace(/\[thinking\][\s\S]*?\[\/thinking\]\s*/g, "").trim();
}

// Akis sirasinda [thinking]...[/thinking] blogunu metinden ayirir; ham etiketler
// kullaniciya gorunmesin, dusunce icerigi ayri bir "Dusunuyor" blogunda gosterilsin.
export function splitStreamingThinking(text: string): { thinking: string; rest: string } {
  let thinking = "";
  let rest = text.replace(/\[thinking\]([\s\S]*?)\[\/thinking\]/g, (_match, content: string) => {
    thinking += (thinking ? "\n" : "") + (content || "").trim();
    return "";
  });
  // Akis ortasinda henuz kapanmamis dusunce blogu (... [/thinking] daha gelmedi)
  const open = rest.match(/\[thinking\]([\s\S]*)$/);
  if (open) {
    thinking += (thinking ? "\n" : "") + (open[1] || "").trim();
    rest = rest.slice(0, open.index);
  }
  return { thinking: thinking.trim(), rest: rest.trim() };
}

export function isToolOnlyAssistantMessage(text: string): boolean {
  const { rest } = splitStreamingThinking(text || "");
  if (!rest.trim()) return false;
  const lines = rest.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^\[tool call:\s*[^\]]+\]$/i.test(line));
}

// NOT: streamingMessage artik bu secime DAHIL DEGIL. Akan mesaj her frame degisip
// tum mesaj dizisinin yeniden taranmasina (O(n)/frame) ve virtualizer'in buyuyen
// satiri yeniden olcmesine (reflow) yol aciyordu. Akan satir artik listeden ayri,
// altta sabit render ediliyor; bu secim yalnizca `messages` degisince (tur basina)
// hesaplanir.
export function selectTimelineVisibleMessages(messages: any[], filter: "all" | "messages" | "tools" | "errors", windowSize: number, plan?: import("../../../../shared/protocol").WebPlanState): TimelineVisibleSelection {
  if (filter === "tools" || filter === "errors") return EMPTY_TIMELINE_VISIBLE_SELECTION;
  const limit = Math.max(1, windowSize + TIMELINE_CANDIDATE_OVERSCAN);
  const selected: any[] = [];
  const sourceIndexes: number[] = [];
  let total = 0;
  let startIndex = 0;
  const pushVisible = (message: any, sourceIndex: number) => {
    total += 1;
    if (selected.length >= limit) {
      selected.shift();
      sourceIndexes.shift();
      startIndex += 1;
    }
    selected.push(message);
    sourceIndexes.push(sourceIndex);
  };
  messages.forEach((message, sourceIndex) => {
    if (message?.role === "toolResult") return;
    if (isHiddenTimelineMessage(message) || isPlanDocumentTimelineMessage(message, plan)) return;
    pushVisible(message, sourceIndex);
  });
  let firstSourceIndex = -1;
  let lastSourceIndex = -1;
  for (const sourceIndex of sourceIndexes) {
    if (sourceIndex >= 0) {
      firstSourceIndex = sourceIndex;
      break;
    }
  }
  for (let index = sourceIndexes.length - 1; index >= 0; index -= 1) {
    if (sourceIndexes[index] >= 0) {
      lastSourceIndex = sourceIndexes[index];
      break;
    }
  }
  return { messages: selected, total, startIndex, firstSourceIndex, lastSourceIndex };
}

export function isPlanDocumentTimelineMessage(message: any, plan?: import("../../../../shared/protocol").WebPlanState): boolean {
  if (message?.role !== "assistant") return false;
  const text = textFromMessage(message).trim();
  if (!text) return false;
  // The Plan artifact is the sole owner of plan prose. Timeline only keeps the
  // compact plan-created event and ordinary research/activity summaries.
  if (/<\s*proposed_plan\s*>/i.test(text)) return true;
  const artifactText = plan?.artifact?.markdown?.trim();
  if (!artifactText) return false;
  const normalized = text
    .replace(/<\/?\s*proposed_plan\s*>/gi, "")
    .trim();
  return normalized === artifactText;
}

export function isHiddenTimelineMessage(message: any): boolean {
  return message?.display === false;
}

export function isPlanProtocolToolName(toolName: unknown): boolean {
  return toolName === "update_plan" || toolName === "request_user_input";
}

export function selectTimelineToolsView(toolMap: Record<string, ToolCardState>, filter: "all" | "messages" | "tools" | "errors", limit: number): TimelineToolsView {
  if (filter === "messages") return { tools: [], total: 0 };
  const tools: ToolCardState[] = [];
  let total = 0;
  for (const id in toolMap) {
    const tool = toolMap[id];
    if (isPlanProtocolToolName(tool.toolName)) continue;
    if (filter === "errors" && tool.status !== "error") continue;
    total += 1;
    pushRecentToolBounded(tools, tool, limit);
  }
  tools.reverse();
  return { tools, total };
}

export function selectTimelineHistoryMessages(messages: any[], selection: TimelineVisibleSelection, windowSize: number): any[] {
  if (!selection.messages.length || selection.firstSourceIndex < 0 || selection.lastSourceIndex < 0) return [];
  const firstIndex = selection.firstSourceIndex;
  const lastIndex = selection.lastSourceIndex;
  const maxScan = Math.max(TIMELINE_HISTORY_SCAN_LIMIT, windowSize + TIMELINE_CANDIDATE_OVERSCAN * 3);
  const end = Math.min(messages.length, lastIndex + TIMELINE_HISTORY_CONTEXT_AFTER + 1);
  const minStart = Math.max(0, end - maxScan);
  let start = Math.max(minStart, firstIndex);
  // Include the user boundary for the first visible assistant fragment. Without it,
  // restored legacy messages fall back to their old per-message turnIds and split
  // one task into several duration cards again.
  while (start > minStart && messages[start]?.role !== "user") start -= 1;
  return messages.slice(start, end);
}

export function advanceConversationTurn(currentTurn: number, message: any): number {
  if (message?.role !== "user") return currentTurn;
  const explicitTurn = Number(message.turnId || 0);
  if (explicitTurn > 0) return Math.max(currentTurn, explicitTurn);
  return currentTurn + 1;
}

export function countConversationTurns(messages: any[]): number {
  let currentTurn = 0;
  for (const message of messages) currentTurn = advanceConversationTurn(currentTurn, message);
  return currentTurn;
}

/**
 * A file-change snapshot belongs to exactly one conversation turn. The global
 * `latest` snapshot is only a transport fallback; never attach it to a newer
 * assistant answer unless its owning turn is explicit and matches.
 */
export function resolveTimelineTurnDiff(
  turnId: unknown,
  turnDiffsByTurn?: Record<string, TurnReviewView>,
  latestTurnDiff?: TurnReviewView,
): TurnReviewView | undefined {
  const normalizedTurnId = Number(turnId);
  if (!Number.isFinite(normalizedTurnId) || normalizedTurnId <= 0) return undefined;

  const exactTurnDiff = turnDiffsByTurn?.[String(normalizedTurnId)];
  if (exactTurnDiff) return exactTurnDiff;

  return Number(latestTurnDiff?.turnId || 0) === normalizedTurnId
    ? latestTurnDiff
    : undefined;
}

export function buildMessageToolHistory(messages: any[], streamingMessage?: any): Map<any, TimelineMessageHistory> {
  const byMessage = new Map<any, TimelineMessageHistory>();
  const byId = new Map<string, ToolCardState>();
  let conversationTurn = 0;
  // streamingMessage lives outside the persisted/virtualized message array.
  // Project it through the exact same parser so live tool-call arguments reach
  // grouped activity even when standalone tools are hidden by the Messages view.
  const sourceMessages = streamingMessage && !messages.includes(streamingMessage)
    ? [...messages, streamingMessage]
    : messages;
  for (const message of sourceMessages) {
    conversationTurn = advanceConversationTurn(conversationTurn, message);
    if (message?.role === "user") {
      const turnId = conversationTurn || Number(message.turnId || 0) || 1;
      byMessage.set(message, { turnId, tools: [] });
      continue;
    }
    if (message?.role === "assistant") {
      // Assistant commentary, tool-call, and final-answer messages all belong to
      // the most recent user task. Legacy per-message turnIds are only a fallback
      // when the visible history starts mid-turn without its user message.
      const turnId = conversationTurn || Number(message.turnId || 0) || 1;
      const timestamp = Number(message.timestamp || Date.now());
      const tools = Array.isArray(message.content)
        ? message.content
          .filter((part: any) => part?.type === "toolCall")
          .filter((part: any) => !isPlanProtocolToolName(part?.name || part?.toolName))
          .map((part: any, index: number) => {
            const id = String(part.id || part.toolCallId || `${turnId}-${index}-${part.name || part.toolName || "tool"}`);
            const tool: ToolCardState = {
              id,
              toolName: String(part.name || part.toolName || "tool"),
              args: part.arguments ?? part.args,
              details: part.details,
              status: "running",
              turnId,
              startedAt: timestamp,
              updatedAt: timestamp,
            };
            byId.set(id, tool);
            return tool;
          })
        : [];
      byMessage.set(message, { turnId, tools });
      continue;
    }
    if (message?.role === "toolResult") {
      const id = String(message.toolCallId || message.id || "");
      const existing = id ? byId.get(id) : undefined;
      if (!existing) continue;
      const timestamp = Number(message.timestamp || Date.now());
      existing.status = message.isError ? "error" : "done";
      existing.output = textFromToolResult(message);
      existing.details = message.details;
      const images = Array.isArray(message.content) ? message.content.filter((p: any) => p.type === "image").map((p: any) => ({ data: p.data, mimeType: p.mimeType || "image/png" })) : [];
      if (images.length > 0) existing.images = images;
      existing.endedAt = timestamp;
      existing.updatedAt = timestamp;
      existing.durationMs = existing.startedAt ? Math.max(0, timestamp - existing.startedAt) : undefined;
    }
  }
  return byMessage;
}

export function extractToolCallNamesFromMessageText(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^\[tool call:\s*([^\]]+)\]$/i);
    if (match) names.push(match[1].trim());
  }
  return names;
}

export function isTimelineToolMessage(message: any, text: string): boolean {
  return message?.role === "assistant" && isToolOnlyAssistantMessage(text);
}

export function normalizeTimelineWorkText(value: string): string {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .trim();
}

export function visibleAssistantNarration(text: string): string {
  return normalizeTimelineWorkText(
    stripThinkingBlocks(text || "")
      .replace(/^\[tool call:\s*[^\]]+\]\s*$/gim, ""),
  );
}

export function hasVisibleAssistantNarration(text: string): boolean {
  return Boolean(visibleAssistantNarration(text));
}

export function timelineThinkingContent(text: string): string {
  return normalizeTimelineWorkText(
    [...String(text || "").matchAll(/\[thinking\]([\s\S]*?)\[\/thinking\]/gi)]
    .map((match) => String(match[1] || "").trim())
    .filter(Boolean)
    .join("\n\n"),
  );
}

export function timelineThinkingPreview(text: string): string {
  return latestPublishedThinkingSummary(timelineThinkingContent(text));
}

export function isAssistantToolPhaseMessage(message: any, text: string): boolean {
  return message?.role === "assistant" && !hasVisibleAssistantNarration(text);
}

export function isAbortedAssistantMessage(message: any): boolean {
  return message?.role === "assistant"
    && (message?.__aborted === true || message?.stopReason === "aborted");
}

export function hasAbortedAssistantMessageForTurn(messages: any[], turnId: number): boolean {
  if (turnId <= 0) return false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isAbortedAssistantMessage(message)) continue;
    if (Number(message?.turnId || 0) === turnId) return true;
  }
  return false;
}

export function buildAbortedTurnDurationMap(messages: any[]): Map<any, number> {
  const durationByMessage = new Map<any, number>();
  let latestUserStartedAt = 0;
  for (const message of messages) {
    const timestamp = Number(message?.timestamp);
    if (message?.role === "user") {
      latestUserStartedAt = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
      continue;
    }
    if (!isAbortedAssistantMessage(message)) continue;
    const explicitDuration = Number(message?.__abortedAfterMs);
    if (Number.isFinite(explicitDuration) && explicitDuration >= 0) {
      durationByMessage.set(message, explicitDuration);
      continue;
    }
    const inferredDuration = latestUserStartedAt > 0 && Number.isFinite(timestamp) && timestamp >= latestUserStartedAt
      ? timestamp - latestUserStartedAt
      : 0;
    durationByMessage.set(message, inferredDuration);
  }
  return durationByMessage;
}

export function formatAbortedTurnLabel(durationMs: number): string {
  const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const totalSeconds = Math.floor(safeDuration / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const elapsed = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  return `${elapsed} sonra durdurdunuz`;
}

export function isSilentAssistantTimelineMessage(message: any, text: string): boolean {
  return !isAbortedAssistantMessage(message)
    && !message?.__streaming
    && isAssistantToolPhaseMessage(message, text)
    && !isTimelineToolMessage(message, text);
}

export function hasActiveTimelineTool(tools: ToolCardState[]): boolean {
  return tools.some((tool) => tool.status === "queued" || tool.status === "running" || tool.status === "streaming");
}

export function groupTimelineRows(rows: Array<TimelineMessageItem | TimelineToolItem>, streamingText: string, messageToolHistory: Map<any, TimelineMessageHistory>, activeStreamingTurnId?: number, agentIsStreaming?: boolean): TimelineRowItem[] {
  type ToolTurnAccumulator = {
    key: string;
    time: number;
    turnId?: number;
    names: Set<string>;
    tools: Map<string, ToolCardState>;
    pending: boolean;
    traceEntries: ToolActivityTraceEntry[];
    traceKeys: Set<string>;
    workEntries: TimelineWorkEntry[];
    thinkingPreview?: string;
    thinkingActive: boolean;
  };

  // One user task can emit many assistant message_start/message_end pairs while the
  // agent loops through tools. Aggregate those protocol fragments by conversation
  // turn so the timeline owns one persistent activity surface and one duration.
  const turnGroups = new Map<string, ToolTurnAccumulator>();
  const messageGroupKeys = new Map<string, string>();
  const suppressedThinkingMessageKeys = new Set<string>();
  // The group belongs after the latest assistant fragment that actually invoked a
  // tool. Anchoring at the first fragment placed the whole activity block above
  // narration that chronologically preceded later tool calls.
  const groupAnchorKeys = new Map<string, string>();
  const groupedToolIds = new Set<string>();

  for (const item of rows) {
    if (item.kind !== "message" || item.message?.role !== "assistant" || isAbortedAssistantMessage(item.message)) continue;
    const text = item.message.__streaming ? streamingText : textFromMessage(item.message);
    const history = messageToolHistory.get(item.message);
    const names = extractToolCallNamesFromMessageText(text);
    const tools = history?.tools || [];
    if (names.length === 0 && tools.length === 0) continue;

    const turnId = Number(history?.turnId || item.message.turnId || 0) || undefined;
    const groupKey = turnId ? `turn:${turnId}` : `message:${item.key}`;
    let group = turnGroups.get(groupKey);
    if (!group) {
      group = {
        key: `tool-turn:${turnId ?? item.key}`,
        time: item.time,
        turnId,
        names: new Set<string>(),
        tools: new Map<string, ToolCardState>(),
        pending: false,
        traceEntries: [],
        traceKeys: new Set<string>(),
        workEntries: [],
        thinkingActive: false,
      };
      turnGroups.set(groupKey, group);
    }
    group.time = Math.max(group.time, item.time);
    group.pending = group.pending || Boolean(item.message.__streaming) || hasActiveTimelineTool(tools);
    group.thinkingActive = false;
    const thinkingPreview = timelineThinkingPreview(text);
    if (thinkingPreview) group.thinkingPreview = thinkingPreview;
    for (const name of names) group.names.add(name);
    for (const tool of tools) {
      group.names.add(tool.toolName);
      group.tools.set(tool.id, tool);
      groupedToolIds.add(tool.id);
      const toolKey = `tool:${tool.id}`;
      if (!group.traceKeys.has(toolKey)) {
        group.traceKeys.add(toolKey);
        group.traceEntries.push({ kind: "tool", key: toolKey, toolId: tool.id });
      }
    }
    messageGroupKeys.set(item.key, groupKey);
    groupAnchorKeys.set(groupKey, item.key);
  }

  // Once a turn has a tool surface, thinking-only protocol fragments between
  // tool calls feed only the live Semantic Flow headline. They never become
  // historical rows; normal assistant prose remains a regular timeline message.
  for (const item of rows) {
    if (item.kind !== "message" || item.message?.role !== "assistant" || isAbortedAssistantMessage(item.message) || messageGroupKeys.has(item.key)) continue;
    const text = item.message.__streaming ? streamingText : textFromMessage(item.message);
    const narration = visibleAssistantNarration(text);
    const thinkingContent = timelineThinkingContent(text);
    const thinkingPreview = timelineThinkingPreview(text);
    const history = messageToolHistory.get(item.message);
    const turnId = Number(history?.turnId || item.message.turnId || 0) || undefined;
    if (!turnId) continue;
    const groupKey = `turn:${turnId}`;
    const group = turnGroups.get(groupKey);
    if (!group) continue;
    if (narration) {
      if (thinkingContent) {
        if (item.time >= group.time) {
          group.thinkingActive = true;
          group.thinkingPreview = thinkingPreview || group.thinkingPreview;
        }
        suppressedThinkingMessageKeys.add(item.key);
      }
      continue;
    }
    if (!item.message.__streaming && !thinkingContent) continue;
    const followsLatestTool = item.time >= group.time;
    messageGroupKeys.set(item.key, groupKey);
    groupAnchorKeys.set(groupKey, item.key);
    group.time = Math.max(group.time, item.time);
    group.pending = group.pending || Boolean(item.message.__streaming);
    group.thinkingActive = followsLatestTool;
    if (thinkingContent && followsLatestTool) {
      group.thinkingPreview = thinkingPreview;
    }
  }

  // Session-level `isStreaming` must never revive the previous turn's settled
  // activity. Only the group owned by the active conversation turn stays live
  // during message_end gaps between tool calls.
  let liveGroupMarked = false;
  if (activeStreamingTurnId) {
    const activeGroup = turnGroups.get(`turn:${activeStreamingTurnId}`);
    if (activeGroup) {
      activeGroup.pending = true;
      liveGroupMarked = true;
    }
  }
  // Dayaniklilik: ajan hala calisiyor (agentIsStreaming) ama aktif turn ID'si
  // hicbir grupla eslesmediyse (tool turnId semasi countConversationTurns ile
  // uyusmayabilir), en guncel (en buyuk time) grubu canli tut. Aksi halde turn
  // "Xs calisti" deyip bitmis gorunur ama ajan devam eder -> "durdu sandim" bug.
  if (agentIsStreaming && !liveGroupMarked && turnGroups.size > 0) {
    let latestGroup: ToolTurnAccumulator | undefined;
    for (const group of turnGroups.values()) {
      if (!latestGroup || group.time >= latestGroup.time) latestGroup = group;
    }
    if (latestGroup) latestGroup.pending = true;
  }

  // Build the disclosure in true protocol order. Visible assistant narration is a
  // phase boundary: the previous tool batch closes before the message, and tools
  // invoked after that message start a fresh batch below it.
  const nestedWorkMessageKeys = new Set<string>();
  for (const group of turnGroups.values()) {
    if (!group.turnId) continue;
    const turnMessages = rows.filter((item): item is TimelineMessageItem => {
      if (item.kind !== "message") return false;
      const itemTurnId = Number(messageToolHistory.get(item.message)?.turnId || item.message?.turnId || 0);
      return itemTurnId === group.turnId;
    });
    const latestAssistantMessage = [...turnMessages].reverse().find((item) => item.message?.role === "assistant");
    const latestAssistantText = latestAssistantMessage
      ? (latestAssistantMessage.message.__streaming ? streamingText : textFromMessage(latestAssistantMessage.message))
      : "";
    const latestAssistantHistory = latestAssistantMessage
      ? messageToolHistory.get(latestAssistantMessage.message)
      : undefined;
    // A trailing narration is the provisional final answer even before agent_end.
    // If another tool arrives later it stops being the latest assistant message
    // and is rebuilt as an intermediate phase in the next projection.
    //
    // KRITIK: Ajan cok-adimli bir turn'de (arac cagirmadan once) ARA metin yazabilir.
    // O metin hala akiyorsa (__streaming) ya da bu grup AKTIF streaming turn ise, bu
    // henuz nihai cevap DEGIL. Boyle durumda "final" sayip pending'i kapatirsak UI
    // yanlislikla "Xs calisti" (bitti) moduna gecer, sonra yeni arac gelince tekrar
    // "calisiyor"a doner -> kullanicinin gordugu "durdu sandim ama devam ediyor" bug'i.
    // Bu yuzden aktif turn'de VEYA metin hala akarken narration'i final saymiyoruz.
    // Ajan hala calisiyorsa ve bu grup en guncel (son) grupsa, aktif turn ID'si
    // eslesmese bile onu aktif streaming grubu say -> narration'i erken "final"
    // sayip "Xs calisti" moduna gecmeyi engeller.
    const isNewestGroup = (() => {
      let latest: ToolTurnAccumulator | undefined;
      for (const candidate of turnGroups.values()) {
        if (!latest || candidate.time >= latest.time) latest = candidate;
      }
      return latest === group;
    })();
    const isActiveStreamingGroup = (Boolean(activeStreamingTurnId) && group.turnId === activeStreamingTurnId)
      || Boolean(agentIsStreaming && isNewestGroup);
    const latestAssistantStillStreaming = Boolean(latestAssistantMessage?.message?.__streaming);
    const finalAssistantMessage = latestAssistantMessage
      && hasVisibleAssistantNarration(latestAssistantText)
      && (latestAssistantHistory?.tools.length || 0) === 0
      && extractToolCallNamesFromMessageText(latestAssistantText).length === 0
      && !isActiveStreamingGroup
      && !latestAssistantStillStreaming
      ? latestAssistantMessage
      : undefined;
    group.pending = group.pending && !finalAssistantMessage;
    type MutableToolBatch = Omit<TimelineToolBatchEntry, "names" | "toolSnapshots"> & {
      names: Set<string>;
      tools: Map<string, ToolCardState>;
    };
    const orderedEntries: Array<{ kind: "message"; key: string; item: TimelineMessageItem } | MutableToolBatch> = [];
    let currentBatch: MutableToolBatch | undefined;
    let batchIndex = 0;
    const startBatch = () => {
      const batch: MutableToolBatch = {
        kind: "toolBatch",
        key: `${group.key}:batch:${batchIndex}`,
        names: new Set<string>(),
        tools: new Map<string, ToolCardState>(),
        pending: false,
        traceEntries: [],
        thinkingActive: false,
      };
      batchIndex += 1;
      orderedEntries.push(batch);
      currentBatch = batch;
      return batch;
    };
    for (const item of turnMessages) {
      const role = item.message?.role;
      const text = item.message.__streaming ? streamingText : textFromMessage(item.message);
      if (role === "user") {
        if (!group.pending) {
          nestedWorkMessageKeys.add(item.key);
          orderedEntries.push({ kind: "message", key: item.key, item });
        }
        continue;
      }
      if (role !== "assistant") continue;

      const history = messageToolHistory.get(item.message);
      const tools = history?.tools || [];
      const names = extractToolCallNamesFromMessageText(text);
      const narration = hasVisibleAssistantNarration(text);
      const isFinalAssistant = item.key === finalAssistantMessage?.key;
      if (narration && !isFinalAssistant) {
        const workMessage = { ...item, suppressToolActivity: true, suppressThinkingActivity: true };
        nestedWorkMessageKeys.add(item.key);
        messageGroupKeys.set(item.key, `turn:${group.turnId}`);
        groupAnchorKeys.set(`turn:${group.turnId}`, item.key);
        orderedEntries.push({ kind: "message", key: item.key, item: workMessage });
        // Any following tools belong to the new narration phase, never to the
        // already-settled counter shown above this message.
        currentBatch = undefined;
      }

      if (tools.length > 0 || names.length > 0) {
        const batch = currentBatch || startBatch();
        for (const name of names) batch.names.add(name);
        for (const tool of tools) {
          batch.names.add(tool.toolName);
          batch.tools.set(tool.id, group.tools.get(tool.id) || tool);
          if (!batch.traceEntries.some((entry) => entry.toolId === tool.id)) {
            batch.traceEntries.push({ kind: "tool", key: `tool:${tool.id}`, toolId: tool.id });
          }
        }
        messageGroupKeys.set(item.key, `turn:${group.turnId}`);
        groupAnchorKeys.set(`turn:${group.turnId}`, item.key);
      }

      const thinkingPreview = timelineThinkingPreview(text);
      if (thinkingPreview && !isFinalAssistant) {
        const batch = currentBatch || startBatch();
        batch.thinkingPreview = thinkingPreview;
        if (item.message.__streaming || item.time >= group.time) batch.thinkingActive = true;
        messageGroupKeys.set(item.key, `turn:${group.turnId}`);
        groupAnchorKeys.set(`turn:${group.turnId}`, item.key);
      }
    }

    // Do not speculate an empty Semantic Flow batch after narration. If another
    // tool actually arrives, its own event starts the next batch below the message.
    const toolBatches = orderedEntries.filter((entry): entry is MutableToolBatch => entry.kind === "toolBatch");
    const latestBatch = toolBatches.at(-1);
    for (const batch of toolBatches) {
      batch.pending = [...batch.tools.values()].some((tool) => hasActiveTimelineTool([tool]));
      if (batch !== latestBatch) batch.thinkingActive = false;
    }
    if (group.pending && latestBatch) {
      latestBatch.pending = true;
      latestBatch.thinkingActive = group.thinkingActive || latestBatch.thinkingActive;
      latestBatch.thinkingPreview = group.thinkingPreview || latestBatch.thinkingPreview;
    }
    group.workEntries = orderedEntries.map((entry): TimelineWorkEntry => entry.kind === "message"
      ? entry
      : {
          ...entry,
          names: [...entry.names],
          toolSnapshots: [...entry.tools.values()],
        });
  }

  const grouped: TimelineRowItem[] = [];
  const emittedGroups = new Set<string>();
  const emittedAbortedTurns = new Set<string>();
  for (const item of rows) {
    if (item.kind === "tool") {
      // The persisted assistant/toolResult history already owns this card.
      if (!groupedToolIds.has(item.card.id)) grouped.push(item);
      continue;
    }

    if (isAbortedAssistantMessage(item.message)) {
      const abortedTurnId = Number(messageToolHistory.get(item.message)?.turnId || item.message?.turnId || 0);
      const abortedTurnKey = abortedTurnId > 0 ? `turn:${abortedTurnId}` : `message:${item.key}`;
      if (emittedAbortedTurns.has(abortedTurnKey)) continue;
      emittedAbortedTurns.add(abortedTurnKey);
    }

    const text = item.message.__streaming ? streamingText : textFromMessage(item.message);
    const groupKey = messageGroupKeys.get(item.key);
    if (groupKey) {
      // During live work, prose stays visible. Once settled, intermediate prose is
      // rendered as a real message inside the disclosure rather than as a tool row.
      if (!nestedWorkMessageKeys.has(item.key) && hasVisibleAssistantNarration(text)) {
        grouped.push({
          ...item,
          suppressToolActivity: true,
          suppressThinkingActivity: true,
        });
      }
      const group = turnGroups.get(groupKey);
      const isGroupAnchor = groupAnchorKeys.get(groupKey) === item.key;
      if (group && isGroupAnchor && !emittedGroups.has(groupKey)) {
        emittedGroups.add(groupKey);
        grouped.push({
          kind: "toolGroup",
          key: group.key,
          time: group.time,
          names: [...group.names],
          turnId: group.turnId,
          toolSnapshots: [...group.tools.values()],
          pending: group.pending,
          traceEntries: group.traceEntries,
          workEntries: group.workEntries,
          thinkingPreview: group.thinkingPreview,
          thinkingActive: group.thinkingActive,
        });
      }
      continue;
    }

    if (nestedWorkMessageKeys.has(item.key)) continue;
    if (isSilentAssistantTimelineMessage(item.message, text)) continue;
    grouped.push(suppressedThinkingMessageKeys.has(item.key) ? { ...item, suppressThinkingActivity: true } : item);
  }
  return grouped;
}
