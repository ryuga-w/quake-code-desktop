import React from "react";
import {
  PanelLeft,
  PanelRight,
  PanelBottom,
  Folder,
} from "lucide-react";
import styles from "./Titlebar.module.css";
import { desktop } from "../../lib/desktop";
import { focusFirstMenuItem, handleMenuKeyDown, restoreMenuTriggerFocus } from "../../lib/menu-keyboard";

/**
 * Frameless compact titlebar. Yalnızca çalışan kontrolleri ve aktif proje bağlamını
 * gösterir; pencereyi sürüklemek için orta alan boş bırakılır.
 *
 * Sag ~144px padding ile OS pencere kontrol overlay'ine (WCO) yer birakilir.
 * Hem web hem desktop'ta gorunur (Codex gorunumu icin sart).
 */

export type MenuAction =
  | "new-chat"
  | "open-folder"
  | "settings"

  | "about";

export function Titlebar({
  leftOpen,
  onToggleSidebar,
  onOpenSessions,
  workspaceName,
  workspacePath,
  onToggleDock,
  onToggleBottomPanel,
  dockOpen,
  bottomPanelOpen,
  showPanelToggles = true,
  showTimelineFade = false,
  onMenuAction,
}: {
  leftOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSessions: () => void;
  workspaceName: string;
  workspacePath: string;
  onToggleDock?: () => void;
  onToggleBottomPanel?: () => void;
  dockOpen?: boolean;
  bottomPanelOpen?: boolean;
  showPanelToggles?: boolean;
  showTimelineFade?: boolean;
  onMenuAction?: (action: MenuAction) => void;
}) {
  const isMac = desktop?.platform === "darwin";
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  const barRef = React.useRef<HTMLElement | null>(null);
  const dropdownRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRefs = React.useRef(new Map<string, HTMLButtonElement>());

  const closeOpenMenu = React.useCallback((restoreFocus: boolean) => {
    const menuId = openMenu;
    setOpenMenu(null);
    if (restoreFocus && menuId) restoreMenuTriggerFocus(triggerRefs.current.get(menuId) ?? null);
  }, [openMenu]);

  React.useEffect(() => {
    if (openMenu) focusFirstMenuItem(dropdownRef.current);
  }, [openMenu]);

  // Dis tiklama / Escape ile acik menuyu kapat.
  React.useEffect(() => {
    if (!openMenu) return;
    const onPointer = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeOpenMenu(true);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu, closeOpenMenu]);

  const runAction = (action: MenuAction) => {
    setOpenMenu(null);
    onMenuAction?.(action);
  };

  const menus: Array<{ id: string; label: string; items: Array<{ label: string; action: MenuAction } | "sep"> }> = [
    {
      id: "file",
      label: "Dosya",
      items: [
        { label: "Yeni sohbet", action: "new-chat" },
        { label: "Klasör aç…", action: "open-folder" },
        "sep",
        { label: "Ayarlar", action: "settings" },
      ],
    },
    {
      id: "edit",
      label: "Düzenle",
      items: [{ label: "Sohbet ara / sürdür…", action: "new-chat" }],
    },
    {
      id: "help",
      label: "Yardım",
      items: [{ label: "Hakkında", action: "about" }],
    },
  ];

  // Düzenle menusunun ikinci ogesi aslinda "Sohbet ara"yi acmali.
  const handleMenuItem = (menuId: string, action: MenuAction) => {
    if (menuId === "edit") {
      setOpenMenu(null);
      onOpenSessions();
      return;
    }
    runAction(action);
  };

  return (
    <>
      <header
        ref={barRef}
        className={`${styles.titlebar} ${isMac ? styles.mac : ""}`}
      >
        <div className={styles.left}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onToggleSidebar}
            aria-label={leftOpen ? "Yan menüyü daralt" : "Yan menüyü genişlet"}
            title="Kenar çubuğu"
          >
            <PanelLeft size={18} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>

        <button type="button" className={styles.projectContext} onClick={() => runAction("open-folder")} title={workspacePath || "Çalışma alanı aç"}>
          <Folder size={14} strokeWidth={1.9} aria-hidden="true" />
          <span>{workspaceName || "Proje seç"}</span>
        </button>

        <nav className={styles.menubar} aria-label="Menü">
          {menus.map((menu) => (
            <div key={menu.id} className={styles.menuItem}>
              <button
                ref={(element) => {
                  if (element) triggerRefs.current.set(menu.id, element);
                  else triggerRefs.current.delete(menu.id);
                }}
                type="button"
                className={`${styles.menuBtn} ${openMenu === menu.id ? styles.open : ""}`}
                aria-haspopup="menu"
                aria-expanded={openMenu === menu.id}
                onClick={() =>
                  setOpenMenu((cur) => (cur === menu.id ? null : menu.id))
                }
              >
                {menu.label}
              </button>
              {openMenu === menu.id && (
                <div
                  ref={dropdownRef}
                  className={styles.dropdown}
                  role="menu"
                  aria-label={`${menu.label} menüsü`}
                  onKeyDown={(event) => handleMenuKeyDown(event, { onEscape: () => closeOpenMenu(true) })}
                >
                  {menu.items.map((item, i) =>
                    item === "sep" ? (
                      <div key={`sep-${i}`} className={styles.dropdownSep} aria-hidden="true" />
                    ) : (
                      <button
                        key={item.label}
                        type="button"
                        role="menuitem"
                        className={styles.dropdownItem}
                        onClick={() => handleMenuItem(menu.id, item.action)}
                      >
                        {item.label}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className={styles.spacer} />

        {showPanelToggles && (
          <div className={styles.right}>
            <button
              type="button"
              className={`${styles.iconBtn} ${bottomPanelOpen ? styles.active : ""}`}
              onClick={onToggleBottomPanel}
              aria-label="Alt paneli aç/kapat"
              aria-pressed={Boolean(bottomPanelOpen)}
              title="Alt paneli aç/kapat (Ctrl+J)"
            >
              <PanelBottom size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`${styles.iconBtn} ${dockOpen ? styles.active : ""}`}
              onClick={onToggleDock}
              aria-label="Sağ paneli aç/kapat"
              aria-pressed={Boolean(dockOpen)}
              title="Sağ paneli aç/kapat"
            >
              <PanelRight size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
      </header>
      {/* Yalnızca timeline metin sütununa denk gelen üst fade. */}
      {showTimelineFade && <div className={styles.edgeFade} aria-hidden="true" />}
    </>
  );
}
