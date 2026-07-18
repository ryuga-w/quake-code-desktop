// CLASSIC JSX runtime: React must be imported at the very top. A missing React
// import here would blank the entire app, so do not remove this line.
import React from "react";
import { createPortal } from "react-dom";
import { Bot, CirclePlus, Folder, Globe, Smartphone, SquareTerminal, X, Zap } from "lucide-react";
import { focusFirstMenuItem, handleMenuKeyDown, restoreMenuTriggerFocus } from "../../lib/menu-keyboard";
import styles from "./QuickLauncher.module.css";

/**
 * QuickLauncher — Codex-Desktop tarzi hizli baslatici.
 *
 * Iki kullanim destekler (variant prop'u):
 *
 * - "popover" (varsayilan): Sag kenara sabitlenmis kucuk yuzen bir tetikleyici
 *   dugme. Tiklaninca dikey bir popover acilir; dock panellerini ikonlari ve
 *   klavye-kisayol ipuclariyla listeler. Popover document.body'ye portal edilir,
 *   Esc / disari tiklamada kapanir.
 *
 * - "panel": Bos sag dock icine gomulu Codex referansindaki dort satirlik
 *   baslatici. Mobil gibi ek yuzeyler panel sekmesi ekleme menusunde kalir.
 *
 * Her oge onOpen geri cagrimini ilgili panel kimligiyle cagirir. Tum
 * renkler/olculer tasarim token'lariyla tanimli, boylece aydinlik/karanlik
 * tema otomatik calisir.
 *
 * Git/inceleme paneli yok — proje gitsizdir.
 */

/** QuickLauncher'in acabilecegi dock paneli kimlikleri. */
export type QuickLauncherPanel = "files" | "terminal" | "browser" | "mobile" | "sidechat" | "agents";

/** Bilesenin gorsel varyanti. */
export type QuickLauncherVariant = "popover" | "panel";

interface LauncherItem {
  panel: QuickLauncherPanel;
  label: string;
  /** Klavye kisayolu rozeti; bos string ise rozet gosterilmez (orn. Terminal). */
  shortcut: string;
  icon: React.ReactNode;
}

const POPOVER_ITEMS: LauncherItem[] = [
  { panel: "terminal", label: "Terminal", shortcut: "", icon: <SquareTerminal size={18} strokeWidth={2} aria-hidden="true" /> },
  { panel: "browser", label: "Tarayıcı", shortcut: "Ctrl+T", icon: <Globe size={18} strokeWidth={2} aria-hidden="true" /> },
  { panel: "mobile", label: "Mobil", shortcut: "", icon: <Smartphone size={18} strokeWidth={2} aria-hidden="true" /> },
  { panel: "files", label: "Dosyalar", shortcut: "Ctrl+P", icon: <Folder size={18} strokeWidth={2} aria-hidden="true" /> },
  { panel: "agents", label: "Ajanlar", shortcut: "", icon: <Bot size={18} strokeWidth={2} aria-hidden="true" /> },
];

const PANEL_ITEMS: LauncherItem[] = [
  { panel: "files", label: "Dosyalar", shortcut: "Ctrl+P", icon: <Folder size={16} strokeWidth={1.65} aria-hidden="true" /> },
  { panel: "sidechat", label: "Yan görev", shortcut: "Ctrl+Alt+S", icon: <CirclePlus size={16} strokeWidth={1.65} aria-hidden="true" /> },
  { panel: "browser", label: "Tarayıcı", shortcut: "Ctrl+T", icon: <Globe size={16} strokeWidth={1.65} aria-hidden="true" /> },
  { panel: "terminal", label: "Terminal", shortcut: "", icon: <SquareTerminal size={16} strokeWidth={1.65} aria-hidden="true" /> },
];

/**
 * Props:
 * - onOpen: secilen dock panelini acan geri cagrim.
 * - variant: "popover" (varsayilan, yuzen tetikleyici) | "panel" (dock-ici dikey liste).
 */
export function QuickLauncher({
  onOpen,
  variant = "popover",
}: {
  onOpen: (panel: QuickLauncherPanel) => void;
  variant?: QuickLauncherVariant;
}) {
  // --- "panel" varyanti: bos sag dock icinde dikey liste. ---
  if (variant === "panel") {
    return (
      <div
        className={styles.panel}
        role="menu"
        aria-label="Panelleri aç"
        onKeyDown={(event) => handleMenuKeyDown(event)}
      >
        <ul className={styles.panelList}>
          {PANEL_ITEMS.map((item) => (
            <li key={item.panel}>
              <button
                type="button"
                role="menuitem"
                className={styles.panelItem}
                onClick={() => onOpen(item.panel)}
              >
                <span className={styles.panelItemIcon}>{item.icon}</span>
                <span className={styles.panelItemLabel}>{item.label}</span>
                {item.shortcut ? <kbd className={styles.kbd}>{item.shortcut}</kbd> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // --- "popover" varyanti (varsayilan): yuzen tetikleyici + portal popover. ---
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);

  const close = React.useCallback(() => {
    setOpen(false);
    // Kapaninca odagi tetikleyiciye geri ver.
    restoreMenuTriggerFocus(triggerRef.current);
  }, []);

  // --- Esc + disari mousedown ile kapat. ---
  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target)) return; // popover ici
      if (triggerRef.current?.contains(target)) return; // tetikleyici (toggle kendisi yonetir)
      close();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [open, close]);

  // Popover acildiginda ilk ogeye odaklan.
  React.useEffect(() => {
    if (!open) return;
    focusFirstMenuItem(popoverRef.current);
  }, [open]);

  const handleSelect = React.useCallback(
    (panel: QuickLauncherPanel) => {
      setOpen(false);
      onOpen(panel);
    },
    [onOpen],
  );

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerActive : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Hızlı başlatıcı"
        title="Hızlı başlatıcı"
      >
        {open ? <X size={18} strokeWidth={2} aria-hidden="true" /> : <Zap size={18} strokeWidth={2} aria-hidden="true" />}
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className={styles.popover}
            role="menu"
            aria-label="Hızlı başlatıcı panelleri"
            onKeyDown={(event) => handleMenuKeyDown(event, { onEscape: close })}
          >
            <div className={styles.head}>Panelleri aç</div>
            {POPOVER_ITEMS.map((item) => (
              <button
                key={item.panel}
                type="button"
                data-launcher-item
                role="menuitem"
                className={styles.item}
                onClick={() => handleSelect(item.panel)}
              >
                <span className={styles.itemIcon}>{item.icon}</span>
                <span className={styles.itemLabel}>{item.label}</span>
                {item.shortcut ? <kbd className={styles.kbd}>{item.shortcut}</kbd> : null}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
