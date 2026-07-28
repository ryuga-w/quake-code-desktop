import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import { desktop } from "../../lib/desktop";
import { normalizeSessionDraftKey } from "../../lib/client-ids";
import {
  getLastSessionForWorkspace,
  normalizeWorkspacePathKey,
  persistLastSessionForWorkspace,
} from "../../lib/session-projects";
import { formatSessionTitle } from "../../lib/render";
import { readStorageArray, writeStorageJson, writeStorageValue } from "../../lib/storage";
import { useAppStore, type ToastState } from "../../state/app-store";
import type {
  ComposerImage,
  FileTab,
  MainView,
  MonacoModal,
  QueuedMessages,
  QueuedUserMessage,
} from "../../types";
import type { ComposerContextChip, SessionComposerDraft } from "./useComposerDraft";

/** Matches App's file preview state shape. */
export type SessionWorkspaceFilePreview = { path?: string; content: string };

export type SessionWorkspaceConfirm = (props: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
  requireText?: string;
}) => Promise<boolean>;

/**
 * Everything App must pass so session/workspace actions can run without
 * closing over App internals. Values that change each render (cwd, sessions, …)
 * should be passed as current values; mutable control state uses refs.
 */
export interface SessionWorkspaceDeps {
  // --- Commands / infrastructure ---
  sendCommand: (command: any) => Promise<any>;
  confirm: SessionWorkspaceConfirm;
  showToast: (
    message: string,
    type?: ToastState["type"],
    options?: Pick<ToastState, "actionLabel" | "action">,
  ) => string;
  refreshAll: () => Promise<void>;
  startNewSession: (options?: {
    parentSession?: string;
    isolation?: "plan" | "goal" | "agent";
    keepModePrefs?: boolean;
  }) => Promise<boolean>;
  clearLocalStreamingState: () => void;
  settleActiveToolsAfterIdle: () => void;
  resetSessionSurface: () => void;
  saveActiveRightPanelSnapshot: () => void;
  activateRightPanelSnapshot: (sessionKey: string) => void;
  unhideWorkspace: (cwd: string) => void;

  // --- Live workspace / session snapshot (current render) ---
  currentWorkspace: string;
  noProject: boolean;
  sessionFile: string | undefined;
  sessions: any[];

  // --- Session transition refs ---
  sessionSwitchSeqRef: MutableRefObject<number>;
  workspaceOpenSeqRef: MutableRefObject<number>;
  sessionTransitionPendingRef: MutableRefObject<boolean>;
  expectedSessionKeyRef: MutableRefObject<string>;
  departingSessionKeysRef: MutableRefObject<Set<string>>;
  stateRefreshSeqRef: MutableRefObject<number>;
  stateRefreshPromiseRef: MutableRefObject<Promise<any> | undefined>;
  abortedTurnSuppressedRef: MutableRefObject<boolean>;
  forkingEntryIdRef: MutableRefObject<string | null>;
  currentTurnRef: MutableRefObject<number>;
  agentTurnActiveRef: MutableRefObject<boolean>;
  agentLifecycleActiveRef: MutableRefObject<boolean>;
  openedCreatedPlanRef: MutableRefObject<string>;
  lastPlanPhaseRef: MutableRefObject<string>;
  filePreviewSeqRef: MutableRefObject<number>;
  monacoOpenSeqRef: MutableRefObject<number>;
  currentFileDirRef: MutableRefObject<string>;

  // --- Composer draft (tightly coupled to session switch) ---
  activeComposerDraftKeyRef: MutableRefObject<string>;
  composerDraftsBySessionRef: MutableRefObject<Map<string, SessionComposerDraft>>;
  promptValueRef: MutableRefObject<string>;
  composerImagesRef: MutableRefObject<ComposerImage[]>;
  contextChipsRef: MutableRefObject<ComposerContextChip[]>;
  composerDraftVersionRef: MutableRefObject<number>;
  setPrompt: Dispatch<SetStateAction<string>>;
  setComposerImages: Dispatch<SetStateAction<ComposerImage[]>>;
  setContextChips: Dispatch<SetStateAction<ComposerContextChip[]>>;
  setPromptHistoryIndex: Dispatch<SetStateAction<number | undefined>>;

