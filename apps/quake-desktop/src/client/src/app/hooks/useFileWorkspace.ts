import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { apiGet, apiPost } from "../../lib/api";
import { parseDiff } from "../../lib/diff-utils";
import { normalizeWorkspaceFileDir } from "../../lib/path-utils";
import { writeStorageValue } from "../../lib/storage";
import { toolDiffText } from "../../lib/tool-helpers";
import type { ToastState, ToolCardState } from "../../state/app-store";
import type { FileTab, MonacoModal, RightTab, WorkspaceChangeSummary } from "../../types";

export type FilePreviewState = { path?: string; content: string };

/**
 * Everything App must pass so file/tree/tab/monaco actions can run without
 * closing over App internals. openTabs / activeTabPath stay owned by App
 * (passed as live value + setters) so other App surfaces can still read them.
 */
export interface FileWorkspaceDeps {
  showToast: (
    message: string,
    type?: ToastState["type"],
    options?: Pick<ToastState, "actionLabel" | "action">,
  ) => string;
  setStore: (partial: any) => void;

  /** Workspace roots used to normalize file-tree paths (current render). */
  configCwd: string;
  stateCwd: string;
  currentWorkspace: string;

  /** Live active tab path (current render) — needed by closeFileTab. */
  activeTabPath: string | undefined;

  fileRefreshSeqRef: MutableRefObject<number>;
  filePreviewSeqRef: MutableRefObject<number>;
  monacoOpenSeqRef: MutableRefObject<number>;
  currentFileDirRef: MutableRefObject<string>;

  setLoading: Dispatch<SetStateAction<Record<string, boolean>>>;
  setCurrentFileDir: Dispatch<SetStateAction<string>>;
  setFilePreview: Dispatch<SetStateAction<FilePreviewState>>;
  setMonacoModal: Dispatch<SetStateAction<MonacoModal | undefined>>;
  setOpenTabs: Dispatch<SetStateAction<FileTab[]>>;
  setActiveTabPath: Dispatch<SetStateAction<string | undefined>>;
  setRightPanelTab: (tab: RightTab) => void;
  setRightPanelOpen: (open: boolean) => void;
  openRightPanel: (tab: RightTab) => void;
}

/**
 * File tree refresh, preview, Monaco modal, and editor/diff tabs.
 */
export function useFileWorkspace(deps: FileWorkspaceDeps) {
  const {
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
  } = deps;

  async function refreshWorkspaceChanges() {
    try {
      await apiGet<WorkspaceChangeSummary>("/api/workspace/changes");
    } catch {
      // Degisiklik ozeti destekleyici bir sinyaldir; sohbet akisini engellemez.
    }
  }

  async function refreshFiles(path = ".") {
    const requestedPath = normalizeWorkspaceFileDir(path || ".", configCwd || stateCwd || currentWorkspace);
    const requestSeq = ++fileRefreshSeqRef.current;
    setLoading((state) => ({ ...state, files: true }));
    try {
      currentFileDirRef.current = requestedPath;
      setCurrentFileDir(requestedPath);
      writeStorageValue("quake-web:fileDir", requestedPath);
      apiPost("/api/web-settings", { fileDir: requestedPath }).catch(() => {});
      const { entries } = await apiGet<any>(`/api/files?path=${encodeURIComponent(requestedPath)}`);
      if (requestSeq !== fileRefreshSeqRef.current) return;
      setStore({ files: entries });
    } catch (error: any) {
      if (requestSeq !== fileRefreshSeqRef.current) return;
      if (requestedPath !== ".") {
        showToast("Klasör bulunamadı; dosya ağacı köke döndü.", "warning");
        await refreshFiles(".");
        return;
      }
      showToast(`Dosyalar alınamadı: ${error.message}`, "error");
    } finally {
      if (requestSeq === fileRefreshSeqRef.current) setLoading((state) => ({ ...state, files: false }));
    }
  }

  async function openFile(path: string) {
    const requestSeq = ++filePreviewSeqRef.current;
    try {
      const file = await apiGet<any>(`/api/file?path=${encodeURIComponent(path)}`);
      if (requestSeq !== filePreviewSeqRef.current) return;
      setFilePreview({ path: file.path, content: file.content });
      // Dosya ağacı ve önizleme aynı çalışma yüzeyinde yan yana kalır.
      setRightPanelTab("files");
      setRightPanelOpen(true);
    } catch (error: any) {
      if (requestSeq !== filePreviewSeqRef.current) return;
      showToast(`Önizleme açılamadı: ${error.message}`, "error");
    }
  }

  async function openFileInMonaco(path: string) {
    const requestSeq = ++monacoOpenSeqRef.current;
    try {
      const file = await apiGet<any>(`/api/file?path=${encodeURIComponent(path)}`);
      if (requestSeq !== monacoOpenSeqRef.current) return;
      setMonacoModal({ mode: "editor", title: file.path, path: file.path, content: file.content });
    } catch (error: any) {
      if (requestSeq !== monacoOpenSeqRef.current) return;
      showToast(`Editör açılamadı: ${error.message}`, "error");
    }
  }

  function closeMonacoModal() {
    monacoOpenSeqRef.current += 1;
    setMonacoModal(undefined);
  }

  function closeFileTab(path: string) {
    setOpenTabs((tabs) => {
      const next = tabs.filter((tab) => tab.path !== path);
      if (activeTabPath === path) {
        const replacement = next[0];
        setActiveTabPath(replacement?.path);
        if (replacement?.mode === "editor") setFilePreview({ path: replacement.path, content: replacement.content });
      }
      return next;
    });
  }

  function openDiffTab(card: ToolCardState) {
    const diff = parseDiff(toolDiffText(card) || card.output || "");
    const path = `diff:${card.toolName}:${card.id}`;
    setActiveTabPath(path);
    const tab: FileTab = { mode: "diff", path, ...diff };
    setOpenTabs((tabs) => [tab, ...tabs.filter((item) => item.path !== path)].slice(0, 10));
  }

  function revealInFileTree(path: string) {
    const dir = path.includes("/") ? path.split("/").slice(0, -1).join("/") : ".";
    openRightPanel("files");
    void refreshFiles(dir || ".");
  }

  return {
    refreshWorkspaceChanges,
    refreshFiles,
    openFile,
    openFileInMonaco,
    closeMonacoModal,
    closeFileTab,
    openDiffTab,
    revealInFileTree,
  };
}

export type UseFileWorkspaceReturn = ReturnType<typeof useFileWorkspace>;
