import React, { useEffect } from "react";
import { X } from "lucide-react";
import { useModalFocusTrap } from "../../lib/modal-focus";
import type { ComposerImage } from "../../types";

export function ImagePreviewModal({ image, onClose }: { image: ComposerImage; onClose: () => void }) {
  const dialogRef = useModalFocusTrap<HTMLDivElement>();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="image-preview-backdrop" onMouseDown={onClose}><div ref={dialogRef} tabIndex={-1} className="image-preview-card" role="dialog" aria-modal="true" aria-label="Görsel önizleme" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="image-preview-close" onClick={onClose} aria-label="Görsel önizlemeyi kapat"><X size={16} strokeWidth={1.8} aria-hidden="true" /></button><img src={image.previewUrl} alt={image.name} /><span>{image.name}</span></div></div>;
}
