import React from "react";
import { Cpu, Sparkles, Map, Target } from "lucide-react";
import { useI18n } from "../../i18n";
import styles from "./StatusBar.module.css";

/**
 * Alt durum cubugu (native-feel): cwd/workspace · model · dusunce · plan · goal.
 * Composer popover'a dagilmis bilgiyi tek satirda toplar. Web + masaustu.
 */
export function StatusBar({
  workspaceName,
  workspacePath,
  modelLabel,
  thinking,
  planMode,
  planPhase,
  goalActive,
  goalTurn,
  goalMaxTurns,
}: {
  workspaceName: string;
  workspacePath: string;
  modelLabel: string;
  thinking: string;
  planMode?: boolean;
  planPhase?: string;
  goalActive?: boolean;
  goalTurn?: number;
  goalMaxTurns?: number;
}) {
  const { t } = useI18n();
  return (
    <footer className={styles.statusbar} aria-label={t("runtime.chrome.statusBar")}>
      <div className={styles.group} aria-label={t("runtime.chrome.workspace", { name: workspaceName })} title={workspacePath}>
        <span className={styles.readyDot} aria-hidden="true" />
        <span className={styles.readyLabel}>{t("runtime.chrome.ready")}</span>
      </div>
      <div className={styles.group}>
        {goalActive && (
          <span className={`${styles.item} ${styles.goal}`} title={t("runtime.chrome.goalActive")}>
            <Target size={12} strokeWidth={2} aria-hidden="true" />
            {t("runtime.chrome.goal")}{goalTurn ? ` · ${t("runtime.chrome.goalTurn", { current: goalTurn, total: goalMaxTurns || 15 })}` : ""}
          </span>
        )}
        {planMode && (
          <span className={`${styles.item} ${styles.plan}`} title={t("runtime.chrome.planReadOnly")}>
            <Map size={12} strokeWidth={2} aria-hidden="true" />
            Plan{planPhase ? ` · ${planPhase}` : ""}
          </span>
        )}
        {modelLabel && (
          <span className={styles.item} title={t("runtime.chrome.activeModel")}>
            <Cpu size={12} strokeWidth={2} aria-hidden="true" />
            {modelLabel}
          </span>
        )}
        {thinking && (
          <span className={styles.item} title={t("runtime.chrome.thinkingLevel")}>
            <Sparkles size={12} strokeWidth={2} aria-hidden="true" />
            {thinking}
          </span>
        )}
      </div>
    </footer>
  );
}