  // --- Session-owned UI setters ---
  setSessionSurfacePending: Dispatch<SetStateAction<boolean>>;
  setPlanModePref: Dispatch<SetStateAction<boolean>>;
  setGoalModePref: Dispatch<SetStateAction<boolean>>;
  setDismissedPlanApprovalKey: Dispatch<SetStateAction<string>>;
  setPlanApplyPending: Dispatch<SetStateAction<boolean>>;
  setDockAddOpen: Dispatch<SetStateAction<boolean>>;
  setExtensionModal: Dispatch<SetStateAction<any>>;
  setSelectedToolId: Dispatch<SetStateAction<string | undefined>>;
  setPreviewImage: Dispatch<SetStateAction<ComposerImage | undefined>>;
  setMonacoModal: Dispatch<SetStateAction<MonacoModal | undefined>>;
  setUserMessageQueue: Dispatch<SetStateAction<QueuedUserMessage[]>>;
  setQueuedMessages: Dispatch<SetStateAction<QueuedMessages>>;
  setSentImagePreviews: Dispatch<SetStateAction<Record<string, ComposerImage[]>>>;
  setForkingEntryId: Dispatch<SetStateAction<string | null>>;
  setSessionModalOpen: Dispatch<SetStateAction<boolean>>;
  setCreateProjectOpen: Dispatch<SetStateAction<boolean>>;
  setProjectMenuOpen: Dispatch<SetStateAction<boolean>>;
  setMainView: Dispatch<SetStateAction<MainView>>;
  setCenterView: Dispatch<SetStateAction<"chat" | "projects" | "scheduled" | "extensions" | "history">>;
  setNoProject: Dispatch<SetStateAction<boolean>>;
  setCurrentFileDir: Dispatch<SetStateAction<string>>;
  setFilePreview: Dispatch<SetStateAction<SessionWorkspaceFilePreview>>;
  setOpenTabs: Dispatch<SetStateAction<FileTab[]>>;
  setActiveTabPath: Dispatch<SetStateAction<string | undefined>>;
  setRecentWorkspacesTick: Dispatch<SetStateAction<number>>;
}

