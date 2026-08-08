import React from "react";
import {
  Folder,
} from "lucide-react";
import styles from "./Titlebar.module.css";
import { desktop } from "../../lib/desktop";
import { focusFirstMenuItem, handleMenuKeyDown, restoreMenuTriggerFocus } from "../../lib/menu-keyboard";
import { useI18n } from "../../i18n";

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
  | "toggle-sidebar"
  | "toggle-bottom-panel"
  | "toggle-right-panel"
  | "toggle-theme"
  | "about";

export function Titlebar({
  leftOpen,
  onToggleSidebar,
  onOpenSessions,
  workspaceName,
  workspacePath,
  showTimelineFade = false,
  onMenuAction,
}: {
  leftOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSessions: () => void;
  workspaceName: string;
  workspacePath: string;
  showTimelineFade?: boolean;
  onMenuAction?: (action: MenuAction) => void;
}) {
  const { t } = useI18n();
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
      label: t("common.titlebar.file"),
      items: [
        { label: t("common.titlebar.newChat"), action: "new-chat" },
        { label: t("common.titlebar.openFolder"), action: "open-folder" },
        "sep",
        { label: t("common.titlebar.settings"), action: "settings" },
      ],
    },
    {
      id: "edit",
      label: t("common.titlebar.edit"),
      items: [{ label: t("common.titlebar.searchOrContinueChat"), action: "new-chat" }],
    },
    {
      id: "view",
      label: t("common.titlebar.view"),
      items: [
        { label: t("common.titlebar.toggleSidebar"), action: "toggle-sidebar" },
        { label: t("common.titlebar.toggleBottomPanel"), action: "toggle-bottom-panel" },
        { label: t("common.titlebar.toggleRightPanel"), action: "toggle-right-panel" },
        "sep",
        { label: t("common.titlebar.toggleTheme"), action: "toggle-theme" },
      ],
    },
    {
      id: "help",
      label: t("common.titlebar.help"),
      items: [{ label: t("common.titlebar.about"), action: "about" }],
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
        <button type="button" className={`${styles.projectContext} ${leftOpen ? styles.projectContextSidebarOpen : ""}`} onClick={() => runAction("open-folder")} title={workspacePath || t("common.titlebar.selectProject")}>
          <Folder size={14} strokeWidth={1.9} aria-hidden="true" />
          <span>{workspaceName || t("common.titlebar.selectProject")}</span>
        </button>

        <span className={styles.brandMark} aria-label="Quake">Quake</span>

        <nav className={styles.menubar} aria-label={t("common.titlebar.menuBar")}>
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
                  aria-label={t("common.titlebar.menuLabel", { label: menu.label })}
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
      </header>
      {/* Yalnızca timeline metin sütununa denk gelen üst fade. */}
      {showTimelineFade && <div className={styles.edgeFade} aria-hidden="true" />}
    </>
  );
}
