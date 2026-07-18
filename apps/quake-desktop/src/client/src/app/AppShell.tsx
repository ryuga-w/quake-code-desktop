import React from "react";
import type { WebContextUsage, WebGoalState, WebPlanState } from "../../../shared/protocol";
import { apiGet } from "../lib/api";
import { normalizeSessionDraftKey } from "../lib/client-ids";
import { copyTextWithToast } from "../lib/copy-toast";
import { formatComposerModelLabel, thinkingLabel } from "../lib/format-utils";
import { normalizeClientPath } from "../lib/path-utils";
import {
  clampLeftSidebarWidth,
  LEFT_SIDEBAR_CLOSE_THRESHOLD,
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
} from "../lib/layout-sizing";
import { useModalFocusTrap } from "../lib/modal-focus";
import { readLastSessionByWorkspace } from "../lib/session-projects";
import { writeStorageValue } from "../lib/storage";
import { toolContextText } from "../lib/tool-helpers";
import type { ToolCardState } from "../state/app-store";
import type {
  ComposerImage,
  DockTab,
  MainView,
  ModalRequest,
  MonacoModal,
  QueuedMessages,
  QueuedUserMessage,
  RightTab,
  TurnReviewView,
} from "../types";
import type { MenuAction } from "../components/chrome/Titlebar";
import type { ProjectPickerItem } from "../components/chrome/ProjectPicker";
import type { NavPinned, NavProject, NavSession } from "../components/chrome/NavRail";
import type { TimelineFilter } from "../components/timeline/TimelineChrome";
import type { ThemeId } from "../components/settings/SettingsPanels";
import type { SettingsView } from "../components/settings/SettingsPanels";
import type { TerminalPolicyMode } from "../components/composer/ChatComposer";
import type { ApprovalDecidePayload } from "../components/security/ComposerApproval";

import { SecurityBanner } from "../components/security/SecurityBanner";
import { ComposerApproval } from "../components/security/ComposerApproval";
import { McpElicitationCard } from "../components/security/McpElicitationCard";
import { TrustOnboardingModal } from "../components/security/TrustOnboardingModal";
import { StatusNoticeHost } from "../components/common/StatusNotice";
import { ContextChips, SlashAutocomplete, type SlashAutocompleteHandle } from "../components/composer/ComposerHelpers";
import { ChatComposer } from "../components/composer/ChatComposer";
import { GoalPanel } from "../components/goal/GoalPanel";
import { DropZone } from "../components/files/DropZone";
import { ExtensionRenderer } from "../components/extensions/ExtensionRenderer";
import { ConfirmProvider } from "../components/common/ConfirmContext";
import { Titlebar } from "../components/chrome/Titlebar";
import { SplashScreen } from "../components/chrome/SplashScreen";
import { PlanQuestionsPanel } from "../components/plan/PlanQuestionsPanel";
import { PlanArtifactPanel } from "../components/plan/PlanArtifactPanel";
import { PlanApprovalCard } from "../components/plan/PlanApprovalCard";
import { NavRail } from "../components/chrome/NavRail";
import { QuickLauncher } from "../components/chrome/QuickLauncher";
import { AgentsPanel } from "../components/agents/AgentsPanel";
import { TurnReviewPanel } from "../components/dock/TurnReviewPanel";
import { BottomPanel } from "../components/chrome/BottomPanel";
import { ProjectPicker, CreateProjectModal } from "../components/chrome/ProjectPicker";
import { LiveTimeline } from "../components/timeline/Timeline";
import { WorkspaceChrome } from "../components/shell/WorkspaceChrome";
import { RightPanelTabs } from "../components/shell/RightPanelTabs";
import { PreviewPanel } from "../components/preview/PreviewPanel";
import { ImagePreviewModal } from "../components/modals/ImagePreviewModal";
import { SessionPickerModal } from "../components/modals/SessionPickerModal";
import { MonacoModal as MonacoModalView } from "../components/modals/MonacoModal";
import { ExtensionModal } from "../components/modals/ExtensionModal";
import { MainEditorView } from "../components/editor/MainEditorView";
import { ToolInspector } from "../components/tools/ToolInspector";

