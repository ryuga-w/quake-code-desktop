import { useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import { writeStorageValue } from "../../lib/storage";
import type { ToastState } from "../../state/app-store";
import type { RightTab } from "../../types";
import type { BrowserFocusComposer, BrowserLayout, FilesLayout } from "./useRightDock";

/**
 * Action + layout handlers for the global App keyboard shortcuts.
 * Layout fields drive focus-mode conditionals and the effect dependency list;
 * action callbacks are read via a ref so identities need not be stable.
 */
export interface AppKeyboardHandlers {
  browserLayout: BrowserLayout;
  filesLayout: FilesLayout;
  rightOpen: boolean;
  rightTab: RightTab;
  settingsOpenRef: MutableRefObject<boolean>;
  promptRef: RefObject<HTMLTextAreaElement | null>;

  toggleLeftPanel: () => void;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  setBottomOpen: Dispatch<SetStateAction<boolean>>;
  setCenterView: Dispatch<SetStateAction<"chat" | "projects" | "scheduled" | "extensions" | "history">>;
  setPromptDraft: (next: SetStateAction<string>) => void;
  showToast: (
    message: string,
    type?: ToastState["type"],
    options?: Pick<ToastState, "actionLabel" | "action">,
  ) => string;
  applyBrowserLayout: (layout: BrowserLayout) => void;
  applyFilesLayout: (layout: FilesLayout) => void;
  setBrowserFocusComposer: Dispatch<SetStateAction<BrowserFocusComposer>>;
  openTerminalPanel: () => void;
  openRightPanel: (tab: RightTab) => void;
}

/**
 * Registers the main App window keydown shortcuts (panel toggles, focus exit,
 * @bilgisayar inject, Alt+1/2/3 dock targets). Settings Escape and Shift+Tab
 * plan toggle stay in App as separate effects.
 */
export function useAppKeyboard(handlers: AppKeyboardHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const { browserLayout, filesLayout, rightOpen, rightTab } = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const h = handlersRef.current;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "b") {
        event.preventDefault();
        h.toggleLeftPanel();
      }
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        h.setCommandPaletteOpen(true);
      }
      if (mod && event.key.toLowerCase() === "j" && !h.settingsOpenRef.current) {
        event.preventDefault();
        // Ctrl+J artik alt paneli (terminal) toggle eder (Codex duzeni).
        h.setBottomOpen((open) => !open);
      }
      if (mod && !event.altKey && event.key.toLowerCase() === "p" && !h.settingsOpenRef.current) {
        event.preventDefault();
        h.openRightPanel("files");
      }
      if (mod && !event.altKey && event.key.toLowerCase() === "t" && !h.settingsOpenRef.current) {
        event.preventDefault();
        h.openRightPanel("browser");
      }
      if (mod && event.altKey && event.key.toLowerCase() === "s" && !h.settingsOpenRef.current) {
        event.preventDefault();
        h.openRightPanel("sidechat");
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "d" && !h.settingsOpenRef.current) {
        event.preventDefault();
        // Panel yerine @bilgisayar mention — computer-use tetikleyici
        h.setCenterView("chat");
        h.setPromptDraft((current) => {
          const base = String(current || "").trim();
          if (/@bilgisayar\b/i.test(base)) return base;
          return base ? `@bilgisayar ${base}` : "@bilgisayar ";
        });
        requestAnimationFrame(() => h.promptRef.current?.focus());
        h.showToast("@bilgisayar eklendi — görevini yazıp gönder", "info");
      }
      const browserFocusActive = h.browserLayout === "focus" && h.rightOpen && h.rightTab === "browser";
      const filesFocusActive = h.filesLayout === "focus" && h.rightOpen && h.rightTab === "files";
      if (event.key === "Escape" && (browserFocusActive || filesFocusActive)) {
        event.preventDefault();
        if (browserFocusActive) h.applyBrowserLayout("dock");
        else h.applyFilesLayout("dock");
        h.showToast(`${browserFocusActive ? "Tarayıcı" : "Dosya"} odak modundan çıkıldı`, "info");
      }
      if (mod && event.code === "Space" && (browserFocusActive || filesFocusActive)) {
        event.preventDefault();
        h.setBrowserFocusComposer((current) => {
          const next = current === "open" ? "mini" : "open";
          writeStorageValue("quake-web:browserFocusComposer", next);
          requestAnimationFrame(() => h.promptRef.current?.focus());
          return next;
        });
      }
      if (event.altKey && ["1", "2", "3"].includes(event.key) && !h.settingsOpenRef.current) {
        event.preventDefault();
        if (event.key === "3") h.openTerminalPanel();
        else h.openRightPanel(event.key === "1" ? "files" : "preview");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [browserLayout, filesLayout, rightOpen, rightTab]);
}
