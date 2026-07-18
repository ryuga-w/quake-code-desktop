import React from "react";
import { createPortal } from "react-dom";
import { CirclePlus, Folder, Globe2, Maximize2, PanelRight } from "lucide-react";
import type { DockTab, RightTab } from "../../types";
import { faviconUrl } from "../../lib/extract-web-sources";
import { focusFirstMenuItem, handleMenuKeyDown, restoreMenuTriggerFocus } from "../../lib/menu-keyboard";

function getBrowserFavicon(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return faviconUrl(parsed.hostname, 32);
  } catch {
    return "";
  }
}

const DOCK_ADD_ITEMS: Array<{
  tab: DockTab;
  label: string;
  shortcut: string;
  ariaKeyShortcuts: string;
  icon: React.ReactNode;
}> = [
  { tab: "files", label: "Dosyalar", shortcut: "Ctrl+P", ariaKeyShortcuts: "Control+P", icon: <Folder aria-hidden="true" /> },
  { tab: "sidechat", label: "Yan görev", shortcut: "Ctrl+Alt+S", ariaKeyShortcuts: "Control+Alt+S", icon: <CirclePlus aria-hidden="true" /> },
  { tab: "browser", label: "Tarayıcı", shortcut: "Ctrl+T", ariaKeyShortcuts: "Control+T", icon: <Globe2 aria-hidden="true" /> },
];

