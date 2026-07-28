import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Copy,
  ExternalLink,
  FilePlus2,
  FolderPlus,
  FolderSearch,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { apiGet, apiPost } from "../../lib/api";
import { useModalFocusTrap } from "../../lib/modal-focus";
import { readStorageValue, writeStorageValue } from "../../lib/storage";
import { useAppStore } from "../../state/app-store";
import { useI18n, type Translate } from "../../i18n";
import { useConfirm } from "../common/ConfirmDialog";
import { useContextMenu, type MenuItem } from "../chrome/ContextMenu";
import { SkeletonLines } from "../common/Feedback";
import { TreeEntryIcon } from "./file-icons";
import {
  ancestorDirs,
  isValidEntryName,
  joinWorkspacePath,
  normalizeDir,
  normalizeEntries,
  parentDir,
  selectVisibleTreeRows,
  type WorkspaceEntry,
} from "./file-tree";
import styles from "./FilesPanel.module.css";

const FILE_TREE_INITIAL_WINDOW = 700;
const FILE_TREE_WINDOW_STEP = 500;
const FILE_TREE_REFERENCE_DEFAULTS_KEY = "quake-web:fileTreeReferenceDefaultsV1";

type MutationDialogState = { kind: "file" | "directory" | "rename"; parent: string; entry?: WorkspaceEntry };

type SessionFilesState = {
  query: string;
  showHidden: boolean;
  showGenerated: boolean;
  childrenByDir: Record<string, WorkspaceEntry[]>;
  expanded: Set<string>;
  activePath: string;
  treeWindowSize: number;
  revealPath: string;
};

const filesStateBySession = new Map<string, SessionFilesState>();

function initialFileVisibility(key: "quake-web:showHiddenFiles" | "quake-web:showGeneratedFiles"): boolean {
  if (readStorageValue(FILE_TREE_REFERENCE_DEFAULTS_KEY, "0") !== "1") {
    writeStorageValue(FILE_TREE_REFERENCE_DEFAULTS_KEY, "1");
    writeStorageValue("quake-web:showHiddenFiles", "1");
    writeStorageValue("quake-web:showGeneratedFiles", "1");
  }
  return readStorageValue(key, "1") !== "0";
}

type Props = {
  sessionKey: string;
  workspaceKey: string;
  loading?: boolean;
  currentFileDir: string;
  onOpenDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenMonaco: (path: string) => void;
  onReveal: (path: string) => void;
  onAskFile: (path: string) => void;
  onSummarizeFile: (path: string) => void;
  onCopyPath: (path: string) => void;
  onAddContext?: (path: string, type: "file" | "directory") => void;
};

