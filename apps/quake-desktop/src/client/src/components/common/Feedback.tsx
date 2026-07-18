import React from "react";
import { AnimatePresence, LazyMotion, domAnimation, m, MotionConfig } from "motion/react";
import { useAppStore } from "../../state/app-store";

export function ToastStack() {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>
        <div className="toast-stack" aria-live="polite">
          <AnimatePresence initial={false}>
            {toasts.map((toast) => (
              <m.div
                key={toast.id}
                layout
                className={`toast ${toast.type}`}
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.96, transition: { duration: 0.16 } }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              >
                <span>{toast.message}</span>
                {toast.action && (
                  <button type="button" onClick={() => { toast.action?.(); dismissToast(toast.id); }}>
                    {toast.actionLabel || "Aç"}
                  </button>
                )}
                <button type="button" aria-label="Bildirimi kapat" onClick={() => dismissToast(toast.id)}>×</button>
              </m.div>
            ))}
          </AnimatePresence>
        </div>
      </LazyMotion>
    </MotionConfig>
  );
}

export function SkeletonLines({ count = 3 }: { count?: number }) {
  return <div className="skeleton-lines">{Array.from({ length: count }).map((_, index) => <span key={index} />)}</div>;
}
