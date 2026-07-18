import React, { useEffect } from "react";
import { useAppStore, type ToolCardState } from "../../state/app-store";
import { useModalFocusTrap } from "../../lib/modal-focus";
import { copyTextWithToast } from "../../lib/copy-toast";
import { formatDate, isDiff } from "../../lib/render";
import { formatDuration, statusLabel } from "../../lib/format-utils";
import {
  safeToolJson,
  toolDetailsText,
  toolDiffText,
  toolDisplayName,
  toolPreviewText,
} from "../../lib/tool-helpers";

export function ToolInspector({ toolId, onClose, onAsk, onOpenDiff, onAddContext }: { toolId: string; onClose: () => void; onAsk: (text: string) => void; onOpenDiff: (card: ToolCardState) => void; onAddContext: (card: ToolCardState) => void }) {
  const inspectorRef = useModalFocusTrap<HTMLElement>();
  const card = useAppStore((s) => s.tools[toolId]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  if (!card) return <div className="inspector-backdrop" onMouseDown={onClose}>
    <aside ref={inspectorRef} tabIndex={-1} className="tool-inspector tool-inspector-empty" role="dialog" aria-modal="true" aria-label="Araç kaydı bulunamadı" onMouseDown={(event) => event.stopPropagation()}>
      <div className="inspector-head"><div><div className="panel-title">Araç inceleyici</div><h2>Kayıt artık bellekte değil</h2><div className="tool-inspector-meta">Araç akışı temizlenmiş veya eski kayıt performans için budanmış olabilir.</div></div><button type="button" onClick={onClose}>Kapat</button></div>
    </aside>
  </div>;
  const args = card.args === undefined ? "" : safeToolJson(card.args);
  const output = card.output || "";
  const details = toolDetailsText(card);
  const diff = toolDiffText(card);
  const preview = toolPreviewText(card);
  const askText = output || details || preview || args;
  const copy = (text: string, successMessage: string) => copyTextWithToast(text, successMessage);
  return <div className="inspector-backdrop" onMouseDown={onClose}>
    <aside ref={inspectorRef} tabIndex={-1} className="tool-inspector" role="dialog" aria-modal="true" aria-label="Araç inceleyici" onMouseDown={(event) => event.stopPropagation()}>
      <div className="inspector-head"><div><div className="panel-title">Araç inceleyici</div><h2>{toolDisplayName(card.toolName)}</h2><span className={`status-badge ${card.status}`}>{statusLabel(card.status)}</span><div className="tool-inspector-meta">Tur #{card.turnId || "?"} · {card.startedAt ? formatDate(card.startedAt) : "başlamadı"}{card.durationMs !== undefined ? ` · ${formatDuration(card.durationMs)}` : ""}</div></div><button type="button" onClick={onClose}>Kapat</button></div>
      <div className="inspector-actions"><button type="button" onClick={() => copy(args, "Araç girdisi kopyalandı")}>Girdiyi kopyala</button>{output && <button type="button" onClick={() => copy(output, "Araç çıktısı kopyalandı")}>Çıktıyı kopyala</button>}{details && <button type="button" onClick={() => copy(details, "Araç detayı kopyalandı")}>Detayı kopyala</button>}{isDiff(diff || output) && <button type="button" onClick={() => onOpenDiff(card)}>Diff aç</button>}<button type="button" onClick={() => onAddContext(card)}>Bağlama ekle</button><button type="button" onClick={() => onAsk(`Bu ${card.toolName} araç sonucunu analiz et ve gerekiyorsa sonraki adımı öner:\n\n${askText.slice(0, 6000)}`)}>Bunu sor</button></div>
      <section><h3>Canlı önizleme</h3><pre>{preview}</pre></section>
      {args && <section><h3>Girdi</h3><pre>{args}</pre></section>}
      {output && <section><h3>Çıktı</h3><pre>{output}</pre></section>}
      {details && <section><h3>Detaylar</h3><pre>{details}</pre></section>}
    </aside>
  </div>;
}
