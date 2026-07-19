import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import type { WebContextUsage } from "../../../shared/protocol";
import { apiGet, apiPost, eventsUrl } from "../lib/api";
import { textFromMessage } from "../lib/render";
import { readStorageValue, writeStorageJson, writeStorageValue } from "../lib/storage";
import { useAppStore, type ToastState, type ToolCardState } from "../state/app-store";
import { loadNotificationConfig } from "../lib/notifications";
import { useConfirm } from "../components/common/ConfirmDialog";
import type { MenuAction } from "../components/chrome/Titlebar";
import { desktop } from "../lib/desktop";
import { clampLeftSidebarWidth, LEFT_SIDEBAR_DEFAULT_WIDTH } from "../lib/layout-sizing";
import { loadGoalUiSettings } from "../components/settings/SettingsPanels";
import type { ModalRequest, FileTab, MonacoModal, MainView, ComposerImage, TurnReviewView, QueuedMessages, QueuedUserMessage } from "../types";
import {
  extensionNotifyType,
  toPromptImages,
} from "../lib/client-ids";
import { composerFallbackMessage, hasComposerPayload } from "../lib/composer-files";
import {
  countConversationTurns,
  hasAbortedAssistantMessageForTurn,
} from "../components/timeline/timeline-logic";

import { EMPTY_STREAMING_SESSIONS } from './lazyPanels';
import { AppShell } from './AppShell';
import { isComposerPlanShortcut } from './plan-shortcut';
import { createServerEventHandlers, type ServerEventHandlerContext, type ServerEventHandlers } from './sse/createServerEventHandlers';
import { useRightDock } from './hooks/useRightDock';
import {
  useSessionWorkspace,
  useComposerDraft,
  useComposerQueue,
  useComposerModels,
  useAppSettings,
  useConversationMetadata,
  useConversationNavigation,
  useFileWorkspace,
  useTerminalWorkspace,
  useTrustOnboarding,
  useAppKeyboard,
} from './hooks';

const EMPTY_WORKSPACE_ROOTS: string[] = [];

