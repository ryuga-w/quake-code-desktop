import React from "react";
import { Archive, CirclePlus, Copy, Folder, MoreHorizontal, Pencil, Pin, PinOff } from "lucide-react";
import { formatSessionTitle } from "../../lib/render";
import { copyTextWithToast } from "../../lib/copy-toast";
import { useContextMenu, type MenuItem } from "../chrome/ContextMenu";
import styles from "./ConversationHeader.module.css";

export function ConversationHeader({
  session,
  pinned,
  onPin,
  onRename,
  onArchive,
  onOpenSideTask,
  workspaceName,
}: {
  session: any;
  pinned: boolean;
  onPin: () => void;
  onRename: (nextName: string) => void;
  onArchive: () => void;
  onOpenSideTask: () => void;
  workspaceName?: string;
}) {
  const menu = useContextMenu();
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState(() => formatSessionTitle(session));
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const title = formatSessionTitle(session);
  const rawCwd = String(session?.cwd || "").trim();
  const folderName = workspaceName || (rawCwd ? (rawCwd.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || "quake-desktop") : "quake-desktop");

  React.useEffect(() => {
    if (!renaming) setDraft(title);
  }, [renaming, title]);

  const commitRename = React.useCallback(() => {
    const next = draft.trim();
    setRenaming(false);
    if (next && next !== title) onRename(next);
    else setDraft(title);
  }, [draft, onRename, title]);

  const beginRename = React.useCallback(() => {
    setDraft(title);
    setRenaming(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [title]);

  const menuItems = React.useMemo<MenuItem[]>(() => [
    {
      id: "pin",
      label: pinned ? "Sabitlemeyi kaldır" : "Görevi sabitle",
      icon: pinned ? <PinOff size={14} /> : <Pin size={14} />,
      onSelect: onPin,
    },
    { id: "rename", label: "Görevi yeniden adlandır", icon: <Pencil size={14} />, onSelect: beginRename },
    { id: "archive", label: "Görevi arşivle", icon: <Archive size={14} />, onSelect: onArchive },
    { type: "separator" },
    { id: "side-task", label: "Yan görevi aç", icon: <CirclePlus size={14} />, onSelect: onOpenSideTask },
    { id: "copy-title", label: "Sohbet adını kopyala", icon: <Copy size={14} />, onSelect: () => copyTextWithToast(title, "Sohbet adı kopyalandı") },
    {
      id: "copy-path",
      label: "Session yolunu kopyala",
      icon: <Copy size={14} />,
      disabled: !session?.path,
      onSelect: () => copyTextWithToast(String(session?.path || ""), "Session yolu kopyalandı"),
    },
  ], [beginRename, onArchive, onOpenSideTask, onPin, pinned, session?.path, title]);

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    menu.open({ x: rect.left, y: rect.bottom + 5 }, menuItems);
  };

  return (
    <>
      <header className={styles.header} aria-label="Aktif sohbet başlığı">
        <span className={styles.divider} aria-hidden="true" />
        <div className={styles.breadcrumb}>
          <span className={styles.workspaceName}>{folderName}</span>
          <span className={styles.breadcrumbSeparator}>/</span>
          {renaming ? (
            <form
              className={styles.renameForm}
              onSubmit={(event) => {
                event.preventDefault();
                commitRename();
              }}
            >
              <input
                ref={inputRef}
                value={draft}
                maxLength={120}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  setDraft(title);
                  setRenaming(false);
                }}
                aria-label="Sohbet adını değiştir"
              />
            </form>
          ) : (
            <strong
              className={styles.title}
              title="Adı değiştirmek için tıklayın"
              onClick={beginRename}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  beginRename();
                }
              }}
            >
              {title}
            </strong>
          )}
        </div>
        <button
          type="button"
          className={styles.menuButton}
          aria-label="Sohbet işlemleri"
          title="Sohbet işlemleri"
          aria-haspopup="menu"
          aria-expanded={menu.isOpen}
          onClick={openMenu}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
      </header>
      {menu.menu}
    </>
  );
}
