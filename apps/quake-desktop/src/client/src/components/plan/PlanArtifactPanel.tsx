import React from "react";
import { Check, Circle, FileText, X } from "lucide-react";
import type { WebPlanState } from "../../../../shared/protocol";
import { useI18n } from "../../i18n";
import { MarkdownMessage } from "../markdown/MarkdownMessage";
import styles from "./PlanArtifactPanel.module.css";

export function PlanArtifactPanel({
  plan,
  onClose,
  onOpenFile,
}: {
  plan: WebPlanState;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}) {
  const { t } = useI18n();
  const markdown = plan.artifact?.markdown || "";

  return <section className={styles.root} aria-label={t("runtime.plan.proposedPlan")}>
    <header className={styles.toolbar}>
      <div className={styles.breadcrumb}><span>{t("runtime.plan.panel")}</span><i>›</i><b>{t("runtime.plan.proposedPlan")}</b></div>
      <div className={styles.actions}>
        <span className={styles.model}>{plan.enabled ? t("runtime.plan.planMode") : t("runtime.plan.defaultMode")}</span>
        <button type="button" className={styles.icon} onClick={onClose} aria-label={t("runtime.plan.closeTab")}><X size={15} /></button>
      </div>
    </header>
    <div className={styles.scroll}>
      {markdown
        ? <article className={styles.document}><MarkdownMessage text={markdown} onOpenFile={onOpenFile} /></article>
        : <div className={styles.empty}><FileText size={24} /><b>{t("runtime.plan.preparing")}</b><span>{t("runtime.plan.preparingDescription")}</span></div>}
      {plan.steps.length > 0 && <section className={styles.todos} aria-label={t("runtime.plan.updatedPlan")}>
        <div className={styles.todoHead}><span>{t("runtime.plan.updatedPlan")}</span></div>
        <ol className={styles.todoList}>
          {plan.steps.map((step) => <li className={`${step.completed ? styles.done : ""} ${step.status === "active" ? styles.active : ""}`} key={`${step.step}:${step.text}`}>
            <span className={styles.todoMark}>{step.completed ? <Check size={12} /> : <Circle size={12} />}</span>
            <span>{step.fullText || step.text}</span>
          </li>)}
        </ol>
      </section>}
    </div>
  </section>;
}
