import React, { useEffect, useState } from "react";
import { CirclePause, CirclePlay, Pencil, Target, Trash2 } from "lucide-react";
import type { WebGoalState } from "../../../../shared/protocol";
import styles from "./GoalPanel.module.css";

export function GoalPanel({
  goal,
  onPause,
  onResume,
  onCancel,
  onEdit,
}: {
  goal?: WebGoalState;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  /** Fill composer with objective for mid-run edit (Codex pencil). */
  onEdit?: (objective: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!goal || ["completed", "failed", "cancelled"].includes(goal.status)) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [goal?.id, goal?.status]);

  if (!goal || goal.status === "cancelled") return null;
  // Keep completed/failed briefly readable in the bar; hide failed is optional — show both.
  if (goal.status === "failed") return null;

  const isRunning = ["planning", "executing", "verifying"].includes(goal.status);
  const isPausedLike = goal.status === "paused" || goal.status === "blocked" || goal.status === "budget_limited";
  const isComplete = goal.status === "completed";
  const elapsedSec = Math.max(
    0,
    Math.floor(((isComplete ? goal.completedAt || goal.updatedAt : now) - goal.createdAt) / 1000),
  );
  const usage = formatUsage(goal, elapsedSec);
  const phrase = statusPhrase(goal.status);
  const objective = goal.objective.trim() || "Hedef";

  return (
    <div
      className={styles.bar}
      data-status={goal.status}
      role="status"
      aria-label={`${phrase} ${objective}${usage ? ` · ${usage}` : ""}`}
    >
      <span className={styles.icon} aria-hidden="true">
        <Target size={14} strokeWidth={2} />
      </span>

      <div className={styles.copy}>
        <span className={styles.phrase}>{phrase}</span>
        <span className={styles.objective} title={objective}>{objective}</span>
        {usage ? (
          <>
            <span className={styles.dot} aria-hidden="true">·</span>
            <span className={styles.usage}>{usage}</span>
          </>
        ) : null}
      </div>

      <div className={styles.actions}>
        {!isComplete && onEdit ? (
          <button type="button" onClick={() => onEdit(objective)} title="Hedefi düzenle" aria-label="Hedefi düzenle">
            <Pencil size={14} strokeWidth={1.9} aria-hidden="true" />
          </button>
        ) : null}
        {isRunning ? (
          <button type="button" onClick={onPause} title="Hedefi duraklat" aria-label="Hedefi duraklat">
            <CirclePause size={15} strokeWidth={1.9} aria-hidden="true" />
          </button>
        ) : null}
        {isPausedLike ? (
          <button type="button" onClick={onResume} title="Hedefe devam et" aria-label="Hedefe devam et">
            <CirclePlay size={15} strokeWidth={1.9} aria-hidden="true" />
          </button>
        ) : null}
        {!isComplete ? (
          <button type="button" onClick={onCancel} title="Hedefi iptal et" aria-label="Hedefi iptal et">
            <Trash2 size={14} strokeWidth={1.9} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function statusPhrase(status: WebGoalState["status"]): string {
  switch (status) {
    case "paused":
      return "Duraklatılan hedef";
    case "blocked":
      return "Engellenen hedef";
    case "budget_limited":
      return "Bütçe limiti";
    case "completed":
      return "Tamamlanan hedef";
    case "verifying":
      return "Doğrulanan hedef";
    case "planning":
      return "Planlanan hedef";
    case "executing":
    default:
      return "Aktif hedef";
  }
}

/** Codex-style compact elapsed / token usage (prefer tokens when budget set). */
function formatUsage(goal: WebGoalState, elapsedSec: number): string {
  const tokenBudget = goal.budget.tokenBudget;
  const tokensUsed = goal.tokensUsed ?? 0;
  if (typeof tokenBudget === "number" && tokenBudget > 0) {
    return `${formatTokens(tokensUsed)} / ${formatTokens(tokenBudget)}`;
  }
  if (tokensUsed > 0 && goal.status === "completed") {
    return `${formatTokens(tokensUsed)} token`;
  }
  return formatElapsed(elapsedSec);
}

function formatElapsed(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `${d}d ${rh}h ${rm}m`;
  }
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export default GoalPanel;
