import React from "react";
import type { WebContextUsage } from "../../../../shared/protocol";
import {
  GENERAL_PREFERENCES_CHANGED_EVENT,
  GENERAL_PREFERENCES_STORAGE_KEY,
  loadShowContextUsagePreference,
} from "../../lib/general-preferences";
import styles from "./ChatComposer.module.css";

export type ContextUsagePresentation = {
  tokens: number | null;
  contextWindow: number;
  usedPercent: number | null;
  remainingPercent: number | null;
  ringPercent: number;
  level: "normal" | "warning" | "critical";
};

export function presentContextUsage(usage?: WebContextUsage): ContextUsagePresentation | undefined {
  const contextWindow = Number(usage?.contextWindow);
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;

  const rawTokens = usage?.tokens;
  const tokens = typeof rawTokens === "number" && Number.isFinite(rawTokens)
    ? Math.max(0, Math.round(rawTokens))
    : null;
  const reportedPercent = usage?.percent;
  const rawPercent = typeof reportedPercent === "number" && Number.isFinite(reportedPercent)
    ? reportedPercent
    : tokens !== null ? (tokens / contextWindow) * 100 : null;
  const safePercent = rawPercent === null ? null : Math.max(0, rawPercent);
  const usedPercent = safePercent === null ? null : Math.round(safePercent);
  const remainingPercent = usedPercent === null ? null : Math.max(0, 100 - usedPercent);
  const ringPercent = safePercent === null ? 0 : Math.min(100, safePercent);
  const level = ringPercent >= 90 ? "critical" : ringPercent >= 75 ? "warning" : "normal";

  return {
    tokens,
    contextWindow: Math.round(contextWindow),
    usedPercent,
    remainingPercent,
    ringPercent,
    level,
  };
}

function useShowContextUsage(): boolean {
  const [visible, setVisible] = React.useState(loadShowContextUsagePreference);

  React.useEffect(() => {
    const syncFromStorage = () => setVisible(loadShowContextUsagePreference());
    const onPreferenceChange = (event: Event) => {
      const detail = (event as CustomEvent<{ showContextUsage?: unknown }>).detail;
      if (typeof detail?.showContextUsage === "boolean") setVisible(detail.showContextUsage);
      else syncFromStorage();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === GENERAL_PREFERENCES_STORAGE_KEY || event.key === null) syncFromStorage();
    };

    window.addEventListener(GENERAL_PREFERENCES_CHANGED_EVENT, onPreferenceChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(GENERAL_PREFERENCES_CHANGED_EVENT, onPreferenceChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return visible;
}

function formatTokens(value: number): string {
  return value.toLocaleString("tr-TR");
}

export function ContextUsageIndicator({ usage }: { usage?: WebContextUsage }) {
  const visible = useShowContextUsage();
  const presentation = presentContextUsage(usage);
  const tooltipId = React.useId();

  if (!visible || !presentation) return null;

  const pending = presentation.tokens === null || presentation.usedPercent === null;
  const valueText = pending
    ? `Bağlam kullanımı hesaplanıyor. Kapasite ${formatTokens(presentation.contextWindow)} token.`
    : `Bağlam penceresinin yüzde ${presentation.usedPercent} kadarı kullanıldı; yüzde ${presentation.remainingPercent} kaldı. ${formatTokens(presentation.tokens!)} / ${formatTokens(presentation.contextWindow)} token.`;

  return (
    <span
      className={styles.contextUsageMeter}
      data-level={presentation.level}
      data-pending={pending ? "true" : "false"}
      role="meter"
      tabIndex={0}
      aria-label="Bağlam penceresi kullanımı"
      aria-describedby={tooltipId}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pending ? undefined : presentation.ringPercent}
      aria-valuetext={valueText}
    >
      <svg className={styles.contextUsageRing} viewBox="0 0 16 16" aria-hidden="true">
        <circle className={styles.contextUsageRingTrack} cx="8" cy="8" r="5.6" pathLength="100" />
        <circle
          className={styles.contextUsageRingValue}
          cx="8"
          cy="8"
          r="5.6"
          pathLength="100"
          strokeDashoffset={100 - presentation.ringPercent}
        />
      </svg>
      <span id={tooltipId} className={styles.contextUsageTooltip} role="tooltip">
        <span className={styles.contextUsageTooltipTitle}>Bağlam penceresi:</span>
        {pending ? (
          <>
            <strong>Kullanım hesaplanıyor</strong>
            <span>{formatTokens(presentation.contextWindow)} token kapasite</span>
          </>
        ) : (
          <>
            <strong>%{presentation.usedPercent} kullanıldı <span>(%{presentation.remainingPercent} kaldı)</span></strong>
            <span>{formatTokens(presentation.tokens!)} / {formatTokens(presentation.contextWindow)} token kullanıldı</span>
          </>
        )}
      </span>
    </span>
  );
}
