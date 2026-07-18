import React, { useState } from "react";
import { useAppStore } from "../../state/app-store";
import styles from "./StatusNotice.module.css";

function Logo({ url, name }: { url?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className={styles.logoFallback} aria-hidden="true">
        {(name || "?").slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return <img className={styles.logo} src={url} alt="" width={36} height={36} onError={() => setFailed(true)} />;
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "provider_connected":
      return "Bağlantı kuruldu";
    case "provider_disconnected":
      return "Bağlantı kesildi";
    case "provider_pending":
      return "Bağlantı bekleniyor";
    case "provider_error":
      return "Bağlantı hatası";
    default:
      return "Durum";
  }
}

/**
 * Sağ alt kurumsal durum kartı — provider bağlama vb.
 * Eski sağ üst toast yığını yerine kullanılır.
 */
export function StatusNoticeHost() {
  const notice = useAppStore((s) => s.statusNotice);
  const dismiss = useAppStore((s) => s.dismissStatusNotice);

  if (!notice) return null;

  const tone =
    notice.kind === "provider_connected"
      ? styles.ok
      : notice.kind === "provider_error"
        ? styles.err
        : notice.kind === "provider_pending"
          ? styles.pending
          : styles.neutral;

  return (
    <div className={styles.host} role="status" aria-live="polite">
      <div className={`${styles.card} ${tone}`}>
        <Logo url={notice.logoUrl} name={notice.title} />
        <div className={styles.body}>
          <div className={styles.kicker}>{kindLabel(notice.kind)}</div>
          <div className={styles.title}>{notice.title}</div>
          {notice.subtitle ? <div className={styles.subtitle}>{notice.subtitle}</div> : null}
        </div>
        <button
          type="button"
          className={styles.close}
          aria-label="Kapat"
          onClick={() => dismiss(notice.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
}

export default StatusNoticeHost;
