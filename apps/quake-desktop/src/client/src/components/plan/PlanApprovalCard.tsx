import React from "react";
import { ArrowRight, Pencil, X } from "lucide-react";
import { useI18n } from "../../i18n";
import styles from "./PlanApprovalCard.module.css";

export function PlanApprovalCard({
  pending,
  onApply,
  onRevise,
  onDismiss,
}: {
  pending: boolean;
  onApply: () => void;
  onRevise: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return <section className={styles.root} aria-label={t("runtime.plan.approval")}>
    <header className={styles.header}>
      <b>{t("runtime.plan.applyQuestion")}</b>
      <button type="button" onClick={onDismiss} aria-label={t("runtime.plan.closeApproval")} disabled={pending}>
        <X size={13} strokeWidth={1.9} aria-hidden="true" />
      </button>
    </header>
    <button type="button" className={styles.apply} onClick={onApply} disabled={pending}>
      <span className={styles.number}>{pending ? <i aria-hidden="true" /> : "1"}</span>
      <span>{pending ? t("runtime.plan.applying") : t("runtime.plan.apply")}</span>
      <ArrowRight size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
    <div className={styles.reviseRow}>
      <button type="button" className={styles.revise} onClick={onRevise} disabled={pending}>
        <Pencil size={13} strokeWidth={1.8} aria-hidden="true" />
        <span>{t("runtime.plan.revise")}</span>
      </button>
      <button type="button" className={styles.skip} onClick={onDismiss} disabled={pending}>{t("runtime.plan.skip")}</button>
    </div>
  </section>;
}
