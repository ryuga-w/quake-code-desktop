import React, { useEffect } from "react";
import { useModalFocusTrap } from "../../lib/modal-focus";
import { SessionsPanel } from "../sessions/SessionsPanel";

export function SessionPickerModal({ loading, onClose, onSwitch }: { loading?: boolean; onClose: () => void; onSwitch: (path: string) => void | Promise<void> }) {
  const dialogRef = useModalFocusTrap<HTMLDivElement>();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="modal-backdrop gemini-backdrop" onMouseDown={onClose}><div ref={dialogRef} tabIndex={-1} className="modal-card gemini-modal" role="dialog" aria-modal="true" aria-label="Sohbet sürdür" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="gemini-close" onClick={onClose} aria-label="Kapat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg></button><div className="gemini-modal-header"><div className="gemini-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg></div><h2>Sohbet sürdür</h2><p>Önceki sohbetlerinden birini seç veya yeni başla</p></div><div className="gemini-modal-body"><SessionsPanel loading={loading} onSwitch={onSwitch} /></div></div></div>;
}
