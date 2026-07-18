import React from "react";
import { ArrowRight, Pencil, X } from "lucide-react";
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
  return <section className={styles.root} aria-label="Plan onayı">
    <header className={styles.header}>
      <b>Bu plan uygulansın mı?</b>
      <button type="button" onClick={onDismiss} aria-label="Plan onayını kapat" disabled={pending}>
        <X size={13} strokeWidth={1.9} aria-hidden="true" />
      </button>
    </header>
    <button type="button" className={styles.apply} onClick={onApply} disabled={pending}>
      <span className={styles.number}>{pending ? <i aria-hidden="true" /> : "1"}</span>
      <span>{pending ? "Plan uygulanıyor…" : "Evet, bu planı uygula"}</span>
      <ArrowRight size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
    <div className={styles.reviseRow}>
      <button type="button" className={styles.revise} onClick={onRevise} disabled={pending}>
        <Pencil size={13} strokeWidth={1.8} aria-hidden="true" />
        <span>Hayır, Quake’e neyi farklı yapacağını söyle</span>
      </button>
      <button type="button" className={styles.skip} onClick={onDismiss} disabled={pending}>Atla</button>
    </div>
  </section>;
}