const WorkspaceDashboard = React.lazy(() =>
  import("../components/workspace/WorkspaceDashboard").then((m) => ({ default: m.WorkspaceDashboard })),
);
const XtermTerminal = React.lazy(() =>
  import("../components/terminal/XtermTerminal").then((m) => ({ default: m.XtermTerminal })),
);
const SettingsPage = React.lazy(() =>
  import("../components/settings/SettingsPanels").then((m) => ({ default: m.SettingsPage })),
);
const FilesPanel = React.lazy(() =>
  import("../components/files/FilesPanel").then((m) => ({ default: m.FilesPanel })),
);
const CommandPalette = React.lazy(() =>
  import("../components/command/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
const BrowserPanel = React.lazy(() =>
  import("../components/dock/BrowserPanel").then((m) => ({ default: m.BrowserPanel })),
);
const SideConversationPanel = React.lazy(() =>
  import("../components/sidechat/SideConversationPanel").then((m) => ({ default: m.SideConversationPanel })),
);
const SubagentWorkspace = React.lazy(() =>
  import("../components/agents/SubagentWorkspace").then((m) => ({ default: m.SubagentWorkspace })),
);
const MobileStudioPanel = React.lazy(() =>
  import("../components/dock/MobileStudioPanel").then((m) => ({ default: m.MobileStudioPanel })),
);
const SchedulePanel = React.lazy(() =>
  import("../components/dock/SchedulePanel").then((m) => ({ default: m.SchedulePanel })),
);
const SearchOverlay = React.lazy(() =>
  import("../components/search/SearchOverlay").then((m) => ({ default: m.SearchOverlay })),
);
const SchedulePage = React.lazy(() =>
  import("../components/pages/SchedulePage").then((m) => ({ default: m.SchedulePage })),
);
const ConversationHistoryPage = React.lazy(() =>
  import("../components/pages/ConversationHistoryPage").then((m) => ({ default: m.ConversationHistoryPage })),
);
const ExtensionsPage = React.lazy(() =>
  import("../components/pages/ExtensionsPage").then((m) => ({ default: m.ExtensionsPage })),
);
const CodexCommandPalette = React.lazy(() =>
  import("../components/command/CodexCommandPalette").then((m) => ({ default: m.CodexCommandPalette })),
);

export type AppShellCenterView = "chat" | "projects" | "scheduled" | "extensions" | "history";
export type AppShellDensity = "comfortable" | "compact" | "dense";
export type AppShellBrowserLayout = "dock" | "split" | "focus";
export type AppShellBrowserFocusComposer = "hidden" | "mini" | "open";
export type AppShellFilesLayout = "dock" | "split" | "focus";

export type AppShellContextChip = {
  id: string;
  type: "file" | "terminal" | "tool" | "annotation";
  label: string;
  text: string;
};

export type AppShellApprovalPrompt = {
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
};

export type AppShellMcpElicitation = {
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
};

export type AppShellFilePreview = { path?: string; content: string };

export type AppShellComposerModel = {
  provider: string;
  id: string;
  reasoning?: boolean;
  supportsXhigh?: boolean;
  supportsMax?: boolean;
  current?: boolean;
};

export type AppShellPaletteSession = {
  path: string;
  name: string;
  project?: string;
};

export type AppShellProps = {
  // ── layout ──────────────────────────────────────────────────────────────
  confirmPortal: React.ReactNode;
  bootSplash: boolean;
  bootSplashFading: boolean;
  density: AppShellDensity;
  theme: ThemeId;
  leftOpen: boolean;
  leftWidth: number;
  rightOpen: boolean;
  bottomOpen: boolean;
  rightWidth: number;
  rightPanelExpanded: boolean;
  bottomHeight: number;
  browserLayout: AppShellBrowserLayout;
  browserFocusComposer: AppShellBrowserFocusComposer;
  browserFocusBottomInset: number;
  filesLayout: AppShellFilesLayout;
  rightTab: RightTab;
  dockTabs: DockTab[];
  dockAddOpen: boolean;
  centerView: AppShellCenterView;
  mainView: MainView;
  settingsModalOpen: boolean;
  settingsInitialView?: SettingsView;
  scheduleOpen: boolean;
  sessionModalOpen: boolean;
  createProjectOpen: boolean;
  projectMenuOpen: boolean;
  commandPaletteOpen: boolean;
  searchOpen: boolean;
  searchPaletteOpen: boolean;
  browserFocusMainRef: React.RefObject<HTMLElement | null>;

  // ── session ─────────────────────────────────────────────────────────────
  sessionId?: string;
  sessionFile?: string;
  sessionPlan?: WebPlanState;
  sessionGoal?: WebGoalState;
  sessionSurfacePending: boolean;
  isSessionStreaming: boolean;
  streamingSessionPaths: string[];
  hasVisibleMessages: boolean;
  workspaceName: string;
  currentWorkspace: string;
  noProject: boolean;
  projectSessions: NavSession[];
  navProjects: NavProject[];
  navPinned: NavPinned[];
  pinnedPaths: Set<string>;
  unreadSessionPaths?: Set<string>;
  projectPickerItems: ProjectPickerItem[];
  visibleSessions: any[];
  paletteRecentSessions: AppShellPaletteSession[];
  forkingEntryId: string | null;
  activeRightPanelKey: string;
  loading: { sessions?: boolean; files?: boolean };

  // ── composer ────────────────────────────────────────────────────────────
  promptRef: React.RefObject<HTMLTextAreaElement | null>;
  prompt: string;
  composerImages: ComposerImage[];
  sentImagePreviews: Record<string, ComposerImage[]>;
  contextChips: AppShellContextChip[];
  queuedMessages: QueuedMessages;
  userMessageQueue: QueuedUserMessage[];
  isComposerStreaming: boolean;
  isPromptPending: boolean;
  contextUsage?: WebContextUsage;
  planEnabled: boolean;
  goalModePref: boolean;
  showPlanApproval: boolean;
  planApplyPending: boolean;
  readyPlanApprovalKey: string;
  terminalPolicyMode: TerminalPolicyMode;
  terminalPolicyPending: boolean;
  currentModel?: AppShellComposerModel | any;
  currentModelValue: string;
  currentModelLabel: string;
  currentThinking: string;
  pinnedModelCount: number;
  visibleModels: AppShellComposerModel[] | any[];
  promptHistory: string[];
  promptHistoryIndex: number | undefined;
  timelineFilter: TimelineFilter;
  timelineScrollRequest: number;
  turnDiffs: Record<string, TurnReviewView>;
  approvalPrompt: AppShellApprovalPrompt | null;
  mcpElicitation: AppShellMcpElicitation | null;

  // ── panels ──────────────────────────────────────────────────────────────
  filePreview: AppShellFilePreview;
  currentFileDir: string;
  turnReview: TurnReviewView | null;
  selectedToolId: string | undefined;
  previewImage: ComposerImage | undefined;
  extensionModal: ModalRequest | undefined;
  monacoModal: MonacoModal | undefined;
  trustOnboardingOpen: boolean;

  // ── handlers ────────────────────────────────────────────────────────────
  // chrome / layout
  toggleLeftPanel: () => void;
  onLeftWidthChange: (width: number) => void;
  toggleRightPanel: () => void;
  toggleBottomPanel: () => void;
  setBottomOpen: (open: boolean) => void;
  setBottomHeight: (height: number) => void;
  setCenterView: (view: AppShellCenterView) => void;
  setMainView: (view: MainView) => void;
  setDockAddOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setScheduleOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchPaletteOpen: (open: boolean) => void;
  setCreateProjectOpen: (open: boolean) => void;
  setProjectMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setExtensionModal: (modal: ModalRequest | undefined) => void;
  setSelectedToolId: (id: string | undefined) => void;
  setPreviewImage: (image: ComposerImage | undefined) => void;
  setFilePreview: (preview: AppShellFilePreview) => void;
  setRightPanelTab: (tab: RightTab) => void;
  setTimelineFilter: (filter: TimelineFilter) => void;
  setPromptHistoryIndex: (index: number | undefined) => void;
  setGoalModePref: (value: boolean) => void;
  setDismissedPlanApprovalKey: (key: string) => void;
  setApprovalPrompt: (prompt: AppShellApprovalPrompt | null) => void;
  setMcpElicitation: (value: AppShellMcpElicitation | null) => void;
  setComposerImagesDraft: React.Dispatch<React.SetStateAction<ComposerImage[]>>;

  handleMenuAction: (action: MenuAction) => void;
  handleRightDragStart: (event: React.PointerEvent) => void;
  handleRightResizeKey: (event: React.KeyboardEvent) => void;
  openRightPanel: (tab: RightTab) => void;
  closeRightPanel: () => void;
  closeDockTab: (tab: DockTab) => void;
  toggleRightPanelExpanded: () => void;
  handleOpenPanel: (panel: RightTab) => void;
  applyBrowserLayout: (layout: AppShellBrowserLayout) => void;
  applyFilesLayout: (layout: AppShellFilesLayout) => void;
  setBrowserFocusComposerMode: (mode: AppShellBrowserFocusComposer) => void;

  // session / nav
  switchSessionFromUi: (sessionPath: string, closeModal?: boolean) => void | Promise<void>;
  markSessionRead: (path: string) => void;
  togglePinSession: (path: string) => void;
  archiveSession: (path: string) => void;
  renameNavSession: (session: NavSession | any, nextName: string) => void;
  removeWorkspaceFromNav: (path: string) => void;
  handleSelectProject: (path: string) => void | Promise<void>;
  handleNewChatWithProjectMenu: () => void | Promise<void>;
  handleOpenFolderNative: () => void | Promise<void>;
  handleAddFolder: () => void | Promise<void>;
  handleCreateProjectSkip: () => void | Promise<void>;
  handleNewProject: () => void;
  handleQuickStart: () => void | Promise<void>;
  handleNoProject: () => void | Promise<void>;
  closeSessionModal: () => void;
  dismissTrustOnboarding: () => void;
  forkSessionFromMessage: (entryId: string) => void | Promise<void>;

  // composer
  setPromptDraft: (value: React.SetStateAction<string>) => void;
  submitPrompt: (event: React.FormEvent<HTMLFormElement>) => void;
  submitCurrentPrompt: () => void | Promise<void>;
  addComposerFiles: (files: readonly File[]) => void | Promise<void>;
  handleComposerPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  removeComposerImage: (id: string) => void;
  addContextChip: (chip: { type: "file" | "terminal" | "tool" | "annotation"; label: string; text: string }) => void;
  removeContextChip: (id: string) => void;
  removeQueuedUserMessage: (id: string) => void;
  routeQueuedUserMessage: (item: QueuedUserMessage) => void | Promise<void>;
  editQueuedUserMessage: (item: QueuedUserMessage) => void;
  clearQueuedUserMessages: () => void;
  selectModel: (provider: string, id: string) => void;
  resetComposerPreferences: () => void;
  openIsolatedMode: (mode: "plan" | "goal") => void | Promise<void>;
  switchComposerMode: (mode: "plan" | "execute") => void | Promise<void>;
  setConversationMode: (mode: "plan" | "execute") => void;
  applyReadyPlan: () => void | Promise<void>;
  reviseReadyPlan: () => void;
  abortAgent: () => void | Promise<void>;
  runUiCommand: (command: any, failureMessage?: string) => void;
  runAwaitedUiCommand: (command: any, failureMessage?: string) => Promise<void>;
  runSlash: (text: string) => void | Promise<void>;
  handlePaletteAction: (action: string) => void | Promise<void>;

  // panels / files / tools
  refreshFiles: (dir?: string) => void | Promise<void>;
  openFile: (path: string) => void | Promise<void>;
  openFileInMonaco: (path: string) => void | Promise<void>;
  revealInFileTree: (path: string) => void;
  openDiffTab: (card: ToolCardState) => void;
  openTurnReview: (review: TurnReviewView) => void;
  closeMonacoModal: () => void;
  showToast: (message: string, type?: "info" | "success" | "warning" | "error") => string | void;

  // settings
  openSettingsPage: (view?: SettingsView) => void;
  closeSettingsModal: () => void;
  updateDensity: (density: AppShellDensity) => void;
  updateTheme: (theme: ThemeId) => void;
  onSettingsThinking: (level: string) => void;
  onSettingsSetModel: (value: string) => void;
  onSettingsOpenWorkspace: () => void;
  onSettingsCompact: () => void;
  onSettingsClearPromptHistory: () => void;
  onSettingsSetDefaultModel: (value: string) => void;
  onSettingsSetDefaultThinking: (level: string) => void;
  onSettingsAutoCompaction: (enabled: boolean) => void;
  onSettingsTerminalPolicy: (mode: TerminalPolicyMode) => void | Promise<void>;
  onSettingsBlockImages: (blocked: boolean) => void;
  onSettingsShowImages: (show: boolean) => void;
};

export function AppShell(props: AppShellProps) {
  const {
    // layout
    confirmPortal,
    bootSplash,
    bootSplashFading,
    density,
    theme,
    leftOpen,
    leftWidth,
    rightOpen,
    bottomOpen,
    rightWidth,
    rightPanelExpanded,
    bottomHeight,
    browserLayout,
    browserFocusComposer,
    browserFocusBottomInset,
    filesLayout,
    rightTab,
    dockTabs,
    dockAddOpen,
    centerView,
    mainView,
    settingsModalOpen,
    settingsInitialView,
    scheduleOpen,
    sessionModalOpen,
    createProjectOpen,
    projectMenuOpen,
    commandPaletteOpen,
    searchOpen,
    searchPaletteOpen,
    browserFocusMainRef,

    // session
    sessionId,
    sessionFile,
    sessionPlan,
    sessionGoal,
    sessionSurfacePending,
    isSessionStreaming,
    streamingSessionPaths,
    hasVisibleMessages,
    workspaceName,
    currentWorkspace,
    noProject,
    projectSessions,
    navProjects,
    navPinned,
    pinnedPaths,
    unreadSessionPaths,
    projectPickerItems,
    visibleSessions,
    paletteRecentSessions,
    forkingEntryId,
    activeRightPanelKey,
    loading,

    // composer
    promptRef,
    prompt,
    composerImages,
    sentImagePreviews,
    contextChips,
    queuedMessages,
    userMessageQueue,
    isComposerStreaming,
    isPromptPending,
    contextUsage,
    planEnabled,
    goalModePref,
    showPlanApproval,
    planApplyPending,
    readyPlanApprovalKey,
    terminalPolicyMode,
    terminalPolicyPending,
    currentModel,
    currentModelValue,
    currentModelLabel,
    currentThinking,
    pinnedModelCount,
    visibleModels,
    promptHistory,
    promptHistoryIndex,
    timelineFilter,
    timelineScrollRequest,
    turnDiffs,
    approvalPrompt,
    mcpElicitation,

    // panels
    filePreview,
    currentFileDir,
    turnReview,
    selectedToolId,
    previewImage,
    extensionModal,
    monacoModal,
    trustOnboardingOpen,

    // handlers
    toggleLeftPanel,
    onLeftWidthChange,
    toggleRightPanel,
    toggleBottomPanel,
    setBottomOpen,
    setBottomHeight,
    setCenterView,
    setMainView,
    setDockAddOpen,
    setScheduleOpen,
    setCommandPaletteOpen,
    setSearchOpen,
    setSearchPaletteOpen,
    setCreateProjectOpen,
    setProjectMenuOpen,
    setExtensionModal,
    setSelectedToolId,
    setPreviewImage,
    setFilePreview,
    setRightPanelTab,
    setTimelineFilter,
    setPromptHistoryIndex,
    setGoalModePref,
    setDismissedPlanApprovalKey,
    setApprovalPrompt,
    setMcpElicitation,
    setComposerImagesDraft,
    handleMenuAction,
    handleRightDragStart,
    handleRightResizeKey,
    openRightPanel,
    closeRightPanel,
    closeDockTab,
    toggleRightPanelExpanded,
    handleOpenPanel,
    applyBrowserLayout,
    applyFilesLayout,
    setBrowserFocusComposerMode,
    switchSessionFromUi,
    markSessionRead,
    togglePinSession,
    archiveSession,
    renameNavSession,
    removeWorkspaceFromNav,
    handleSelectProject,
    handleNewChatWithProjectMenu,
    handleOpenFolderNative,
    handleAddFolder,
    handleCreateProjectSkip,
    handleNewProject,
    handleQuickStart,
    handleNoProject,
    closeSessionModal,
    dismissTrustOnboarding,
    forkSessionFromMessage,
    setPromptDraft,
    submitPrompt,
    submitCurrentPrompt,
    addComposerFiles,
    handleComposerPaste,
    removeComposerImage,
    addContextChip,
    removeContextChip,
    removeQueuedUserMessage,
    routeQueuedUserMessage,
    editQueuedUserMessage,
    clearQueuedUserMessages,
    selectModel,
    resetComposerPreferences,
    openIsolatedMode,
    switchComposerMode,
    setConversationMode,
    applyReadyPlan,
    reviseReadyPlan,
    abortAgent,
    runUiCommand,
    runAwaitedUiCommand,
    runSlash,
    handlePaletteAction,
    refreshFiles,
    openFile,
    openFileInMonaco,
    revealInFileTree,
    openDiffTab,
    openTurnReview,
    closeMonacoModal,
    showToast,
    openSettingsPage,
    closeSettingsModal,
    updateDensity,
    updateTheme,
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
  } = props;

  const panelSessionKey = normalizeSessionDraftKey(sessionFile || sessionId || activeRightPanelKey || "boot");
  const [browserTabMetadata, setBrowserTabMetadata] = React.useState({ title: "Tarayıcı", url: "" });
  const [subagentRequest, setSubagentRequest] = React.useState({ sessionKey: panelSessionKey, id: "", version: 0 });
  const appGridRef = React.useRef<HTMLDivElement>(null);
  const slashAutocompleteRef = React.useRef<SlashAutocompleteHandle>(null);
  const scheduleDialogRef = useModalFocusTrap<HTMLDivElement>(scheduleOpen);
  const closeScheduleDialog = React.useCallback(() => setScheduleOpen(false), [setScheduleOpen]);
  const handleScheduleDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeScheduleDialog();
  }, [closeScheduleDialog]);
  const openSubagentWorkspace = React.useCallback((agentId: string) => {
    setSubagentRequest((current) => ({
      sessionKey: panelSessionKey,
      id: agentId,
      version: current.version + 1,
    }));
    openRightPanel("subagents");
  }, [openRightPanel, panelSessionKey]);

  // Older drag previews wrote the transient width directly onto #app. Remove
  // that override so reopening always falls back to the persisted shell width.
  React.useLayoutEffect(() => {
    appGridRef.current?.style.removeProperty("--left-sidebar-width");
  }, [leftOpen, leftWidth]);

  const handleLeftDragStart = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const app = handle.closest<HTMLElement>("#app");
    const shell = handle.closest<HTMLElement>(".app-shell");
    const startX = event.clientX;
    const startWidth = leftWidth;
    let nextWidth = startWidth;
    let collapseReady = false;
    let frame: number | undefined;

    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("panel-resize-active", "panel-resize-horizontal");

    const applyWidth = () => {
      frame = undefined;
      const previewWidth = collapseReady
        ? 0
        : Math.min(LEFT_SIDEBAR_MAX_WIDTH, Math.max(0, nextWidth));
      const value = `${Math.round(previewWidth)}px`;
      shell?.style.setProperty("--left-sidebar-preview-width", value);
    };
    const onMove = (moveEvent: PointerEvent) => {
      nextWidth = startWidth + moveEvent.clientX - startX;
      collapseReady = nextWidth <= LEFT_SIDEBAR_CLOSE_THRESHOLD;
      document.body.classList.toggle("left-sidebar-collapse-ready", collapseReady);
      if (frame === undefined) frame = window.requestAnimationFrame(applyWidth);
    };
    const cleanup = () => {
      document.body.classList.remove("panel-resize-active", "panel-resize-horizontal", "left-sidebar-collapse-ready");
      shell?.style.removeProperty("--left-sidebar-preview-width");
      app?.style.removeProperty("--left-sidebar-width");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
    };
    const onUp = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (collapseReady) {
        cleanup();
        toggleLeftPanel();
        return;
      }
      const finalWidth = clampLeftSidebarWidth(nextWidth);
      shell?.style.setProperty("--left-sidebar-width", `${finalWidth}px`);
      cleanup();
      onLeftWidthChange(finalWidth);
    };
    const onCancel = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      cleanup();
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp, { once: true });
    handle.addEventListener("pointercancel", onCancel, { once: true });
  }, [leftWidth, onLeftWidthChange, toggleLeftPanel]);

  const handleLeftResizeKey = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 20 : 8;
    let next: number | undefined;
    if (event.key === "ArrowLeft" && leftWidth <= LEFT_SIDEBAR_MIN_WIDTH) {
      event.preventDefault();
      toggleLeftPanel();
      return;
    }
    if (event.key === "ArrowLeft") next = leftWidth - step;
    else if (event.key === "ArrowRight") next = leftWidth + step;
    else if (event.key === "Home") next = LEFT_SIDEBAR_MIN_WIDTH;
    else if (event.key === "End") next = LEFT_SIDEBAR_MAX_WIDTH;
    if (next === undefined) return;
    event.preventDefault();
    onLeftWidthChange(next);
  }, [leftWidth, onLeftWidthChange, toggleLeftPanel]);

  return <ConfirmProvider>
    {confirmPortal}
    {bootSplash && (
      <SplashScreen
        fading={bootSplashFading}
      />
    )}
    <TrustOnboardingModal
      open={trustOnboardingOpen && !bootSplash}
      onDismiss={dismissTrustOnboarding}
      onOpenPermissions={() => openSettingsPage("permissions")}
    />
    <StatusNoticeHost />
    {commandPaletteOpen && <React.Suspense fallback={null}><CommandPalette
      onClose={() => setCommandPaletteOpen(false)}
      onRunCommand={runSlash}
      onOpenFile={(path) => { openRightPanel("files"); void openFile(path); }}
      onSwitchSession={(sessionPath) => switchSessionFromUi(sessionPath)}
      onSetModel={(value) => {
        const [provider, ...idParts] = value.split("/");
        selectModel(provider, idParts.join("/"));
      }}
      onAction={handlePaletteAction}
    /></React.Suspense>}
    {extensionModal && <ExtensionModal request={extensionModal} onClose={() => setExtensionModal(undefined)} />}
    {monacoModal && <MonacoModalView modal={monacoModal} onClose={closeMonacoModal} />}
    {selectedToolId && <ToolInspector
      toolId={selectedToolId}
      onClose={() => setSelectedToolId(undefined)}
      onAsk={(text) => { setPromptDraft(text); setSelectedToolId(undefined); }}
      onOpenDiff={openDiffTab}
      onAddContext={(card) => addContextChip({ type: "tool", label: card.toolName, text: toolContextText(card).slice(0, 4000) })}
    />}
    {previewImage && <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(undefined)} />}
    {searchOpen && <React.Suspense fallback={null}><SearchOverlay
      onClose={() => setSearchOpen(false)}
      onOpenFile={(path) => { openRightPanel("files"); void openFile(path); }}
      onSwitchSession={(sessionPath) => void switchSessionFromUi(sessionPath, true)}
    /></React.Suspense>}
    {searchPaletteOpen && <React.Suspense fallback={null}><CodexCommandPalette
      open={searchPaletteOpen}
      onClose={() => setSearchPaletteOpen(false)}
      recentSessions={paletteRecentSessions}
      onOpenSession={(path) => { setCenterView("chat"); void switchSessionFromUi(path, true); }}
      onNewChat={() => { void handleNewChatWithProjectMenu(); }}
      onOpenFolder={() => void handleOpenFolderNative()}
      onSettings={() => openSettingsPage()}
      onFileSearch={() => setSearchOpen(true)}
    /></React.Suspense>}
    {sessionModalOpen && <SessionPickerModal loading={loading.sessions} onClose={closeSessionModal} onSwitch={(sessionPath) => switchSessionFromUi(sessionPath, true)} />}
    <CreateProjectModal
      open={createProjectOpen}
      onClose={() => setCreateProjectOpen(false)}
      onAddFolder={() => void handleAddFolder()}
      onSkip={() => void handleCreateProjectSkip()}
    />


    <DropZone onFilesUploaded={() => void refreshFiles(currentFileDir)}>
    <div className={`app-shell ${centerView === "chat" && !hasVisibleMessages ? "new-chat" : ""}`} style={{ "--dock-w": rightOpen ? `${rightWidth}px` : "0px", "--left-sidebar-width": `${leftWidth}px`, "--active-left-sidebar-width": leftOpen ? `${leftWidth}px` : "0px" } as React.CSSProperties}>
    <Titlebar
      leftOpen={leftOpen}
      onToggleSidebar={toggleLeftPanel}
      onOpenSessions={() => setCenterView("history")}
      workspaceName={workspaceName}
      workspacePath={currentWorkspace}
      onToggleDock={toggleRightPanel}
      onToggleBottomPanel={toggleBottomPanel}
      dockOpen={rightOpen}
      bottomPanelOpen={bottomOpen}
      showPanelToggles={!settingsModalOpen && !(centerView === "chat" && !hasVisibleMessages)}
      showTimelineFade={!settingsModalOpen && centerView === "chat" && hasVisibleMessages && !(rightOpen && ((rightTab === "browser" && browserLayout === "focus") || (rightTab === "files" && filesLayout === "focus")))}
      onMenuAction={handleMenuAction}
    />
    {!(rightOpen && ((rightTab === "browser" && browserLayout === "focus") || (rightTab === "files" && filesLayout === "focus"))) && (
      <WorkspaceChrome
        rightOpen={rightOpen}
        sessionId={sessionId}
        workspaceName={workspaceName}
        workspacePath={currentWorkspace}
        plan={sessionSurfacePending ? undefined : sessionPlan}
        onToggleRight={toggleRightPanel}
        onOpenFiles={() => openRightPanel("files")}
        onOpenBrowser={() => openRightPanel("browser")}
        onOpenPlan={() => openRightPanel("plan")}
        onOpenAgents={() => openRightPanel("agents")}
        onOpenSubagent={openSubagentWorkspace}
      />
    )}
    <div ref={appGridRef} id="app" data-density={density} data-theme={theme} data-browser-layout={rightOpen && rightTab === "browser" ? browserLayout : undefined} data-browser-focus-composer={rightOpen && ((rightTab === "browser" && browserLayout === "focus") || (rightTab === "files" && filesLayout === "focus")) ? browserFocusComposer : undefined} data-files-layout={rightOpen && rightTab === "files" ? filesLayout : undefined} className={`${centerView === "chat" ? "chat-workspace" : ""} ${leftOpen ? "" : "left-collapsed"} ${rightOpen ? "" : "right-collapsed"} ${rightOpen && rightTab === "plan" ? "plan-panel-open" : ""} ${rightOpen && rightTab === "subagents" ? "subagents-layout-split" : ""} ${rightOpen && rightTab === "browser" ? `browser-layout-${browserLayout}` : ""} ${rightOpen && rightTab === "files" ? (filesLayout === "focus" ? "browser-layout-focus files-focus-workspace" : `files-layout-${filesLayout}`) : ""}`} style={{ "--dock-w": rightOpen ? `${rightWidth}px` : "0px", "--bottom-h": bottomOpen ? `${bottomHeight}px` : "0px", "--browser-composer-inset": `${browserFocusBottomInset}px` } as React.CSSProperties}> 
      <NavRail
        leftOpen={leftOpen}
        onToggle={toggleLeftPanel}
        workspaceName={workspaceName}
        workspacePath={currentWorkspace}
        onOpenWorkspace={() => void handleOpenFolderNative()}
        onOpenProjects={() => setCenterView("projects")}
        onNewChat={() => { void handleNewChatWithProjectMenu(); }}
        onSearch={() => setCenterView("history")}
        onScheduled={() => setCenterView("scheduled")}
        onExtensions={() => setCenterView("extensions")}
        onSettings={() => openSettingsPage()}
        onOpenSessions={() => setCenterView("history")}
        sessions={projectSessions as any}
        projects={navProjects as any}
        activeCwd={currentWorkspace}
        activeSessionId={sessionId}
        activeSessionFile={sessionFile}
        activeSessionStreaming={isSessionStreaming}
        streamingSessionPaths={streamingSessionPaths}
        onSwitchSession={(path) => { markSessionRead(path); setCenterView("chat"); void switchSessionFromUi(path, true); }}
        activeView={searchPaletteOpen ? "search" : centerView}
        pinned={navPinned}
        pinnedPaths={pinnedPaths}
        onPinSession={togglePinSession}
        onArchiveSession={archiveSession}
        onRenameSession={renameNavSession}
        unreadSessionPaths={unreadSessionPaths}
        onRemoveProject={removeWorkspaceFromNav}
      />
      {leftOpen && (
        <div
          className="left-resize-handle"
          onPointerDown={handleLeftDragStart}
          onDoubleClick={() => onLeftWidthChange(LEFT_SIDEBAR_DEFAULT_WIDTH)}
          onKeyDown={handleLeftResizeKey}
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={LEFT_SIDEBAR_MIN_WIDTH}
          aria-valuemax={LEFT_SIDEBAR_MAX_WIDTH}
          aria-valuenow={Math.round(leftWidth)}
          aria-label="Sol kenar çubuğunu yeniden boyutlandır; sola sürükleyerek kapat"
          title="Sola sürükleyerek kapat · çift tıklayarak sıfırla"
          tabIndex={0}
        />
      )}
      <main ref={browserFocusMainRef} className={`main ${centerView === "chat" ? (hasVisibleMessages ? "chat-active" : "empty-chat") : "page-view"}`}>
        {hasVisibleMessages && centerView === "chat" && <SecurityBanner onOpenSettings={() => openSettingsPage()} />}
        {centerView === "projects" ? (
          <React.Suspense fallback={<div className="panel-loading" style={{display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>Yükleniyor…</div>}>
            <WorkspaceDashboard
              projects={projectPickerItems}
              sessions={visibleSessions as any}
              activePath={currentWorkspace}
              lastSessionByWorkspace={readLastSessionByWorkspace()}
              onAdd={() => void handleOpenFolderNative()}
              onOpen={(path) => { void handleSelectProject(path); }}
              onRemove={removeWorkspaceFromNav}
              onOpenSession={(path) => { setCenterView("chat"); void switchSessionFromUi(path, true); }}
              onNewChat={(path) => { void handleSelectProject(path); }}
            />
          </React.Suspense>
        ) : centerView === "history" ? (
          <React.Suspense fallback={<div className="panel-loading" style={{display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>Yükleniyor…</div>}>
            <ConversationHistoryPage
              sessions={visibleSessions as any}
              activeSessionId={sessionId}
              workspaceName={workspaceName}
              onOpenSession={(path) => { setCenterView("chat"); void switchSessionFromUi(path, true); }}
            />
          </React.Suspense>
        ) : centerView === "scheduled" ? (
          <React.Suspense fallback={<div className="panel-loading" style={{display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>Yükleniyor…</div>}>
            <SchedulePage
              onCreateWithChat={() => { void handleNewChatWithProjectMenu(); }}
            />
          </React.Suspense>
        ) : centerView === "extensions" ? (
          <React.Suspense fallback={<div className="panel-loading" style={{display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>Yükleniyor…</div>}>
            <ExtensionsPage
              onTryInChat={(name) => { setCenterView("chat"); setPromptDraft(`/desktop ${name} görevi`); promptRef.current?.focus(); }}
              onInstall={() => undefined}
              onOpenSettings={() => openSettingsPage("customizations")}
            />
          </React.Suspense>
        ) : <>
        {mainView.mode !== "chat" ? <MainEditorView view={mainView} onBack={() => setMainView({ mode: "chat" })} /> : <>
        {hasVisibleMessages && (
          <LiveTimeline
            imageAttachments={sentImagePreviews}
            filter={timelineFilter}
            onFilterChange={setTimelineFilter}
            conversationKey={sessionId}
            scrollRequest={timelineScrollRequest}
            pendingMessages={userMessageQueue}
            onRemovePending={removeQueuedUserMessage}
            onSendPending={(item) => void routeQueuedUserMessage(item)}
            onInspectTool={setSelectedToolId}
            onOpenFile={(path) => { openRightPanel("files"); void openFile(path); }}
            onOpenDiff={openDiffTab}
            onReviewTurn={openTurnReview}
            onToast={showToast}
            onPreviewImage={setPreviewImage}
            onOpenPlan={() => openRightPanel("plan")}
            onForkFromMessage={(entryId) => void forkSessionFromMessage(entryId)}
            forkingEntryId={forkingEntryId}
            plan={sessionSurfacePending ? undefined : sessionPlan}
            compactOverlay={rightOpen && ((rightTab === "browser" && browserLayout === "focus") || (rightTab === "files" && filesLayout === "focus")) && browserFocusComposer === "open"}
            turnDiff={turnDiffs.latest}
            turnDiffsByTurn={turnDiffs}
          />
        )}
        <SlashAutocomplete
          ref={slashAutocompleteRef}
          prompt={prompt}
          inputRef={promptRef}
          onPick={(command) => {
            setPromptHistoryIndex(undefined);
            setPromptDraft(command);
          }}
        />
        <ContextChips chips={contextChips} onRemove={removeContextChip} />
        <PlanQuestionsPanel
          clarification={sessionSurfacePending ? undefined : sessionPlan?.clarification}
          onComplete={(args) =>
            runAwaitedUiCommand(
              {
                type: "plan_clarification_complete",
                requestId: args.requestId,
                clarificationId: args.clarificationId,
                answers: args.answers,
              },
              "Plan netleştirme tamamlanamadı",
            )
          }
          onSkip={(args) =>
            runAwaitedUiCommand(
              { type: "plan_clarification_skip", requestId: args.requestId, clarificationId: args.clarificationId },
              "Plan netleştirme atlanamadı",
            )
          }
        />
        <div className={`composer-shell ${hasVisibleMessages ? "" : "is-empty"}`}>
        <GoalPanel
          goal={sessionGoal}
          onPause={() => void runUiCommand({ type: "goal_pause" }, "Goal duraklatılamadı")}
          onResume={() => void runUiCommand({ type: "goal_resume" }, "Goal sürdürülemedi")}
          onCancel={() => void runUiCommand({ type: "goal_cancel" }, "Goal iptal edilemedi")}
          onEdit={(objective) => {
            setGoalModePref(true);
            setConversationMode("execute");
            setPromptDraft(objective);
            try { promptRef.current?.focus(); } catch { /* ignore */ }
          }}
        />
        {!hasVisibleMessages && (
          <div className="empty-composer-project">
            <ProjectPicker
              open={projectMenuOpen}
              onClose={() => setProjectMenuOpen(false)}
              onToggle={() => setProjectMenuOpen((v) => !v)}
              projects={projectPickerItems}
              activePath={currentWorkspace}
              noProject={noProject}
              label={workspaceName}
              onSelectProject={(path) => void handleSelectProject(path)}
              onNewProject={handleNewProject}
              onQuickStart={() => void handleQuickStart()}
              onNoProject={() => void handleNoProject()}
            />
          </div>
        )}
        {showPlanApproval && (
          <PlanApprovalCard
            pending={planApplyPending}
            onApply={() => void applyReadyPlan()}
            onRevise={reviseReadyPlan}
            onDismiss={() => setDismissedPlanApprovalKey(readyPlanApprovalKey)}
          />
        )}
        {mcpElicitation ? (
          <McpElicitationCard
            id={mcpElicitation.id}
            serverName={mcpElicitation.serverName}
            mode={mcpElicitation.mode}
            message={mcpElicitation.message}
            fields={mcpElicitation.fields}
            url={mcpElicitation.url}
            onRespond={(result) => {
              const requestId = mcpElicitation.id;
              setMcpElicitation(null);
              void runUiCommand(
                {
                  type: "mcp_elicitation_respond",
                  requestId,
                  action: result.action,
                  content: result.content,
                },
                "MCP bilgi yanıtı gönderilemedi",
              );
            }}
          />
        ) : approvalPrompt ? (
          <ComposerApproval
            id={approvalPrompt.id}
            tool={approvalPrompt.tool}
            summary={approvalPrompt.summary}
            command={approvalPrompt.command}
            reason={approvalPrompt.reason}
            risk={approvalPrompt.risk}
            presetLabel={approvalPrompt.presetLabel}
            fileChange={approvalPrompt.fileChange}
            proposedExecpolicyAmendment={approvalPrompt.proposedExecpolicyAmendment}
            networkApprovalContext={approvalPrompt.networkApprovalContext}
            proposedNetworkPolicyAmendments={approvalPrompt.proposedNetworkPolicyAmendments}
            kind={approvalPrompt.kind}
            mcp={approvalPrompt.mcp}
            onDecide={(payload: ApprovalDecidePayload) => {
              const requestId = approvalPrompt.id;
              setApprovalPrompt(null);
              void runUiCommand(
                {
                  type: "approval_respond",
                  requestId,
                  decision: payload.decision,
                  execpolicyAmendment: payload.execpolicyAmendment,
                  networkPolicyAmendment: payload.networkPolicyAmendment,
                  scope: payload.scope,
                },
                "Onay yanıtı gönderilemedi",
              );
            }}
          />
        ) : (
        <ChatComposer
          promptRef={promptRef}
          prompt={prompt}
          hasVisibleMessages={hasVisibleMessages}
          images={composerImages}
          contextCount={contextChips.filter((chip) => chip.type !== "annotation").length}
          queuedMessages={queuedMessages}
          localQueue={userMessageQueue}
          agentBusy={isComposerStreaming}
          promptPending={isPromptPending}
          contextUsage={contextUsage}
          planActive={planEnabled}
          plan={sessionPlan}
          goalActive={goalModePref || Boolean(sessionGoal && !["completed", "failed", "cancelled"].includes(sessionGoal.status))}
          terminalPolicyMode={terminalPolicyMode}
          terminalPolicyPending={terminalPolicyPending}
          onSetTerminalPolicy={onSettingsTerminalPolicy}
          currentModel={currentModel as any}
          currentModelValue={currentModelValue}
          currentModelLabel={currentModelLabel}
          currentThinking={currentThinking}
          pinnedModelCount={pinnedModelCount}
          visibleModels={visibleModels as any[]}
          onSubmit={submitPrompt}
          onSubmitCurrent={() => void submitCurrentPrompt()}
          onPromptChange={setPromptDraft}
          onPromptPaste={handleComposerPaste}
          onAddFiles={addComposerFiles}
          onPromptKeyDown={(event) => {
            if (slashAutocompleteRef.current?.handleKeyDown(event)) return;
            if (event.key === "ArrowUp" && !prompt.trim() && promptHistory.length) { event.preventDefault(); setPromptHistoryIndex(0); setPromptDraft(promptHistory[0]); }
            if (event.key === "ArrowUp" && promptHistoryIndex !== undefined) { event.preventDefault(); const next = Math.min(promptHistoryIndex + 1, promptHistory.length - 1); setPromptHistoryIndex(next); setPromptDraft(promptHistory[next] || ""); }
            if (event.key === "ArrowDown" && promptHistoryIndex !== undefined) { event.preventDefault(); const next = promptHistoryIndex - 1; setPromptHistoryIndex(next >= 0 ? next : undefined); setPromptDraft(next >= 0 ? promptHistory[next] || "" : ""); }
          }}
          onOpenFiles={() => openRightPanel("files")}
          onOpenPlan={() => handleOpenPanel("plan")}
          onPreviewImage={setPreviewImage}
          onRemoveImage={removeComposerImage}
          onSetMode={(mode) => {
            if (mode === "goal") {
              void openIsolatedMode("goal");
              return;
            }
            if (mode === "plan") {
              void openIsolatedMode("plan");
              return;
            }
            // Agent / execute — exit modes on this chat (no new session).
            setGoalModePref(false);
            void switchComposerMode("execute");
          }}
          onDismissPlan={() => {
            // Stay on isolated plan chat; only leave plan mode.
            setGoalModePref(false);
            void switchComposerMode("execute");
          }}
          onDismissGoal={() => {
            // Stay on isolated goal chat; cancel goal + leave goal pref.
            setGoalModePref(false);
            const status = sessionGoal?.status;
            if (status && !["completed", "failed", "cancelled"].includes(status)) {
              void runUiCommand({ type: "goal_cancel" }, "Goal iptal edilemedi");
            }
            void switchComposerMode("execute");
          }}
          onSetThinking={(level) => runUiCommand({ type: "set_thinking_level", level }, "Çaba seviyesi değiştirilemedi")}
          onSelectModel={selectModel}
          onResetPreferences={resetComposerPreferences}
          onAbort={() => void abortAgent()}
          onSendQueued={(item) => void routeQueuedUserMessage(item)}
          onEditQueued={editQueuedUserMessage}
          onRemoveQueued={removeQueuedUserMessage}
          onClearQueue={clearQueuedUserMessages}
          onCopyQueued={(text) => copyTextWithToast(text, "Mesaj kopyalandı")}
          formatModelLabel={formatComposerModelLabel}
          formatThinkingLabel={thinkingLabel}
          compact={rightOpen && ((rightTab === "browser" && browserLayout === "focus") || (rightTab === "files" && filesLayout === "focus")) && browserFocusComposer === "mini"}
        />
        )}
        </div>
        </>}
        </>}
      </main>
      {rightOpen && <div className="right-resize-handle" onPointerDown={handleRightDragStart} onKeyDown={handleRightResizeKey} role="separator" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={Math.max(320, window.innerWidth - 360)} aria-valuenow={Math.round(rightWidth)} aria-label="Sağ paneli yeniden boyutlandır (ok tuşları)" tabIndex={0} />}
      <aside className="rightbar" data-active-panel={rightTab} aria-hidden={!rightOpen}>
        <RightPanelTabs active={rightTab} tabs={dockTabs} addOpen={dockAddOpen} launcherExpanded={rightPanelExpanded} browserLayout={browserLayout} browserFocusComposer={browserFocusComposer} browserTitle={browserTabMetadata.title} browserUrl={browserTabMetadata.url} filesLayout={filesLayout} onClose={closeRightPanel} onCloseTab={closeDockTab} onToggleAdd={() => setDockAddOpen((value) => !value)} onToggleLauncherExpand={toggleRightPanelExpanded} onChange={(tab) => { setDockAddOpen(false); handleOpenPanel(tab); }} onBrowserLayout={applyBrowserLayout} onBrowserFocusComposer={setBrowserFocusComposerMode} onFilesLayout={applyFilesLayout} />
        {rightTab === "launcher" && <QuickLauncher variant="panel" onOpen={(panel) => handleOpenPanel(panel)} />}
        {rightTab === "files" && <div className={`files-workbench ${filePreview.path ? "has-preview" : ""}`}><div className="files-workbench-preview"><PreviewPanel filePreview={filePreview} onClose={() => setFilePreview({ content: "Dosya seçilmedi" })} onOpen={() => setMainView({ mode: "editor", title: filePreview.path || "Dosya önizleme", path: filePreview.path, content: filePreview.content })} /></div><div className="files-workbench-tree"><React.Suspense fallback={<div className="panel-loading">Yükleniyor…</div>}><FilesPanel key={`${normalizeClientPath(currentWorkspace || "workspace")}::${panelSessionKey}`} workspaceKey={normalizeClientPath(currentWorkspace || "workspace")} sessionKey={panelSessionKey} loading={loading.files} currentFileDir={currentFileDir} onOpenDir={refreshFiles} onOpenFile={openFile} onOpenMonaco={openFileInMonaco} onReveal={revealInFileTree} onAskFile={(path) => { setPromptDraft(`Bu dosyayı incele ve önemli noktaları açıkla: ${path}`); requestAnimationFrame(() => promptRef.current?.focus()); }} onSummarizeFile={(path) => { setPromptDraft(`Bu dosyayı kısa ve teknik şekilde özetle: ${path}`); requestAnimationFrame(() => promptRef.current?.focus()); }} onCopyPath={(path) => copyTextWithToast(path, "Yol kopyalandı")} onAddContext={(path, type) => {
          if (type === "directory") {
            addContextChip({ type: "file", label: path, text: `Klasör bağlamı: ${path}` });
            showToast("Klasör bağlama eklendi", "success");
            return;
          }
          void apiGet<any>(`/api/file?path=${encodeURIComponent(path)}`).then((file) => {
            addContextChip({ type: "file", label: path, text: String(file.content || "").slice(0, 12000) });
            showToast("Dosya bağlama eklendi", "success");
          }).catch((error) => showToast(`Dosya bağlama eklenemedi: ${error.message}`, "error"));
        }} /></React.Suspense></div></div>}
        {rightTab === "preview" && <PreviewPanel filePreview={filePreview} onClose={() => { setFilePreview({ content: "Dosya seçilmedi" }); setRightPanelTab("files"); }} onOpen={() => setMainView({ mode: "editor", title: filePreview.path || "Dosya önizleme", path: filePreview.path, content: filePreview.content })} />}
        {rightTab === "mobile" && <React.Suspense fallback={<div className="panel-loading">Mobile Studio yükleniyor…</div>}><MobileStudioPanel key={panelSessionKey} sessionKey={panelSessionKey} /></React.Suspense>}
        {rightTab === "plan" && !sessionSurfacePending && sessionPlan && <PlanArtifactPanel plan={sessionPlan} onClose={() => closeDockTab("plan")} onOpenFile={(path) => { openRightPanel("files"); void openFile(path); }} />}
        {rightTab === "sidechat" && (
          <React.Suspense fallback={<div className="panel-loading">Yan sohbet yükleniyor…</div>}>
            <SideConversationPanel
              key={panelSessionKey}
              parentSessionPath={sessionFile}
              workspaceName={workspaceName}
              currentModelValue={currentModelValue}
              currentModelLabel={currentModelLabel}
              currentThinking={currentThinking}
              models={visibleModels}
              onOpenFiles={() => openRightPanel("files")}
              onOpenFile={(path) => { openRightPanel("files"); void openFile(path); }}
              onToast={showToast}
            />
          </React.Suspense>
        )}
        {rightTab === "subagents" && <React.Suspense fallback={<div className="panel-loading">Subagent çalışma alanı yükleniyor…</div>}><SubagentWorkspace key={panelSessionKey} sessionId={sessionId} requestedAgentId={subagentRequest.sessionKey === panelSessionKey ? subagentRequest.id : undefined} requestVersion={subagentRequest.version} onOpenFiles={() => openRightPanel("files")} onOpenFile={(path) => { openRightPanel("files"); void openFile(path); }} onOpenAgents={() => openRightPanel("agents")} onToast={showToast} /></React.Suspense>}
        {rightTab === "agents" && <AgentsPanel />}
        {rightTab === "review" && turnReview && <TurnReviewPanel review={turnReview} onOpenFile={(path) => { openRightPanel("files"); void openFile(path); }} onToast={showToast} />}
        {rightTab === "browser" && <React.Suspense fallback={<div className="panel-loading">Yükleniyor…</div>}><BrowserPanel key={panelSessionKey} sessionKey={panelSessionKey} chromeMenuOpen={dockAddOpen} onMetadataChange={setBrowserTabMetadata} onAnnotationBundle={(bundle) => {
          const bundleId = `browser-annotations:${bundle.url}`;
          setComposerImagesDraft((current) => [
            ...current.filter((image) => image.annotationBundleId !== bundleId),
            { ...bundle.image, id: bundleId, annotationBundleId: bundleId, annotationCount: bundle.annotations.length },
          ].slice(-6));
          showToast(`${bundle.annotations.length} açıklama composer'a eklendi`, "success");
          requestAnimationFrame(() => promptRef.current?.focus());
        }} /></React.Suspense>}
        {extensionModal &&<div className="panel"><div className="panel-title">Eklenti arayüzü</div><ExtensionRenderer type={extensionModal.method || "confirm"} props={extensionModal} requestId={extensionModal.id} /></div>}
      </aside>
      <div className="bottom-dock">
        <BottomPanel open={bottomOpen} onClose={() => setBottomOpen(false)} height={bottomHeight} onHeightChange={(h) => { setBottomHeight(h); writeStorageValue("quake-web:bottomHeight", String(Math.round(h))); }}>
          <React.Suspense fallback={<div className="panel-loading">Terminal yükleniyor…</div>}><XtermTerminal onAsk={(text) => { setPromptDraft(text); requestAnimationFrame(() => promptRef.current?.focus()); }} onAddContext={(context) => { addContextChip({ type: "terminal", label: context.label, text: context.text }); showToast("Terminal çıktısı bağlama eklendi", "success"); }} /></React.Suspense>
        </BottomPanel>
      </div>
    </div>
    {scheduleOpen && <div ref={scheduleDialogRef} role="dialog" aria-modal="true" aria-labelledby="schedule-dialog-title" tabIndex={-1} onKeyDown={handleScheduleDialogKeyDown} style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <h2 id="schedule-dialog-title" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>Zamanlananlar</h2>
      <div role="presentation" onClick={closeScheduleDialog} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} />
      <div style={{ position: "relative", width: "min(720px, 100%)", height: "min(80vh, 720px)", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-card)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <React.Suspense fallback={<div className="panel-loading">Yükleniyor…</div>}><SchedulePanel onClose={closeScheduleDialog} /></React.Suspense>
      </div>
    </div>}
    {settingsModalOpen && (
      <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSettingsModal(); }}>
        <div
          className="settings-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Ayarlar"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <React.Suspense fallback={<div className="panel-loading" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40, width: "100%" }}>Yükleniyor…</div>}>
            <SettingsPage
              layout="modal"
              density={density}
              theme={theme}
              initialView={settingsInitialView}
              onDensity={updateDensity}
              onTheme={updateTheme}
              onClose={closeSettingsModal}
              onThinking={onSettingsThinking}
              onSetModel={onSettingsSetModel}
              onOpenWorkspace={onSettingsOpenWorkspace}
              onCompact={onSettingsCompact}
              onClearPromptHistory={onSettingsClearPromptHistory}
              onSetDefaultModel={onSettingsSetDefaultModel}
              onSetDefaultThinking={onSettingsSetDefaultThinking}
              onAutoCompaction={onSettingsAutoCompaction}
              onTerminalPolicy={onSettingsTerminalPolicy}
              onBlockImages={onSettingsBlockImages}
              onShowImages={onSettingsShowImages}
            />
          </React.Suspense>
        </div>
      </div>
    )}
    </div>
    </DropZone>
  </ConfirmProvider>;
}
