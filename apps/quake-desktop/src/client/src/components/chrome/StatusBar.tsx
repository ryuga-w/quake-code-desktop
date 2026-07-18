import React from "react";
import { Cpu, Sparkles, Map, Target } from "lucide-react";
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
  return (
    <footer className={styles.statusbar} aria-label="Durum çubuğu">
      <div className={styles.group} aria-label={`Çalışma alanı: ${workspaceName}`} title={workspacePath}>
        <span className={styles.readyDot} aria-hidden="true" />
        <span className={styles.readyLabel}>Hazır</span>
      </div>
      <div className={styles.group}>
        {goalActive && (
          <span className={`${styles.item} ${styles.goal}`} title="Otonom Hedef (Goal) Modu Aktif">
            <Target size={12} strokeWidth={2} aria-hidden="true" />
            Hedef{goalTurn ? ` · Tur ${goalTurn}/${goalMaxTurns || 15}` : ""}
          </span>
        )}
        {planMode && (
          <span className={`${styles.item} ${styles.plan}`} title="Plan modu — salt-okunur keşif">
            <Map size={12} strokeWidth={2} aria-hidden="true" />
            Plan{planPhase ? ` · ${planPhase}` : ""}
          </span>
        )}
        {modelLabel && (
          <span className={styles.item} title="Aktif model">
            <Cpu size={12} strokeWidth={2} aria-hidden="true" />
            {modelLabel}
          </span>
        )}
        {thinking && (
          <span className={styles.item} title="Düşünme seviyesi">
            <Sparkles size={12} strokeWidth={2} aria-hidden="true" />
            {thinking}
          </span>
        )}
      </div>
    </footer>
  );
}
