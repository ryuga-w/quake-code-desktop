import React, { useRef, useState } from "react";
import { readStorageValue, writeStorageValue } from "../../lib/storage";
import { normalizeSessionDraftKey } from "../../lib/client-ids";
import type { DockTab, RightTab, TurnReviewView } from "../../types";

export type BrowserLayout = "dock" | "split" | "focus";
export type BrowserFocusComposer = "hidden" | "mini" | "open";
export type FilesLayout = "dock" | "split" | "focus";

export type FilePreviewSnapshot = { path?: string; content: string };

export type SessionRightPanelSnapshot = {
  open: boolean;
  activeTab: RightTab;
  dockTabs: DockTab[];
  review: TurnReviewView | null;
  fileDir: string;
  filePreview: FilePreviewSnapshot;
  browserLayout: BrowserLayout;
  browserFocusComposer: BrowserFocusComposer;
  filesLayout: FilesLayout;
  width: number;
};

export type UseRightDockOptions = {
  /** Left sidebar open — used when sizing focus/split layouts. */
  leftOpen?: boolean;
  /** Current resizable left sidebar width. */
  leftWidth?: number;
  /** Close bottom terminal when browser enters focus layout. */
  setBottomOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  /** Focus prompt when browser-focus composer mode becomes visible. */
  promptRef?: React.RefObject<HTMLTextAreaElement | null>;
  /** Bump file-preview request seq when dock closes / switches away from preview. */
  onInvalidatePendingPreview?: () => void;
  /** Read external file-tree/preview fields for session snapshots. */
  getFileSnapshot?: () => { fileDir: string; filePreview: FilePreviewSnapshot };
  /** Restore external file-tree/preview fields from a session snapshot. */
  applyFileSnapshot?: (snapshot: { fileDir: string; filePreview: FilePreviewSnapshot }) => void;
  /** Seed for activeRightPanelKeyRef (session file / id). */
  initialSessionKey?: string;
  /** handleOpenPanel("terminal") → open bottom terminal panel. */
  onOpenTerminal?: () => void;
  /** handleOpenPanel("computer") → @bilgisayar mention flow (owned by App). */
  onOpenComputer?: () => void;
};

const DEFAULT_FILE_PREVIEW: FilePreviewSnapshot = { content: "Dosya seçilmedi" };

function readLayoutStorage<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  const stored = readStorageValue(key, fallback);
  return (allowed as readonly string[]).includes(stored) ? (stored as T) : fallback;
}

/**
 * Owns right-dock open/tab/layout state and the session-scoped panel snapshot map.
 * External couplings (left sidebar, bottom panel, prompt focus, file preview) are
 * injected so App can wire them without moving non-dock ownership here.
 */
