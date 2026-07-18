import React from "react";
import { Check, Circle, FileText, X } from "lucide-react";
import type { WebPlanState } from "../../../../shared/protocol";
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
  const markdown = plan.artifact?.markdown || "";

  return <section className={styles.root} aria-label="Proposed Plan">
    <header className={styles.toolbar}>
      <div className={styles.breadcrumb}><span>Plan</span><i>›</i><b>Proposed Plan</b></div>
      <div className={styles.actions}>
        <span className={styles.model}>{plan.enabled ? "Plan mode" : "Default mode"}</span>
        <button type="button" className={styles.icon} onClick={onClose} aria-label="Plan sekmesini kapat"><X size={15} /></button>
      </div>
    </header>
    <div className={styles.scroll}>
      {markdown
        ? <article className={styles.document}><MarkdownMessage text={markdown} onOpenFile={onOpenFile} /></article>
        : <div className={styles.empty}><FileText size={24} /><b>Plan hazırlanıyor</b><span>Codex-compatible Plan Mode çıktısı burada artımlı görünecek.</span></div>}
      {plan.steps.length > 0 && <section className={styles.todos} aria-label="Updated Plan">
        <div className={styles.todoHead}><span>Updated Plan</span></div>
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