export function App() {
  const { confirm, ConfirmPortal } = useConfirm();
  const {
    visibleMessageCount,
    sessions,
    models,
    configCwd,
    workspaceRoots,
    stateCwd,
    sessionId,
    sessionFile,
    sessionModel,
    sessionThinkingLevel,
    sessionContextUsage,
    isSessionStreaming,
    isSessionCompacting,
    streamingSessionPaths,
    sessionPlan,
    sessionConversationMode,
    sessionGoal,
    terminalPolicyMode,
    defaultProvider,
    defaultModel,
    defaultThinkingLevel,
    setStore,
    addStoreMessage,
    upsertTool,
    setWidget,
    setSidebar,
    setStatus,
    setStreamingStoreMessage,
    resetSessionSurface,
    showToast,
  } = useAppStore(useShallow((state) => ({
    visibleMessageCount: state.visibleMessageCount,
    sessions: state.sessions,
    models: state.models,
    configCwd: state.config?.cwd || "",
    workspaceRoots: (Array.isArray(state.config?.workspaceRoots)
      ? state.config.workspaceRoots
      : EMPTY_WORKSPACE_ROOTS) as string[],
    stateCwd: state.state?.cwd || "",
    sessionId: state.state?.sessionId,
    sessionFile: state.state?.sessionFile as string | undefined,
    sessionModel: state.state?.model,
    sessionThinkingLevel: state.state?.thinkingLevel,
    sessionContextUsage: state.state?.contextUsage as WebContextUsage | undefined,
    isSessionStreaming: Boolean(state.state?.isStreaming),
    isSessionCompacting: Boolean(state.state?.isCompacting),
    // Must be a stable reference when empty — `[]` each call infinite-loops useSyncExternalStore.
    streamingSessionPaths: (Array.isArray(state.state?.streamingSessions)
      ? state.state.streamingSessions
      : EMPTY_STREAMING_SESSIONS) as string[],
    sessionPlan: state.state?.plan,
    sessionConversationMode: state.state?.conversationMode,
    sessionGoal: state.state?.goal,
    terminalPolicyMode: (state.config?.terminalPolicyMode as "safe" | "allow-all" | "disabled" | undefined) || "safe",
    defaultProvider: state.runtimeSettings?.defaultProvider,
    defaultModel: state.runtimeSettings?.defaultModel,
    defaultThinkingLevel: state.runtimeSettings?.defaultThinkingLevel,
    setStore: state.set,
    addStoreMessage: state.addMessage,
    upsertTool: state.upsertTool,
    setWidget: state.setWidget,
    setSidebar: state.setSidebar,
    setStatus: state.setStatus,
    setStreamingStoreMessage: state.setStreamingMessage,
    resetSessionSurface: state.resetSessionSurface,
    showToast: state.showToast,
  })));
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const forkingEntryIdRef = useRef<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [approvalPrompt, setApprovalPrompt] = useState<{
    id: string;
    tool: string;
    summary: string;
    command?: string;
    reason?: string;
    risk: "low" | "medium" | "high";
    presetLabel?: string;
    fileChange?: {
      files: Array<{ path: string; kind: string; added: number; removed: number }>;
      patchPreview?: string;
    };
    proposedExecpolicyAmendment?: { command: string[] };
    networkApprovalContext?: { host: string; protocol: "http" | "https" | "socks5_tcp" | "socks5_udp" };
    proposedNetworkPolicyAmendments?: Array<{
      host: string;
      action: "allow" | "deny";
      protocol?: "http" | "https" | "socks5_tcp" | "socks5_udp";
    }>;
    kind?: "exec" | "file_change" | "network" | "mcp_tool" | "generic";
    mcp?: { serverId: string; serverName?: string; toolName: string };
  } | null>(null);
  const [mcpElicitation, setMcpElicitation] = useState<{
    id: string;
    serverId: string;
    serverName: string;
    mode: string;
    message: string;
    fields: Array<{
      name: string;
      type: string;
      title?: string;
      description?: string;
      required?: boolean;
      enum?: string[];
      enumNames?: string[];
      default?: string | number | boolean | string[];
      format?: string;
      secret?: boolean;
    }>;
    url?: string;
    elicitationId?: string;
  } | null>(null);
  const [turnDiffs, setTurnDiffs] = useState<Record<string, TurnReviewView>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Codex nav-rail: merkez tam-sayfa gorunumu (sohbet/zamanlananlar/eklentiler).
  const [centerView, setCenterView] = useState<"chat" | "projects" | "scheduled" | "extensions" | "history">("chat");
  // Codex "Arama" -> komut paleti (eski SearchOverlay yerine nav-rail Arama dugmesi).
  const [searchPaletteOpen, setSearchPaletteOpen] = useState(false);
  const {
    prompt,
    composerImages,
    sentImagePreviews,
    contextChips,
    promptHistory,
    promptHistoryIndex,
    promptRef,
    promptValueRef,
    composerImagesRef,
    contextChipsRef,
    composerDraftVersionRef,
    composerDraftsBySessionRef,
    activeComposerDraftKeyRef,
    setPrompt,
    setComposerImages,
    setSentImagePreviews,
    setContextChips,
    setPromptHistory,
    setPromptHistoryIndex,
    setPromptDraft,
    setComposerImagesDraft,
    setContextChipsDraft,
    addContextChip,
    removeContextChip,
    addComposerFiles,
    handleComposerPaste,
    removeComposerImage,
  } = useComposerDraft({
    initialSessionKey: sessionFile || sessionId || "boot",
    showToast,
  });
  const [previewImage, setPreviewImage] = useState<ComposerImage | undefined>();
  /** UI preference; server state.plan.enabled is source of truth once synced */
  const [planModePref, setPlanModePref] = useState(false);
  const [sessionSurfacePending, setSessionSurfacePending] = useState(false);
  /** Synchronous guard: React state commits too late to block stale SSE during a session switch. */
  const sessionTransitionPendingRef = useRef(false);
  const expectedSessionKeyRef = useRef("");
  const departingSessionKeysRef = useRef(new Set<string>());
  const [goalModePref, setGoalModePref] = useState(false);
  const [goalUiSettings, setGoalUiSettings] = useState(() => loadGoalUiSettings());
  const planEnabled = Boolean(sessionPlan?.enabled || sessionConversationMode === "plan" || planModePref);
  const openedCreatedPlanRef = useRef<string>("");
  const lastPlanPhaseRef = useRef<string>(sessionPlan?.phase || "idle");
  const [dismissedPlanApprovalKey, setDismissedPlanApprovalKey] = useState("");
  const [planApplyPending, setPlanApplyPending] = useState(false);

  // Keep local pref aligned with server plan state when SSE arrives
  useEffect(() => {
    if (typeof sessionPlan?.enabled === "boolean") {
      setPlanModePref(Boolean(sessionPlan.enabled));
    } else if (sessionConversationMode === "plan" || sessionConversationMode === "execute") {
      setPlanModePref(sessionConversationMode === "plan");
    }
  }, [sessionPlan?.enabled, sessionConversationMode]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isComposerPlanShortcut(event, promptRef.current)) return;
      event.preventDefault();
      // Shift+Tab is a composer-only shortcut; elsewhere it remains native reverse focus navigation.
      if (planEnabled) {
        setGoalModePref(false);
        void switchComposerMode("execute");
      } else {
        void openIsolatedMode("plan");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [planEnabled]);
  const [isPromptPending, setIsPromptPending] = useState(false);
  const [timelineScrollRequest, setTimelineScrollRequest] = useState(0);
  const [timelineFilter, setTimelineFilter] = useState<"all" | "messages" | "tools" | "errors">("messages");
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [noProject, setNoProject] = useState(() => readStorageValue("quake-web:noProject", "0") === "1");
  const [loading, setLoading] = useState<Record<string, boolean>>({ config: true, sessions: true, models: true, files: true });
  /** Boot splash until core config+sessions land (QuakeCode LoadingSplash parity). */
  const [bootSplash, setBootSplash] = useState(true);
  const [bootSplashFading, setBootSplashFading] = useState(false);
  const { trustOnboardingOpen, dismissTrustOnboarding } = useTrustOnboarding(bootSplash);
  const [selectedToolId, setSelectedToolId] = useState<string | undefined>();
  const [openTabs, setOpenTabs] = useState<FileTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | undefined>();
  const [filePreview, setFilePreview] = useState<{ path?: string; content: string }>({ content: "Dosya seçilmedi" });
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessages>({ steering: [], followUp: [] });
  const [userMessageQueue, setUserMessageQueue] = useState<QueuedUserMessage[]>([]);
  const [currentFileDir, setCurrentFileDir] = useState(readStorageValue("quake-web:fileDir", "."));
  const [extensionModal, setExtensionModal] = useState<ModalRequest | undefined>();
  const [monacoModal, setMonacoModal] = useState<MonacoModal | undefined>();
  const [mainView, setMainView] = useState<MainView>({ mode: "chat" });
  const [leftOpen, setLeftOpen] = useState(() => readStorageValue("quake-web:leftOpen", "1") !== "0");
  const [leftWidth, setLeftWidth] = useState(() => {
    const stored = Number(readStorageValue("quake-web:leftWidth"));
    return clampLeftSidebarWidth(stored || LEFT_SIDEBAR_DEFAULT_WIDTH);
  });
  const persistLeftWidth = useCallback((width: number) => {
    const next = clampLeftSidebarWidth(width);
    setLeftWidth(next);
    writeStorageValue("quake-web:leftWidth", String(next));
  }, []);
  const [bottomOpen, setBottomOpen] = useState(false); // Alt panel (terminal) — Ctrl+J / Titlebar PanelBottom ile acilir.
  const [bottomHeight, setBottomHeight] = useState(() => Number(readStorageValue("quake-web:bottomHeight")) || 280);
  const { terminalRuns, terminalTabsRef, setTerminalTabs } = useTerminalWorkspace({
    showToast,
    openTerminalPanel,
  });
  const currentTurnRef = useRef(0);
  /** One active id spans the complete agent_start → agent_end tool loop. */
  const agentTurnActiveRef = useRef(false);
  /** Prevent message_end gaps inside the loop from being mistaken for completion. */
  const agentLifecycleActiveRef = useRef(false);
  const browserFocusMainRef = useRef<HTMLElement | null>(null);
  const [browserFocusBottomInset, setBrowserFocusBottomInset] = useState(72);
  const pendingStreamingUpdateRef = useRef<{ message: any; sourceMessage: any; status: string } | undefined>(undefined);
  const streamingUpdateFrameRef = useRef<number | undefined>(undefined);
  const pendingToolUpdatesRef = useRef<Map<string, Partial<ToolCardState>>>(new Map());
  const toolUpdateFrameRef = useRef<number | undefined>(undefined);
  const eventStreamWarningShownRef = useRef(false);
  const lastAssistantToolCallSignatureRef = useRef("");
  const previousGoalStatusRef = useRef<string | undefined>(undefined);
  /** Sync lock — React state is too late to stop double Enter / double click sends. */
  const promptSubmitLockRef = useRef(false);
  /** Stop is immediate: quarantine late events from the aborted turn until the next prompt. */
  const abortedTurnSuppressedRef = useRef(false);
  const currentFileDirRef = useRef(currentFileDir);
  const lastAgentEventAtRef = useRef(Date.now());
  /** Debounce mid-loop assistant message_end → only one "yanıt hazır" per turn. */
  const turnCompleteNotifyTimerRef = useRef<number | undefined>(undefined);
  const turnCompleteNotifiedRef = useRef(false);
  const stateRefreshSeqRef = useRef(0);
  const stateRefreshPromiseRef = useRef<Promise<any> | undefined>(undefined);
  const configRefreshSeqRef = useRef(0);
  const sessionsRefreshSeqRef = useRef(0);
  const sessionsRefreshTimerRef = useRef<number | undefined>(undefined);
  const modelsRefreshSeqRef = useRef(0);
  const commandsRefreshSeqRef = useRef(0);
  const fileRefreshSeqRef = useRef(0);
  const filePreviewSeqRef = useRef(0);

  const {
    rightTab,
    dockTabs,
    turnReview,
    dockAddOpen,
    rightOpen,
    rightWidth,
    rightPanelExpanded,
    browserLayout,
    browserFocusComposer,
    filesLayout,
    setRightTab,
    setDockAddOpen,
    setRightOpen,
    setBrowserFocusComposer,
    activeRightPanelKeyRef,
    setRightPanelOpen,
    setRightPanelTab,
    openRightPanel,
    closeDockTab,
    closeRightPanel,
    toggleRightPanelExpanded,
    applyFilesLayout,
    applyBrowserLayout,
    setBrowserFocusComposerMode,
    saveActiveRightPanelSnapshot,
    activateRightPanelSnapshot,
    openTurnReview,
    handleOpenPanel,
    handleRightDragStart,
    handleRightResizeKey,
  } = useRightDock({
    leftOpen,
    leftWidth,
    setBottomOpen,
    promptRef,
    onInvalidatePendingPreview: () => {
      filePreviewSeqRef.current += 1;
    },
    getFileSnapshot: () => ({
      fileDir: currentFileDirRef.current,
      filePreview,
    }),
    applyFileSnapshot: (snapshot) => {
      setCurrentFileDir(snapshot.fileDir || ".");
      currentFileDirRef.current = snapshot.fileDir || ".";
      setFilePreview(snapshot.filePreview || { content: "Dosya seçilmedi" });
    },
    initialSessionKey: sessionFile || sessionId || "boot",
    onOpenTerminal: () => setBottomOpen(true),
    onOpenComputer: () => {
      setCenterView("chat");
      setPromptDraft((current) => {
        const base = String(current || "").trim();
        if (/@bilgisayar\b/i.test(base)) return base;
        return base ? `@bilgisayar ${base}` : "@bilgisayar ";
      });
      requestAnimationFrame(() => promptRef.current?.focus());
      showToast("@bilgisayar — görevini yazıp gönder (ekranda imleç + kenar ışığı)", "info");
    },
  });
  const monacoOpenSeqRef = useRef(0);
  const workspaceOpenSeqRef = useRef(0);
  const sessionSwitchSeqRef = useRef(0);
  const serverEventCtxRef = useRef<ServerEventHandlerContext>({} as ServerEventHandlerContext);
  const serverEventHandlersRef = useRef<ServerEventHandlers | null>(null);
  const hasVisibleMessages = visibleMessageCount > 0 || isSessionStreaming;
  const currentWorkspace = stateCwd || configCwd || "";
  const unattendedGoalActive = Boolean(sessionGoal && ["planning", "executing", "verifying", "blocked"].includes(sessionGoal.status));

  useEffect(() => {
    const onSettingsChange = (event: Event) => setGoalUiSettings((event as CustomEvent).detail || loadGoalUiSettings());
    window.addEventListener("quake:goal-settings-change", onSettingsChange);
    return () => window.removeEventListener("quake:goal-settings-change", onSettingsChange);
  }, []);

  useEffect(() => {
    desktop?.setGoalUnattendedActive?.(unattendedGoalActive && goalUiSettings.preventSleep);
    return () => desktop?.setGoalUnattendedActive?.(false);
  }, [unattendedGoalActive, goalUiSettings.preventSleep]);
  const workspaceName = noProject
    ? "No Project"
    : (currentWorkspace.split(/[\\/]/).filter(Boolean).pop() || "Çalışma alanı");
  const {
    pinnedPaths,
    archivedPaths,
    sessionAliases,
    hiddenWorkspaces,
    recentWorkspacesTick,
    setRecentWorkspacesTick,
    togglePinSession,
    renameNavSession,
    archiveSession,
    removeWorkspaceFromNav,
    unhideWorkspace,
    hydrateConversationMetadata,
  } = useConversationMetadata({ showToast });

  // sendCommand / startNewSession / clearLocalStreamingState / settleActiveToolsAfterIdle /
  // refreshAll are function declarations (hoisted) and close over hook returns at call time.
  const {
    saveActiveComposerDraft,
    activateComposerDraft,
    resetSessionOwnedUi,
    acceptsSessionReady,
    switchSessionFromUi,
    forkSessionFromMessage,
    openWorkspaceFromModal,
    handleNewChatWithProjectMenu,
    handleSelectProject,
    handleQuickStart,
    handleNoProject,
    handleNewProject,
    handleAddFolder,
    handleOpenFolderNative,
    handleCreateProjectSkip,
  } = useSessionWorkspace({
    sendCommand,
    confirm,
    showToast,
    refreshAll,
    startNewSession,
    clearLocalStreamingState,
    settleActiveToolsAfterIdle,
    resetSessionSurface,
    saveActiveRightPanelSnapshot,
    activateRightPanelSnapshot,
    unhideWorkspace,
    currentWorkspace,
    noProject,
    sessionFile,
    sessions,
    sessionSwitchSeqRef,
    workspaceOpenSeqRef,
    sessionTransitionPendingRef,
    expectedSessionKeyRef,
    departingSessionKeysRef,
    stateRefreshSeqRef,
    stateRefreshPromiseRef,
    abortedTurnSuppressedRef,
    forkingEntryIdRef,
    currentTurnRef,
    agentTurnActiveRef,
    agentLifecycleActiveRef,
    openedCreatedPlanRef,
    lastPlanPhaseRef,
    filePreviewSeqRef,
    monacoOpenSeqRef,
    currentFileDirRef,
    activeComposerDraftKeyRef,
    composerDraftsBySessionRef,
    promptValueRef,
    composerImagesRef,
    contextChipsRef,
    composerDraftVersionRef,
    setPrompt,
    setComposerImages,
    setContextChips,
    setPromptHistoryIndex,
    setSessionSurfacePending,
    setPlanModePref,
    setGoalModePref,
    setDismissedPlanApprovalKey,
    setPlanApplyPending,
    setDockAddOpen,
    setExtensionModal,
    setSelectedToolId,
    setPreviewImage,
    setMonacoModal,
    setUserMessageQueue,
    setQueuedMessages,
    setSentImagePreviews,
    setForkingEntryId,
    setSessionModalOpen,
    setCreateProjectOpen,
    setProjectMenuOpen,
    setMainView,
    setCenterView,
    setNoProject,
    setCurrentFileDir,
    setFilePreview,
    setOpenTabs,
    setActiveTabPath,
    setRecentWorkspacesTick,
  });

  const openSessionFromNavigation = useCallback((path: string) => {
    setCenterView("chat");
    return switchSessionFromUi(path, true);
  }, [switchSessionFromUi]);
  const {
    unreadSessionPaths,
    markSessionRead,
    visibleSessions,
    projectSessions,
    navProjects,
    projectPickerItems,
    navPinned,
    paletteRecentSessions,
  } = useConversationNavigation({
    sessions: (sessions as any[]) || [],
    currentWorkspace,
    workspaceRoots,
    noProject,
    streamingSessionPaths,
    sessionFile,
    pinnedPaths,
    archivedPaths,
    sessionAliases,
    hiddenWorkspaces,
    recentWorkspacesTick,
    onOpenSession: openSessionFromNavigation,
  });

  useEffect(() => desktop?.onWorkspaceSelected?.((path) => {
    void openWorkspaceFromModal(path, { toast: "Çalışma alanı kökü açıldı", startSession: false }).catch((error: any) => {
      showToast(`Çalışma alanı açılamadı: ${error?.message || "bilinmeyen hata"}`, "error");
    });
  }), [openWorkspaceFromModal, showToast]);
  const {
    pinnedModels,
    visibleModels,
    currentModel,
    currentModelValue,
    currentModelLabel,
    currentThinking,
    selectModel,
    resetComposerPreferences,
    refreshModels,
  } = useComposerModels({
    models: models as any[],
    sessionModel,
    sessionThinkingLevel,
    defaultProvider,
    defaultModel,
    defaultThinkingLevel,
    stateCwd,
    modelsRefreshSeqRef,
    setLoading,
    setStore,
    sendCommand,
    runUiCommand,
    showToast,
  });
  const isComposerStreaming = isSessionStreaming;
  const readyPlanApprovalKey = sessionPlan?.enabled && sessionPlan.phase === "ready" && sessionPlan.artifact
    ? `${sessionPlan.artifact.id}:${sessionPlan.artifact.revision}`
    : "";
  const showPlanApproval = Boolean(
    readyPlanApprovalKey
      && readyPlanApprovalKey !== dismissedPlanApprovalKey
      && !isComposerStreaming,
  );
  const {
    density,
    theme,
    settingsModalOpen,
    settingsInitialView,
    terminalPolicyPending,
    settingsOpenRef,
    openSettingsPage,
    closeSettingsModal,
    updateDensity,
    updateTheme,
    toggleTheme,
    onSettingsThinking,
    onSettingsSetModel,
    onSettingsOpenWorkspace,
    onSettingsCompact,
    onSettingsClearPromptHistory,
    onSettingsSetDefaultModel,
    onSettingsSetDefaultThinking,
    onSettingsAutoCompaction,
    onSettingsTerminalPolicy,
    onSettingsBlockImages,
    onSettingsShowImages,
  } = useAppSettings({
    commandPaletteOpen,
    sendCommand,
    runUiCommand,
    selectModel,
    openWorkspace: handleOpenFolderNative,
    setPromptHistory,
    setStore,
    showToast,
  });
  const patchSessionState = useCallback((patch: Record<string, unknown>) => {
    const current = useAppStore.getState().state || {};
    setStore({ state: { ...current, ...patch } });
  }, [setStore]);

  function hasActiveToolState(tools: Record<string, ToolCardState>): boolean {
    return Object.values(tools).some((tool) => tool?.status === "queued" || tool?.status === "running" || tool?.status === "streaming");
  }

  function hasDanglingAgentUiState(): boolean {
    const snapshot = useAppStore.getState();
    return Boolean(snapshot.streamingMessage) || hasActiveToolState(snapshot.tools);
  }

  function cancelScheduledToolUpdates() {
    pendingToolUpdatesRef.current.clear();
    if (toolUpdateFrameRef.current !== undefined) {
      window.cancelAnimationFrame(toolUpdateFrameRef.current);
      toolUpdateFrameRef.current = undefined;
    }
  }

  function settleActiveToolsAfterIdle() {
    const now = Date.now();
    const tools = useAppStore.getState().tools;
    for (const [toolId, tool] of Object.entries(tools)) {
      if (!tool || !["queued", "running", "streaming"].includes(tool.status)) continue;
      const endedAt = tool.endedAt ?? now;
      upsertTool(toolId, {
        status: "done",
        endedAt,
        durationMs: tool.startedAt ? Math.max(0, endedAt - tool.startedAt) : tool.durationMs,
      });
    }
  }

  function preserveStreamingMessageAfterAbort(authoritativeDurationMs?: number) {
    // message_update patches are coalesced with rAF. The queued patch can therefore
    // be newer than the snapshot currently rendered in the store when Stop is clicked.
    const pendingMessage = pendingStreamingUpdateRef.current?.message;
    const storeSnapshot = useAppStore.getState();
    const renderedMessage = storeSnapshot.streamingMessage;
    const snapshot = pendingMessage || renderedMessage;
    const turnId = Number(snapshot?.turnId || currentTurnRef.current || 1);
    // Stop is archived optimistically, then confirmed by `turn_aborted`. Both paths
    // call this helper, so make the projection idempotent for the active turn.
    if (hasAbortedAssistantMessageForTurn(storeSnapshot.messages, turnId)) return;

    const abortedAt = Date.now();
    const body = snapshot ? textFromMessage(snapshot).trim() : "";
    // Preserve partial assistant text when present. An empty response is intentional:
    // Timeline renders the dedicated “Xs sonra durdurdunuz” row without Markdown.
    const content = body
      ? (typeof snapshot.content === "string"
          ? snapshot.content
          : Array.isArray(snapshot.content)
            ? snapshot.content
            : body)
      : "";

    let startedAt = 0;
    for (let index = storeSnapshot.messages.length - 1; index >= 0; index -= 1) {
      const message = storeSnapshot.messages[index];
      if (message?.role !== "user") continue;
      const messageTurnId = Number(message?.turnId || 0);
      if (messageTurnId > 0 && messageTurnId !== turnId) continue;
      const timestamp = Number(message?.timestamp);
      if (Number.isFinite(timestamp) && timestamp > 0) startedAt = timestamp;
      break;
    }
    if (!startedAt) {
      const snapshotTimestamp = Number(snapshot?.timestamp);
      if (Number.isFinite(snapshotTimestamp) && snapshotTimestamp > 0) startedAt = snapshotTimestamp;
    }
    const providedDuration = Number(authoritativeDurationMs);
    const abortedAfterMs = Number.isFinite(providedDuration) && providedDuration >= 0
      ? providedDuration
      : Math.max(0, abortedAt - (startedAt || abortedAt));

    addStoreMessage({
      ...(snapshot || { role: "assistant" }),
      role: "assistant",
      content,
      __streaming: undefined,
      __localOptimistic: undefined,
      __aborted: true,
      __abortedAfterMs: abortedAfterMs,
      __abortedAt: abortedAt,
      stopReason: snapshot?.stopReason === "error" ? "error" : "aborted",
      turnId,
      timestamp: abortedAt,
    });
  }

  function clearLocalStreamingState() {
    cancelScheduledStreamingUpdate();
    cancelScheduledToolUpdates();
    lastAssistantToolCallSignatureRef.current = "";
    agentTurnActiveRef.current = false;
    agentLifecycleActiveRef.current = false;
    setStreamingStoreMessage(undefined);
    patchSessionState({ isStreaming: false });
  }

  async function refreshSessionState(options?: { quiet?: boolean; settleIfIdle?: boolean }) {
    const quiet = options?.quiet === true;
    if (stateRefreshPromiseRef.current) {
      try {
        const result = await stateRefreshPromiseRef.current;
        if (!result?.state?.isStreaming && options?.settleIfIdle !== false) settleActiveToolsAfterIdle();
        return result;
      } catch (error) {
        if (!quiet) throw error;
        return undefined;
      }
    }
    const requestSeq = ++stateRefreshSeqRef.current;
    const request = apiGet<any>("/api/state")
      .then((result) => {
        if (requestSeq !== stateRefreshSeqRef.current) return result;
        setStore({ state: result.state, messages: result.messages || [] });
        currentTurnRef.current = countConversationTurns(result.messages || []);
        agentTurnActiveRef.current = Boolean(result.state?.isStreaming);
        agentLifecycleActiveRef.current = Boolean(result.state?.isStreaming);
        if (agentTurnActiveRef.current && currentTurnRef.current <= 0) currentTurnRef.current = 1;
        if (!result.state?.isStreaming) {
          clearLocalStreamingState();
          if (options?.settleIfIdle !== false) settleActiveToolsAfterIdle();
        }
        return result;
      })
      .catch((error: any) => {
        if (!quiet) showToast(`Çalışma zamanı durumu alınamadı: ${error?.message || "bilinmeyen hata"}`, "error");
        throw error;
      })
      .finally(() => {
        if (stateRefreshPromiseRef.current === request) stateRefreshPromiseRef.current = undefined;
      });
    stateRefreshPromiseRef.current = request;
    return request;
  }

  const {
    clearQueuedUserMessages,
    removeQueuedUserMessage,
    editQueuedUserMessage,
    routeQueuedUserMessage,
    sendQueuedUserMessage,
  } = useComposerQueue({
    sendCommand,
    showToast,
    ensureAgentTurn,
    clearLocalStreamingState,
    scheduleRefreshSessions,
    patchSessionState,
    addStoreMessage,
    setStreamingStoreMessage,
    setStore,
    planEnabled,
    currentTurnRef,
    promptRef,
    setUserMessageQueue,
    setTimelineScrollRequest,
    setSentImagePreviews,
    setPromptDraft,
    setComposerImagesDraft,
  });

  function openTerminalPanel() {
    setBottomOpen(true);
  }

  function closeSessionModal() {
    sessionSwitchSeqRef.current += 1;
    setSessionModalOpen(false);
  }

  useEffect(() => {
    (window as unknown as { __QUAKE_UI_MOUNTED__?: boolean }).__QUAKE_UI_MOUNTED__ = true;
  }, []);

  // Ajan embedded tarayıcı oturumu → sağ panel Tarayıcı sekmesini aç
  useEffect(() => {
    const unsub = desktop?.browser?.onAgentSession?.((state) => {
      if (state?.active) openRightPanel("browser");
    });
    return () => {
      unsub?.();
    };
  }, []);

  // Computer-use: panel AÇILMAZ — kullanıcı tam ekran imleç + kenar ışığı görür.
  // Session biterse yanlışlıkla computer sekmesinde kaldıysak launcher'a dön.
  useEffect(() => {
    const unsub = desktop?.computerUse?.onSession?.((state) => {
      if (state?.active) {
        showToast("Masaüstü modu: ajan imleci ve kenar ışıkları ekranda", "info");
        return;
      }
      setRightTab((tab) => tab === "computer" ? "launcher" : tab);
    });
    return () => {
      unsub?.();
    };
  }, []);

  // User bubble "undo" → mesajı composer'a geri yükle
  useEffect(() => {
    const onRestore = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text;
      if (typeof text !== "string") return;
      setPromptDraft(text);
      requestAnimationFrame(() => {
        const el = promptRef.current;
        if (!el) return;
        el.focus();
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
      });
    };
    const onOpenToolFile = (event: Event) => {
      const path = String((event as CustomEvent<{ path?: string }>).detail?.path || "").trim();
      if (!path) return;
      openRightPanel("files");
      void openFile(path);
    };
    const onFilesChanged = () => {
      void refreshFiles(currentFileDirRef.current);
    };
    const onRetryWebSearch = (event: Event) => {
      const query = String((event as CustomEvent<{ query?: string }>).detail?.query || "").trim();
      if (!query) return;
      setPromptDraft(`Web'de yeniden ara ve sonuçları özetle: ${query}`);
      requestAnimationFrame(() => promptRef.current?.focus());
    };
    const onMobileAnnotation = async (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; name: string; previewUrl: string; annotation: string; annotationTarget: string }>).detail;
      if (!detail?.previewUrl) return;
      const response = await fetch(detail.previewUrl);
      const blob = await response.blob();
      const data = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "").split(",")[1] || ""); reader.readAsDataURL(blob); });
      setComposerImagesDraft((current) => [...current, { id: detail.id, name: detail.name, mimeType: blob.type || "image/png", data, previewUrl: detail.previewUrl, annotation: detail.annotation, annotationTarget: detail.annotationTarget }].slice(0, 6));
      addContextChip({ type: "annotation", label: "1 mobil açıklama", text: detail.annotation });
      showToast("Mobil element composer'a eklendi", "success");
    };
    window.addEventListener("quake:restore-user-prompt", onRestore as EventListener);
    window.addEventListener("quake:open-tool-file", onOpenToolFile as EventListener);
    window.addEventListener("quake:files-changed", onFilesChanged as EventListener);
    window.addEventListener("quake:retry-web-search", onRetryWebSearch as EventListener);
    window.addEventListener("quake:mobile-annotation", onMobileAnnotation as EventListener);
    return () => {
      window.removeEventListener("quake:restore-user-prompt", onRestore as EventListener);
      window.removeEventListener("quake:open-tool-file", onOpenToolFile as EventListener);
      window.removeEventListener("quake:files-changed", onFilesChanged as EventListener);
      window.removeEventListener("quake:retry-web-search", onRetryWebSearch as EventListener);
      window.removeEventListener("quake:mobile-annotation", onMobileAnnotation as EventListener);
    };
  }, []);

  useEffect(() => {
    currentFileDirRef.current = currentFileDir;
  }, [currentFileDir]);

  useEffect(() => {
    loadNotificationConfig();
    void refreshAll();
    const source = new EventSource(eventsUrl());
    source.onopen = () => {
      eventStreamWarningShownRef.current = false;
      void refreshSessionState({ quiet: true, settleIfIdle: true });
    };
    source.onmessage = (msg) => handleServerMessage(msg.data);
    source.onerror = () => {
      if (!useAppStore.getState().state?.isStreaming && !hasDanglingAgentUiState()) return;
      void refreshSessionState({ quiet: true, settleIfIdle: true });
    };
    return () => {
      source.close();
      cancelScheduledStreamingUpdate();
      cancelScheduledToolUpdates();
    };
  }, []);

  useEffect(() => {
    function reconcileIfNeeded() {
      const snapshot = useAppStore.getState();
      if (!snapshot.state?.isStreaming && !snapshot.streamingMessage && !hasActiveToolState(snapshot.tools)) return;
      void refreshSessionState({ quiet: true, settleIfIdle: true });
    }
    const onFocus = () => reconcileIfNeeded();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") reconcileIfNeeded();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!isSessionStreaming) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastAgentEventAtRef.current < 4000) return;
      void refreshSessionState({ quiet: true, settleIfIdle: true });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [isSessionStreaming]);

  useAppKeyboard({
    browserLayout,
    filesLayout,
    rightOpen,
    rightTab,
    settingsOpenRef,
    promptRef,
    toggleLeftPanel,
    setCommandPaletteOpen,
    setBottomOpen,
    setCenterView,
    setPromptDraft,
    showToast,
    applyBrowserLayout,
    applyFilesLayout,
    setBrowserFocusComposer,
    openTerminalPanel,
    openRightPanel,
  });

  // Focus layouts reserve space for the compact composer above native views.
  useLayoutEffect(() => {
    const focusWorkspaceActive = rightOpen && (
      (rightTab === "browser" && browserLayout === "focus") ||
      (rightTab === "files" && filesLayout === "focus")
    );
    if (!focusWorkspaceActive || browserFocusComposer === "hidden") {
      setBrowserFocusBottomInset(0);
      return;
    }
    // Native WebContentsView React katmanının üstünde çizilir. Odak moduna ilk
    // girişte ölçüm henüz oturmadan tüm yüksekliği kapatmaması için güvenli alanı
    // senkron ayır; sonraki karelerde gerçek composer yüksekliğiyle kesinleştir.
    setBrowserFocusBottomInset(browserFocusComposer === "mini" ? 72 : 220);
    const main = browserFocusMainRef.current;
    if (!main) return;
    const updateInset = () => {
      const rect = main.getBoundingClientRect();
      const measured = Math.max(0, Math.ceil(window.innerHeight - rect.top));
      if (measured > 0) setBrowserFocusBottomInset(measured);
    };
    const observer = new ResizeObserver(updateInset);
    observer.observe(main);
    window.addEventListener("resize", updateInset);
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      updateInset();
      secondFrame = requestAnimationFrame(updateInset);
    });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateInset);
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [browserLayout, filesLayout, rightOpen, rightTab, browserFocusComposer, hasVisibleMessages]);

  // Disari tiklayinca acik composer menulerini (details) kapat.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Element | null;
      const openMenus = document.querySelectorAll<HTMLDetailsElement>(".composer-menu[open]");
      openMenus.forEach((details) => {
        if (!details.contains(target)) details.removeAttribute("open");
      });
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  // Dismiss HTML early-paint splash once React mounts.
  useEffect(() => {
    const el = document.getElementById("quake-boot-splash");
    if (el) el.remove();
    try {
      (window as any).__QUAKE_UI_MOUNTED__ = true;
    } catch { /* ignore */ }
  }, []);

  // Hide React boot splash after config + sessions resolve (min 450ms for polish).
  useEffect(() => {
    if (!bootSplash) return;
    const coreReady = !loading.config && !loading.sessions;
    if (!coreReady) return;
    const minMs = 450;
    const started = performance.now();
    const finish = () => {
      setBootSplashFading(true);
      window.setTimeout(() => setBootSplash(false), 360);
    };
    const elapsed = performance.now() - started;
    const wait = Math.max(0, minMs - elapsed);
    const timer = window.setTimeout(finish, wait);
    return () => window.clearTimeout(timer);
  }, [bootSplash, loading.config, loading.sessions]);

  async function refreshAll() {
    await refreshSessionState({ settleIfIdle: true });
    await refreshConfig();
    await Promise.all([refreshSessions(), refreshModels(), refreshCommands(), refreshFiles(currentFileDirRef.current)]);
  }

  function toggleLeftPanel() {
    setLeftOpen((open) => {
      writeStorageValue("quake-web:leftOpen", open ? "0" : "1");
      return !open;
    });
  }

  function toggleRightPanel() {
    setRightOpen((open) => !open);
  }

  function toggleBottomPanel() {
    setBottomOpen((open) => !open);
  }

  // Titlebar menu (Dosya/Görünüm/Yardım) aksiyonlarini ilgili davranisa bagla.
  function handleMenuAction(action: MenuAction) {
    if (action === "new-chat") { void handleNewChatWithProjectMenu(); return; }
    if (action === "open-folder") { void handleOpenFolderNative(); return; }
    if (action === "settings") { openSettingsPage(); return; }
    if (action === "about") { openSettingsPage("about"); return; }
    if (action === "toggle-sidebar") { toggleLeftPanel(); return; }
    if (action === "toggle-bottom-panel") { toggleBottomPanel(); return; }
    if (action === "toggle-right-panel") { toggleRightPanel(); return; }
    if (action === "toggle-theme") toggleTheme();
  }

  async function refreshConfig() {
    const requestSeq = ++configRefreshSeqRef.current;
    setLoading((state) => ({ ...state, config: true }));
    try {
      const [{ config }, runtimeSettingsResult, metadataResult] = await Promise.all([
        apiGet<any>("/api/config"),
        apiGet<any>("/api/settings").catch(() => ({ settings: {} })),
        apiGet<any>("/api/conversation-metadata").catch(() => ({ metadata: undefined })),
      ]);
      if (requestSeq !== configRefreshSeqRef.current) return;
      setStore({ config, runtimeSettings: runtimeSettingsResult.settings || {} });
      if (metadataResult.metadata) {
        hydrateConversationMetadata(metadataResult.metadata);
      }
    } catch (error: any) {
      if (requestSeq !== configRefreshSeqRef.current) return;
      showToast(`Ayarlar alınamadı: ${error.message}`, "error");
    } finally {
      if (requestSeq === configRefreshSeqRef.current) setLoading((state) => ({ ...state, config: false }));
    }
  }

  async function refreshSessions() {
    const requestSeq = ++sessionsRefreshSeqRef.current;
    setLoading((state) => ({ ...state, sessions: true }));
    try {
      const { sessions } = await apiGet<any>("/api/sessions?all=1");
      if (requestSeq !== sessionsRefreshSeqRef.current) return;
      // Keep optimistic active-chat row if disk list hasn't caught up yet (race after first send).
      const prev = (useAppStore.getState().sessions as any[]) || [];
      const st = useAppStore.getState().state as Record<string, any> | undefined;
      const activePath = String(st?.sessionFile || "").trim();
      const activeId = String(st?.sessionId || "").trim();
      const activeHasConversation = useAppStore.getState().messages.some((message: any) => message?.role === "user");
      const serverList = (Array.isArray(sessions) ? sessions : []).filter((session: any) =>
        Number(session?.messageCount) > 0 && String(session?.firstMessage || "").trim() !== "(no messages)",
      );
      const onServer = activePath || activeId
        ? serverList.some((s: any) => {
            const sp = String(s?.path || "");
            const sid = String(s?.id || "");
            return (activePath && sp === activePath) || (activeId && sid === activeId);
          })
        : true;
      if (activeHasConversation && !onServer && (activePath || activeId)) {
        const local = prev.find((s: any) => {
          const sp = String(s?.path || "");
          const sid = String(s?.id || "");
          return (activePath && sp === activePath) || (activeId && sid === activeId);
        });
        if (local) serverList.unshift(local);
        else if (activePath) {
          serverList.unshift({
            path: activePath,
            id: activeId || undefined,
            cwd: st?.cwd || currentWorkspace || undefined,
            firstMessage: "Yeni sohbet",
            modified: new Date().toISOString(),
            messageCount: Math.max(1, Number(st?.messageCount) || 0),
          });
        }
      }
      setStore({ sessions: serverList });
    } catch (error: any) {
      if (requestSeq !== sessionsRefreshSeqRef.current) return;
      showToast(`Sohbetler alınamadı: ${error.message}`, "error");
    } finally {
      if (requestSeq === sessionsRefreshSeqRef.current) setLoading((state) => ({ ...state, sessions: false }));
    }
  }

  /** Debounced refresh so rapid message_end events don't spam /api/sessions. */
  function scheduleRefreshSessions(delayMs = 250) {
    if (sessionsRefreshTimerRef.current !== undefined) window.clearTimeout(sessionsRefreshTimerRef.current);
    sessionsRefreshTimerRef.current = window.setTimeout(() => {
      sessionsRefreshTimerRef.current = undefined;
      void refreshSessions();
    }, delayMs);
  }

  /**
   * Immediately put/update the active chat in the sidebar after the user sends a message.
   * Server list only updates after the session is persisted (and a refresh); without this
   * new chats stay invisible until the next ready/switch.
   */
  function upsertActiveSessionInSidebar(firstMessage?: string) {
    const st = useAppStore.getState().state as Record<string, any> | undefined;
    const path = String(st?.sessionFile || "").trim();
    const id = String(st?.sessionId || "").trim();
    if (!path && !id) return;
    const cwd = String(st?.cwd || currentWorkspace || "").trim();
    const now = new Date().toISOString();
    const title = (firstMessage || "").trim();
    const sessions = (useAppStore.getState().sessions as any[]) || [];
    const idx = sessions.findIndex((s: any) => {
      const sp = String(s?.path || "");
      const sid = String(s?.id || "");
      return (path && sp === path) || (id && sid === id) || (path && sp.endsWith(path)) || (path && path.endsWith(sp));
    });
    if (idx >= 0) {
      const prev = sessions[idx];
      const prevFirst = String(prev.firstMessage || "").trim();
      const keepFirst = prevFirst && prevFirst !== "(no messages)" ? prevFirst : (title || prevFirst || "Yeni sohbet");
      const next = sessions.slice();
      next[idx] = {
        ...prev,
        path: path || prev.path,
        id: id || prev.id,
        cwd: cwd || prev.cwd,
        firstMessage: keepFirst,
        lastUserMessage: title || prev.lastUserMessage,
        modified: now,
        messageCount: Math.max(Number(prev.messageCount) || 0, 1),
      };
      // Move to front so Projeler / Sohbetler sorts it as newest even before server refresh.
      if (idx > 0) {
        const [row] = next.splice(idx, 1);
        next.unshift(row);
      }
      setStore({ sessions: next });
      return;
    }
    if (!path) return;
    setStore({
      sessions: [
        {
          path,
          id: id || undefined,
          cwd: cwd || undefined,
          firstMessage: title || "Yeni sohbet",
          lastUserMessage: title || undefined,
          modified: now,
          messageCount: 1,
        },
        ...sessions,
      ],
    });
  }

  async function refreshCommands() {
    const requestSeq = ++commandsRefreshSeqRef.current;
    try {
      const { commands } = await apiGet<any>("/api/commands");
      if (requestSeq !== commandsRefreshSeqRef.current) return;
      setStore({ commands });
    } catch {
      // Keep the last known command list; transient refresh failures should not blank the palette.
    }
  }

  const {
    refreshWorkspaceChanges,
    refreshFiles,
    openFile,
    openFileInMonaco,
    closeMonacoModal,
    openDiffTab,
    revealInFileTree,
  } = useFileWorkspace({
    showToast,
    setStore,
    configCwd,
    stateCwd,
    currentWorkspace,
    activeTabPath,
    fileRefreshSeqRef,
    filePreviewSeqRef,
    monacoOpenSeqRef,
    currentFileDirRef,
    setLoading,
    setCurrentFileDir,
    setFilePreview,
    setMonacoModal,
    setOpenTabs,
    setActiveTabPath,
    setRightPanelTab,
    setRightPanelOpen,
    openRightPanel,
  });

  async function sendCommand(command: any) {
    const response = await apiPost<any>("/api/command", command);
    if (response?.success === false) throw new Error(response.error || "Komut çalıştırılamadı");
    return response;
  }

  function runUiCommand(command: any, failureMessage = "Komut çalıştırılamadı") {
    void sendCommand(command).catch((error: any) => {
      showToast(`${failureMessage}: ${error?.message || "bilinmeyen hata"}`, "error");
    });
  }

  async function runAwaitedUiCommand(command: any, failureMessage = "Komut çalıştırılamadı"): Promise<void> {
    try {
      await sendCommand(command);
    } catch (error: any) {
      showToast(`${failureMessage}: ${error?.message || "bilinmeyen hata"}`, "error");
      throw error;
    }
  }

  function isPlanSurfaceToast(toast: ToastState): boolean {
    return /\bplan\b|netleştirme|planlama/i.test(toast.message);
  }

  function clearPlanUiSurface(options?: { switchPanel?: boolean; resetMode?: boolean }) {
    const store = useAppStore.getState();
    setPlanModePref(false);
    if (options?.resetMode) writeStorageValue("quake-web:composerMode", "execute");
    setStore({ toasts: store.toasts.filter((toast) => !isPlanSurfaceToast(toast)) });
    if (options?.switchPanel) setRightPanelTab("launcher");
  }

  async function startNewSession(options?: {
    parentSession?: string;
    isolation?: "plan" | "goal" | "agent";
    /** When true, skip resetting goal/plan prefs after create (caller applies mode). */
    keepModePrefs?: boolean;
  }) {
    // Park previous agent in the background — do NOT wait for it / do NOT abort.
    const previousDraftKey = activeComposerDraftKeyRef.current;
    const parentSession =
      options?.parentSession
      || useAppStore.getState().state?.sessionFile
      || undefined;
    saveActiveComposerDraft();
    activateComposerDraft(`new:${Date.now()}:${sessionSwitchSeqRef.current + 1}`);
    // Capture the departing chat's complete dock before clearing plan lifecycle UI.
    resetSessionOwnedUi();
    clearPlanUiSurface({ switchPanel: false, resetMode: !options?.keepModePrefs });
    if (!options?.keepModePrefs) setGoalModePref(false);
    // Clear local "this chat is streaming" lock immediately so Chat 2 can prompt
    // without queueing behind Chat 1's stale isStreaming flag.
    clearLocalStreamingState();
    settleActiveToolsAfterIdle();
    setUserMessageQueue([]);
    setQueuedMessages({ steering: [], followUp: [] });
    setSentImagePreviews({});
    currentTurnRef.current = 0;
    agentTurnActiveRef.current = false;
    agentLifecycleActiveRef.current = false;
    try {
      await sendCommand({
        type: "new_session",
        parentSession,
        isolation: options?.isolation || "agent",
      });
      // ready SSE will replace messages/state; force idle until then so composer stays open.
      clearLocalStreamingState();
      await refreshAll();
      return true;
    } catch (error: any) {
      sessionTransitionPendingRef.current = false;
      expectedSessionKeyRef.current = "";
      departingSessionKeysRef.current.clear();
      setSessionSurfacePending(false);
      activateComposerDraft(previousDraftKey);
      activateRightPanelSnapshot(previousDraftKey);
      showToast(`Yeni sohbet başlatılamadı: ${error?.message || "bilinmeyen hata"}`, "error");
      return false;
    }
  }

  /** True when current chat already has user content (must isolate mode switches). */
  function currentChatHasHistory(): boolean {
    const messages = useAppStore.getState().messages || [];
    return messages.some((message: any) => {
      if (message?.role !== "user") return false;
      const text = typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content.map((part: any) => String(part?.text || "")).join("")
          : "";
      return Boolean(String(text || "").trim());
    });
  }

  /**
   * Open Plan or Goal in an isolated chat:
   * - Empty draft → apply mode in place
   * - Existing history / other mode → park current chat, open new isolated session
   */
  async function openIsolatedMode(mode: "plan" | "goal") {
    if (useAppStore.getState().state?.isStreaming) {
      showToast("Aktif görev çalışırken yeni izole sohbet açılamaz. Önce durdurun veya bitirin.", "info");
      return;
    }
    const hasHistory = currentChatHasHistory();
    const goalTerminal = !sessionGoal || ["completed", "failed", "cancelled"].includes(sessionGoal.status);
    const hasActiveGoal = Boolean(sessionGoal && !goalTerminal);
    const currentlyPlan = planEnabled;
    const currentlyGoal = Boolean(goalModePref || hasActiveGoal);

    // Already pure empty session of this mode → stay.
    if (!hasHistory) {
      if (mode === "plan") {
        if (currentlyGoal && hasActiveGoal) {
          void runUiCommand({ type: "goal_cancel" }, "Goal iptal edilemedi");
        }
        setGoalModePref(false);
        void switchComposerMode("plan");
        showToast("Plan modu bu sohbette açıldı", "info");
        return;
      }
      if (currentlyPlan) void switchComposerMode("execute");
      setGoalModePref(true);
      showToast("Hedef modu bu sohbette açıldı", "info");
      return;
    }

    // History (or conflicting mode) → brand-new isolated chat.
    const ok = await startNewSession({ isolation: mode, keepModePrefs: true });
    if (!ok) return;
    if (mode === "plan") {
      setGoalModePref(false);
      void switchComposerMode("plan");
      showToast("Plan için yeni izole sohbet açıldı", "info");
      return;
    }
    setGoalModePref(true);
    // Server isolation=goal leaves collaboration as default/agent.
    void switchComposerMode("execute");
    showToast("Hedef için yeni izole sohbet açıldı", "info");
  }

  async function runSlash(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const [command, ...rest] = trimmed.split(/\s+/);
    await sendCommand({ type: "slash_command", command, args: rest.join(" ") });
  }

  async function handlePaletteAction(action: string) {
    if (action === "new") {
      await handleNewChatWithProjectMenu();
      return;
    }
    if (action === "refresh") {
      await refreshAll();
      return;
    }
    if (action === "terminal") {
      openTerminalPanel();
      return;
    }
    if (action === "files") {
      openRightPanel("files");
      return;
    }
    if (action === "settings") {
      openSettingsPage();
      return;
    }
    if (action === "toggle-left") {
      toggleLeftPanel();
      return;
    }
    if (action === "abort") {
      await abortAgent();
    }
  }

  /**
   * Codex `Op::Interrupt` / app-server `turn/interrupt`.
   * Preserves partial assistant text; emits server `turn_aborted` (reason: interrupted).
   * Clears active-turn pending_input equivalent (steer/followUp queues) — does not start a new turn.
   */
  async function abortAgent() {
    abortedTurnSuppressedRef.current = true;
    promptSubmitLockRef.current = false;
    setIsPromptPending(false);
    turnCompleteNotifiedRef.current = true; // prevent "Yanıt tamamlandı" after interrupt
    if (turnCompleteNotifyTimerRef.current !== undefined) {
      window.clearTimeout(turnCompleteNotifyTimerRef.current);
      turnCompleteNotifyTimerRef.current = undefined;
    }
    // Keep partial assistant text (Codex keeps streamed agent message until abort settles).
    preserveStreamingMessageAfterAbort();
    clearLocalStreamingState();
    settleActiveToolsAfterIdle();
    // Codex interrupt_task clears pending for the active turn — not local "next turn" drafts.
    setQueuedMessages({ steering: [], followUp: [] });
    try {
      await sendCommand({ type: "turn_interrupt" });
      showToast("Tur kesildi (interrupt)", "info");
    } catch (error: any) {
      // Fallback alias
      try {
        await sendCommand({ type: "abort" });
        showToast("Tur kesildi (interrupt)", "info");
      } catch (err2: any) {
        showToast(`Yanıt durdurulamadı: ${err2?.message || error?.message || "bilinmeyen hata"}`, "error");
      }
    }
  }

  async function submitPrompt(event: React.FormEvent) {
    event.preventDefault();
    await submitCurrentPrompt();
  }

  async function submitCurrentPrompt() {
    // Sync re-entry guard (isPromptPending state is one frame too late for double Enter).
    if (promptSubmitLockRef.current) return;
    // A deliberate new prompt starts a fresh turn and releases the aborted-turn quarantine.
    abortedTurnSuppressedRef.current = false;
    // Annotation text already travels with its annotated image. Keeping the
    // matching annotation chip in this envelope would send the same context twice.
    const nonAnnotationContextChips = contextChips.filter((chip) => chip.type !== "annotation");
    const contextHint = nonAnnotationContextChips.length ? `\n\n[Bağlam]\n${nonAnnotationContextChips.map((chip) => `### ${chip.type}: ${chip.label}\n${chip.text}`).join("\n\n")}` : "";
    const images = composerImagesRef.current;
    const annotationHint = images
      .filter((image) => image.annotation || image.annotationTarget)
      .map((image, index) => `### Açıklama ${index + 1}${image.annotationTarget ? ` · ${image.annotationTarget}` : ""}\n${image.annotation || "Bu seçimi incele."}`)
      .join("\n\n");
    const message = promptValueRef.current.trim();
    if (!hasComposerPayload(message, images.length, nonAnnotationContextChips.length)) return;
    const fallbackMessage = composerFallbackMessage(images.length, nonAnnotationContextChips.length);
    const displayMessage = message || fallbackMessage;
    const modelMessage = [message, annotationHint].filter(Boolean).join("\n\n") || fallbackMessage;
    const sentAsGoal = goalModePref || message.startsWith("/goal ");
    const outgoingMessage = goalModePref && !message.startsWith("/goal ") ? `/goal ${modelMessage}` : modelMessage;
    const outgoingDisplayMessage = goalModePref && !message.startsWith("/goal ") ? `/goal ${displayMessage}` : displayMessage;
    if (goalModePref) setGoalModePref(false);

    // Codex `Op::UserInput` while turn active → Session::steer_input (same-turn).
    // Not "wait until agent finishes" — inject into the current turn (pending_input).
    // Local follow-up queue is only via explicit ComposerQueue "Bekliyor" path.
    const snap = useAppStore.getState();
    const localStreaming = Boolean(snap.state?.isStreaming || snap.streamingMessage);
    let forceSteer = false;
    if (isComposerStreaming || localStreaming || isPromptPending) {
      const runtimeState = await refreshSessionState({ quiet: true, settleIfIdle: true }).catch(() => undefined);
      const activeStillStreaming = Boolean(
        runtimeState?.state?.isStreaming ||
          useAppStore.getState().state?.isStreaming ||
          useAppStore.getState().streamingMessage,
      );
      if (activeStillStreaming || isPromptPending) {
        forceSteer = true;
      } else {
        // Stale lock — free the composer for this (new/switched) session.
        clearLocalStreamingState();
      }
    }

    promptSubmitLockRef.current = true;
    const nextHistory = message ? [message, ...promptHistory.filter((entry) => entry !== message)].slice(0, 50) : promptHistory;
    setPromptHistory(nextHistory);
    writeStorageJson("quake-web:promptHistory", nextHistory);
    setPromptHistoryIndex(undefined);
    setTimelineScrollRequest((value) => value + 1);
    setIsPromptPending(true);
    // Optimistic lock: stop button + queue routing before first SSE event arrives.
    patchSessionState({ isStreaming: true });
    const optimisticTurnId = !message.startsWith("/") ? ensureAgentTurn() : undefined;
    // Empty assistant bubble so "Düşünüyor" appears the instant the user sends.
    if (!message.startsWith("/")) {
      setStreamingStoreMessage({
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        turnId: optimisticTurnId,
        __localOptimistic: true,
      });
    }
    setPromptDraft("");
    setComposerImagesDraft([]);
    // One optimistic bubble only — replace any prior optimistic twin with same text.
    if (!message.startsWith("/")) {
      const store = useAppStore.getState();
      const withoutDup = store.messages.filter(
        (m: any) => !(m?.__localOptimistic && m?.role === "user" && String(m?.content || "").trim() === outgoingDisplayMessage),
      );
      if (withoutDup.length !== store.messages.length) {
        setStore({ messages: withoutDup });
      }
      addStoreMessage({
        role: "user",
        content: outgoingDisplayMessage,
        timestamp: Date.now(),
        turnId: optimisticTurnId,
        __localOptimistic: true,
        __sentAsGoal: sentAsGoal,
      });
      upsertActiveSessionInSidebar(displayMessage);
    }
    const restoreDraftVersion = composerDraftVersionRef.current;
    if (images.length) setSentImagePreviews((current) => ({ ...current, [outgoingDisplayMessage]: images }));
    try {
      if (message.startsWith("/")) await runSlash(message);
      else if (forceSteer) {
        // Codex turn/steer — inject into active turn (does not start a new turn).
        await sendCommand({
          type: "turn_steer",
          message: `${outgoingMessage}${contextHint}`,
          displayMessage: outgoingDisplayMessage,
          images: toPromptImages(images),
          conversationMode: planEnabled ? "plan" : "execute",
        });
        showToast("Aynı tura yönlendirildi (Codex steer)", "info");
        scheduleRefreshSessions(400);
      } else {
        await sendCommand({
          type: "prompt",
          message: `${outgoingMessage}${contextHint}`,
          displayMessage: outgoingDisplayMessage,
          images: toPromptImages(images),
          conversationMode: planEnabled ? "plan" : "execute",
          goalOptions: outgoingMessage.startsWith("/goal ") ? {
            maxTurns: goalUiSettings.maxTurns,
            maxStagnantTurns: goalUiSettings.maxStagnantTurns,
            autoRecover: goalUiSettings.autoRecover,
          } : undefined,
        });
        // Persist may complete on user message_end shortly after; refresh list soon.
        scheduleRefreshSessions(400);
      }
      if (contextChips.length) setContextChipsDraft([]);
    } catch (error: any) {
      clearLocalStreamingState();
      // Drop optimistic user bubble if the request never reached the agent.
      const store = useAppStore.getState();
      const kept = store.messages.filter((m: any) => !(m?.__localOptimistic && m?.role === "user"));
      if (kept.length !== store.messages.length) {
        setStore({ messages: kept });
      }
      const draftIsStillCleared = composerDraftVersionRef.current === restoreDraftVersion && !promptValueRef.current.trim() && composerImagesRef.current.length === 0;
      if (draftIsStillCleared) {
        setPromptDraft(message);
        setComposerImagesDraft(images);
      }
      showToast(`Mesaj gönderilemedi: ${error.message}`, "error");
    } finally {
      setIsPromptPending(false);
      promptSubmitLockRef.current = false;
    }
  }

  async function applyReadyPlan() {
    const artifact = sessionPlan?.artifact;
    if (!artifact || sessionPlan?.phase !== "ready" || !readyPlanApprovalKey) return;
    if (promptSubmitLockRef.current || isPromptPending || isComposerStreaming) return;

    const executionPrompt = "Evet, bu planı uygula. Hazırladığın son planı eksiksiz uygula ve sonucu doğrula.";
    promptSubmitLockRef.current = true;
    abortedTurnSuppressedRef.current = false;
    setPlanApplyPending(true);
    setDismissedPlanApprovalKey(readyPlanApprovalKey);
    setPlanModePref(false);
    setTimelineScrollRequest((value) => value + 1);
    setIsPromptPending(true);
    patchSessionState({
      isStreaming: true,
      conversationMode: "execute",
      plan: {
        ...sessionPlan,
        enabled: false,
        phase: "idle",
      },
    });
    const turnId = ensureAgentTurn();
    setStreamingStoreMessage({
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      turnId,
      __localOptimistic: true,
    });
    addStoreMessage({
      role: "user",
      content: executionPrompt,
      timestamp: Date.now(),
      turnId,
      __localOptimistic: true,
    });
    upsertActiveSessionInSidebar(executionPrompt);

    try {
      await sendCommand({
        type: "prompt",
        message: executionPrompt,
        conversationMode: "execute",
      });
      scheduleRefreshSessions(400);
    } catch (error: any) {
      clearLocalStreamingState();
      const store = useAppStore.getState();
      const kept = store.messages.filter(
        (message: any) => !(message?.__localOptimistic && message?.role === "user" && String(message?.content || "") === executionPrompt),
      );
      if (kept.length !== store.messages.length) setStore({ messages: kept });
      setPlanModePref(true);
      patchSessionState({
        isStreaming: false,
        conversationMode: "plan",
        plan: {
          ...sessionPlan,
          enabled: true,
          phase: "ready",
        },
      });
      setDismissedPlanApprovalKey("");
      showToast(`Plan uygulanamadı: ${error?.message || "bilinmeyen hata"}`, "error");
    } finally {
      setPlanApplyPending(false);
      setIsPromptPending(false);
      promptSubmitLockRef.current = false;
    }
  }

  function reviseReadyPlan() {
    if (!readyPlanApprovalKey) return;
    setDismissedPlanApprovalKey(readyPlanApprovalKey);
    if (!promptValueRef.current.trim()) setPromptDraft("Planı şu şekilde değiştir: ");
    requestAnimationFrame(() => {
      const textarea = promptRef.current;
      textarea?.focus();
      if (textarea) textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }

  function openCreatedPlanActivity(signature: string) {
    if (sessionTransitionPendingRef.current) return;
    if (!signature || openedCreatedPlanRef.current === signature) return;
    openedCreatedPlanRef.current = signature;
    openRightPanel("plan");
  }

  function hasCreatedPlanActivity(planId: string): boolean {
    return useAppStore.getState().messages.some((message: any) =>
      message?.customType === "plan-created" && String(message?.details?.planId || "") === planId,
    );
  }

  function ensureCreatedPlanActivity(plan: any, options: { open?: boolean } = {}) {
    const artifact = plan?.artifact;
    if (!artifact?.id) return;
    const planId = String(artifact.id);
    if (!hasCreatedPlanActivity(planId)) {
      addStoreMessage({
        id: `plan-created:${planId}`,
        role: "custom",
        customType: "plan-created",
        content: String(artifact.title || "Uygulama Planı"),
        display: true,
        details: { planId, title: artifact.title, documentPath: artifact.documentPath, markdown: artifact.markdown },
        timestamp: artifact.updatedAt || artifact.createdAt || Date.now(),
      });
    }
    if (options.open !== false) openCreatedPlanActivity(planId);
  }

  // SSE core handlers live in createServerEventHandlers; wired after handleExtensionRequest.
  // Thin stable entry points used earlier in this component (and by EventSource effect):
  function ensureAgentTurn(): number {
    if (serverEventHandlersRef.current) return serverEventHandlersRef.current.ensureAgentTurn();
    if (!agentTurnActiveRef.current) {
      currentTurnRef.current = Math.max(0, currentTurnRef.current) + 1;
      agentTurnActiveRef.current = true;
    }
    if (currentTurnRef.current <= 0) currentTurnRef.current = 1;
    return currentTurnRef.current;
  }

  function cancelScheduledStreamingUpdate() {
    if (serverEventHandlersRef.current) {
      serverEventHandlersRef.current.cancelScheduledStreamingUpdate();
      return;
    }
    if (streamingUpdateFrameRef.current !== undefined) {
      window.cancelAnimationFrame(streamingUpdateFrameRef.current);
      streamingUpdateFrameRef.current = undefined;
    }
    pendingStreamingUpdateRef.current = undefined;
  }

  function handleServerMessage(raw: string) {
    serverEventHandlersRef.current?.handleServerMessage(raw);
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const text = String((event as CustomEvent).detail || "");
      if (text) setPromptDraft(text);
    };
    window.addEventListener("quake:set-composer-draft", handler);
    return () => window.removeEventListener("quake:set-composer-draft", handler);
  }, []);

  function handleExtensionRequest(event: any) {
    if (event.method === "setStatus") {
      setStatus(event.statusKey, event.statusText);
      if (event.statusKey === "web-focus") {
        const focus = String(event.statusText || "");
        if (focus === "settings") {
          openSettingsPage("customizations");
        } else if (focus === "computeruse" || focus === "desktop") {
          // Panel yok: composer'a @bilgisayar koy
          setCenterView("chat");
          setPromptDraft((current) => {
            const base = String(current || "").trim();
            if (/@bilgisayar\b/i.test(base)) return base;
            return base ? `@bilgisayar ${base}` : "@bilgisayar ";
          });
          showToast("Masaüstü modu: @bilgisayar — görevini yaz", "info");
        } else if (focus === "browser") {
          openRightPanel("browser");
        }
      }
      return;
    }
    if (event.method === "setWidget") setWidget(event.widgetKey, event.widgetLines);
    if (event.method === "setSidebar") setSidebar(event.sidebarKey, event.sidebarLines);
    if (event.method === "setTitle") document.title = event.title;
    if (event.method === "set_editor_text") setPromptDraft(event.text || "");
    if (event.method === "notify") showToast(String(event.message || ""), extensionNotifyType(event.notifyType));
    // Clarification is rendered from authoritative runtime state. The server emits
    // that state before this notification, so this event must not create a second
    // client-owned plan snapshot or open the generic extension modal.
    if (event.method === "planClarification" || event.method === "requestUserInput") return;
    if (["confirm", "select", "input", "editor"].includes(event.method)) setExtensionModal(event);
  }

  // Bind/create SSE handlers once; mutate ctx fields every render for freshness.
  {
    const ctx = serverEventCtxRef.current;
    ctx.setStore = setStore;
    ctx.addStoreMessage = addStoreMessage;
    ctx.upsertTool = upsertTool;
    ctx.setStreamingStoreMessage = setStreamingStoreMessage;
    ctx.patchSessionState = patchSessionState;
    ctx.showToast = showToast;
    ctx.setStatus = setStatus;
    ctx.sessionFile = sessionFile;
    ctx.sessionId = sessionId;
    ctx.setSessionSurfacePending = setSessionSurfacePending;
    ctx.setTurnDiffs = setTurnDiffs;
    ctx.setQueuedMessages = setQueuedMessages;
    ctx.setUserMessageQueue = setUserMessageQueue;
    ctx.setApprovalPrompt = setApprovalPrompt;
    ctx.setMcpElicitation = setMcpElicitation;
    ctx.setTerminalTabs = setTerminalTabs;
    ctx.currentTurnRef = currentTurnRef;
    ctx.agentTurnActiveRef = agentTurnActiveRef;
    ctx.agentLifecycleActiveRef = agentLifecycleActiveRef;
    ctx.lastAssistantToolCallSignatureRef = lastAssistantToolCallSignatureRef;
    ctx.lastPlanPhaseRef = lastPlanPhaseRef;
    ctx.previousGoalStatusRef = previousGoalStatusRef;
    ctx.abortedTurnSuppressedRef = abortedTurnSuppressedRef;
    ctx.sessionTransitionPendingRef = sessionTransitionPendingRef;
    ctx.eventStreamWarningShownRef = eventStreamWarningShownRef;
    ctx.lastAgentEventAtRef = lastAgentEventAtRef;
    ctx.turnCompleteNotifyTimerRef = turnCompleteNotifyTimerRef;
    ctx.turnCompleteNotifiedRef = turnCompleteNotifiedRef;
    ctx.pendingStreamingUpdateRef = pendingStreamingUpdateRef;
    ctx.streamingUpdateFrameRef = streamingUpdateFrameRef;
    ctx.pendingToolUpdatesRef = pendingToolUpdatesRef;
    ctx.toolUpdateFrameRef = toolUpdateFrameRef;
    ctx.terminalTabsRef = terminalTabsRef;
    ctx.currentFileDirRef = currentFileDirRef;
    ctx.terminalRuns = terminalRuns;
    ctx.goalUiSettings = goalUiSettings;
    ctx.acceptsSessionReady = acceptsSessionReady;
    ctx.activateComposerDraft = activateComposerDraft;
    ctx.activateRightPanelSnapshot = activateRightPanelSnapshot;
    ctx.ensureCreatedPlanActivity = ensureCreatedPlanActivity;
    ctx.openCreatedPlanActivity = openCreatedPlanActivity;
    ctx.hasCreatedPlanActivity = hasCreatedPlanActivity;
    ctx.clearLocalStreamingState = clearLocalStreamingState;
    ctx.hasDanglingAgentUiState = hasDanglingAgentUiState;
    ctx.settleActiveToolsAfterIdle = settleActiveToolsAfterIdle;
    ctx.preserveStreamingMessageAfterAbort = preserveStreamingMessageAfterAbort;
    ctx.refreshSessionState = refreshSessionState;
    ctx.refreshSessions = refreshSessions;
    ctx.refreshModels = refreshModels;
    ctx.refreshCommands = refreshCommands;
    ctx.refreshFiles = refreshFiles;
    ctx.refreshWorkspaceChanges = refreshWorkspaceChanges;
    ctx.scheduleRefreshSessions = scheduleRefreshSessions;
    ctx.upsertActiveSessionInSidebar = upsertActiveSessionInSidebar;
    ctx.openRightPanel = openRightPanel;
    ctx.handleExtensionRequest = handleExtensionRequest;
    ctx.sendQueuedUserMessage = sendQueuedUserMessage;
    if (!serverEventHandlersRef.current) {
      serverEventHandlersRef.current = createServerEventHandlers(ctx);
    }
  }

  async function switchComposerMode(mode: "plan" | "execute") {
    if (useAppStore.getState().state?.isStreaming) {
      showToast("Aktif görev çalışırken Plan modu değiştirilemez.", "info");
      return;
    }
    setConversationMode(mode);
  }

  function setConversationMode(mode: "plan" | "execute") {
    const enable = mode === "plan";
    setPlanModePref(enable);
    patchSessionState({
      conversationMode: mode,
      plan: {
        ...(sessionPlan || { steps: [], completed: 0 }),
        enabled: enable,
        phase: enable ? (sessionPlan?.phase && sessionPlan.phase !== "idle" ? sessionPlan.phase : "planning") : "idle",
        steps: sessionPlan?.steps || [],
        completed: sessionPlan?.completed || 0,
        clarification: sessionPlan?.clarification,
        artifact: sessionPlan?.artifact,
        lastPlanText: sessionPlan?.lastPlanText,
        activeStep: sessionPlan?.activeStep,
      },
    });
    runUiCommand({ type: "set_plan_mode", enabled: enable }, enable ? "Plan modu açılamadı" : "Plan modu kapatılamadı");
  }

  return (
    <AppShell
      confirmPortal={<ConfirmPortal />}
      bootSplash={bootSplash}
      bootSplashFading={bootSplashFading}
      density={density}
      theme={theme}
      leftOpen={leftOpen}
      leftWidth={leftWidth}
      rightOpen={rightOpen}
      bottomOpen={bottomOpen}
      rightWidth={rightWidth}
      rightPanelExpanded={rightPanelExpanded}
      bottomHeight={bottomHeight}
      browserLayout={browserLayout}
      browserFocusComposer={browserFocusComposer}
      browserFocusBottomInset={browserFocusBottomInset}
      filesLayout={filesLayout}
      rightTab={rightTab}
      dockTabs={dockTabs}
      dockAddOpen={dockAddOpen}
      centerView={centerView}
      mainView={mainView}
      settingsModalOpen={settingsModalOpen}
      settingsInitialView={settingsInitialView}
      scheduleOpen={scheduleOpen}
      sessionModalOpen={sessionModalOpen}
      createProjectOpen={createProjectOpen}
      projectMenuOpen={projectMenuOpen}
      commandPaletteOpen={commandPaletteOpen}
      searchOpen={searchOpen}
      searchPaletteOpen={searchPaletteOpen}
      browserFocusMainRef={browserFocusMainRef}
      sessionId={sessionId}
      sessionFile={sessionFile}
      sessionPlan={sessionPlan}
      sessionGoal={sessionGoal}
      sessionSurfacePending={sessionSurfacePending}
      isSessionStreaming={isSessionStreaming}
      streamingSessionPaths={streamingSessionPaths}
      hasVisibleMessages={hasVisibleMessages}
      workspaceName={workspaceName}
      currentWorkspace={currentWorkspace}
      noProject={noProject}
      projectSessions={projectSessions as any}
      navProjects={navProjects as any}
      navPinned={navPinned}
      pinnedPaths={pinnedPaths}
      unreadSessionPaths={unreadSessionPaths}
      projectPickerItems={projectPickerItems}
      visibleSessions={visibleSessions as any}
      paletteRecentSessions={paletteRecentSessions}
      forkingEntryId={forkingEntryId}
      activeRightPanelKey={activeRightPanelKeyRef.current}
      loading={loading}
      promptRef={promptRef}
      prompt={prompt}
      composerImages={composerImages}
      sentImagePreviews={sentImagePreviews}
      contextChips={contextChips}
      queuedMessages={queuedMessages}
      userMessageQueue={userMessageQueue}
      isComposerStreaming={isComposerStreaming}
      isPromptPending={isPromptPending}
      isCompacting={isSessionCompacting}
      contextUsage={sessionContextUsage}
      planEnabled={planEnabled}
      goalModePref={goalModePref}
      showPlanApproval={showPlanApproval}
      planApplyPending={planApplyPending}
      readyPlanApprovalKey={readyPlanApprovalKey}
      terminalPolicyMode={terminalPolicyMode}
      terminalPolicyPending={terminalPolicyPending}
      currentModel={currentModel as any}
      currentModelValue={currentModelValue}
      currentModelLabel={currentModelLabel}
      currentThinking={currentThinking}
      pinnedModelCount={pinnedModels.length}
      visibleModels={visibleModels as any[]}
      promptHistory={promptHistory}
      promptHistoryIndex={promptHistoryIndex}
      timelineFilter={timelineFilter}
      timelineScrollRequest={timelineScrollRequest}
      turnDiffs={turnDiffs}
      approvalPrompt={approvalPrompt}
      mcpElicitation={mcpElicitation}
      filePreview={filePreview}
      currentFileDir={currentFileDir}
      turnReview={turnReview}
      selectedToolId={selectedToolId}
      previewImage={previewImage}
      extensionModal={extensionModal}
      monacoModal={monacoModal}
      trustOnboardingOpen={trustOnboardingOpen}
      toggleLeftPanel={toggleLeftPanel}
      onLeftWidthChange={persistLeftWidth}
      toggleRightPanel={toggleRightPanel}
      toggleBottomPanel={toggleBottomPanel}
      setBottomOpen={setBottomOpen}
      setBottomHeight={setBottomHeight}
      setCenterView={setCenterView}
      setMainView={setMainView}
      setDockAddOpen={setDockAddOpen}
      setScheduleOpen={setScheduleOpen}
      setCommandPaletteOpen={setCommandPaletteOpen}
      setSearchOpen={setSearchOpen}
      setSearchPaletteOpen={setSearchPaletteOpen}
      setCreateProjectOpen={setCreateProjectOpen}
      setProjectMenuOpen={setProjectMenuOpen}
      setExtensionModal={setExtensionModal}
      setSelectedToolId={setSelectedToolId}
      setPreviewImage={setPreviewImage}
      setFilePreview={setFilePreview}
      setRightPanelTab={setRightPanelTab}
      setTimelineFilter={setTimelineFilter}
      setPromptHistoryIndex={setPromptHistoryIndex}
      setGoalModePref={setGoalModePref}
      setDismissedPlanApprovalKey={setDismissedPlanApprovalKey}
      setApprovalPrompt={setApprovalPrompt}
      setMcpElicitation={setMcpElicitation}
      setComposerImagesDraft={setComposerImagesDraft}
      handleMenuAction={handleMenuAction}
      handleRightDragStart={handleRightDragStart as (event: React.PointerEvent) => void}
      handleRightResizeKey={handleRightResizeKey}
      openRightPanel={openRightPanel}
      closeRightPanel={closeRightPanel}
      closeDockTab={closeDockTab}
      toggleRightPanelExpanded={toggleRightPanelExpanded}
      handleOpenPanel={handleOpenPanel}
      applyBrowserLayout={applyBrowserLayout}
      applyFilesLayout={applyFilesLayout}
      setBrowserFocusComposerMode={setBrowserFocusComposerMode}
      switchSessionFromUi={switchSessionFromUi}
      markSessionRead={markSessionRead}
      togglePinSession={togglePinSession}
      archiveSession={archiveSession}
      renameNavSession={renameNavSession}
      removeWorkspaceFromNav={removeWorkspaceFromNav}
      handleSelectProject={handleSelectProject}
      handleNewChatWithProjectMenu={handleNewChatWithProjectMenu}
      handleOpenFolderNative={handleOpenFolderNative}
      handleAddFolder={handleAddFolder}
      handleCreateProjectSkip={handleCreateProjectSkip}
      handleNewProject={handleNewProject}
      handleQuickStart={handleQuickStart}
      handleNoProject={handleNoProject}
      closeSessionModal={closeSessionModal}
      dismissTrustOnboarding={dismissTrustOnboarding}
      forkSessionFromMessage={forkSessionFromMessage}
      setPromptDraft={setPromptDraft}
      submitPrompt={submitPrompt}
      submitCurrentPrompt={submitCurrentPrompt}
      addComposerFiles={addComposerFiles}
      handleComposerPaste={handleComposerPaste}
      removeComposerImage={removeComposerImage}
      addContextChip={addContextChip}
      removeContextChip={removeContextChip}
      removeQueuedUserMessage={removeQueuedUserMessage}
      routeQueuedUserMessage={routeQueuedUserMessage}
      editQueuedUserMessage={editQueuedUserMessage}
      clearQueuedUserMessages={clearQueuedUserMessages}
      selectModel={selectModel}
      resetComposerPreferences={resetComposerPreferences}
      openIsolatedMode={openIsolatedMode}
      switchComposerMode={switchComposerMode}
      setConversationMode={setConversationMode}
      applyReadyPlan={applyReadyPlan}
      reviseReadyPlan={reviseReadyPlan}
      abortAgent={abortAgent}
      runUiCommand={runUiCommand}
      runAwaitedUiCommand={runAwaitedUiCommand}
      runSlash={runSlash}
      handlePaletteAction={handlePaletteAction}
      refreshFiles={refreshFiles}
      openFile={openFile}
      openFileInMonaco={openFileInMonaco}
      revealInFileTree={revealInFileTree}
      openDiffTab={openDiffTab}
      openTurnReview={openTurnReview}
      closeMonacoModal={closeMonacoModal}
      showToast={showToast}
      openSettingsPage={openSettingsPage}
      closeSettingsModal={closeSettingsModal}
      updateDensity={updateDensity}
      updateTheme={updateTheme}
      onSettingsThinking={onSettingsThinking}
      onSettingsSetModel={onSettingsSetModel}
      onSettingsOpenWorkspace={onSettingsOpenWorkspace}
      onSettingsCompact={onSettingsCompact}
      onSettingsClearPromptHistory={onSettingsClearPromptHistory}
      onSettingsSetDefaultModel={onSettingsSetDefaultModel}
      onSettingsSetDefaultThinking={onSettingsSetDefaultThinking}
      onSettingsAutoCompaction={onSettingsAutoCompaction}
      onSettingsTerminalPolicy={onSettingsTerminalPolicy}
      onSettingsBlockImages={onSettingsBlockImages}
      onSettingsShowImages={onSettingsShowImages}
    />
  );

}
