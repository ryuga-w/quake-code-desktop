import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import type { QueuedUserMessage } from "../../types";

export type TimelineFilter = "all" | "messages" | "tools" | "errors";

export type TimelineHeaderContext = {
  hiddenTimelineCount: number;
  nextOlderCount: number;
  onLoadOlder: () => void;
};

const FILTER_OPTIONS: Array<{ value: TimelineFilter; label: string }> = [
  { value: "all", label: "Akış" },
  { value: "messages", label: "Mesajlar" },
  { value: "tools", label: "İşlemler" },
  { value: "errors", label: "Hatalar" },
];

export function TimelineHeader({ context }: { context?: TimelineHeaderContext }) {
  if (!context || context.hiddenTimelineCount <= 0) return null;
  return (
    <button type="button" className="timeline-load-older" onClick={context.onLoadOlder}>
      Daha eski konuşmayı yükle
      <span>{context.hiddenTimelineCount} geçmiş kaydı kaldı · sonraki {context.nextOlderCount}</span>
    </button>
  );
}

export function TimelineControls({
  filter,
  errorCount,
  onFilterChange,
}: {
  filter: TimelineFilter;
  errorCount: number;
  onFilterChange: (filter: TimelineFilter) => void;
}) {
  const activeLabel = FILTER_OPTIONS.find((option) => option.value === filter)?.label || "Mesajlar";
  return (
    <details className="timeline-filter-menu">
      <summary aria-label={`Timeline görünümü: ${activeLabel}`}>
        <SlidersHorizontal size={14} aria-hidden="true" />
        <span>{activeLabel}</span>
        {errorCount > 0 && <span className="timeline-error-badge" aria-label={`${errorCount} başarısız işlem`}>{errorCount}</span>}
      </summary>
      <div className="timeline-filter-options" role="menu" aria-label="Timeline görünümü">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={filter === option.value}
            className={filter === option.value ? "active" : ""}
            onClick={(event) => {
              onFilterChange(option.value);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <span>{option.label}</span>
            {option.value === "errors" && errorCount > 0 && <span className="timeline-filter-count">{errorCount}</span>}
          </button>
        ))}
      </div>
    </details>
  );
}

export function PendingMessagesInChat({
  items,
  onRemove,
  onSendNow,
}: {
  items: QueuedUserMessage[];
  onRemove?: (id: string) => void;
  onSendNow?: (item: QueuedUserMessage) => void;
}) {
  if (!items.length) return null;
  return (
    <section className="pending-messages" aria-label="Bekleyen mesajlar">
      <div className="pending-messages-rule" aria-hidden="true" />
      <div className="pending-messages-head">
        <span className="pending-messages-title">Bekleyen mesajlar</span>
        <span className="pending-messages-icon" title="Ajan bitince sırayla gider" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </span>
      </div>
      <ul className="pending-messages-list">
        {items.map((item) => (
          <li key={item.id} className="pending-message-item">
            <button type="button" className="pending-message-bubble" title="Şimdi gönder" onClick={() => onSendNow?.(item)}>
              <span className="pending-message-text">{item.message || (item.images.length ? "Görsel eki" : "Mesaj")}</span>
            </button>
            <button
              type="button"
              className="pending-message-remove"
              aria-label="Kuyruktan kaldır"
              title="Kaldır"
              onClick={() => onRemove?.(item.id)}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TimelineJumpBottom({
  activityCount,
  errorCount,
  isStreaming,
}: {
  activityCount: number;
  errorCount: number;
  isStreaming: boolean;
}) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const seenActivityCount = useRef(activityCount);
  const seenErrorCount = useRef(errorCount);
  if (isAtBottom) {
    seenActivityCount.current = activityCount;
    seenErrorCount.current = errorCount;
  }
  const newUpdateCount = Math.max(0, activityCount - seenActivityCount.current);
  const newErrorCount = Math.max(0, errorCount - seenErrorCount.current);
  if (isAtBottom) return null;
  const label = newErrorCount > 0
    ? `${newErrorCount} işlem başarısız`
    : isStreaming
      ? `Ajan çalışıyor${newUpdateCount > 0 ? ` · ${newUpdateCount} güncelleme` : ""}`
      : newUpdateCount > 0
        ? `${newUpdateCount} yeni güncelleme`
        : "Aşağı in";
  return (
    <button
      type="button"
      className={`timeline-jump-bottom ${newErrorCount > 0 ? "has-error" : ""}`}
      onClick={() => { void scrollToBottom(); }}
      aria-label={`${label}. Sohbetin en altına in`}
    >
      <ChevronDown size={18} strokeWidth={2.2} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export function TimelineAnnouncer({ isStreaming, errorCount }: { isStreaming: boolean; errorCount: number }) {
  const [announcement, setAnnouncement] = useState("");
  const previousStreaming = useRef(isStreaming);
  const previousErrorCount = useRef(errorCount);
  useEffect(() => {
    let nextAnnouncement = "";
    if (errorCount > previousErrorCount.current) nextAnnouncement = "Bir işlem başarısız oldu.";
    else if (isStreaming && !previousStreaming.current) nextAnnouncement = "Ajan yanıt veriyor.";
    else if (!isStreaming && previousStreaming.current) nextAnnouncement = "Yanıt tamamlandı.";
    previousStreaming.current = isStreaming;
    previousErrorCount.current = errorCount;
    if (nextAnnouncement) setAnnouncement(nextAnnouncement);
  }, [errorCount, isStreaming]);
  return <div className="timeline-announcer" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>;
}