export function FilesPanel(props: Props) {
  const { t } = useI18n();
  const stateKey = `${props.workspaceKey || "workspace"}::${props.sessionKey}`;
  const restoredState = useMemo(() => filesStateBySession.get(stateKey), [stateKey]);
  const storeFiles = useAppStore((state) => state.files);
  const showToast = useAppStore((state) => state.showToast);
  const rootFiles = useMemo(() => normalizeEntries(storeFiles), [storeFiles]);
  const [query, setQuery] = useState(() => restoredState?.query || "");
  const [showHidden, setShowHidden] = useState(() => restoredState?.showHidden ?? initialFileVisibility("quake-web:showHiddenFiles"));
  const [showGenerated, setShowGenerated] = useState(() => restoredState?.showGenerated ?? initialFileVisibility("quake-web:showGeneratedFiles"));
  const [childrenByDir, setChildrenByDir] = useState<Record<string, WorkspaceEntry[]>>(() => restoredState?.childrenByDir || {});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(restoredState?.expanded || [".", ...ancestorDirs(props.currentFileDir || ".")]));
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set());
  const [searchResults, setSearchResults] = useState<WorkspaceEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [activePath, setActivePath] = useState(() => restoredState?.activePath || normalizeDir(props.currentFileDir || "."));
  const [treeWindowSize, setTreeWindowSize] = useState(() => restoredState?.treeWindowSize || FILE_TREE_INITIAL_WINDOW);
  const [revealPath, setRevealPath] = useState(() => restoredState?.revealPath || "");
  const [treeError, setTreeError] = useState("");
  const [mutationDialog, setMutationDialog] = useState<MutationDialogState>();
  const [mutationValue, setMutationValue] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [mutating, setMutating] = useState(false);
  const treeRef = useRef<HTMLDivElement>(null);
  const mutationInputRef = useRef<HTMLInputElement>(null);
  const childLoadSeqRef = useRef(new Map<string, number>());
  const searchSeqRef = useRef(0);
  const mutationDialogRef = useModalFocusTrap<HTMLFormElement>(Boolean(mutationDialog));
  const contextMenu = useContextMenu();
  const { confirm, ConfirmPortal } = useConfirm();

  useEffect(() => {
    filesStateBySession.set(stateKey, {
      query,
      showHidden,
      showGenerated,
      childrenByDir,
      expanded: new Set(expanded),
      activePath,
      treeWindowSize,
      revealPath,
    });
  }, [stateKey, query, showHidden, showGenerated, childrenByDir, expanded, activePath, treeWindowSize, revealPath]);

  useEffect(() => {
    const currentDir = normalizeDir(props.currentFileDir || ".");
    setChildrenByDir((tree) => ({ ...tree, [currentDir]: rootFiles }));
  }, [props.currentFileDir, rootFiles]);

  useEffect(() => {
    if (!childrenByDir["."]) void loadChildren(".", true);
  }, [stateKey]);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) {
      searchSeqRef.current += 1;
      setSearchResults([]);
      setSearching(false);
      return;
    }
    const sequence = ++searchSeqRef.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchResults([]);
      try {
        const response = await apiGet<{ entries: unknown }>(`/api/files/search?q=${encodeURIComponent(value)}&${fileTreeOptions(showHidden, showGenerated)}&limit=240`);
        if (sequence === searchSeqRef.current) setSearchResults(normalizeEntries(response.entries));
      } catch (error) {
        if (sequence === searchSeqRef.current) showToast(t("files.searchFailed", { error: errorMessage(error, t("files.unknownError")) }), "error");
      } finally {
        if (sequence === searchSeqRef.current) setSearching(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, showHidden, showGenerated, showToast]);

  useEffect(() => {
    if (!mutationDialog) return;
    setMutationError("");
    setMutationValue(mutationDialog.kind === "rename" ? mutationDialog.entry?.name || "" : "");
    const timer = window.setTimeout(() => mutationInputRef.current?.select(), 30);
    return () => window.clearTimeout(timer);
  }, [mutationDialog]);

  useEffect(() => {
    if (!mutationDialog) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || mutating) return;
      event.preventDefault();
      setMutationDialog(undefined);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [mutationDialog, mutating]);

  const normalizedCurrentDir = normalizeDir(props.currentFileDir || ".");
  const rootEntries = childrenByDir["."] || (normalizedCurrentDir === "." ? rootFiles : []);
  const searchQuery = query.trim().toLowerCase();
  const treeSelection = useMemo(
    () => searchQuery ? { rows: [], total: 0 } : selectVisibleTreeRows(childrenByDir, rootEntries, expanded, showHidden, showGenerated, treeWindowSize),
    [searchQuery, childrenByDir, rootEntries, expanded, showHidden, showGenerated, treeWindowSize],
  );
  const keyboardEntries = searchQuery ? searchResults : treeSelection.rows.map((row) => row.entry);
  const hiddenCount = Math.max(0, treeSelection.total - treeSelection.rows.length);

  async function loadChildren(path: string, force = false, visibility = { hidden: showHidden, generated: showGenerated }): Promise<WorkspaceEntry[]> {
    const directory = normalizeDir(path);
    if (!force && childrenByDir[directory]) return childrenByDir[directory];
    const sequence = (childLoadSeqRef.current.get(directory) || 0) + 1;
    childLoadSeqRef.current.set(directory, sequence);
    setLoadingDirs((current) => new Set(current).add(directory));
    setTreeError("");
    try {
      const response = await apiGet<{ entries: unknown }>(`/api/files?path=${encodeURIComponent(directory)}&${fileTreeOptions(visibility.hidden, visibility.generated)}`);
      const entries = normalizeEntries(response.entries);
      if (childLoadSeqRef.current.get(directory) === sequence) setChildrenByDir((tree) => ({ ...tree, [directory]: entries }));
      return entries;
    } catch (error) {
      if (childLoadSeqRef.current.get(directory) === sequence) {
        const message = t("files.folderReadFailed", { error: errorMessage(error, t("files.unknownError")) });
        setTreeError(message);
        showToast(message, "error");
      }
      return [];
    } finally {
      if (childLoadSeqRef.current.get(directory) === sequence) {
        setLoadingDirs((current) => { const next = new Set(current); next.delete(directory); return next; });
      }
    }
  }

  async function refreshDirectory(path: string) {
    const directory = normalizeDir(path);
    await loadChildren(directory, true);
    if (directory === normalizedCurrentDir) props.onOpenDir(directory);
  }

  async function toggleDirectory(path: string) {
    const directory = normalizeDir(path);
    const opening = !expanded.has(directory);
    setExpanded((current) => { const next = new Set(current); opening ? next.add(directory) : next.delete(directory); return next; });
    setActivePath(directory);
    if (opening) await loadChildren(directory);
  }

  async function revealEntry(path: string) {
    const target = normalizeDir(path);
    const directory = parentDir(target);
    const ancestors = directory === "." ? [] : ancestorDirs(directory);
    for (const ancestor of [".", ...ancestors]) await loadChildren(ancestor);
    setExpanded((current) => new Set([...current, ".", ...ancestors]));
    setActivePath(target);
    setRevealPath(target);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-file-path="${CSS.escape(target)}"]`)?.scrollIntoView({ block: "nearest" }));
    window.setTimeout(() => setRevealPath((value) => value === target ? "" : value), 950);
  }

  function activateEntry(entry: WorkspaceEntry) {
    setActivePath(entry.path);
    if (entry.type === "directory") void toggleDirectory(entry.path);
    else props.onOpenFile(entry.path);
  }

  function handleTreeKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!keyboardEntries.length) return;
    let index = keyboardEntries.findIndex((entry) => entry.path === activePath);
    if (index < 0) index = 0;
    const moveTo = (nextIndex: number) => {
      const next = keyboardEntries[Math.max(0, Math.min(keyboardEntries.length - 1, nextIndex))];
      if (!next) return;
      setActivePath(next.path);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-file-path="${CSS.escape(next.path)}"]`)?.scrollIntoView({ block: "nearest" }));
    };
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); moveTo(index + (event.key === "ArrowDown" ? 1 : -1)); return; }
    if (event.key === "Home" || event.key === "End") { event.preventDefault(); moveTo(event.key === "Home" ? 0 : keyboardEntries.length - 1); return; }
    if (event.key === "PageDown" || event.key === "PageUp") { event.preventDefault(); moveTo(index + (event.key === "PageDown" ? 12 : -12)); return; }
    const entry = keyboardEntries[index];
    if (event.key === "Enter") { event.preventDefault(); event.ctrlKey || event.metaKey ? entry.type === "file" && props.onOpenMonaco(entry.path) : activateEntry(entry); return; }
    if (event.key === "ArrowRight" && entry.type === "directory") {
      event.preventDefault();
      if (!expanded.has(entry.path)) void toggleDirectory(entry.path);
      else moveTo(index + 1);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (entry.type === "directory" && expanded.has(entry.path)) void toggleDirectory(entry.path);
      else setActivePath(parentDir(entry.path));
      return;
    }
    if (event.key === "F2") { event.preventDefault(); openMutation("rename", parentDir(entry.path), entry); return; }
    if (event.key === "Delete") { event.preventDefault(); void deleteEntry(entry); return; }
    if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); }
  }

  function menuItems(entry: WorkspaceEntry): MenuItem[] {
    const file = entry.type === "file";
    return [
      { id: "open", label: file ? t("files.preview") : expanded.has(entry.path) ? t("files.collapse") : t("files.expand"), icon: file ? <ExternalLink size={14} /> : <FolderSearch size={14} />, onSelect: () => activateEntry(entry) },
      ...(file ? [{ id: "editor", label: t("files.openEditor"), icon: <ExternalLink size={14} />, onSelect: () => props.onOpenMonaco(entry.path) } satisfies MenuItem] : []),
      { type: "separator" },
      { id: "context", label: t("files.addContext"), icon: <Sparkles size={14} />, onSelect: () => props.onAddContext?.(entry.path, entry.type) },
      ...(file ? [
        { id: "ask", label: t("files.askAboutFile"), onSelect: () => props.onAskFile(entry.path) } satisfies MenuItem,
        { id: "summary", label: t("files.summarize"), onSelect: () => props.onSummarizeFile(entry.path) } satisfies MenuItem,
      ] : []),
      { id: "copy", label: t("files.copyPath"), icon: <Copy size={14} />, onSelect: () => props.onCopyPath(entry.path) },
      { id: "reveal", label: t("files.revealInTree"), onSelect: () => { setQuery(""); void revealEntry(entry.path); props.onReveal(entry.path); } },
      { type: "separator" },
      { id: "rename", label: t("files.rename"), icon: <Pencil size={14} />, onSelect: () => openMutation("rename", parentDir(entry.path), entry) },
      { id: "delete", label: t("files.delete"), icon: <Trash2 size={14} />, danger: true, onSelect: () => void deleteEntry(entry) },
    ];
  }

  function openContextMenu(event: React.MouseEvent, entry: WorkspaceEntry) {
    event.preventDefault();
    event.stopPropagation();
    setActivePath(entry.path);
    contextMenu.open(event, menuItems(entry));
  }

  function openMutation(kind: MutationDialogState["kind"], parent = activeDirectory(), entry?: WorkspaceEntry) {
    setMutationDialog({ kind, parent, entry });
  }

  function activeDirectory(): string {
    const active = keyboardEntries.find((entry) => entry.path === activePath);
    return active?.type === "directory" ? active.path : active ? parentDir(active.path) : normalizedCurrentDir;
  }

  async function submitMutation() {
    if (!mutationDialog || mutating) return;
    const name = mutationValue.trim();
    if (!isValidEntryName(name)) { setMutationError(t("files.invalidName")); return; }
    setMutating(true);
    setMutationError("");
    try {
      if (mutationDialog.kind === "file") {
        const path = joinWorkspacePath(mutationDialog.parent, name);
        await apiPost("/api/file/write", { path, content: "", createBackup: false });
        await refreshDirectory(mutationDialog.parent);
        setMutationDialog(undefined);
        props.onOpenMonaco(path);
        showToast(t("files.fileCreated"), "success");
      } else if (mutationDialog.kind === "directory") {
        const path = joinWorkspacePath(mutationDialog.parent, name);
        await apiPost("/api/file/mkdir", { path });
        await refreshDirectory(mutationDialog.parent);
        setExpanded((current) => new Set([...current, mutationDialog.parent]));
        setActivePath(path);
        setMutationDialog(undefined);
        showToast(t("files.folderCreated"), "success");
      } else if (mutationDialog.entry) {
        const destination = joinWorkspacePath(mutationDialog.parent, name);
        await apiPost("/api/file/rename", { from: mutationDialog.entry.path, to: destination });
        invalidateSubtree(mutationDialog.entry.path);
        await refreshDirectory(mutationDialog.parent);
        setActivePath(destination);
        setMutationDialog(undefined);
        showToast(t("files.renamed"), "success");
      }
    } catch (error) {
      setMutationError(errorMessage(error));
    } finally {
      setMutating(false);
    }
  }

  async function deleteEntry(entry: WorkspaceEntry) {
    const accepted = await confirm({
      title: entry.type === "directory" ? t("files.deleteFolderTitle") : t("files.deleteFileTitle"),
      message: t("files.deleteMessage", { path: entry.path, suffix: entry.type === "directory" ? t("files.deleteFolderSuffix") : "" }),
      confirmLabel: t("files.delete"),
      variant: "danger",
      requireText: entry.type === "directory" ? entry.name : undefined,
    });
    if (!accepted) return;
    try {
      await apiPost("/api/file/delete", { path: entry.path });
      invalidateSubtree(entry.path);
      await refreshDirectory(parentDir(entry.path));
      setActivePath(parentDir(entry.path));
      showToast(t("files.deleted"), "success");
    } catch (error) {
      showToast(t("files.deleteFailed", { error: errorMessage(error, t("files.unknownError")) }), "error");
    }
  }

  function invalidateSubtree(path: string) {
    setChildrenByDir((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== path && !key.startsWith(`${path}/`))));
    setExpanded((current) => new Set([...current].filter((key) => key !== path && !key.startsWith(`${path}/`))));
  }

  function updateVisibility(kind: "hidden" | "generated", value: boolean) {
    const visibility = { hidden: kind === "hidden" ? value : showHidden, generated: kind === "generated" ? value : showGenerated };
    if (kind === "hidden") { setShowHidden(value); writeStorageValue("quake-web:showHiddenFiles", value ? "1" : "0"); }
    else { setShowGenerated(value); writeStorageValue("quake-web:showGeneratedFiles", value ? "1" : "0"); }
    setChildrenByDir({});
    void loadChildren(".", true, visibility);
  }

  function renderName(name: string) {
    if (!searchQuery) return name;
    const index = name.toLowerCase().indexOf(searchQuery);
    if (index < 0) return name;
    return <>{name.slice(0, index)}<mark className={styles.match}>{name.slice(index, index + searchQuery.length)}</mark>{name.slice(index + searchQuery.length)}</>;
  }

  function renderEntry(entry: WorkspaceEntry, depth: number, isSearch = false) {
    const isDirectory = entry.type === "directory";
    const isExpanded = expanded.has(entry.path);
    const selected = activePath === entry.path;
    return (
      <div
        key={`${isSearch ? "search-" : ""}${entry.path}`}
        className={`${styles.row} ${isDirectory ? styles.directory : ""} ${isSearch ? styles.searchResult : ""} ${selected ? styles.rowSelected : ""} ${revealPath === entry.path ? styles.rowReveal : ""}`}
        style={{ "--depth": isSearch ? 0 : depth } as React.CSSProperties}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={isDirectory ? isExpanded : undefined}
        aria-level={depth + 1}
        data-file-path={entry.path}
        tabIndex={selected ? 0 : -1}
        onClick={() => {
          setActivePath(entry.path);
          if (!isDirectory) props.onOpenFile(entry.path);
        }}
        onDoubleClick={() => isDirectory ? activateEntry(entry) : props.onOpenMonaco(entry.path)}
        onContextMenu={(event) => openContextMenu(event, entry)}
      >
        <button type="button" className={styles.twist} disabled={!isDirectory} aria-label={isExpanded ? t("files.collapse") : t("files.expand")} onClick={(event) => { event.stopPropagation(); if (isDirectory) void toggleDirectory(entry.path); }}>
          {isDirectory ? isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
        </button>
        <TreeEntryIcon entry={entry} expanded={isExpanded} />
        <span className={styles.name} title={entry.path}>{renderName(entry.name)}</span>
        {loadingDirs.has(entry.path) ? <span className={styles.loading}>…</span> : null}
        <button type="button" className={styles.rowMenuButton} aria-label={t("files.rowActions", { name: entry.name })} onClick={(event) => openContextMenu(event, entry)}><MoreHorizontal size={15} /></button>
        {isSearch && <span className={styles.path}>{entry.path}</span>}
      </div>
    );
  }

  function closeExplorerMenu(event: React.MouseEvent<HTMLElement>) {
    event.currentTarget.closest("details")?.removeAttribute("open");
  }

  function explorerHeader() {
    return <div className={styles.header}>
      <label className={styles.searchWrap}>
        {/* Legacy source contract: placeholder="Dosyaları filtrele…" */}
        {searching ? <RefreshCw className={styles.searchSpinner} size={14} /> : <Search size={14} />}
        <input
          className={styles.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }}
          placeholder={t("files.searchPlaceholder")}
          aria-label={t("files.searchLabel")}
        />
        {query && <button type="button" className={styles.clearButton} aria-label={t("files.clearSearch")} onClick={() => setQuery("")}><X size={13} /></button>}
      </label>
      <details className={styles.optionsMenu}>
        <summary className={styles.optionsTrigger} aria-label={t("files.options")} title={t("files.options")}><MoreHorizontal size={15} /></summary>
        <div className={styles.optionsPopover}>
          <button type="button" onClick={(event) => { openMutation("file"); closeExplorerMenu(event); }}><FilePlus2 size={14} /><span>{t("files.newFile")}</span></button>
          <button type="button" onClick={(event) => { openMutation("directory"); closeExplorerMenu(event); }}><FolderPlus size={14} /><span>{t("files.newFolder")}</span></button>
          <div className={styles.optionsSeparator} />
          <button type="button" onClick={(event) => { void refreshDirectory(activeDirectory()); closeExplorerMenu(event); }}><RefreshCw size={14} /><span>{t("files.refresh")}</span></button>
          <button type="button" onClick={(event) => { setExpanded(new Set(["."])); closeExplorerMenu(event); }}><ChevronsDownUp size={14} /><span>{t("files.collapseAll")}</span></button>
          <button type="button" onClick={(event) => { void revealEntry(activePath); closeExplorerMenu(event); }}><FolderSearch size={14} /><span>{t("files.revealSelection")}</span></button>
          <div className={styles.optionsSeparator} />
          <label><input type="checkbox" checked={showHidden} onChange={(event) => updateVisibility("hidden", event.target.checked)} /><span>{t("files.hiddenFiles")}</span></label>
          <label><input type="checkbox" checked={showGenerated} onChange={(event) => updateVisibility("generated", event.target.checked)} /><span>{t("files.generatedFiles")}</span></label>
        </div>
      </details>
    </div>;
  }

  if (props.loading && !rootEntries.length) {
    return <div className={styles.panel}>{explorerHeader()}<SkeletonLines count={12} /></div>;
  }

  return (
    <div className={`${styles.panel} files-panel`}>
      {explorerHeader()}

      <div id="files" ref={treeRef} className={styles.tree} role="tree" aria-label={t("files.workspaceTree")} aria-busy={searching} tabIndex={0} onKeyDown={handleTreeKeyDown}>
        {searchQuery ? searchResults.map((entry) => renderEntry(entry, 0, true)) : treeSelection.rows.map((row) => renderEntry(row.entry, row.depth))}
        {!searchQuery && hiddenCount > 0 && <button type="button" className={styles.loadMore} onClick={() => setTreeWindowSize((value) => value + FILE_TREE_WINDOW_STEP)}>{t("files.nextItems", { count: Math.min(hiddenCount, FILE_TREE_WINDOW_STEP) })} <span>{t("files.remaining", { count: hiddenCount })}</span></button>}
        {treeError && !searchQuery && <div className={styles.errorState}><span>{treeError}</span><button type="button" onClick={() => void loadChildren(".", true)}>{t("files.retry")}</button></div>}
        {!treeError && !rootEntries.length && !searchQuery && <div className={styles.empty}>{t("files.emptyFolder")}</div>}
        {searchQuery && !searching && !searchResults.length && <div className={styles.empty}>{t("files.noMatch", { query: query.trim() })}</div>}
      </div>
      {contextMenu.menu}
      <ConfirmPortal />
      {mutationDialog && (
        <div className={styles.mutateBackdrop} role="presentation" onMouseDown={() => !mutating && setMutationDialog(undefined)}>
          <form ref={mutationDialogRef} className={styles.mutateDialog} role="dialog" aria-modal="true" aria-labelledby="file-mutation-title" tabIndex={-1} onSubmit={(event) => { event.preventDefault(); void submitMutation(); }} onMouseDown={(event) => event.stopPropagation()}>
            <h3 id="file-mutation-title">{mutationTitle(mutationDialog.kind, t)}</h3>
            <p>{mutationDialog.parent === "." ? t("files.dialog.workspaceRoot") : mutationDialog.parent}</p>
            <input ref={mutationInputRef} aria-label={mutationDialog.kind === "rename" ? t("files.dialog.newName") : mutationDialog.kind === "directory" ? t("files.dialog.folderName") : t("files.dialog.fileName")} value={mutationValue} onChange={(event) => setMutationValue(event.target.value)} placeholder={mutationDialog.kind === "file" ? t("files.dialog.filePlaceholder") : mutationDialog.kind === "directory" ? t("files.dialog.folderPlaceholder") : t("files.dialog.renamePlaceholder")} disabled={mutating} />
            <div className={styles.mutateError} role="alert">{mutationError}</div>
            <div className={styles.mutateActions}><button type="button" onClick={() => setMutationDialog(undefined)} disabled={mutating}>{t("files.dialog.cancel")}</button><button type="submit" disabled={mutating}>{mutating ? t("files.dialog.processing") : mutationDialog.kind === "rename" ? t("files.dialog.rename") : t("files.dialog.create")}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

function fileTreeOptions(showHidden: boolean, showGenerated: boolean): string {
  return `hidden=${showHidden ? "1" : "0"}&generated=${showGenerated ? "1" : "0"}`;
}

function mutationTitle(kind: MutationDialogState["kind"], t: Translate): string {
  if (kind === "file") return t("files.dialog.newFile");
  if (kind === "directory") return t("files.dialog.newFolder");
  return t("files.dialog.rename");
}

function errorMessage(error: unknown, fallback = "Unknown error"): string {
  return error instanceof Error ? error.message : fallback;
}

export default FilesPanel;
