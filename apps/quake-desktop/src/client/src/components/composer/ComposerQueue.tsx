import React from "react";
import { CornerDownRight, MoreHorizontal, Pencil, SendHorizontal, Trash2 } from "lucide-react";
import type { QueuedUserMessage } from "../../types";
import styles from "./ComposerQueue.module.css";

type Props = {
  items: QueuedUserMessage[];
  agentBusy?: boolean;
  onSendNow: (item: QueuedUserMessage) => void;
  onEdit: (item: QueuedUserMessage) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onCopy?: (text: string) => void;
};

/** Messages waiting above the composer until the active turn completes or the user routes one now. */
export function ComposerQueue({
  items,
  agentBusy = false,
  onSendNow,
  onEdit,
  onRemove,
}: Props) {
  if (items.length === 0) return null;

  return (
    <section className={styles.panel} aria-label="Bekleyen mesajlar" data-busy={agentBusy ? "1" : "0"}>
      <ul className={styles.list} role="list">
        {items.map((item) => (
          <li className={styles.row} role="listitem" key={item.id}>
            <CornerDownRight className={styles.queueIcon} size={13} strokeWidth={1.8} aria-hidden="true" />
            <span className={styles.text} title={item.message}>
              {item.message || (item.images.length ? "Görsel eki" : "Mesaj")}
            </span>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.routeButton}
                title={agentBusy ? "Aktif tura şimdi yönlendir" : "Şimdi gönder"}
                onClick={() => onSendNow(item)}
              >
                <SendHorizontal size={13} strokeWidth={1.8} aria-hidden="true" />
                <span>Yönlendir</span>
              </button>
              <button
                type="button"
                className={styles.iconButton}
                title="Bekleyen mesajı sil"
                aria-label="Bekleyen mesajı sil"
                onClick={() => onRemove(item.id)}
              >
                <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <details className={styles.more}>
                <summary aria-label="Diğer işlemler" title="Diğer işlemler">
                  <MoreHorizontal size={14} strokeWidth={1.8} aria-hidden="true" />
                </summary>
                <div className={styles.menu} role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(event) => {
                      closeDetails(event);
                      onEdit(item);
                    }}
                  >
                    <Pencil size={13} strokeWidth={1.8} aria-hidden="true" />
                    Düzenle
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(event) => {
                      closeDetails(event);
                      onRemove(item.id);
                    }}
                  >
                    <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
                    Sil
                  </button>
                </div>
              </details>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function closeDetails(event: React.MouseEvent) {
  const details = (event.currentTarget as HTMLElement).closest("details");
  if (details) details.open = false;
}

export default ComposerQueue;
