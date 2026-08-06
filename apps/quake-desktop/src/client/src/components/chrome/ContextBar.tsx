import React from "react";
import { Box, ChevronDown } from "lucide-react";
import { useI18n } from "../../i18n";
import styles from "./ContextBar.module.css";

/**
 * Composer altı bağlam çubuğu: proje · Yerel çalışma.
 * Git/branch yok — bu proje gitsiz çalışır.
 */
export function ContextBar({
  workspaceName,
  workspacePath,
  onOpenWorkspace,
}: {
  workspaceName: string;
  workspacePath: string;
  onOpenWorkspace: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.bar}>
      <button
        type="button"
        className={styles.item}
        onClick={onOpenWorkspace}
        title={workspacePath}
      >
        <Box size={13} strokeWidth={2} aria-hidden="true" />
        <span className={styles.label}>{workspaceName}</span>
      </button>

      <button type="button" className={styles.item} onClick={onOpenWorkspace}>
        <span className={styles.label}>{t("runtime.chrome.localWork")}</span>
        <ChevronDown size={13} strokeWidth={2} aria-hidden="true" className={styles.caret} />
      </button>
    </div>
  );
}
