/**
 * SSE / server-event handler factory.
 *
 * Extracted from App.tsx so the live event pipeline can be tested and wired
 * without pulling the entire React surface into this module. App owns the
 * refs/setters and passes them via {@link ServerEventHandlerContext}.
 */
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { countConversationTurns } from "../../components/timeline/timeline-logic";
import { ensureTerminalTab, type TerminalTabState } from "../../components/terminal/terminal-utils";
import {
  appendTerminalOutput,
  formatTerminalRunOutput,
  terminalTranscript,
} from "../../lib/terminal-output";
import { normalizeQueuedTexts } from "../../lib/format-utils";
import { textFromMessage, textFromToolResult } from "../../lib/render";
import { isPlanProtocolToolName, normalizeToolArgs, toolCallStreamSignature } from "../../lib/tool-helpers";
import { notifyError, notifyTaskComplete } from "../../lib/notifications";
import { useAppStore, type ToolCardState } from "../../state/app-store";
import type {
  QueuedMessages,
  QueuedUserMessage,
  RightTab,
  TurnReviewView,
} from "../../types";

/** Mutable ref shape used throughout the event handlers. */
export type HandlerRef<T> = MutableRefObject<T>;

/** Coalesced streaming-message patch waiting for the next animation frame. */
export type PendingStreamingUpdate = {
  message: any;
  sourceMessage: any;
  status: string;
};

/** In-flight terminal process buffer keyed by server terminal id. */
export type TerminalRun = { command: string; output: string };

/**
 * Wide dependency bag so App can pass every closed-over setter/ref/helper the
 * SSE handlers need without this module importing React state hooks.
 */
