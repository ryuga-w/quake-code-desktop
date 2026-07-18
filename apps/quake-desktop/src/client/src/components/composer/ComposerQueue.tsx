import React from "react";
import { ListOrdered, Zap, Pencil, X, MoreHorizontal, Copy, Trash2 } from "lucide-react";
import type { ComposerImage, QueuedUserMessage } from "../../types";
import styles from "./ComposerQueue.module.css";

export type ServerQueueSnapshot = {
  steering: string[];
  followUp: string[];
};

type Props = {
  /** Local messages waiting for this session (client-side FIFO). */
  items: QueuedUserMessage[];
  /** Server-side agent queues (already accepted by runtime). */
  serverQueue?: ServerQueueSnapshot;
  /** Agent currently generating in this chat. */
  agentBusy?: boolean;
  onSendNow: (item: QueuedUserMessage) => void;
  onEdit: (item: QueuedUserMessage) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onCopy?: (text: string) => void;
};

/**
 * Unified queue panel above the composer.
 *
 * Codex model (codex-rs Session::steer_input / Op::UserInput):
 * - Normal send while busy → turn/steer (same-turn), not this panel.
 * - This panel is only explicit follow-up / server-visible queues.
 * - "Şimdi gönder" = steer into the active turn.
 * - Server "Şimdi yönlendirildi" rows = accepted steer pending_input.
 */
export function ComposerQueue({
  items,
  serverQueue,
  agentBusy = false,
  onSendNow,
  onEdit,
  onRemove,
  onClearAll,
  onCopy,
}: Props) {
  const serverSteer = (serverQueue?.steering || []).filter(Boolean);
  const serverFollow = (serverQueue?.followUp || []).filter(Boolean);
  const hasLocal = items.length > 0;
  const hasServer = serverSteer.length > 0 || serverFollow.length > 0;
  if (!hasLocal && !hasServer) return null;

  const total = items.length + serverSteer.length + serverFollow.length;
  const hint = agentBusy
    ? "Ajan tamamlayınca sırayla gönderilir"
    : items.length > 0
      ? "Gönderilmeye hazır"
      : "Ajana iletildi";

  return (
    <section className={styles.panel} aria-label="Mesaj kuyruğu" data-busy={agentBusy ? "1" : "0"}>
      <header className={styles.head}>
        <div className={styles.headLeft}>
          <ListOrdered size={14} strokeWidth={2.1} aria-hidden="true" className={styles.headIcon} />
          <span className={styles.count}>{total}</span>
        </div>
        <span className={styles.hint}>{hint}</span>
        {hasLocal && items.length > 1 && (
          <button type="button" className={styles.clearAll} onClick={onClearAll} title="Yerel kuyruğu temizle">
            Tümünü temizle
          </button>
        )}
      </header>

      <ul className={styles.list} role="list">
        {serverSteer.map((text, i) => (
          <ServerRow key={`steer-${i}-${text.slice(0, 24)}`} kind="steer" text={text} />
        ))}
        {serverFollow.map((text, i) => (
          <ServerRow key={`follow-${i}-${text.slice(0, 24)}`} kind="followUp" text={text} />
        ))}
        {items.map((item, index) => (
          <LocalRow
            key={item.id}
            item={item}
            index={index}
            agentBusy={agentBusy}
            onSendNow={onSendNow}
            onEdit={onEdit}
            onRemove={onRemove}
            onCopy={onCopy}
          />
        ))}
      </ul>
    </section>
  );
}

function ServerRow({ kind, text }: { kind: "steer" | "followUp"; text: string }) {
  const label = kind === "steer" ? "Şimdi yönlendirildi" : "Sıraya alındı";
  return (
    <li className={`${styles.row} ${styles.rowServer}`} role="listitem">
      <div className={styles.main}>
        <span className={`${styles.badge} ${kind === "steer" ? styles.badgeSteer : styles.badgeWait}`}>{label}</span>
        <span className={styles.text} title={text}>
          {text}
        </span>
      </div>
      <span className={styles.serverNote} title="Bu mesaj zaten ajan kuyruğunda">
        agent
      </span>
    </li>
  );
}

function LocalRow({
  item,
  index,
  agentBusy,
  onSendNow,
  onEdit,
  onRemove,
  onCopy,
}: {
  item: QueuedUserMessage;
  index: number;
  agentBusy: boolean;
  onSendNow: (item: QueuedUserMessage) => void;
  onEdit: (item: QueuedUserMessage) => void;
  onRemove: (id: string) => void;
  onCopy?: (text: string) => void;
}) {
  const hasImages = item.images.length > 0;
  return (
    <li className={styles.row} role="listitem">
      <div className={styles.main}>
        <span className={styles.pos} aria-hidden="true">
          {index + 1}
        </span>
        <div className={styles.body}>
          <span className={styles.text} title={item.message}>
            {item.message || (hasImages ? "Görsel eki" : "Mesaj")}
          </span>
          <span className={styles.meta}>
            <span className={`${styles.badge} ${styles.badgeWait}`}>Bekliyor</span>
            {hasImages ? <span className={styles.metaExtra}>· {item.images.length} görsel</span> : null}
            <span className={styles.metaExtra}>· {agentBusy ? "cevap bitince" : "sırada"}</span>
          </span>
        </div>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.sendNow}
          title={agentBusy ? "Ajana hemen yönlendir (mevcut turu keser)" : "Ajana şimdi gönder"}
          onClick={() => onSendNow(item)}
        >
          <Zap size={13} strokeWidth={2.2} aria-hidden="true" />
          <span>Şimdi gönder</span>
        </button>
        <button type="button" className={styles.iconBtn} title="Düzenle" aria-label="Düzenle" onClick={() => onEdit(item)}>
          <Pencil size={13} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" className={styles.iconBtn} title="Kaldır" aria-label="Kaldır" onClick={() => onRemove(item.id)}>
          <X size={14} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <details className={styles.more}>
          <summary aria-label="Diğer" title="Diğer">
            <MoreHorizontal size={14} strokeWidth={2} aria-hidden="true" />
          </summary>
          <div className={styles.menu} role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                closeDetails(e);
                onEdit(item);
              }}
            >
              <Pencil size={13} strokeWidth={2} aria-hidden="true" />
              Düzenle
            </button>
            {onCopy && (
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  closeDetails(e);
                  onCopy(item.message);
                }}
              >
                <Copy size={13} strokeWidth={2} aria-hidden="true" />
                Kopyala
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                closeDetails(e);
                onRemove(item.id);
              }}
            >
              <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
              Kaldır
            </button>
          </div>
        </details>
      </div>
    </li>
  );
}

function closeDetails(event: React.MouseEvent) {
  const details = (event.currentTarget as HTMLElement).closest("details");
  if (details) details.open = false;
}

export default ComposerQueue;
