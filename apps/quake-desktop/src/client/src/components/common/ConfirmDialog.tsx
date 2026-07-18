import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
  requireText?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel = "Onayla", cancelLabel = "İptal", variant = "danger", requireText, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");
  const [isPending, setIsPending] = useState(false);
  const canConfirm = requireText ? inputValue === requireText : true;

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const timer = window.setTimeout(() => {
      const first = el.querySelector<HTMLElement>("button:not([disabled]),input:not([disabled])");
      (first || el).focus({ preventScroll: true });
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      if (event.key === "Tab") {
        const focusable = Array.from(el.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled])")).filter((e) => {
          const s = getComputedStyle(e);
          return s.display !== "none" && s.visibility !== "hidden" && e.offsetWidth > 0 && e.offsetHeight > 0;
        });
        if (!focusable.length) { event.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    el.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener("keydown", onKeyDown);
      if (previous && document.contains(previous)) window.setTimeout(() => previous.focus({ preventScroll: true }), 0);
    };
  }, [onCancel]);

  async function handleConfirm() {
    if (!canConfirm || isPending) return;
    setIsPending(true);
    try { await onConfirm(); } finally { setIsPending(false); }
  }

  return (
    <div className={styles.backdrop} onMouseDown={onCancel} role="presentation">
      <div ref={dialogRef} tabIndex={-1} className={`${styles.dialog} ${styles[variant]}`} role="alertdialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={`${styles.icon} ${styles[variant]}`} aria-hidden="true">{variant === "info" ? <Info size={22} /> : <AlertTriangle size={22} />}</span>
          <h3>{title}</h3>
        </div>
        <p className={styles.message}>{message}</p>
        {requireText && (
          <div className={styles.inputGroup}>
            <label>Devam etmek için <code>{requireText}</code> yazın:</label>
            <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} placeholder={requireText} autoFocus />
          </div>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={styles.confirm} disabled={!canConfirm || isPending} onClick={() => void handleConfirm()}>
            {isPending ? "İşleniyor…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface UseConfirmReturn {
  confirm: (props: Omit<ConfirmDialogProps, "onConfirm" | "onCancel">) => Promise<boolean>;
  ConfirmPortal: React.FC;
}

export function useConfirm(): UseConfirmReturn {
  const [state, setState] = useState<{ props: ConfirmDialogProps; resolve: (value: boolean) => void } | null>(null);

  const confirm = (props: Omit<ConfirmDialogProps, "onConfirm" | "onCancel">): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({
        props: {
          ...props,
          onConfirm: () => { setState(null); resolve(true); },
          onCancel: () => { setState(null); resolve(false); },
        },
        resolve,
      });
    });
  };

  const ConfirmPortal: React.FC = () => (state ? <ConfirmDialog {...state.props} /> : null);

  return { confirm, ConfirmPortal };
}