export type ServerEventHandlerContext = {
  // ── Store / session surface ──────────────────────────────────────────────
  /** Patch top-level zustand app store fields (state, messages, …). */
  setStore: (patch: Record<string, unknown>) => void;
  /** Append a settled timeline message to the store. */
  addStoreMessage: (message: any) => void;
  /** Insert or merge a tool card by id. */
  upsertTool: (id: string, patch: Partial<ToolCardState>) => void;
  /** Set or clear the live streaming assistant message. */
  setStreamingStoreMessage: (message?: any) => void;
  /** Merge fields into `state` without clobbering unrelated keys. */
  patchSessionState: (patch: Record<string, unknown>) => void;
  /** Toast helper from app store (preferred over re-importing toast store). */
  showToast: (message: string, type?: "info" | "success" | "warning" | "error") => void;
  /** Extension/status strip key → text. */
  setStatus: (key: string, text?: string) => void;

  // ── Session identity (for plan activity signatures) ──────────────────────
  /** Active session file path when known. */
  sessionFile: string | undefined;
  /** Active session id when known. */
  sessionId: string | undefined;

  // ── React state setters ──────────────────────────────────────────────────
  /** Mark the session surface as still hydrating / pending. */
  setSessionSurfacePending: Dispatch<SetStateAction<boolean>>;
  /** Replace or update per-turn diff cards. */
  setTurnDiffs: Dispatch<SetStateAction<Record<string, TurnReviewView>>>;
  /** Replace steering / follow-up queue previews. */
  setQueuedMessages: Dispatch<SetStateAction<QueuedMessages>>;
  /** Local user message queue drained after each turn completes. */
  setUserMessageQueue: Dispatch<SetStateAction<QueuedUserMessage[]>>;
  /** Security approval modal payload. */
  setApprovalPrompt: Dispatch<SetStateAction<any>>;
  /** MCP elicitation modal payload. */
  setMcpElicitation: Dispatch<SetStateAction<any>>;
  /** Terminal panel tab list. */
  setTerminalTabs: Dispatch<SetStateAction<TerminalTabState[]>>;

  // ── Refs (shared with App so stop/abort paths stay in sync) ──────────────
  /** Latest conversation turn counter. */
  currentTurnRef: HandlerRef<number>;
  /** True while an agent turn is considered active. */
  agentTurnActiveRef: HandlerRef<boolean>;
  /** True between agent_start and agent_end lifecycle events. */
  agentLifecycleActiveRef: HandlerRef<boolean>;
  /** Signature of assistant toolCall parts already synced while streaming. */
  lastAssistantToolCallSignatureRef: HandlerRef<string>;
  /** Last observed plan phase (for ready-transition detection). */
  lastPlanPhaseRef: HandlerRef<string>;
  /** Previous goal status for completion / blocked notifications. */
  previousGoalStatusRef: HandlerRef<string | undefined>;
  /** Suppress late events after user-initiated turn abort. */
  abortedTurnSuppressedRef: HandlerRef<boolean>;
  /** True while a session switch / new chat transition is in flight. */
  sessionTransitionPendingRef: HandlerRef<boolean>;
  /** One-shot guard for event-stream parse/handle warnings. */
  eventStreamWarningShownRef: HandlerRef<boolean>;
  /** Timestamp of last agent_event (liveness). */
  lastAgentEventAtRef: HandlerRef<number>;
  /** Debounced “yanıt tamamlandı” timer id. */
  turnCompleteNotifyTimerRef: HandlerRef<number | undefined>;
  /** Whether the completion toast/queue drain already fired this turn. */
  turnCompleteNotifiedRef: HandlerRef<boolean>;
  /** Pending rAF-coalesced streaming message update. */
  pendingStreamingUpdateRef: HandlerRef<PendingStreamingUpdate | undefined>;
  /** requestAnimationFrame id for streaming message coalesce. */
  streamingUpdateFrameRef: HandlerRef<number | undefined>;
  /** Pending rAF-coalesced tool card patches by toolCallId. */
  pendingToolUpdatesRef: HandlerRef<Map<string, Partial<ToolCardState>>>;
  /** requestAnimationFrame id for tool update coalesce. */
  toolUpdateFrameRef: HandlerRef<number | undefined>;
  /** Live mirror of terminal tabs for event→tab lookup. */
  terminalTabsRef: HandlerRef<TerminalTabState[]>;
  /** Current files panel directory (refresh target after ready). */
  currentFileDirRef: HandlerRef<string>;

  // ── Non-React mutable collections ────────────────────────────────────────
  /** Active terminal run buffers keyed by server terminal id. */
  terminalRuns: Map<string, TerminalRun>;

  // ── Settings snapshots ───────────────────────────────────────────────────
  /** Goal UI prefs; `completionNotification` drives goal status toasts. */
  goalUiSettings: { completionNotification: boolean };

  // ── App-owned helpers (not extracted; stay in App / siblings) ────────────
  /** Accept ready payload only if it matches expected session transition. */
  acceptsSessionReady: (state: any) => boolean;
  /** Hydrate composer draft for the given session key. */
  activateComposerDraft: (sessionKey: string) => void;
  /** Restore right-panel snapshot for the given session key. */
  activateRightPanelSnapshot: (sessionKey: string) => void;
  /** Ensure compact plan-created timeline activity exists (optionally open panel). */
  ensureCreatedPlanActivity: (plan: any, options?: { open?: boolean }) => void;
  /** Open the plan dock for a created-plan activity signature. */
  openCreatedPlanActivity: (signature: string) => void;
  /** Whether a plan-created activity for this planId already exists. */
  hasCreatedPlanActivity: (planId: string) => boolean;
  /** Clear local streaming UI + cancel scheduled patches. */
  clearLocalStreamingState: () => void;
  /** True if streaming message or active tools still hang after idle. */
  hasDanglingAgentUiState: () => boolean;
  /** Mark running/streaming tools as done when the turn goes idle. */
  settleActiveToolsAfterIdle: () => void;
  /** Snapshot partial streaming message into the timeline after Stop. */
  preserveStreamingMessageAfterAbort: (authoritativeDurationMs?: number) => void;
  /** Quiet/authoritative state re-fetch after idle reconcile. */
  refreshSessionState: (options?: { quiet?: boolean; settleIfIdle?: boolean }) => Promise<any> | void;
  /** Refresh session sidebar list. */
  refreshSessions: () => void | Promise<void>;
  /** Refresh model picker list. */
  refreshModels: () => void | Promise<void>;
  /** Refresh slash command list. */
  refreshCommands: () => void | Promise<void>;
  /** Refresh files panel for a directory. */
  refreshFiles: (path?: string) => void | Promise<void>;
  /** Refresh workspace git/change summary. */
  refreshWorkspaceChanges: () => void | Promise<void>;
  /** Debounced sidebar sessions refresh after message_end. */
  scheduleRefreshSessions: (delayMs?: number) => void;
  /** Upsert the active session row title from first user text. */
  upsertActiveSessionInSidebar: (firstMessage?: string) => void;
  /** Open (or focus) a right-panel dock tab. */
  openRightPanel: (tab: RightTab) => void;
  /** Dispatch extension_ui_request methods (status, widgets, modals, …). */
  handleExtensionRequest: (event: any) => void;
  /** Send the next queued user message after turn completion. */
  sendQueuedUserMessage: (item: QueuedUserMessage) => Promise<unknown>;
};

