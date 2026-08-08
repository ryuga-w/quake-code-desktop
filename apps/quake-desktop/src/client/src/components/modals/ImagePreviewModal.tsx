import React, { useEffect, useState } from "react";
import { Check, Copy, Download, X } from "lucide-react";
import { useModalFocusTrap } from "../../lib/modal-focus";
import type { ComposerImage } from "../../types";

export function ImagePreviewModal({ image, onClose }: { image: ComposerImage; onClose: () => void }) {
  const dialogRef = useModalFocusTrap<HTMLDivElement>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = image.previewUrl;
    link.download = image.name || "image.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && typeof window.fetch === "function") {
        const response = await fetch(image.previewUrl);
        const blob = await response.blob();
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type || "image/png"]: blob }),
        ]);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      await navigator.clipboard?.writeText(image.previewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="image-preview-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="image-preview-card"
        role="dialog"
        aria-modal="true"
        aria-label="Görsel önizleme"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <img src={image.previewUrl} alt={image.name} />
        <div className="image-preview-header" onMouseDown={(e) => e.stopPropagation()}>
        <span className="image-preview-filename" title={image.name}>
          {image.name}
        </span>
        <div className="image-preview-toolbar">
          <button
            type="button"
            className="image-preview-action-btn"
            onClick={handleCopy}
            title={copied ? "Kopyalandı!" : "Görseli Kopyala"}
          >
            {copied ? <Check size={15} color="#10b981" /> : <Copy size={15} />}
          </button>
          <button
            type="button"
            className="image-preview-action-btn"
            onClick={handleDownload}
            title="Görseli İndir"
          >
            <Download size={15} />
          </button>
          <button
            type="button"
            className="image-preview-close-btn"
            onClick={onClose}
            aria-label="Önizlemeyi kapat (Esc)"
            title="Kapat (Esc)"
          >
            <X size={18} strokeWidth={2.2} />
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
