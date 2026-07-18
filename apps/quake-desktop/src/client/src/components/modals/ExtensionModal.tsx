import React, { useEffect, useState } from "react";
import { apiPost } from "../../lib/api";
import { useAppStore } from "../../state/app-store";
import { useModalFocusTrap } from "../../lib/modal-focus";

export function ExtensionModal({ request, onClose }: { request: any; onClose: () => void }) {
  const [value, setValue] = useState(request.prefill || request.options?.[0] || "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const showToast = useAppStore((state) => state.showToast);
  const dialogRef = useModalFocusTrap<HTMLFormElement>();
  const cancel = () => {
    if (pending) return;
    apiPost("/api/command", { type: "extension_ui_response", id: request.id, cancelled: true })
      .catch((err: any) => showToast(`Eklenti iptali gönderilemedi: ${err?.message || "bilinmeyen hata"}`, "error"));
    onClose();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, request.id]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await apiPost("/api/command", { type: "extension_ui_response", id: request.id, confirmed: request.method === "confirm" ? true : undefined, value });
      onClose();
    } catch (err: any) {
      const message = err?.message || "Eklenti yanıtı gönderilemedi";
      setError(message);
      showToast(`Eklenti yanıtı gönderilemedi: ${message}`, "error");
    } finally {
      setPending(false);
    }
  }
  return <div className="modal-backdrop" onMouseDown={cancel}><form ref={dialogRef} tabIndex={-1} className="modal-card" role="dialog" aria-modal="true" aria-label={request.title || "Eklenti isteği"} onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-kicker">Eklenti arayüzü</div><h2>{request.title || "Eklenti isteği"}</h2><p className="muted">{request.message}</p>{error && <div className="workspace-error">{error}</div>}<div className="modal-body">{request.method === "select" && <select value={value} disabled={pending} onChange={(e) => setValue(e.target.value)}>{request.options?.map((option: string) => <option key={option}>{option}</option>)}</select>}{request.method === "input" && <input value={value} placeholder={request.placeholder} disabled={pending} onChange={(e) => setValue(e.target.value)} />}{request.method === "editor" && <textarea value={value} disabled={pending} onChange={(e) => setValue(e.target.value)} />}{request.method === "confirm" && <div>{request.message || "Emin misin?"}</div>}</div><div className="modal-actions"><button type="button" onClick={cancel} disabled={pending}>Vazgeç</button><button type="submit" disabled={pending}>{pending ? "Gönderiliyor…" : request.method === "confirm" ? "Onayla" : "Tamam"}</button></div></form></div>;
}
