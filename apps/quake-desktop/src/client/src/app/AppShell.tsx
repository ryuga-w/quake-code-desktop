import React from "react";
import { PanelLeft } from "lucide-react";
import type { WebContextUsage, WebGoalState, WebPlanState } from "../../../shared/protocol";
import { apiGet } from "../lib/api";
import { normalizeSessionDraftKey } from "../lib/client-ids";
import { copyTextWithToast } from "../lib/copy-toast";
import { formatComposerModelLabel, thinkingLabel } from "../lib/format-utils";
import { normalizeClientPath } from "../lib/path-utils";
import { normalizeSessionMetadataPath } from "./conversation-navigation";
import { useI18n } from "../i18n";
import {
  getLeftSidebarSnapWidth,
  isLeftSidebarSize,
  nearestLeftSidebarSize,
  nextLeftSidebarSize,
  LEFT_SIDEBAR_MIN_WIDTH,
  LEFT_SIDEBAR_SIZES,
  type LeftSidebarSize,
} from "../lib/layout-sizing";
import { useModalFocusTrap } from "../lib/modal-focus";
import { readLastSessionByWorkspace } from "../lib/session-projects";
import { readStorageValue, writeStorageValue } from "../lib/storage";
import { toolContextText } from "../lib/tool-helpers";
import type { ToolCardState } from "../state/app-store";
import type {
  ComposerImage,
  DockTab,
  MainView,
  ModalRequest,
  MonacoModal,
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
import { ComposerMentionMenu, type ComposerMentionMenuHandle } from "../components/composer/ComposerMentionMenu";
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
import { ConversationHeader } from "../components/shell/ConversationHeader";
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
const FILES_TREE_MIN_WIDTH = 145;
const FILES_TREE_MAX_WIDTH = 420;
const FILES_TREE_DEFAULT_WIDTH = 190;
export type AppShellBrowserLayout = "dock" | "split" | "focus";
export type AppShellBrowserFocusComposer = "hidden" | "mini" | "open";
export type AppShellFilesLayout = "dock" | "split" | "focus";

function viewportWidth(): number {
  return typeof window === "undefined" ? 1440 : Math.max(1, window.innerWidth);
}

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
  userMessageQueue: QueuedUserMessage[];
  isComposerStreaming: boolean;
  isPromptPending: boolean;
  isCompacting: boolean;
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
    userMessageQueue,
    isComposerStreaming,
    isPromptPending,
    isCompacting,
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
  const { t } = useI18n();

  const panelSessionKey = normalizeSessionDraftKey(sessionFile || sessionId || activeRightPanelKey || "boot");
  const [browserTabMetadata, setBrowserTabMetadata] = React.useState({ title: "", url: "" });
  const [subagentRequest, setSubagentRequest] = React.useState({ sessionKey: panelSessionKey, id: "", version: 0 });
  const appGridRef = React.useRef<HTMLDivElement>(null);
  const filesWorkbenchRef = React.useRef<HTMLDivElement>(null);
  const slashAutocompleteRef = React.useRef<SlashAutocompleteHandle>(null);
  const mentionMenuRef = React.useRef<ComposerMentionMenuHandle>(null);
  const leftSidebarPeekCloseTimerRef = React.useRef<number | undefined>(undefined);
  const [appViewportWidth, setAppViewportWidth] = React.useState(viewportWidth);
  const [leftSidebarPeekOpen, setLeftSidebarPeekOpen] = React.useState(false);
  const [leftSidebarSize, setLeftSidebarSize] = React.useState<LeftSidebarSize>(() => {
    const stored = readStorageValue("quake-web:leftSidebarSize");
    return isLeftSidebarSize(stored)
      ? stored
      : nearestLeftSidebarSize(leftWidth, viewportWidth());
  });
  const [filesTreeOpen, setFilesTreeOpen] = React.useState(() => readStorageValue("quake-web:filesTreeOpen", "1") !== "0");
  const [filesTreeWidth, setFilesTreeWidth] = React.useState(() => {
    const stored = Number(readStorageValue("quake-web:filesTreeWidth", String(FILES_TREE_DEFAULT_WIDTH)));
    return Math.min(FILES_TREE_MAX_WIDTH, Math.max(FILES_TREE_MIN_WIDTH, Number.isFinite(stored) ? stored : FILES_TREE_DEFAULT_WIDTH));
  });
  const leftSidebarWidth = getLeftSidebarSnapWidth(leftSidebarSize, appViewportWidth);
  const setPersistedLeftSidebarSize = React.useCallback((size: LeftSidebarSize) => {
    setLeftSidebarSize(size);
    writeStorageValue("quake-web:leftSidebarSize", size);
    onLeftWidthChange(getLeftSidebarSnapWidth(size, appViewportWidth));
  }, [appViewportWidth, onLeftWidthChange]);
  const cycleLeftSidebarSize = React.useCallback(() => {
    setPersistedLeftSidebarSize(nextLeftSidebarSize(leftSidebarSize));
  }, [leftSidebarSize, setPersistedLeftSidebarSize]);
  const cancelLeftSidebarPeekClose = React.useCallback(() => {
    if (leftSidebarPeekCloseTimerRef.current === undefined) return;
    window.clearTimeout(leftSidebarPeekCloseTimerRef.current);
    leftSidebarPeekCloseTimerRef.current = undefined;
  }, []);
  const revealLeftSidebarPeek = React.useCallback(() => {
    cancelLeftSidebarPeekClose();
    if (!leftOpen) setLeftSidebarPeekOpen(true);
  }, [cancelLeftSidebarPeekClose, leftOpen]);
  const scheduleLeftSidebarPeekClose = React.useCallback(() => {
    cancelLeftSidebarPeekClose();
    if (leftOpen) return;
    leftSidebarPeekCloseTimerRef.current = window.setTimeout(() => {
      leftSidebarPeekCloseTimerRef.current = undefined;
      setLeftSidebarPeekOpen(false);
    }, 180);
  }, [cancelLeftSidebarPeekClose, leftOpen]);
  React.useEffect(() => {
    if (leftOpen) setLeftSidebarPeekOpen(false);
    return cancelLeftSidebarPeekClose;
  }, [cancelLeftSidebarPeekClose, leftOpen]);
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
  const activeConversationSession = React.useMemo(() => {
    const activePath = normalizeSessionMetadataPath(sessionFile || "");
    return visibleSessions.find((session) => {
      if (sessionId && String(session?.id || "") === String(sessionId)) return true;
      return activePath && normalizeSessionMetadataPath(String(session?.path || "")) === activePath;
    }) || {
      id: sessionId,
      path: sessionFile,
      name: workspaceName ? `${workspaceName} sohbeti` : "Sohbet",
      firstMessage: "Sohbet",
    };
  }, [sessionFile, sessionId, visibleSessions, workspaceName]);
  const activeConversationPinned = pinnedPaths.has(
    normalizeSessionMetadataPath(String(activeConversationSession?.path || "")),
  );

  const toggleFilesTree = React.useCallback(() => {
    setFilesTreeOpen((current) => {
      const next = !current;
      writeStorageValue("quake-web:filesTreeOpen", next ? "1" : "0");
      return next;
    });
  }, []);

  const closeFilePreview = React.useCallback(() => {
    setFilePreview({ content: t("runtime.shell.fileNotSelected") });
    if (typeof window !== "undefined" && window.innerWidth <= 640) {
      setFilesTreeOpen(true);
      writeStorageValue("quake-web:filesTreeOpen", "1");
    }
  }, [setFilePreview, t]);

  const openArtifactTemplateSkill = React.useCallback(async (skillName: string) => {
    try {
      const skill = await apiGet<{ path: string; content: string }>(
        `/api/artifact-templates/skill?id=${encodeURIComponent(skillName)}`,
      );
      setFilePreview({ path: skill.path, content: skill.content });
      openRightPanel("files");
    } catch (error: any) {
      showToast(t("runtime.shell.templateOpenFailed", { error: error?.message || t("runtime.app.unknownError") }), "error");
    }
  }, [openRightPanel, setFilePreview, showToast, t]);

  React.useEffect(() => {
    if (!filePreview.path || typeof window === "undefined" || window.innerWidth > 640) return;
    setFilesTreeOpen(false);
  }, [filePreview.path]);

  const clampFilesTreeWidth = React.useCallback((value: number) => {
    const available = filesWorkbenchRef.current?.clientWidth || window.innerWidth;
    const maximum = Math.min(FILES_TREE_MAX_WIDTH, Math.max(FILES_TREE_MIN_WIDTH, available - 240));
    return Math.min(maximum, Math.max(FILES_TREE_MIN_WIDTH, value));
  }, []);

  const handleFilesTreeResizeStart = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = filesTreeWidth;
    let nextWidth = startWidth;
    let frame: number | undefined;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("panel-resize-active", "panel-resize-horizontal");

    const applyWidth = () => {
      frame = undefined;
      filesWorkbenchRef.current?.style.setProperty("--files-tree-width", `${Math.round(nextWidth)}px`);
    };
    const onMove = (moveEvent: PointerEvent) => {
      nextWidth = clampFilesTreeWidth(startWidth + startX - moveEvent.clientX);
      if (frame === undefined) frame = window.requestAnimationFrame(applyWidth);
    };
    const cleanup = () => {
      document.body.classList.remove("panel-resize-active", "panel-resize-horizontal");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
    };
    const commit = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      applyWidth();
      setFilesTreeWidth(nextWidth);
      writeStorageValue("quake-web:filesTreeWidth", String(Math.round(nextWidth)));
      cleanup();
    };
    const onUp = () => commit();
    const onCancel = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      filesWorkbenchRef.current?.style.setProperty("--files-tree-width", `${Math.round(startWidth)}px`);
      cleanup();
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp, { once: true });
    handle.addEventListener("pointercancel", onCancel, { once: true });
  }, [clampFilesTreeWidth, filesTreeWidth]);

  const handleFilesTreeResizeKey = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 12;
    let next: number | undefined;
    if (event.key === "ArrowLeft") next = filesTreeWidth + step;
    else if (event.key === "ArrowRight") next = filesTreeWidth - step;
    else if (event.key === "Home") next = FILES_TREE_MIN_WIDTH;
    else if (event.key === "End") next = FILES_TREE_MAX_WIDTH;
    if (next === undefined) return;
    event.preventDefault();
    const clamped = clampFilesTreeWidth(next);
    setFilesTreeWidth(clamped);
    writeStorageValue("quake-web:filesTreeWidth", String(Math.round(clamped)));
  }, [clampFilesTreeWidth, filesTreeWidth]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const syncViewportWidth = () => setAppViewportWidth(viewportWidth());
    window.addEventListener("resize", syncViewportWidth);
    return () => window.removeEventListener("resize", syncViewportWidth);
  }, []);

  React.useEffect(() => {
    if (leftWidth !== leftSidebarWidth) onLeftWidthChange(leftSidebarWidth);
  }, [leftSidebarSize, leftSidebarWidth, leftWidth, onLeftWidthChange]);

  // Bildirim aksiyon butonlari: "Sohbete don" -> chat gorunumu; "Yanit gonder" ->
  // chat gorunumu + composer'a odaklan (kullanici hemen yazmaya baslasin).
  React.useEffect(() => {
    const api = (window as unknown as { quakeDesktop?: { onNotificationAction?: (cb: (p: { action: "open-chat" | "reply" }) => void) => () => void } }).quakeDesktop;
    if (!api?.onNotificationAction) return;
    const unsubscribe = api.onNotificationAction(({ action }) => {
      setCenterView("chat");
      if (action === "reply") {
        requestAnimationFrame(() => {
          try { promptRef.current?.focus(); } catch { /* ignore */ }
        });
      }
    });
    return unsubscribe;
  }, [setCenterView, promptRef]);

  // Older drag previews wrote the transient width directly onto #app. Remove
  // that override so reopening always falls back to the persisted shell width.
  React.useLayoutEffect(() => {
    appGridRef.current?.style.removeProperty("--left-sidebar-width");
  }, [leftOpen, leftSidebarWidth]);

  const handleLeftDragStart = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const app = handle.closest<HTMLElement>("#app");
    const shell = handle.closest<HTMLElement>(".app-shell");
    const startX = event.clientX;
    const startWidth = leftSidebarWidth;
    let nextWidth = startWidth;
    let nextSize: LeftSidebarSize = "quarter";
    let frame: number | undefined;

    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("panel-resize-active", "panel-resize-horizontal");

    const applyWidth = () => {
      frame = undefined;
      const previewWidth = Math.min(
        getLeftSidebarSnapWidth("half", appViewportWidth),
        Math.max(LEFT_SIDEBAR_MIN_WIDTH, nextWidth),
      );
      const value = `${Math.round(previewWidth)}px`;
      shell?.style.setProperty("--left-sidebar-preview-width", value);
    };
    const onMove = (moveEvent: PointerEvent) => {
      nextWidth = startWidth + moveEvent.clientX - startX;
      // Resizing is bounded to the compact reference width; dragging cannot
      // promote the rail into a half/full-screen panel.
      nextSize = "quarter";
      if (frame === undefined) frame = window.requestAnimationFrame(applyWidth);
    };
    const cleanup = () => {
      document.body.classList.remove("panel-resize-active", "panel-resize-horizontal");
      shell?.style.removeProperty("--left-sidebar-preview-width");
      app?.style.removeProperty("--left-sidebar-width");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
    };
    const onUp = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      cleanup();
      setPersistedLeftSidebarSize(nextSize);
    };
    const onCancel = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      cleanup();
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp, { once: true });
    handle.addEventListener("pointercancel", onCancel, { once: true });
  }, [appViewportWidth, leftSidebarSize, leftSidebarWidth, setPersistedLeftSidebarSize, toggleLeftPanel]);

  const handleLeftResizeKey = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = LEFT_SIDEBAR_SIZES.indexOf(leftSidebarSize);
    if (event.key === "ArrowLeft" && currentIndex === 0) {
      event.preventDefault();
      toggleLeftPanel();
      return;
    }
    let nextSize: LeftSidebarSize | undefined;
    if (event.key === "ArrowLeft") nextSize = LEFT_SIDEBAR_SIZES[Math.max(0, currentIndex - 1)];
    else if (event.key === "ArrowRight") nextSize = LEFT_SIDEBAR_SIZES[Math.min(LEFT_SIDEBAR_SIZES.length - 1, currentIndex + 1)];
    else if (event.key === "Home") nextSize = "quarter";
    else if (event.key === "End") nextSize = "quarter";
    if (!nextSize) return;
    event.preventDefault();
    setPersistedLeftSidebarSize(nextSize);
  }, [leftSidebarSize, setPersistedLeftSidebarSize, toggleLeftPanel]);

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
    <div className={`app-shell ${centerView === "chat" && !hasVisibleMessages ? "new-chat" : ""}`} style={{ "--dock-w": rightOpen ? `${rightWidth}px` : "0px", "--left-sidebar-width": `${leftSidebarWidth}px`, "--active-left-sidebar-width": leftOpen ? `${leftSidebarWidth}px` : "0px" } as React.CSSProperties}>
    <button
      type="button"
      className="fixed-sidebar-toggle-btn"
      onClick={toggleLeftPanel}
      aria-label={leftOpen ? t("common.titlebar.collapseSidebar") : t("common.titlebar.expandSidebar")}
      title={t("common.titlebar.sidebar")}
    >
      <PanelLeft size={16} strokeWidth={1.8} aria-hidden="true" />
    </button>
    <Titlebar
      leftOpen={leftOpen}
      onToggleSidebar={toggleLeftPanel}
      onOpenSessions={() => setCenterView("history")}
      workspaceName={workspaceName}
      workspacePath={currentWorkspace}
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
        onToggleTerminal={toggleBottomPanel}
        terminalOpen={bottomOpen}
        onOpenFiles={() => openRightPanel("files")}
        onOpenBrowser={() => openRightPanel("browser")}
        onOpenPlan={() => openRightPanel("plan")}
        onOpenAgents={() => openRightPanel("agents")}
        onOpenSubagent={openSubagentWorkspace}
      />
    )}
    <div ref={appGridRef} id="app" data-density={density} data-theme={theme} data-browser-layout={rightOpen && rightTab === "browser" ? browserLayout : undefined} data-browser-focus-composer={rightOpen && ((rightTab === "browser" && browserLayout === "focus") || (rightTab === "files" && filesLayout === "focus")) ? browserFocusComposer : undefined} data-files-layout={rightOpen && rightTab === "files" ? filesLayout : undefined} className={`${centerView === "chat" ? "chat-workspace" : ""} ${leftOpen ? "" : "left-collapsed"} ${!leftOpen && leftSidebarPeekOpen ? "left-sidebar-peek-open" : ""} ${rightOpen ? "" : "right-collapsed"} ${rightOpen && rightTab === "plan" ? "plan-panel-open" : ""} ${rightOpen && rightTab === "subagents" ? "subagents-layout-split" : ""} ${rightOpen && rightTab === "browser" ? `browser-layout-${browserLayout}` : ""} ${rightOpen && rightTab === "files" ? (filesLayout === "focus" ? "browser-layout-focus files-focus-workspace" : `files-layout-${filesLayout}`) : ""}`} style={{ "--dock-w": rightOpen ? `${rightWidth}px` : "0px", "--bottom-h": bottomOpen ? `${bottomHeight}px` : "0px", "--browser-composer-inset": `${browserFocusBottomInset}px` } as React.CSSProperties}>
      <NavRail
        leftOpen={leftOpen || leftSidebarPeekOpen}
        onToggle={toggleLeftPanel}
        sidebarSize={leftSidebarSize}
        onCycleSidebarSize={cycleLeftSidebarSize}
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
        onPeekEnter={revealLeftSidebarPeek}
        onPeekLeave={scheduleLeftSidebarPeekClose}
      />
      {!leftOpen && (
        <div
          className="left-sidebar-hover-zone"
          aria-hidden="true"
          onPointerEnter={revealLeftSidebarPeek}
          onPointerLeave={scheduleLeftSidebarPeekClose}
        />
      )}
      {leftOpen && (
        <div
          className="left-resize-handle"
          onPointerDown={handleLeftDragStart}
          onDoubleClick={cycleLeftSidebarSize}
          onKeyDown={handleLeftResizeKey}
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={getLeftSidebarSnapWidth("quarter", appViewportWidth)}
          aria-valuemax={getLeftSidebarSnapWidth("half", appViewportWidth)}
          aria-valuenow={Math.round(leftSidebarWidth)}
          aria-valuetext={t("navRail.resizeHandleValue", { size: t(leftSidebarSize === "quarter" ? "navRail.sidebarQuarter" : "navRail.sidebarHalf") })}
          aria-label={t("navRail.resizeHandleLabel")}
          title={t("navRail.resizeHandleTitle")}
          tabIndex={0}
        />
      )}
      <main ref={browserFocusMainRef} className={`main ${centerView === "chat" ? (hasVisibleMessages ? "chat-active" : "empty-chat") : "page-view"}`}>
        {hasVisibleMessages && centerView === "chat" && mainView.mode === "chat" && (
          <ConversationHeader
            session={activeConversationSession}
            pinned={activeConversationPinned}
            onPin={() => {
              if (activeConversationSession?.path) togglePinSession(activeConversationSession.path);
            }}
            onRename={(nextName) => renameNavSession(activeConversationSession, nextName)}
            onArchive={() => {
              if (activeConversationSession?.path) archiveSession(activeConversationSession.path);
            }}
            onOpenSideTask={() => openRightPanel("sidechat")}
          />
        )}
        {hasVisibleMessages && centerView === "chat" && <SecurityBanner onOpenSettings={() => openSettingsPage()} />}
        {centerView === "projects" ? (
          <React.Suspense fallback={<div className="panel-loading" style={{display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>{t("tools.activity.loading")}</div>}>
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
          <React.Suspense fallback={<div className="panel-loading" style={{display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>{t("tools.activity.loading")}</div>}>
            <ConversationHistoryPage
              sessions={visibleSessions as any}
              activeSessionId={sessionId}
              workspaceName={workspaceName}
              onOpenSession={(path) => { setCenterView("chat"); void switchSessionFromUi(path, true); }}
            />
          </React.Suspense>
        ) : centerView === "scheduled" ? (
          <React.Suspense fallback={<div className="panel-loading" style={{display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>{t("tools.activity.loading")}</div>}>
            <SchedulePage
              onCreateWithChat={async () => {
                await handleNewChatWithProjectMenu();
                setPromptDraft(t("schedule.chatPrompt"));
                requestAnimationFrame(() => {
                  const textarea = promptRef.current;
                  textarea?.focus();
                  if (textarea) textarea.setSelectionRange(textarea.value.length, textarea.value.length);
                });
              }}
            />
          </React.Suspense>
        ) : centerView === "extensions" ? (
          <React.Suspense fallback={<div className="panel-loading" style={{display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>{t("tools.activity.loading")}</div>}>
            <ExtensionsPage
              onTryInChat={(name) => { setCenterView("chat"); setPromptDraft(t("runtime.shell.extensionTaskPrompt", { name })); promptRef.current?.focus(); }}
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
            onInspectTool={setSelectedToolId}
            onOpenFile={(path) => { openRightPanel("files"); void openFile(path); }}
            onOpenDiff={openDiffTab}
            onReviewTurn={openTurnReview}
            onToast={showToast}
            onPreviewImage={setPreviewImage}
            onOpenPlan={() => openRightPanel("plan")}
            onOpenArtifactTemplateSkill={(skillName) => void openArtifactTemplateSkill(skillName)}
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
              t("runtime.shell.planClarificationFailed"),
            )
          }
          onSkip={(args) =>
            runAwaitedUiCommand(
              { type: "plan_clarification_skip", requestId: args.requestId, clarificationId: args.clarificationId },
              t("runtime.shell.planClarificationSkipFailed"),
            )
          }
        />
        <div className={`composer-shell ${hasVisibleMessages ? "" : "is-empty"}`}>
        <GoalPanel
          goal={sessionGoal}
          onPause={() => void runUiCommand({ type: "goal_pause" }, t("runtime.shell.goalPauseFailed"))}
          onResume={() => void runUiCommand({ type: "goal_resume" }, t("runtime.shell.goalResumeFailed"))}
          onCancel={() => void runUiCommand({ type: "goal_cancel" }, t("runtime.shell.goalCancelFailed"))}
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
                t("runtime.shell.mcpResponseFailed"),
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
                t("runtime.shell.approvalResponseFailed"),
              );
            }}
          />
        ) : (<>
        <ComposerMentionMenu
          ref={mentionMenuRef}
          prompt={prompt}
          promptHistory={promptHistory}
          onPick={(value) => {
            setPromptHistoryIndex(undefined);
            setPromptDraft(value);
            requestAnimationFrame(() => promptRef.current?.focus({ preventScroll: true }));
          }}
        />
        <ChatComposer
          promptRef={promptRef}
          prompt={prompt}
          hasVisibleMessages={hasVisibleMessages}
          images={composerImages}
          contextCount={contextChips.filter((chip) => chip.type !== "annotation").length}
          localQueue={userMessageQueue}
          agentBusy={isComposerStreaming}
          promptPending={isPromptPending}
          isCompacting={isCompacting}
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
            if (mentionMenuRef.current?.handleKeyDown(event)) return true;
            if (slashAutocompleteRef.current?.handleKeyDown(event)) return true;
            if (event.key === "ArrowUp" && !prompt.trim() && promptHistory.length) { event.preventDefault(); setPromptHistoryIndex(0); setPromptDraft(promptHistory[0]); return true; }
            if (event.key === "ArrowUp" && promptHistoryIndex !== undefined) { event.preventDefault(); const next = Math.min(promptHistoryIndex + 1, promptHistory.length - 1); setPromptHistoryIndex(next); setPromptDraft(promptHistory[next] || ""); return true; }
            if (event.key === "ArrowDown" && promptHistoryIndex !== undefined) { event.preventDefault(); const next = promptHistoryIndex - 1; setPromptHistoryIndex(next >= 0 ? next : undefined); setPromptDraft(next >= 0 ? promptHistory[next] || "" : ""); return true; }
            return false;
          }}
          onOpenFiles={() => openRightPanel("files")}
          onOpenProjects={() => setCenterView("projects")}
          onOpenPlan={() => handleOpenPanel("plan")}
          onOpenDocumentSkill={(skillName) => void openArtifactTemplateSkill(skillName)}
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
              void runUiCommand({ type: "goal_cancel" }, t("runtime.shell.goalCancelFailed"));
            }
            void switchComposerMode("execute");
          }}
          onSetThinking={(level) => runUiCommand({ type: "set_thinking_level", level }, t("runtime.shell.thinkingChangeFailed"))}
          onSelectModel={selectModel}
          onResetPreferences={resetComposerPreferences}
          onAbort={() => void abortAgent()}
          onSendQueued={(item) => void routeQueuedUserMessage(item)}
          onEditQueued={editQueuedUserMessage}
          onRemoveQueued={removeQueuedUserMessage}
          onClearQueue={clearQueuedUserMessages}
          onCopyQueued={(text) => copyTextWithToast(text, t("runtime.shell.messageCopied"))}
          formatModelLabel={formatComposerModelLabel}
          formatThinkingLabel={thinkingLabel}
          compact={rightOpen && ((rightTab === "browser" && browserLayout === "focus") || (rightTab === "files" && filesLayout === "focus")) && browserFocusComposer === "mini"}
        />
        </>)}
        </div>
        </>}
        </>}
      </main>
      {rightOpen && <div className="right-resize-handle" onPointerDown={handleRightDragStart} onKeyDown={handleRightResizeKey} role="separator" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={Math.max(320, window.innerWidth - 360)} aria-valuenow={Math.round(rightWidth)} aria-label={t("runtime.shell.resizeRightPanel")} tabIndex={0} />}
      <aside className="rightbar" data-active-panel={rightTab} aria-hidden={!rightOpen}>
        <RightPanelTabs active={rightTab} tabs={dockTabs} addOpen={dockAddOpen} launcherExpanded={rightPanelExpanded} browserLayout={browserLayout} browserFocusComposer={browserFocusComposer} browserTitle={browserTabMetadata.title || t("runtime.shell.browser")} browserUrl={browserTabMetadata.url} filesTitle={filePreview.path ? filePreview.path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) : t("rightPanel.openFile")} filesLayout={filesLayout} filesTreeOpen={filesTreeOpen} onClose={closeRightPanel} onCloseTab={closeDockTab} onToggleAdd={() => setDockAddOpen((value) => !value)} onToggleLauncherExpand={toggleRightPanelExpanded} onToggleFilesTree={toggleFilesTree} onChange={(tab) => { setDockAddOpen(false); handleOpenPanel(tab); }} onBrowserLayout={applyBrowserLayout} onBrowserFocusComposer={setBrowserFocusComposerMode} onFilesLayout={applyFilesLayout} />
        {rightTab === "launcher" && <QuickLauncher variant="panel" onOpen={(panel) => handleOpenPanel(panel)} />}
        {rightTab === "files" && <div ref={filesWorkbenchRef} className={`files-workbench ${filePreview.path ? "has-preview" : ""} ${filesTreeOpen ? "files-tree-open" : "files-tree-closed"}`} style={{ "--files-tree-width": `${filesTreeWidth}px` } as React.CSSProperties}><div className="files-workbench-preview"><PreviewPanel filePreview={filePreview} onOpenFile={openFile} onClose={closeFilePreview} onOpen={() => setMainView({ mode: "editor", title: filePreview.path || t("files.preview"), path: filePreview.path, content: filePreview.content })} /></div>{filesTreeOpen && <div className="files-tree-resize-handle" role="separator" aria-orientation="vertical" aria-label={t("rightPanel.resizeFileTree")} aria-valuemin={FILES_TREE_MIN_WIDTH} aria-valuemax={FILES_TREE_MAX_WIDTH} aria-valuenow={Math.round(filesTreeWidth)} tabIndex={0} onPointerDown={handleFilesTreeResizeStart} onKeyDown={handleFilesTreeResizeKey} />}<div className="files-workbench-tree"><React.Suspense fallback={<div className="panel-loading">{t("tools.activity.loading")}</div>}><FilesPanel key={`${normalizeClientPath(currentWorkspace || "workspace")}::${panelSessionKey}`} workspaceKey={normalizeClientPath(currentWorkspace || "workspace")} sessionKey={panelSessionKey} loading={loading.files} currentFileDir={currentFileDir} onOpenDir={refreshFiles} onOpenFile={openFile} onOpenMonaco={openFileInMonaco} onReveal={revealInFileTree} onAskFile={(path) => { setPromptDraft(`${t("files.askAboutFile")}: ${path}`); requestAnimationFrame(() => promptRef.current?.focus()); }} onSummarizeFile={(path) => { setPromptDraft(`${t("files.summarize")}: ${path}`); requestAnimationFrame(() => promptRef.current?.focus()); }} onCopyPath={(path) => copyTextWithToast(path, t("runtime.shell.pathCopied"))} onAddContext={(path, type) => {
          if (type === "directory") {
            addContextChip({ type: "file", label: path, text: t("runtime.shell.folderContext", { path }) });
            showToast(t("runtime.shell.folderContextAdded"), "success");
            return;
          }
          void apiGet<any>(`/api/file?path=${encodeURIComponent(path)}`).then((file) => {
            addContextChip({ type: "file", label: path, text: String(file.content || "").slice(0, 12000) });
            showToast(t("runtime.shell.fileContextAdded"), "success");
          }).catch((error) => showToast(t("runtime.shell.fileContextFailed", { error: error.message }), "error"));
        }} /></React.Suspense></div></div>}
        {rightTab === "preview" && <PreviewPanel filePreview={filePreview} onClose={() => { setFilePreview({ content: t("runtime.shell.fileNotSelected") }); setRightPanelTab("files"); }} onOpen={() => setMainView({ mode: "editor", title: filePreview.path || t("files.preview"), path: filePreview.path, content: filePreview.content })} />}
        {rightTab === "mobile" && <React.Suspense fallback={<div className="panel-loading">{t("runtime.shell.mobileLoading")}</div>}><MobileStudioPanel key={panelSessionKey} sessionKey={panelSessionKey} /></React.Suspense>}
        {rightTab === "plan" && !sessionSurfacePending && sessionPlan && <PlanArtifactPanel plan={sessionPlan} onClose={() => closeDockTab("plan")} onOpenFile={(path) => { openRightPanel("files"); void openFile(path); }} />}
        {rightTab === "sidechat" && (
          <React.Suspense fallback={<div className="panel-loading">{t("runtime.shell.sideChatLoading")}</div>}>
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
        {rightTab === "subagents" && <React.Suspense fallback={<div className="panel-loading">{t("runtime.shell.subagentsLoading")}</div>}><SubagentWorkspace key={panelSessionKey} sessionId={sessionId} requestedAgentId={subagentRequest.sessionKey === panelSessionKey ? subagentRequest.id : undefined} requestVersion={subagentRequest.version} onOpenFiles={() => openRightPanel("files")} onOpenFile={(path) => { openRightPanel("files"); void openFile(path); }} onOpenAgents={() => openRightPanel("agents")} onToast={showToast} /></React.Suspense>}
        {rightTab === "agents" && <AgentsPanel />}
        {rightTab === "review" && turnReview && <TurnReviewPanel review={turnReview} onOpenFile={(path) => { openRightPanel("files"); void openFile(path); }} onToast={showToast} />}
         {rightTab === "browser" && <React.Suspense fallback={<div className="panel-loading">{t("tools.activity.loading")}</div>}><BrowserPanel key={panelSessionKey} sessionKey={panelSessionKey} onMetadataChange={setBrowserTabMetadata} onAnnotationBundle={(bundle) => {
          const bundleId = `browser-annotations:${bundle.url}`;
          setComposerImagesDraft((current) => [
            ...current.filter((image) => image.annotationBundleId !== bundleId),
            { ...bundle.image, id: bundleId, annotationBundleId: bundleId, annotationCount: bundle.annotations.length },
          ].slice(-6));
          showToast(t("runtime.shell.annotationsAdded", { count: bundle.annotations.length }), "success");
          requestAnimationFrame(() => promptRef.current?.focus());
        }} /></React.Suspense>}
        {extensionModal &&<div className="panel"><div className="panel-title">{t("runtime.shell.extensionUi")}</div><ExtensionRenderer type={extensionModal.method || "confirm"} props={extensionModal} requestId={extensionModal.id} /></div>}
      </aside>
      <div className="bottom-dock">
        <BottomPanel open={bottomOpen} onClose={() => setBottomOpen(false)} height={bottomHeight} onHeightChange={(h) => { setBottomHeight(h); writeStorageValue("quake-web:bottomHeight", String(Math.round(h))); }}>
          {(panelControls) => <React.Suspense fallback={<div className="panel-loading">{t("runtime.shell.terminalLoading")}</div>}><XtermTerminal panelControls={panelControls} onAsk={(text) => { setPromptDraft(text); requestAnimationFrame(() => promptRef.current?.focus()); }} onAddContext={(context) => { addContextChip({ type: "terminal", label: context.label, text: context.text }); showToast(t("runtime.shell.terminalContextAdded"), "success"); }} /></React.Suspense>}
        </BottomPanel>
      </div>
    </div>
    {scheduleOpen && <div ref={scheduleDialogRef} role="dialog" aria-modal="true" aria-labelledby="schedule-dialog-title" tabIndex={-1} onKeyDown={handleScheduleDialogKeyDown} style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <h2 id="schedule-dialog-title" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>{t("schedule.view")}</h2>
      <div role="presentation" onClick={closeScheduleDialog} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} />
      <div style={{ position: "relative", width: "min(720px, 100%)", height: "min(80vh, 720px)", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-card)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <React.Suspense fallback={<div className="panel-loading">{t("tools.activity.loading")}</div>}><SchedulePanel onClose={closeScheduleDialog} /></React.Suspense>
      </div>
    </div>}
    {settingsModalOpen && (
      <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSettingsModal(); }}>
        <div
          className="settings-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t("settings.title")}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <React.Suspense fallback={<div className="panel-loading" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40, width: "100%" }}>{t("tools.activity.loading")}</div>}>
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
