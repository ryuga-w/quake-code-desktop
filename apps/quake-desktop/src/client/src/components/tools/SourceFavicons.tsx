import React from "react";
import { AnimatePresence, motion } from "motion/react";
import type { WebSource } from "../../lib/extract-web-sources";
import { faviconUrl } from "../../lib/extract-web-sources";
import styles from "./SourceFavicons.module.css";
import { useI18n } from "../../i18n";

function truncate(value: string, max: number): string {
  if (!value) return "";
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

function FaviconBadge({
  source,
  index,
  compact,
}: {
  source: WebSource;
  index: number;
  compact?: boolean;
}) {
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const label = source.title || source.hostname;

  return (
    <motion.a
      layout
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      title={source.title ? `${source.title} — ${source.url}` : source.url}
      initial={{ opacity: 0, scale: 0.86, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, y: -2 }}
      transition={{
        duration: 0.38,
        delay: Math.min(index * 0.055, 0.45),
        ease: [0.23, 1, 0.32, 1],
      }}
      className={`${styles.chip} ${compact ? styles.chipCompact : ""}`}
    >
      <span className={styles.iconWrap}>
        {!loaded && !failed && (
          <motion.span
            className={styles.shimmer}
            animate={{ opacity: [0.35, 0.85, 0.35] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            aria-hidden
          />
        )}
        {!failed ? (
          <motion.img
            src={faviconUrl(source.hostname, 32)}
            alt=""
            width={16}
            height={16}
            loading="lazy"
            decoding="async"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: loaded ? 1 : 0, scale: loaded ? 1 : 0.7 }}
            transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={styles.icon}
          />
        ) : (
          <span className={styles.iconFallback}>
            {source.hostname.charAt(0).toUpperCase()}
          </span>
        )}
      </span>

      {!compact && <span className={styles.label}>{truncate(label, 28)}</span>}
    </motion.a>
  );
}

export function SourceFavicons({
  sources,
  isRunning,
  label,
  compact,
  inline,
  max,
}: {
  sources: WebSource[];
  isRunning?: boolean;
  label?: string;
  /** Icon-only chips */
  compact?: boolean;
  /** Summary/header row — no section label */
  inline?: boolean;
  max?: number;
}) {
  const { locale } = useI18n();
  const resolvedLabel = label ?? (locale === "en" ? "Sources" : "Kaynaklar");
  const visible = max ? sources.slice(0, max) : sources;
  const overflow = max && sources.length > max ? sources.length - max : 0;
  const keys = React.useMemo(() => visible.map((s) => s.hostname).join("|"), [visible]);
  if (!visible.length) return null;

  return (
    <motion.div
      layout
      initial={inline ? false : { opacity: 0, y: 4 }}
      animate={inline ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}
      className={inline ? styles.wrapInline : styles.wrap}
    >
      {!inline && (
        <div className={styles.header}>
          <span>{resolvedLabel}</span>
          <span className={styles.headerCount}>{sources.length}</span>
          {isRunning && (
            <motion.span
              className={styles.scanning}
              animate={{ opacity: [0.4, 0.9, 0.4] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            >
              <span className={styles.scanDot} />
              {locale === "en" ? "scanning" : "taranıyor"}
            </motion.span>
          )}
        </div>
      )}

      <motion.div
        layout
        className={`${styles.row} ${inline ? styles.rowInline : ""}`}
        key={keys}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {visible.map((source, index) => (
            <FaviconBadge
              key={source.hostname}
              source={source}
              index={index}
              compact={compact || inline}
            />
          ))}
        </AnimatePresence>

        {overflow > 0 && (
          <motion.span
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={styles.overflow}
          >
            +{overflow}
          </motion.span>
        )}

        {isRunning && (
          <motion.span
            key="scan-pulse"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: [0.25, 0.55, 0.25], scale: [0.92, 1, 0.92] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            className={styles.scanPlaceholder}
            aria-hidden
          >
            <span className={styles.scanPlaceholderDot} />
          </motion.span>
        )}
      </motion.div>
    </motion.div>
  );
}