// Codex tarzi minimal dock basligi: bosken (launcher) sol bos + sagda 3 duzen
// ikonu (genislet / alt-panel Ctrl+J / sag-paneli kapat). Bir arac acikken solda
// "geri" (launcher'a don) + arac basligi.
export function RightPanelTabs({ active, tabs, addOpen, launcherExpanded, browserLayout, browserFocusComposer, browserTitle, browserUrl, filesLayout, onClose, onCloseTab, onToggleAdd, onToggleLauncherExpand, onChange, onBrowserLayout, onBrowserFocusComposer, onFilesLayout }: { active: RightTab; tabs: DockTab[]; addOpen: boolean; launcherExpanded: boolean; browserLayout: "dock" | "split" | "focus"; browserFocusComposer: "hidden" | "mini" | "open"; browserTitle?: string; browserUrl?: string; filesLayout: "dock" | "split" | "focus"; onClose: () => void; onCloseTab: (tab: DockTab) => void; onToggleAdd: () => void; onToggleLauncherExpand: () => void; onChange: (tab: RightTab) => void; onBrowserLayout: (layout: "dock" | "split" | "focus") => void; onBrowserFocusComposer: (mode: "hidden" | "mini" | "open") => void; onFilesLayout: (layout: "dock" | "split" | "focus") => void }) {
  const isLauncher = active === "launcher";
  const browserFavicon = getBrowserFavicon(browserUrl || "");
  const dynamicTabKind = active === "sidechat" || active === "subagents" ? active : undefined;
  const addTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const addMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [addMenuPosition, setAddMenuPosition] = React.useState({ left: 8, top: 8 });
  const closeAddMenu = React.useCallback(() => {
    if (!addOpen) return;
    onToggleAdd();
    restoreMenuTriggerFocus(addTriggerRef.current);
  }, [addOpen, onToggleAdd]);

  React.useEffect(() => {
    if (addOpen) focusFirstMenuItem(addMenuRef.current);
  }, [addOpen]);

  React.useLayoutEffect(() => {
    if (!addOpen) return;
    const positionMenu = () => {
      const trigger = addTriggerRef.current;
      if (!trigger) return;
      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = addMenuRef.current?.getBoundingClientRect();
      const menuWidth = menuRect?.width || Math.min(280, window.innerWidth - 16);
      const menuHeight = menuRect?.height || 108;
      const left = Math.min(
        Math.max(8, triggerRect.left - 8),
        Math.max(8, window.innerWidth - menuWidth - 8),
      );
      const top = Math.min(
        Math.max(8, triggerRect.bottom + 5),
        Math.max(8, window.innerHeight - menuHeight - 8),
      );
      setAddMenuPosition({ left, top });
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [addOpen]);

  React.useEffect(() => {
    if (!addOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (addTriggerRef.current?.contains(target) || addMenuRef.current?.contains(target)) return;
      closeAddMenu();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [addOpen, closeAddMenu]);

  const dockTabLabel = (tab: string) =>
    tab === "files" ? "Dosyalar" : tab === "browser" ? "Tarayıcı" : tab === "mobile" ? "Mobil" : tab === "sidechat" ? "Yan görev" : tab === "subagents" ? "Alt ajanlar" : tab === "agents" ? "Ajanlar" : tab === "review" ? "İnceleme" : "Plan";
  return (
    <div className={`dock-header ${isLauncher ? "dock-header-launcher" : ""} ${active === "browser" ? "dock-header-browser" : ""}`}>
      <div className="dock-header-left dock-tab-strip" role="tablist" aria-label="Sağ panel sekmeleri">
        {!isLauncher && <React.Fragment>
        {tabs.map((tab) => {
          if (tab === active && dynamicTabKind) {
            return <div className="dock-dynamic-tab-slot" data-dock-dynamic-tabs={dynamicTabKind} key={tab} />;
          }
          const label = tab === "browser" ? (browserTitle || "Tarayıcı") : dockTabLabel(tab);
          return (
            <div className={`dock-workspace-tab ${tab === "browser" ? "dock-browser-tab" : ""} ${active === tab ? "active" : ""}`} key={tab}>
              <button type="button" role="tab" aria-selected={active === tab} onClick={() => onChange(tab)}>
                {tab === "browser" && <span className="dock-tab-favicon" aria-hidden="true"><Globe2 />{browserFavicon && <img src={browserFavicon} alt="" onError={(event) => event.currentTarget.remove()} />}</span>}
                {tab === "review" && <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h5"/></svg>}
                <span>{label}</span>
              </button>
              <button type="button" className="dock-tab-close" aria-label={`${label} sekmesini kapat`} onClick={() => onCloseTab(tab)}>×</button>
            </div>
          );
        })}
        <div className="dock-add-wrap">
          <button
            ref={addTriggerRef}
            type="button"
            className="dock-add-button"
            aria-label="Yeni panel sekmesi"
            title="Yeni panel sekmesi"
            aria-haspopup="menu"
            aria-expanded={addOpen}
            onClick={onToggleAdd}
          >
            +
          </button>
          {addOpen && typeof document !== "undefined" && createPortal(
            <div
              ref={addMenuRef}
              className="dock-add-menu"
              role="menu"
              aria-label="Eklenecek panel"
              style={{ left: addMenuPosition.left, top: addMenuPosition.top }}
              onKeyDown={(event) => handleMenuKeyDown(event, { onEscape: closeAddMenu })}
            >
              {DOCK_ADD_ITEMS.map((item) => (
                <button
                  key={item.tab}
                  type="button"
                  role="menuitem"
                  aria-keyshortcuts={item.ariaKeyShortcuts}
                  onClick={() => onChange(item.tab)}
                >
                  <span className="dock-add-menu-icon">{item.icon}</span>
                  <span className="dock-add-menu-label">{item.label}</span>
                  <kbd>{item.shortcut}</kbd>
                </button>
              ))}
            </div>,
            document.body,
          )}
        </div>
        </React.Fragment>}
      </div>
      <div className="dock-header-right">
        {isLauncher && <button type="button" className="dock-launcher-expand" title={launcherExpanded ? "Paneli önceki boyuta getir" : "Paneli genişlet"} aria-label={launcherExpanded ? "Sağ paneli önceki boyuta getir" : "Sağ paneli genişlet"} aria-pressed={launcherExpanded} onClick={onToggleLauncherExpand}><Maximize2 aria-hidden="true" /></button>}
        {active === "files" && (
          <div className="browser-layout-switch" role="group" aria-label="Dosya çalışma alanı yerleşimi">
            <button type="button" className={filesLayout === "dock" ? "active" : ""} title="Dar dosya paneli" aria-label="Dosya panelini dar yap" aria-pressed={filesLayout === "dock"} onClick={() => onFilesLayout("dock")}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16" /></svg></button>
            <button type="button" className={filesLayout === "split" ? "active" : ""} title="Dosya ve önizleme yarım ekran" aria-label="Dosya çalışma alanını yarım ekran yap" aria-pressed={filesLayout === "split"} onClick={() => onFilesLayout("split")}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16" /></svg></button>
            <button type="button" className={filesLayout === "focus" ? "active" : ""} title="Dosya çalışma alanı odak modu" aria-label="Dosya çalışma alanı odak modunu aç" aria-pressed={filesLayout === "focus"} onClick={() => onFilesLayout("focus")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M8 21H5a2 2 0 0 1-2-2v-3m18 0v3a2 2 0 0 1-2 2h-3" /></svg></button>
          </div>
        )}
        {active === "browser" && (
          <div className="browser-layout-switch browser-chrome-actions" role="group" aria-label="Tarayıcı görünümü">
            <button type="button" className={browserLayout === "focus" ? "active" : ""} title={browserLayout === "focus" ? "Odak görünümünden çık" : "Odak görünümü"} aria-label={browserLayout === "focus" ? "Tarayıcı odak görünümünden çık" : "Tarayıcı odak görünümünü aç"} aria-pressed={browserLayout === "focus"} onClick={() => onBrowserLayout(browserLayout === "focus" ? "dock" : "focus")}><Maximize2 aria-hidden="true" /></button>
            <button type="button" className="browser-chrome-close" title="Tarayıcı panelini kapat" aria-label="Tarayıcı panelini kapat" onClick={() => { if (browserLayout === "focus") onBrowserLayout("dock"); onClose(); }}><PanelRight aria-hidden="true" /></button>
          </div>
        )}
        {((active === "browser" && browserLayout === "focus") || (active === "files" && filesLayout === "focus")) && <>
          <div className="focus-composer-switch" role="group" aria-label="Quake komut kutusu görünümü">
            <button type="button" className={browserFocusComposer === "hidden" ? "active" : ""} onClick={() => onBrowserFocusComposer("hidden")} title="Komut kutusunu gizle">Gizli</button>
            <button type="button" className={browserFocusComposer === "mini" ? "active" : ""} onClick={() => onBrowserFocusComposer("mini")} title="Mini komut kutusu">Mini</button>
            <button type="button" className={browserFocusComposer === "open" ? "active" : ""} onClick={() => onBrowserFocusComposer("open")} title="Sohbeti aç">Açık</button>
          </div>
          <button type="button" className="browser-focus-exit" title="Odak modundan çık (Esc)" aria-label="Odak modundan çık" onClick={() => active === "browser" ? onBrowserLayout("dock") : onFilesLayout("dock")}><span>Odaktan çık</span><kbd>Esc</kbd></button>
        </>}
        {active !== "browser" && !(active === "files" && filesLayout === "focus") && <button type="button" className={isLauncher ? "dock-launcher-close" : ""} title="Paneli kapat" aria-label="Sağ paneli kapat" onClick={onClose}>{isLauncher ? <PanelRight aria-hidden="true" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>}</button>}
      </div>
    </div>
  );
}