export function useRightDock(options: UseRightDockOptions = {}) {
  const leftOpen = options.leftOpen ?? true;
  const leftWidth = options.leftWidth ?? 340;
  const initialSessionKey = options.initialSessionKey ?? "boot";

  const [rightTab, setRightTab] = useState<RightTab>("launcher");
  const [dockTabs, setDockTabs] = useState<DockTab[]>([]);
  const [turnReview, setTurnReview] = useState<TurnReviewView | null>(null);
  const [dockAddOpen, setDockAddOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [rightWidth, setRightWidth] = useState(() => Number(readStorageValue("quake-web:rightWidth")) || 400);
  const [browserLayout, setBrowserLayout] = useState<BrowserLayout>(() =>
    readLayoutStorage("quake-web:browserLayout", "dock", ["dock", "split", "focus"] as const),
  );
  const [browserFocusComposer, setBrowserFocusComposer] = useState<BrowserFocusComposer>(() =>
    readLayoutStorage("quake-web:browserFocusComposer", "mini", ["hidden", "mini", "open"] as const),
  );
  const [filesLayout, setFilesLayout] = useState<FilesLayout>(() =>
    readLayoutStorage("quake-web:filesLayout", "dock", ["dock", "split", "focus"] as const),
  );

  const isDraggingRight = useRef(false);
  const rightPanelBySessionRef = useRef(new Map<string, SessionRightPanelSnapshot>());
  const activeRightPanelKeyRef = useRef(normalizeSessionDraftKey(initialSessionKey || "boot"));

  // Keep latest option callbacks available without re-binding action identities every render
  // when callers pass inline lambdas (matches App.tsx free-function behavior).
  const leftOpenRef = useRef(leftOpen);
  leftOpenRef.current = leftOpen;
  const leftWidthRef = useRef(leftWidth);
  leftWidthRef.current = leftWidth;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  function invalidatePendingPreview() {
    optionsRef.current.onInvalidatePendingPreview?.();
  }

  function setRightPanelOpen(open: boolean) {
    setRightOpen(open);
  }

  function setRightPanelTab(tab: RightTab) {
    // Active dock state is session-owned; never persist it as a global preference.
    setRightTab(tab);
  }

  function openRightPanel(tab: RightTab) {
    if (tab !== "preview") invalidatePendingPreview();
    if (tab === "files" || tab === "browser" || tab === "mobile" || tab === "plan" || tab === "sidechat" || tab === "subagents" || tab === "agents" || tab === "review") {
      setDockTabs((current) => (current.includes(tab) ? current : [...current, tab]));
    }
    setRightPanelTab(tab);
    setRightPanelOpen(true);
    if (tab === "plan") setRightWidth(Math.max(560, Math.round(window.innerWidth * 0.52)));
    if (tab === "sidechat") {
      const storedWidth = Number(readStorageValue("quake-web:rightWidth")) || 500;
      setRightWidth(Math.min(560, Math.max(440, storedWidth)));
    }
    if (tab === "subagents") {
      const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
      const available = Math.max(760, viewportWidth - (leftOpenRef.current ? leftWidthRef.current : 0));
      const desired = Math.round(available * 0.58);
      const stored = Number(readStorageValue("quake-web:subagentRightWidth"));
      const minimum = viewportWidth <= 1100 ? 440 : 500;
      const maximum = Math.min(760, Math.max(minimum, viewportWidth - 280));
      setRightWidth(Math.min(maximum, Math.max(minimum, stored || desired)));
    }
    if (tab === "agents") setRightWidth(Math.min(480, Math.max(360, Number(readStorageValue("quake-web:rightWidth")) || 420)));
  }

  function closeDockTab(tab: DockTab) {
    setDockTabs((current) => {
      const next = current.filter((item) => item !== tab);
      if (rightTab === tab) {
        const replacement = next[next.length - 1];
        setRightPanelTab(replacement || "launcher");
      }
      return next;
    });
  }

  function closeRightPanel() {
    invalidatePendingPreview();
    setRightPanelOpen(false);
  }

  function launcherExpandedWidth(): number {
    const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
    return Math.max(320, Math.min(viewportWidth - 48, Math.max(480, Math.round(viewportWidth * 0.7))));
  }

  const rightPanelExpanded = rightWidth >= launcherExpandedWidth() - 8;

  function toggleRightPanelExpanded() {
    if (rightPanelExpanded) {
      const storedWidth = Number(readStorageValue("quake-web:rightWidth")) || 400;
      setRightWidth(Math.min(480, Math.max(360, storedWidth)));
      return;
    }
    setRightWidth(launcherExpandedWidth());
  }

  function applyFilesLayout(layout: FilesLayout) {
    setFilesLayout(layout);
    writeStorageValue("quake-web:filesLayout", layout);
    setRightPanelTab("files");
    setRightPanelOpen(true);
    if (layout === "dock") {
      setRightWidth(Math.min(520, Math.max(380, Number(readStorageValue("quake-web:rightWidth")) || 440)));
    } else if (layout === "split") {
      setRightWidth(Math.round(window.innerWidth * 0.58));
    } else {
      setRightWidth(Math.max(720, window.innerWidth - (leftOpenRef.current ? leftWidthRef.current : 0) - 360));
    }
  }

  function setBrowserFocusComposerMode(mode: BrowserFocusComposer) {
    setBrowserFocusComposer(mode);
    writeStorageValue("quake-web:browserFocusComposer", mode);
    if (mode !== "hidden") requestAnimationFrame(() => optionsRef.current.promptRef?.current?.focus());
  }

  function applyBrowserLayout(layout: BrowserLayout) {
    setBrowserLayout(layout);
    writeStorageValue("quake-web:browserLayout", layout);
    setRightPanelTab("browser");
    setRightPanelOpen(true);
    if (layout === "focus") optionsRef.current.setBottomOpen?.(false);
    if (layout === "dock") {
      const width = Math.min(460, Math.max(360, Number(readStorageValue("quake-web:rightWidth")) || 400));
      setRightWidth(width);
      return;
    }
    if (layout === "split") {
      setRightWidth(Math.round(window.innerWidth * 0.55));
      return;
    }
    setRightWidth(Math.max(640, window.innerWidth - (leftOpenRef.current ? leftWidthRef.current : 0) - 390));
  }

  function captureRightPanelSnapshot(): SessionRightPanelSnapshot {
    const file = optionsRef.current.getFileSnapshot?.() ?? {
      fileDir: ".",
      filePreview: DEFAULT_FILE_PREVIEW,
    };
    return {
      open: rightOpen,
      activeTab: rightTab,
      dockTabs: [...dockTabs],
      review: turnReview,
      fileDir: file.fileDir,
      filePreview: file.filePreview,
      browserLayout,
      browserFocusComposer,
      filesLayout,
      width: rightWidth,
    };
  }

  function saveActiveRightPanelSnapshot() {
    const key = activeRightPanelKeyRef.current;
    if (key) rightPanelBySessionRef.current.set(key, captureRightPanelSnapshot());
  }

  function activateRightPanelSnapshot(sessionKey: string) {
    const key = normalizeSessionDraftKey(sessionKey || "boot");
    const snapshot = rightPanelBySessionRef.current.get(key);
    activeRightPanelKeyRef.current = key;
    setDockAddOpen(false);
    setRightOpen(snapshot?.open ?? false);
    setRightTab(snapshot?.activeTab ?? "launcher");
    setDockTabs(snapshot ? [...snapshot.dockTabs] : []);
    setTurnReview(snapshot?.review || null);
    optionsRef.current.applyFileSnapshot?.({
      fileDir: snapshot?.fileDir || ".",
      filePreview: snapshot?.filePreview || DEFAULT_FILE_PREVIEW,
    });
    setBrowserLayout(snapshot?.browserLayout || "dock");
    setBrowserFocusComposer(snapshot?.browserFocusComposer || "mini");
    setFilesLayout(snapshot?.filesLayout || "dock");
    setRightWidth(snapshot?.width || 400);
  }

  function openTurnReview(review: TurnReviewView) {
    setTurnReview(review);
    openRightPanel("review");
    if (window.innerWidth > 1100) {
      const desiredWidth = Math.min(760, Math.max(560, Math.round(window.innerWidth * 0.43)));
      const availableWidth = Math.max(420, window.innerWidth - (leftOpenRef.current ? 700 : 430));
      setRightWidth(Math.min(desiredWidth, availableWidth));
    }
  }

  // QuickLauncher / palet panel kimliklerini ilgili hedefe yonlendir.
  // "terminal" -> alt panel; digerleri -> sag dock sekmesi.
  // Computer-Use paneli yerine @bilgisayar mention — onOpenComputer App tarafinda.
  function handleOpenPanel(panel: RightTab) {
    if (panel === "terminal") {
      optionsRef.current.onOpenTerminal?.();
      return;
    }
    if (panel === "computer") {
      optionsRef.current.onOpenComputer?.();
      return;
    }
    openRightPanel(panel);
  }

  function handleRightDragStart(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (rightTab === "browser" && browserLayout !== "dock") {
      setBrowserLayout("dock");
      writeStorageValue("quake-web:browserLayout", "dock");
    }
    if (rightTab === "files" && filesLayout !== "dock") {
      setFilesLayout("dock");
      writeStorageValue("quake-web:filesLayout", "dock");
    }

    const handle = event.currentTarget;
    const app = handle.closest<HTMLElement>("#app");
    const shell = handle.closest<HTMLElement>(".app-shell");
    const startX = event.clientX;
    const startWidth = rightWidth;
    let nextWidth = startWidth;
    let frame: number | undefined;
    isDraggingRight.current = true;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("panel-resize-active", "panel-resize-horizontal");

    const applyWidth = () => {
      frame = undefined;
      const value = `${Math.round(nextWidth)}px`;
      app?.style.setProperty("--dock-w", value);
      shell?.style.setProperty("--dock-w", value);
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (!isDraggingRight.current) return;
      const maximum = Math.max(320, window.innerWidth - 360);
      nextWidth = Math.min(Math.max(320, startWidth + startX - moveEvent.clientX), maximum);
      if (frame === undefined) frame = window.requestAnimationFrame(applyWidth);
    };
    const onUp = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      applyWidth();
      isDraggingRight.current = false;
      document.body.classList.remove("panel-resize-active", "panel-resize-horizontal");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setRightWidth(nextWidth);
      writeStorageValue("quake-web:rightWidth", String(Math.round(nextWidth)));
      if (rightTab === "subagents") writeStorageValue("quake-web:subagentRightWidth", String(Math.round(nextWidth)));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp, { once: true });
    handle.addEventListener("pointercancel", onUp, { once: true });
  }

  // Resize handle klavye ile de calisir (H4): ok tuslari ile genislik ayarla.
  function handleRightResizeKey(e: React.KeyboardEvent) {
    const clamp = (v: number) => Math.min(Math.max(320, v), Math.max(320, window.innerWidth - 360));
    const step = e.shiftKey ? 48 : 16;
    let next: number | undefined;
    if (e.key === "ArrowLeft") next = clamp(rightWidth + step);
    else if (e.key === "ArrowRight") next = clamp(rightWidth - step);
    else if (e.key === "Home") next = clamp(900);
    else if (e.key === "End") next = clamp(320);
    if (next === undefined) return;
    e.preventDefault();
    setRightWidth(next);
    writeStorageValue("quake-web:rightWidth", String(Math.round(next)));
    if (rightTab === "subagents") writeStorageValue("quake-web:subagentRightWidth", String(Math.round(next)));
  }

  return {
    // state
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

    // raw setters (App still mutates some of these directly)
    setRightTab,
    setDockTabs,
    setTurnReview,
    setDockAddOpen,
    setRightOpen,
    setRightWidth,
    setBrowserLayout,
    setBrowserFocusComposer,
    setFilesLayout,

    // refs
    isDraggingRight,
    rightPanelBySessionRef,
    activeRightPanelKeyRef,

    // actions
    setRightPanelOpen,
    setRightPanelTab,
    openRightPanel,
    closeDockTab,
    closeRightPanel,
    toggleRightPanelExpanded,
    applyFilesLayout,
    applyBrowserLayout,
    setBrowserFocusComposerMode,
    captureRightPanelSnapshot,
    saveActiveRightPanelSnapshot,
    activateRightPanelSnapshot,
    openTurnReview,
    handleOpenPanel,
    handleRightDragStart,
    handleRightResizeKey,
  };
}

export type UseRightDockReturn = ReturnType<typeof useRightDock>;