export type ServerEventHandlers = {
  handleServerMessage: (raw: string) => void;
  handleServerEvent: (event: any) => void;
  handleAgentEvent: (event: any) => void;
  handleTerminalEvent: (event: any) => void;
  warnEventStreamOnce: (message: string, error: unknown) => void;
  ensureAgentTurn: () => number;
  /** Also exported so App can cancel rAF patches outside agent events. */
  cancelScheduledStreamingUpdate: () => void;
};

function hasActiveToolState(tools: Record<string, ToolCardState>): boolean {
  return Object.values(tools).some(
    (tool) => tool?.status === "queued" || tool?.status === "running" || tool?.status === "streaming",
  );
}

/**
 * Build the SSE core handlers bound to the given App context.
 * Logic matches App.tsx (handleServerEvent / handleAgentEvent / handleTerminalEvent).
 */
export function createServerEventHandlers(ctx: ServerEventHandlerContext): ServerEventHandlers {
  function cancelScheduledStreamingUpdate() {
    if (ctx.streamingUpdateFrameRef.current !== undefined) {
      window.cancelAnimationFrame(ctx.streamingUpdateFrameRef.current);
      ctx.streamingUpdateFrameRef.current = undefined;
    }
    ctx.pendingStreamingUpdateRef.current = undefined;
  }

  function scheduleStreamingMessageUpdate(message: any, status: string) {
    ctx.pendingStreamingUpdateRef.current = {
      message: { ...message, turnId: ctx.currentTurnRef.current },
      sourceMessage: message,
      status,
    };
    if (ctx.streamingUpdateFrameRef.current !== undefined) return;
    ctx.streamingUpdateFrameRef.current = window.requestAnimationFrame(() => {
      ctx.streamingUpdateFrameRef.current = undefined;
      const pending = ctx.pendingStreamingUpdateRef.current;
      ctx.pendingStreamingUpdateRef.current = undefined;
      if (!pending) return;
      ctx.setStreamingStoreMessage(pending.message);
      syncAssistantToolCalls(pending.sourceMessage, pending.status);
    });
  }

  // tool_execution_update olaylari saniyede onlarca gelebilir; her birini senkron
  // upsertTool'a vermek (pruneTools + compactToolOutput + tum tool abonelerini render)
  // metin akisiyla cakisan ikinci bir render firtinasi yaratiyordu. Mesaj
  // guncellemeleri gibi rAF ile coalesce et: toolCallId basina son patch'i frame'de
  // bir kez uygula.
  function scheduleToolUpdate(id: string, patch: Partial<ToolCardState>) {
    ctx.pendingToolUpdatesRef.current.set(id, patch);
    if (ctx.toolUpdateFrameRef.current !== undefined) return;
    ctx.toolUpdateFrameRef.current = window.requestAnimationFrame(() => {
      ctx.toolUpdateFrameRef.current = undefined;
      const pending = ctx.pendingToolUpdatesRef.current;
      ctx.pendingToolUpdatesRef.current = new Map();
      for (const [toolId, toolPatch] of pending) ctx.upsertTool(toolId, toolPatch);
    });
  }

  function syncAssistantToolCalls(message: any, status: string) {
    if (!Array.isArray(message?.content)) return;
    const signature = toolCallStreamSignature(message);
    if (status === "streaming" && signature && signature === ctx.lastAssistantToolCallSignatureRef.current) return;
    if (signature) ctx.lastAssistantToolCallSignatureRef.current = signature;
    for (const [index, part] of message.content.entries()) {
      if (part?.type !== "toolCall") continue;
      if (isPlanProtocolToolName(part.name || part.toolName)) continue;
      const id = String(part.id || part.toolCallId || `${ctx.currentTurnRef.current || 1}-${index}-${part.name || part.toolName || "tool"}`);
      const existing = useAppStore.getState().tools[id];
      const nextStatus = existing && ["done", "error"].includes(existing.status) ? existing.status : status;
      ctx.upsertTool(id, {
        toolName: String(part.name || part.toolName || "tool"),
        args: normalizeToolArgs(part.arguments ?? part.args),
        details: part.details ?? existing?.details,
        status: nextStatus,
        turnId: ctx.currentTurnRef.current || 1,
        startedAt: existing?.startedAt ?? Date.now(),
      });
    }
  }

  function terminalRunForEvent(event: any): TerminalRun | undefined {
    if (!event?.id) return undefined;
    const existing = ctx.terminalRuns.get(event.id);
    if (existing) return existing;
    const tab = ctx.terminalTabsRef.current.find((item) => item.id === event.id);
    const command = String(event.command || tab?.command || "terminal");
    const run = { command, output: "" };
    ctx.terminalRuns.set(event.id, run);
    ctx.setTerminalTabs((tabs) => ensureTerminalTab(tabs, event.id, command).map((item) => item.id === event.id ? { ...item, command, output: item.output && item.output !== "Komut çıktısı burada görünecek" ? item.output : terminalTranscript(command, "Çalışıyor…"), status: "running" } : item));
    return run;
  }

  function ensureAgentTurn(): number {
    if (!ctx.agentTurnActiveRef.current) {
      ctx.currentTurnRef.current = Math.max(0, ctx.currentTurnRef.current) + 1;
      ctx.agentTurnActiveRef.current = true;
    }
    if (ctx.currentTurnRef.current <= 0) ctx.currentTurnRef.current = 1;
    return ctx.currentTurnRef.current;
  }

  function warnEventStreamOnce(message: string, error: unknown) {
    if (ctx.eventStreamWarningShownRef.current) return;
    ctx.eventStreamWarningShownRef.current = true;
    console.warn("[quake-web] Event stream issue", error);
    ctx.showToast(`${message}: ${error instanceof Error ? error.message : "bilinmeyen hata"}`, "warning");
  }

  function handleServerMessage(raw: string) {
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch (error: any) {
      warnEventStreamOnce("Olay akışında bozuk veri atlandı", error);
      return;
    }
    try {
      handleServerEvent(event);
    } catch (error: any) {
      warnEventStreamOnce("Olay işlenirken hata yakalandı, akış korunuyor", error);
    }
  }

  function handleServerEvent(event: any) {
    if (event.type === "ready") {
      if (!ctx.acceptsSessionReady(event.state)) return;
      cancelScheduledStreamingUpdate();
      ctx.setSessionSurfacePending(false);
      const readySessionKey = event.state?.sessionFile || event.state?.sessionId || "boot";
      ctx.activateComposerDraft(readySessionKey);
      ctx.activateRightPanelSnapshot(readySessionKey);
      ctx.setStore({ state: event.state, messages: event.messages || [] });
      // Hydrate turn-diff history for file-change cards (clear previous session first).
      {
        const next: Record<string, TurnReviewView> = {};
        const list = Array.isArray(event.turnDiffs) ? event.turnDiffs : [];
        for (const td of list) {
          const key = String(td.turnId || "");
          if (!key) continue;
          const entry = {
            turnId: Number(td.turnId) || undefined,
            diff: td.diff || "",
            files: Array.isArray(td.files) ? td.files : [],
            totalAdded: Number(td.totalAdded) || 0,
            totalRemoved: Number(td.totalRemoved) || 0,
          };
          next[key] = entry;
          if (td.lifecycleTurnId) next[String(td.lifecycleTurnId)] = entry;
        }
        if (list.length) {
          const last = list[list.length - 1];
          next.latest = {
            turnId: Number(last.turnId) || undefined,
            diff: last.diff || "",
            files: Array.isArray(last.files) ? last.files : [],
            totalAdded: Number(last.totalAdded) || 0,
            totalRemoved: Number(last.totalRemoved) || 0,
          };
        }
        ctx.setTurnDiffs(next);
      }
      // plan-created is a compact client timeline projection of the persisted plan
      // artifact, not a session message. Recreate it whenever history is restored so
      // switching away and back cannot make an approved plan disappear.
      ctx.ensureCreatedPlanActivity(event.state?.plan, { open: false });
      ctx.lastPlanPhaseRef.current = event.state?.plan?.phase || "idle";
      ctx.previousGoalStatusRef.current = event.state?.goal?.status;
      ctx.currentTurnRef.current = countConversationTurns(event.messages || []);
      ctx.agentTurnActiveRef.current = Boolean(event.state?.isStreaming);
      ctx.agentLifecycleActiveRef.current = Boolean(event.state?.isStreaming);
      if (ctx.agentTurnActiveRef.current && ctx.currentTurnRef.current <= 0) ctx.currentTurnRef.current = 1;
      ctx.lastAssistantToolCallSignatureRef.current = "";
      // Resume mid-stream when returning to a background chat that is still generating.
      if (event.streamingMessage && event.state?.isStreaming) {
        ctx.setStreamingStoreMessage({ ...event.streamingMessage, turnId: ctx.currentTurnRef.current || 1 });
      } else {
        ctx.setStreamingStoreMessage(undefined);
        // Explicit idle — never keep previous chat's isStreaming lock after switch/new.
        if (!event.state?.isStreaming) {
          ctx.patchSessionState({ isStreaming: false });
          ctx.settleActiveToolsAfterIdle();
        }
      }
      // Server steering queues are session-scoped; drop local follow-up queue on focus change.
      ctx.setQueuedMessages({ steering: [], followUp: [] });
      if (!event.state?.isStreaming) ctx.setUserMessageQueue([]);
      void ctx.refreshSessions();
      void ctx.refreshModels();
      void ctx.refreshCommands();
      void ctx.refreshFiles(ctx.currentFileDirRef.current);
      void ctx.refreshWorkspaceChanges();
      return;
    }
    if (ctx.sessionTransitionPendingRef.current) return;
    if (event.type === "state") {
      if (ctx.abortedTurnSuppressedRef.current && event.state?.isStreaming) {
        event = { ...event, state: { ...event.state, isStreaming: false, pendingMessageCount: 0, activeTools: [] } };
      }
      const nextGoalStatus = event.state?.goal?.status as string | undefined;
      const previousGoalStatus = ctx.previousGoalStatusRef.current;
      ctx.previousGoalStatusRef.current = nextGoalStatus;
      if (ctx.goalUiSettings.completionNotification && previousGoalStatus && previousGoalStatus !== nextGoalStatus) {
        if (nextGoalStatus === "completed") notifyTaskComplete(`Goal tamamlandı: ${event.state.goal.objective}`);
        if (nextGoalStatus === "blocked" || nextGoalStatus === "failed") notifyError(`Goal durdu: ${event.state.goal.objective}`);
      }
      const previousPlanPhase = ctx.lastPlanPhaseRef.current;
      const nextPlanPhase = event.state?.plan?.phase || "idle";
      ctx.setStore({ state: event.state });
      ctx.lastPlanPhaseRef.current = nextPlanPhase;
      // The runtime's live ready transition is authoritative. Guarantee the compact
      // Created Plan activity even if an extension-injected custom message is missed
      // or arrives out of order. Initial/history `ready` payloads use the `ready`
      // event above and intentionally do not enter this path.
      if (previousPlanPhase !== "ready" && nextPlanPhase === "ready" && event.state?.plan?.artifact) {
        ctx.ensureCreatedPlanActivity(event.state.plan);
      }
      if (!event.state?.isStreaming) {
        const needsStateReconcile = ctx.hasDanglingAgentUiState();
        ctx.clearLocalStreamingState();
        if (needsStateReconcile) void ctx.refreshSessionState({ quiet: true, settleIfIdle: true });
        else ctx.settleActiveToolsAfterIdle();
      }
    }
    if (event.type === "agent_event") handleAgentEvent(event.event);
    if (event.type?.startsWith("terminal_")) handleTerminalEvent(event);
    if (event.type === "mcp_status") {
      const servers = Array.isArray(event.servers) ? event.servers : [];
      const connected = servers.filter((server: any) => server.status === "connected").length;
      ctx.setStatus("mcp", connected ? `${connected} MCP bağlı` : undefined);
    }
    if (event.type === "extension_ui_request") ctx.handleExtensionRequest(event);
    if (event.type === "browser_activity" && !ctx.abortedTurnSuppressedRef.current) {
      // Ajan browser_* tool çalıştırdı → canlı paneli öne al
      ctx.openRightPanel("browser");
      if (event.url) console.log("[browser-activity]", event.tool, event.url);
    }
    if (event.type === "provider_rotation") {
      const from = event.fromLabel || "önceki hesap";
      const to = event.toLabel || "yedek hesap";
      useAppStore.getState().showStatusNotice({
        kind: "provider_connected",
        title: String(event.providerId || "Provider"),
        subtitle: `Kota / limit → ${from} → ${to} (otomatik rotasyon)`,
        logoUrl: event.providerId ? `/providers/${event.providerId}.svg` : undefined,
        providerId: event.providerId,
        durationMs: 6500,
      });
    }
    if (event.type === "error") {
      ctx.showToast(event.message, "error");
      notifyError(event.message);
    }
    if (event.type === "approval_request") {
      ctx.setApprovalPrompt({
        id: event.id,
        tool: event.tool,
        summary: event.summary,
        command: event.command,
        reason: event.reason,
        risk: event.risk || "medium",
        presetLabel: event.presetLabel,
        fileChange: event.fileChange,
        proposedExecpolicyAmendment: event.proposedExecpolicyAmendment,
        networkApprovalContext: event.networkApprovalContext,
        proposedNetworkPolicyAmendments: event.proposedNetworkPolicyAmendments,
        kind: event.kind,
        mcp: event.mcp,
      });
    }
    if (event.type === "mcp_elicitation_request") {
      ctx.setMcpElicitation({
        id: event.id,
        serverId: event.serverId,
        serverName: event.serverName,
        mode: event.mode || "form",
        message: event.message,
        fields: Array.isArray(event.fields) ? event.fields : [],
        url: event.url,
        elicitationId: event.elicitationId,
      });
    }
    if (event.type === "turn_diff_updated") {
      const convKey = event.conversationTurn != null ? String(event.conversationTurn) : "";
      const entry = {
        turnId: Number(event.conversationTurn) || undefined,
        diff: event.diff || "",
        files: Array.isArray(event.files) ? event.files : [],
        totalAdded: Number(event.totalAdded) || 0,
        totalRemoved: Number(event.totalRemoved) || 0,
      };
      ctx.setTurnDiffs((prev) => {
        const next: typeof prev = { ...prev, latest: entry };
        if (convKey) next[convKey] = entry;
        // Also keep lifecycle id for live maps that still use it
        if (event.turnId) next[String(event.turnId)] = entry;
        return next;
      });
    }
    // Codex EventMsg::TurnAborted
    if (event.type === "turn_aborted" && event.reason !== "replaced") {
      ctx.abortedTurnSuppressedRef.current = true;
      ctx.turnCompleteNotifiedRef.current = true;
      ctx.preserveStreamingMessageAfterAbort(Number(event.durationMs));
      ctx.clearLocalStreamingState();
      ctx.settleActiveToolsAfterIdle();
      ctx.setQueuedMessages({ steering: [], followUp: [] });
      if (event.reason === "interrupted") {
        // Client-side stop usually already toasted; ignore duplicate noise if same tick.
      }
    }
    if (event.type === "turn_steer_accepted") {
      // Same-turn steer accepted — agent continues current turn with new pending input.
      ctx.setQueuedMessages((prev) => ({
        steering: event.messagePreview
          ? [...prev.steering, String(event.messagePreview)]
          : prev.steering,
        followUp: prev.followUp,
      }));
    }
  }

  function handleAgentEvent(event: any) {
    ctx.lastAgentEventAtRef.current = Date.now();
    if (ctx.abortedTurnSuppressedRef.current) {
      const abortedTurnEvent = event?.type === "agent_start"
        || event?.type === "agent_end"
        || event?.type === "tool_execution_start"
        || event?.type === "tool_execution_update"
        || event?.type === "tool_execution_end"
        || ((event?.type === "message_start" || event?.type === "message_update" || event?.type === "message_end")
          && event.message?.role === "assistant");
      if (abortedTurnEvent) {
        // agent_end is still useful as an idle confirmation, but never as a reason
        // to notify completion or flush queued prompts after a user stop.
        if (event?.type === "agent_end") {
          ctx.clearLocalStreamingState();
          ctx.settleActiveToolsAfterIdle();
        }
        return;
      }
    }
    if (event?.type === "queue_update") {
      ctx.setQueuedMessages({
        steering: normalizeQueuedTexts(event.steering),
        followUp: normalizeQueuedTexts(event.followUp),
      });
    }
    if (event?.type === "compaction_start") {
      ctx.patchSessionState({ isCompacting: true });
    }
    if (event?.type === "compaction_end") {
      ctx.patchSessionState({ isCompacting: false });
      if (event.errorMessage) {
        ctx.showToast(String(event.errorMessage), "error");
      } else if (event.aborted) {
        ctx.showToast("Bağlam sıkıştırma iptal edildi.", "info");
      } else if (event.result) {
        void Promise.resolve(ctx.refreshSessionState({ quiet: true, settleIfIdle: false })).catch(() => undefined);
      }
    }
    if (event?.type === "agent_start") {
      ensureAgentTurn();
      ctx.agentLifecycleActiveRef.current = true;
      ctx.turnCompleteNotifiedRef.current = false;
      if (ctx.turnCompleteNotifyTimerRef.current !== undefined) {
        window.clearTimeout(ctx.turnCompleteNotifyTimerRef.current);
        ctx.turnCompleteNotifyTimerRef.current = undefined;
      }
      ctx.patchSessionState({ isStreaming: true });
    }
    if (event?.type === "message_start" && event.message?.role === "assistant") {
      cancelScheduledStreamingUpdate();
      const turnId = ensureAgentTurn();
      ctx.lastAssistantToolCallSignatureRef.current = "";
      ctx.turnCompleteNotifiedRef.current = false;
      if (ctx.turnCompleteNotifyTimerRef.current !== undefined) {
        window.clearTimeout(ctx.turnCompleteNotifyTimerRef.current);
        ctx.turnCompleteNotifyTimerRef.current = undefined;
      }
      ctx.patchSessionState({ isStreaming: true });
      ctx.setStreamingStoreMessage({ ...event.message, turnId });
      syncAssistantToolCalls(event.message, "streaming");
    }
    if (event?.type === "message_update" && event.message?.role === "assistant") {
      ensureAgentTurn();
      scheduleStreamingMessageUpdate(event.message, "streaming");
    }
    if (event?.type === "message_end") {
      cancelScheduledStreamingUpdate();
      if (event.message?.role === "assistant") {
        ctx.lastAssistantToolCallSignatureRef.current = "";
        ctx.setStreamingStoreMessage(undefined);
        // agent_end is authoritative. A single agent run emits many message_end
        // events between tools; only legacy streams without lifecycle events use
        // the short idle fallback below.
        syncAssistantToolCalls(event.message, "running");
        if (ctx.turnCompleteNotifyTimerRef.current !== undefined) {
          window.clearTimeout(ctx.turnCompleteNotifyTimerRef.current);
        }
        if (!ctx.agentLifecycleActiveRef.current) ctx.turnCompleteNotifyTimerRef.current = window.setTimeout(() => {
          ctx.turnCompleteNotifyTimerRef.current = undefined;
          const snap = useAppStore.getState();
          // Still generating or tools running → not a finished turn.
          if (snap.streamingMessage) return;
          if (hasActiveToolState(snap.tools)) return;
          if (ctx.turnCompleteNotifiedRef.current) return;
          ctx.turnCompleteNotifiedRef.current = true;
          ctx.agentTurnActiveRef.current = false;
          ctx.patchSessionState({ isStreaming: false });
          ctx.settleActiveToolsAfterIdle();
          // Don't celebrate aborts as "complete".
          if (event.message?.stopReason !== "aborted") {
            notifyTaskComplete("Yanıt tamamlandı");
          }
          ctx.setUserMessageQueue((prev) => {
            if (prev.length === 0) return prev;
            const next = prev[0];
            const remaining = prev.slice(1);
            setTimeout(() => {
              ctx.sendQueuedUserMessage(next).catch(() => {});
            }, 300);
            return remaining;
          });
        }, 1200);
      }
      // Tag server-side aborted assistants so the timeline can show "Durduruldu".
      const isAbortedAssistant =
        event.message?.role === "assistant"
        && (event.message?.stopReason === "aborted" || event.message?.__aborted);
      const settledMessage = event.message?.role === "assistant" || event.message?.role === "user"
        ? {
            ...event.message,
            turnId: ctx.currentTurnRef.current || 1,
            ...(isAbortedAssistant ? { __aborted: true, stopReason: "aborted" as const } : {}),
          }
        : event.message;
      const duplicateCreatedPlan = settledMessage?.customType === "plan-created"
        && ctx.hasCreatedPlanActivity(String(settledMessage.details?.planId || ""));
      if (!duplicateCreatedPlan) ctx.addStoreMessage(settledMessage);
      // Auto-open the Plan artifact at the exact moment its compact Created Plan
      // timeline event lands. Planning mode, research streams, draft artifacts,
      // execution, and restored history must never open the panel implicitly.
      if (settledMessage?.customType === "plan-created") {
        ctx.openCreatedPlanActivity(String(settledMessage.details?.planId || settledMessage.id || `${ctx.sessionFile || ctx.sessionId || "active"}:${settledMessage.timestamp || Date.now()}`));
      }
      // Session file is written on user/assistant message_end — keep sidebar in sync.
      if (event.message?.role === "user" || event.message?.role === "assistant") {
        if (event.message?.role === "user") {
          const text = textFromMessage(event.message);
          if (text) ctx.upsertActiveSessionInSidebar(text);
        }
        ctx.scheduleRefreshSessions(event.message?.role === "user" ? 200 : 350);
      }
    }
    // Prefer agent_end when the runtime emits it (definitive end of tool loop).
    if (event?.type === "agent_end") {
      cancelScheduledStreamingUpdate();
      if (ctx.turnCompleteNotifyTimerRef.current !== undefined) {
        window.clearTimeout(ctx.turnCompleteNotifyTimerRef.current);
        ctx.turnCompleteNotifyTimerRef.current = undefined;
      }
      ctx.lastAssistantToolCallSignatureRef.current = "";
      ctx.agentTurnActiveRef.current = false;
      ctx.agentLifecycleActiveRef.current = false;
      ctx.setStreamingStoreMessage(undefined);
      ctx.patchSessionState({ isStreaming: false });
      ctx.settleActiveToolsAfterIdle();
      if (!ctx.turnCompleteNotifiedRef.current) {
        ctx.turnCompleteNotifiedRef.current = true;
        notifyTaskComplete("Yanıt tamamlandı");
      }
      ctx.setUserMessageQueue((prev) => {
        if (prev.length === 0) return prev;
        const next = prev[0];
        const remaining = prev.slice(1);
        setTimeout(() => {
          ctx.sendQueuedUserMessage(next).catch(() => {});
        }, 300);
        return remaining;
      });
    }
    // New tool activity means the turn is not done — cancel pending completion toast.
    if (event?.type === "tool_execution_start") {
      if (ctx.turnCompleteNotifyTimerRef.current !== undefined) {
        window.clearTimeout(ctx.turnCompleteNotifyTimerRef.current);
        ctx.turnCompleteNotifyTimerRef.current = undefined;
      }
      ctx.turnCompleteNotifiedRef.current = false;
      ctx.patchSessionState({ isStreaming: true });
      if (isPlanProtocolToolName(event.toolName)) return;
      const turnId = ensureAgentTurn();
      ctx.upsertTool(event.toolCallId, {
        toolName: event.toolName,
        args: event.args,
        status: "running",
        turnId,
        startedAt: Date.now(),
      });
    }
    if (event?.type === "tool_execution_update" && !isPlanProtocolToolName(event.toolName)) {
      const turnId = ensureAgentTurn();
      scheduleToolUpdate(event.toolCallId, { toolName: event.toolName, args: event.args, status: "streaming", turnId, output: textFromToolResult(event.partialResult), details: event.partialResult?.details });
    }
    if (event?.type === "tool_execution_end") {
      if (isPlanProtocolToolName(event.toolName)) return;
      // Bekleyen (rAF) streaming patch'i düşür ki final sonucun üstüne yazmasın.
      ctx.pendingToolUpdatesRef.current.delete(event.toolCallId);
      const resultImages = Array.isArray(event.result?.content) ? event.result.content.filter((p: any) => p.type === "image").map((p: any) => ({ data: p.data, mimeType: p.mimeType || "image/png" })) : [];
      const turnId = ensureAgentTurn();
      ctx.upsertTool(event.toolCallId, { toolName: event.toolName, status: event.isError ? "error" : "done", turnId, endedAt: Date.now(), output: textFromToolResult(event.result), images: resultImages.length > 0 ? resultImages : undefined, details: event.result?.details });
      if (/(edit|write|apply_patch|patch|delete|remove|rm)/i.test(String(event.toolName))) window.setTimeout(() => void ctx.refreshWorkspaceChanges(), 180);
    }
  }

  function handleTerminalEvent(event: any) {
    if (event.type === "terminal_start") {
      ctx.terminalRuns.set(event.id, { command: event.command, output: "" });
      ctx.setTerminalTabs((tabs) => ensureTerminalTab(tabs, event.id, event.command).map((tab) => tab.id === event.id ? { ...tab, command: event.command, output: terminalTranscript(event.command, "Çalışıyor…"), status: "running" } : tab));
    }
    const run = terminalRunForEvent(event);
    if (event.type === "terminal_output" && run) {
      const chunk = event.stream === "stderr" ? `\n[stderr]\n${String(event.text || "")}` : String(event.text || "");
      run.output = appendTerminalOutput(run.output, chunk);
      const output = formatTerminalRunOutput(run.command, "Çalışıyor…", run.output);
      ctx.setTerminalTabs((tabs) => tabs.map((tab) => tab.id === event.id ? { ...tab, output, status: "running" } : tab));
    }
    if (event.type === "terminal_end" && run) {
      const status = event.timedOut ? "zaman aşımı" : `exit ${event.exitCode}`;
      const output = formatTerminalRunOutput(run.command, `${status} · ${event.durationMs}ms`, run.output);
      ctx.setTerminalTabs((tabs) => tabs.map((tab) => tab.id === event.id ? { ...tab, output, status: event.exitCode === 0 ? "done" : "error", exitCode: event.exitCode, durationMs: event.durationMs } : tab));
      ctx.terminalRuns.delete(event.id);
    }
  }

  return {
    handleServerMessage,
    handleServerEvent,
    handleAgentEvent,
    handleTerminalEvent,
    warnEventStreamOnce,
    ensureAgentTurn,
    cancelScheduledStreamingUpdate,
  };
}