export function useSessionWorkspace(deps: SessionWorkspaceDeps) {
  const {
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
  } = deps;

  function saveActiveComposerDraft() {
    const key = activeComposerDraftKeyRef.current;
    if (!key) return;
    composerDraftsBySessionRef.current.set(key, {
      prompt: promptValueRef.current,
      images: composerImagesRef.current,
      contextChips: contextChipsRef.current,
    });
  }

  function activateComposerDraft(sessionKey: string) {
    const key = normalizeSessionDraftKey(sessionKey);
    if (!key || key === activeComposerDraftKeyRef.current) return;
    saveActiveComposerDraft();
    activeComposerDraftKeyRef.current = key;
    const draft = composerDraftsBySessionRef.current.get(key);
    const nextPrompt = draft?.prompt || "";
    const nextImages = draft?.images || [];
    const nextChips = draft?.contextChips || [];
    promptValueRef.current = nextPrompt;
    composerImagesRef.current = nextImages;
    contextChipsRef.current = nextChips;
    composerDraftVersionRef.current += 1;
    setPrompt(nextPrompt);
    setComposerImages(nextImages);
    setContextChips(nextChips);
    setPromptHistoryIndex(undefined);
  }

  function resetWorkspaceFileSurface() {
    writeStorageValue("quake-web:fileDir", ".");
    currentFileDirRef.current = ".";
    filePreviewSeqRef.current += 1;
    monacoOpenSeqRef.current += 1;
    setCurrentFileDir(".");
    setFilePreview({ content: "Dosya seçilmedi" });
    setOpenTabs([]);
    setActiveTabPath(undefined);
    setMonacoModal(undefined);
  }

  function resetSessionOwnedUi(expectedSessionKey = "") {
    const activeState = useAppStore.getState().state;
    saveActiveRightPanelSnapshot();
    departingSessionKeysRef.current = new Set(
      [activeState?.sessionFile, activeState?.sessionId]
        .map((value) => normalizeSessionDraftKey(String(value || "")))
        .filter(Boolean),
    );
    sessionTransitionPendingRef.current = true;
    abortedTurnSuppressedRef.current = false;
    expectedSessionKeyRef.current = normalizeSessionDraftKey(expectedSessionKey);
    // Invalidate any /api/state request started for the previous session. Its late
    // response must not repopulate the cleared surface while the switch is pending.
    stateRefreshSeqRef.current += 1;
    stateRefreshPromiseRef.current = undefined;
    resetSessionSurface();
    setSessionSurfacePending(true);
    setPlanModePref(false);
    setGoalModePref(false);
    openedCreatedPlanRef.current = "";
    lastPlanPhaseRef.current = "idle";
    setDismissedPlanApprovalKey("");
    setPlanApplyPending(false);
    setDockAddOpen(false);
    setExtensionModal(undefined);
    setSelectedToolId(undefined);
    setPreviewImage(undefined);
    setMonacoModal(undefined);
    setUserMessageQueue([]);
    setQueuedMessages({ steering: [], followUp: [] });
    setSentImagePreviews({});
    activateRightPanelSnapshot(expectedSessionKey || `new:${Date.now()}:${sessionSwitchSeqRef.current + 1}`);
  }

  function acceptsSessionReady(state: any): boolean {
    if (!sessionTransitionPendingRef.current) return true;
    const expected = expectedSessionKeyRef.current;
    const actualFile = normalizeSessionDraftKey(String(state?.sessionFile || ""));
    const actualId = normalizeSessionDraftKey(String(state?.sessionId || ""));
    if (expected && expected !== actualFile && expected !== actualId) return false;
    if (!expected && (departingSessionKeysRef.current.has(actualFile) || departingSessionKeysRef.current.has(actualId))) return false;
    sessionTransitionPendingRef.current = false;
    expectedSessionKeyRef.current = "";
    departingSessionKeysRef.current.clear();
    return true;
  }

  async function switchSessionFromUi(sessionPath: string, closeModal = false) {
    const requestSeq = ++sessionSwitchSeqRef.current;
    const previousDraftKey = activeComposerDraftKeyRef.current;
    const previousWorkspaceKey = normalizeWorkspacePathKey(currentWorkspace);
    const expectedWorkspace = String((sessions as any[]).find((session) => session?.path === sessionPath)?.cwd || "").trim();
    saveActiveComposerDraft();
    activateComposerDraft(sessionPath);
    try {
      // Clear local stream UI before switch so the previous chat's tokens don't paint on the next one.
      // Server keeps background agents running — we only park the active view.
      clearLocalStreamingState();
      settleActiveToolsAfterIdle();
      resetSessionOwnedUi(sessionPath);
      currentTurnRef.current = 0;
      agentTurnActiveRef.current = false;
      agentLifecycleActiveRef.current = false;
      await sendCommand({ type: "switch_session", sessionPath });
      if (requestSeq !== sessionSwitchSeqRef.current) return;
      const switchedCwd = String(useAppStore.getState().state?.cwd || expectedWorkspace || "").trim();
      if (switchedCwd && normalizeWorkspacePathKey(switchedCwd) !== previousWorkspaceKey) {
        resetWorkspaceFileSurface();
      }
      const switchedToNoProject = /(?:^|[\\/])no-project(?:[\\/]|$)/i.test(switchedCwd);
      setNoProject(switchedToNoProject);
      writeStorageValue("quake-web:noProject", switchedToNoProject ? "1" : "0");
      if (closeModal) setSessionModalOpen(false);
      await refreshAll();
      const cwdForLast =
        String(useAppStore.getState().state?.cwd || currentWorkspace || "").trim()
        || String((sessions as any[]).find((session) => session?.path === sessionPath)?.cwd || "").trim();
      if (cwdForLast && !switchedToNoProject) persistLastSessionForWorkspace(cwdForLast, sessionPath);
    } catch (error: any) {
      if (requestSeq !== sessionSwitchSeqRef.current) return;
      sessionTransitionPendingRef.current = false;
      expectedSessionKeyRef.current = "";
      departingSessionKeysRef.current.clear();
      setSessionSurfacePending(false);
      activateComposerDraft(previousDraftKey);
      activateRightPanelSnapshot(previousDraftKey);
      showToast(`Sohbet açılamadı: ${error?.message || "bilinmeyen hata"}`, "error");
    }
  }

  /** Fork at a user message entryId (session JSONL entry id, not session id). */
  async function forkSessionFromMessage(entryId: string) {
    const stableId = String(entryId || "").trim();
    if (!stableId || forkingEntryIdRef.current) return;
    forkingEntryIdRef.current = stableId;
    setForkingEntryId(stableId);
    const requestSeq = ++sessionSwitchSeqRef.current;
    const previousDraftKey = activeComposerDraftKeyRef.current;
    saveActiveComposerDraft();
    try {
      clearLocalStreamingState();
      settleActiveToolsAfterIdle();
      // Unknown forked path until ready — reject ready events for the departing session.
      resetSessionOwnedUi();
      currentTurnRef.current = 0;
      agentTurnActiveRef.current = false;
      agentLifecycleActiveRef.current = false;
      const response = await sendCommand({ type: "fork_session", entryId: stableId });
      if (requestSeq !== sessionSwitchSeqRef.current) return;
      const data = (response?.data || {}) as { cancelled?: boolean };
      if (data.cancelled) {
        sessionTransitionPendingRef.current = false;
        expectedSessionKeyRef.current = "";
        departingSessionKeysRef.current.clear();
        setSessionSurfacePending(false);
        activateComposerDraft(previousDraftKey);
        activateRightPanelSnapshot(previousDraftKey);
        showToast("Dallandırma iptal edildi", "info");
        return;
      }
      await refreshAll();
      showToast("Sohbet buradan dallandırıldı", "success");
    } catch (error: any) {
      if (requestSeq !== sessionSwitchSeqRef.current) return;
      sessionTransitionPendingRef.current = false;
      expectedSessionKeyRef.current = "";
      departingSessionKeysRef.current.clear();
      setSessionSurfacePending(false);
      activateComposerDraft(previousDraftKey);
      activateRightPanelSnapshot(previousDraftKey);
      showToast(`Dallandırılamadı: ${error?.message || "bilinmeyen hata"}`, "error");
    } finally {
      forkingEntryIdRef.current = null;
      setForkingEntryId(null);
    }
  }

  async function maybeRestoreLastSession(cwd: string): Promise<boolean> {
    const lastPath = getLastSessionForWorkspace(cwd);
    if (!lastPath) return false;
    const latestSessions = (useAppStore.getState().sessions || []) as any[];
    const known = latestSessions.find((session) => String(session?.path || "") === lastPath);
    const title = known ? formatSessionTitle(known) : lastPath.split(/[\\/]/).filter(Boolean).pop() || "son sohbet";
    const restore = await confirm({
      title: "Bu projedeki son sohbet açılsın mı?",
      message: `"${title}" sohbetine dönmek ister misiniz? İptal ederseniz yeni bir sohbet açılır.`,
      variant: "info",
      confirmLabel: "Son sohbeti aç",
      cancelLabel: "Yeni sohbet",
    });
    if (!restore) return false;
    await switchSessionFromUi(lastPath, true);
    return true;
  }

  async function openWorkspacesFromModal(paths: string[], options?: { toast?: string; noProject?: boolean; startSession?: boolean }) {
    const normalizedRoots = [...new Map(
      paths
        .map((path) => String(path || "").replace(/[\\/]+$/, ""))
        .filter(Boolean)
        .map((path) => [normalizeWorkspacePathKey(path), path]),
    ).values()];
    if (normalizedRoots.length === 0) throw new Error("Çalışma alanı yolu seçilmedi");
    const normalizedTarget = normalizedRoots[normalizedRoots.length - 1];
    const leavingCwd = String(currentWorkspace || "").replace(/[\\/]+$/, "");
    const sameWorkspace =
      normalizedRoots.length === 1
      && !options?.noProject
      && !noProject
      && Boolean(leavingCwd)
      && normalizeWorkspacePathKey(leavingCwd) === normalizeWorkspacePathKey(normalizedTarget);

    // Already on this project: skip server reopen / leave confirm; only start a new chat if requested.
    if (sameWorkspace) {
      setCreateProjectOpen(false);
      setProjectMenuOpen(false);
      setMainView({ mode: "chat" });
      setCenterView("chat");
      if (options?.startSession !== false) await startNewSession();
      return;
    }

    // Keep the last active session pointer for every root. Unlike the former
    // single-root flow, the runtime parks this session instead of closing it.
    if (leavingCwd && !noProject && sessionFile) {
      persistLastSessionForWorkspace(leavingCwd, sessionFile);
    }

    const requestSeq = ++workspaceOpenSeqRef.current;
    const response = normalizedRoots.length > 1
      ? await sendCommand({ type: "open_workspaces", paths: normalizedRoots, activePath: normalizedTarget })
      : await sendCommand({ type: "open_workspace", path: normalizedTarget });
    if (requestSeq !== workspaceOpenSeqRef.current) return;
    if (response && response.success === false) throw new Error(response.error || "Çalışma alanı açılamadı");
    void desktop?.rememberWorkspaceRoots?.(normalizedRoots, normalizedTarget).catch(() => {});
    resetWorkspaceFileSurface();
    setMainView({ mode: "chat" });
    setCreateProjectOpen(false);
    setProjectMenuOpen(false);
    const isNoProject = Boolean(options?.noProject);
    setNoProject(isNoProject);
    writeStorageValue("quake-web:noProject", isNoProject ? "1" : "0");
    if (!isNoProject) {
      for (const root of normalizedRoots) unhideWorkspace(root);
      const recent = readStorageArray<string>("quake-web:recentWorkspaces");
      const ordered = [normalizedTarget, ...normalizedRoots.filter((root) => root !== normalizedTarget), ...recent];
      const seen = new Set<string>();
      writeStorageJson("quake-web:recentWorkspaces", ordered.filter((item) => {
        const key = normalizeWorkspacePathKey(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 24));
      setRecentWorkspacesTick((n) => n + 1);
    }
    showToast(options?.toast || (isNoProject
      ? "Projesiz mod"
      : normalizedRoots.length > 1
        ? `${normalizedRoots.length} çalışma alanı kökü açıldı`
        : "Çalışma alanı açıldı"), "success");
    await refreshAll();
    if (isNoProject) {
      if (options?.startSession !== false) await startNewSession();
      return;
    }
    const restored = await maybeRestoreLastSession(normalizedTarget);
    if (restored) return;
    if (options?.startSession !== false) {
      await startNewSession();
    }
  }

  async function openWorkspaceFromModal(path: string, options?: { toast?: string; noProject?: boolean; startSession?: boolean }) {
    await openWorkspacesFromModal([path], options);
  }

  async function handleNewChatWithProjectMenu() {
    setCenterView("chat");
    setCreateProjectOpen(false);
    // A new chat keeps the current workspace. Project selection is opened only
    // by the explicit workspace chevron in the composer header.
    setProjectMenuOpen(false);
    await startNewSession();
  }

  async function handleSelectProject(path: string) {
    try {
      await openWorkspaceFromModal(path, { toast: "Proje açıldı", startSession: true });
    } catch (error: any) {
      showToast(`Proje açılamadı: ${error?.message || "bilinmeyen hata"}`, "error");
    }
  }

  async function handleQuickStart() {
    setProjectMenuOpen(false);
    setCreateProjectOpen(false);
    try {
      let dir: string | null | undefined = desktop?.createQuickProject ? await desktop.createQuickProject() : null;
      if (!dir) {
        const response = await sendCommand({ type: "create_quick_project" });
        dir = response?.data?.cwd as string | undefined;
        if (!dir) throw new Error("Klasör oluşturulamadı");
        // Server already rebound workspace — sync client chrome + new session.
        writeStorageValue("quake-web:fileDir", ".");
        setCurrentFileDir(".");
        setNoProject(false);
        writeStorageValue("quake-web:noProject", "0");
        const normalized = dir.replace(/[\\/]+$/, "");
        unhideWorkspace(normalized);
        const recent = readStorageArray<string>("quake-web:recentWorkspaces");
        writeStorageJson("quake-web:recentWorkspaces", [normalized, ...recent.filter((item) => item.replace(/[\\/]+$/, "") !== normalized)].slice(0, 12));
        setRecentWorkspacesTick((n) => n + 1);
        setMainView({ mode: "chat" });
        setCenterView("chat");
        showToast(`Quick Start: ${normalized.split(/[\\/]/).pop()}`, "success");
        await refreshAll();
        await startNewSession();
        return;
      }
      await openWorkspaceFromModal(dir, {
        toast: `Quick Start: ${dir.split(/[\\/]/).filter(Boolean).pop()}`,
        startSession: true,
      });
    } catch (error: any) {
      showToast(`Quick Start başarısız: ${error?.message || "bilinmeyen hata"}`, "error");
    }
  }

  async function handleNoProject() {
    setProjectMenuOpen(false);
    try {
      const leavingCwd = String(currentWorkspace || "").replace(/[\\/]+$/, "");
      if (leavingCwd && !noProject && sessionFile) {
        persistLastSessionForWorkspace(leavingCwd, sessionFile);
      }
      let dir: string | null | undefined = desktop?.noProjectDir ? await desktop.noProjectDir() : null;
      if (!dir) {
        const response = await sendCommand({ type: "clear_workspace" });
        dir = response?.data?.cwd as string | undefined;
      } else {
        await sendCommand({ type: "open_workspace", path: dir });
      }
      setNoProject(true);
      writeStorageValue("quake-web:noProject", "1");
      setMainView({ mode: "chat" });
      setCenterView("chat");
      showToast("Projesiz çalışma", "success");
      await refreshAll();
      await startNewSession();
    } catch (error: any) {
      showToast(`No Project açılamadı: ${error?.message || "bilinmeyen hata"}`, "error");
    }
  }

  function handleNewProject() {
    setProjectMenuOpen(false);
    setCreateProjectOpen(true);
  }

  /** Native OS klasör seçici — in-app WorkspaceModal YOK. */
  async function pickFolderNative(): Promise<string | null> {
    const api = (window as any).quakeDesktop as typeof desktop | undefined;
    const pick = api?.pickFolder ?? desktop?.pickFolder;
    if (typeof pick !== "function") {
      console.warn("[workspace] pickFolder missing on quakeDesktop", api && Object.keys(api));
      showToast("Klasör seçici yüklenmedi — uygulamayı yeniden başlat", "error");
      return null;
    }
    try {
      const dir = await pick();
      return dir || null;
    } catch (err: any) {
      console.error("[workspace] pickFolder failed", err);
      showToast(`Gezgin açılamadı: ${err?.message || "bilinmeyen hata"}`, "error");
      return null;
    }
  }

  async function pickFoldersNative(): Promise<string[]> {
    const api = (window as any).quakeDesktop as typeof desktop | undefined;
    const pickMany = api?.pickFolders ?? desktop?.pickFolders;
    if (typeof pickMany === "function") {
      try {
        return (await pickMany()).filter(Boolean);
      } catch (err: any) {
        console.error("[workspace] pickFolders failed", err);
        showToast(`Gezgin açılamadı: ${err?.message || "bilinmeyen hata"}`, "error");
        return [];
      }
    }
    const single = await pickFolderNative();
    return single ? [single] : [];
  }

  async function handleAddFolder() {
    // Önce native dialog — modal kapanınca odak kaybolmasın diye dialog bitince kapat
    try {
      const roots = await pickFoldersNative();
      if (roots.length === 0) return; // iptal veya hata
      setCreateProjectOpen(false);
      setProjectMenuOpen(false);
      await openWorkspacesFromModal(roots, {
        toast: roots.length > 1 ? `${roots.length} klasör çalışma alanına eklendi` : "Klasör çalışma alanına eklendi",
        startSession: true,
      });
    } catch (error: any) {
      if (error?.message) showToast(`Klasör açılamadı: ${error.message}`, "error");
    }
  }

  async function handleOpenFolderNative() {
    try {
      const dir = await pickFolderNative();
      if (!dir) return;
      await openWorkspaceFromModal(dir, { toast: "Çalışma alanı açıldı", startSession: false });
    } catch (error: any) {
      if (error?.message) showToast(`Klasör açılamadı: ${error.message}`, "error");
    }
  }

  async function handleCreateProjectSkip() {
    setCreateProjectOpen(false);
    await handleQuickStart();
  }

  return {
    saveActiveComposerDraft,
    activateComposerDraft,
    resetSessionOwnedUi,
    acceptsSessionReady,
    switchSessionFromUi,
    forkSessionFromMessage,
    maybeRestoreLastSession,
    openWorkspacesFromModal,
    openWorkspaceFromModal,
    handleNewChatWithProjectMenu,
    handleSelectProject,
    handleQuickStart,
    handleNoProject,
    handleNewProject,
    pickFolderNative,
    handleAddFolder,
    handleOpenFolderNative,
    handleCreateProjectSkip,
  };
}
