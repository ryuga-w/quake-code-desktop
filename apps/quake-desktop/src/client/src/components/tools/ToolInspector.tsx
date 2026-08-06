import React, { useEffect } from "react";
import { useAppStore, type ToolCardState } from "../../state/app-store";
import { useModalFocusTrap } from "../../lib/modal-focus";
import { copyTextWithToast } from "../../lib/copy-toast";
import { formatDate, isDiff } from "../../lib/render";
import { formatDuration, statusLabel } from "../../lib/format-utils";
import { useI18n } from "../../i18n";
import {
  safeToolJson,
  toolDetailsText,
  toolDiffText,
  toolDisplayName,
  toolPreviewText,
} from "../../lib/tool-helpers";

export function ToolInspector({ toolId, onClose, onAsk, onOpenDiff, onAddContext }: { toolId: string; onClose: () => void; onAsk: (text: string) => void; onOpenDiff: (card: ToolCardState) => void; onAddContext: (card: ToolCardState) => void }) {
  const { t, locale } = useI18n();
  const inspectorRef = useModalFocusTrap<HTMLElement>();
  const card = useAppStore((s) => s.tools[toolId]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  if (!card) return <div className="inspector-backdrop" onMouseDown={onClose}>
    <aside ref={inspectorRef} tabIndex={-1} className="tool-inspector tool-inspector-empty" role="dialog" aria-modal="true" aria-label={t("tools.inspector.missingLabel")} onMouseDown={(event) => event.stopPropagation()}>
      <div className="inspector-head"><div><div className="panel-title">{t("tools.inspector.title")}</div><h2>{t("tools.inspector.missingTitle")}</h2><div className="tool-inspector-meta">{t("tools.inspector.missingDescription")}</div></div><button type="button" onClick={onClose}>{t("tools.inspector.close")}</button></div>
    </aside>
  </div>;
  const args = card.args === undefined ? "" : safeToolJson(card.args);
  const output = card.output || "";
  const details = toolDetailsText(card);
  const diff = toolDiffText(card);
  const preview = toolPreviewText(card, locale);
  const askText = output || details || preview || args;
  const copy = (text: string, successMessage: string) => copyTextWithToast(text, successMessage);
  const askPrompt = `${t("tools.inspector.askPrompt", { tool: card.toolName })}\n\n${askText.slice(0, 6000)}`;
  return <div className="inspector-backdrop" onMouseDown={onClose}>
    <aside ref={inspectorRef} tabIndex={-1} className="tool-inspector" role="dialog" aria-modal="true" aria-label={t("tools.inspector.title")} onMouseDown={(event) => event.stopPropagation()}>
      <div className="inspector-head"><div><div className="panel-title">{t("tools.inspector.title")}</div><h2>{toolDisplayName(card.toolName, locale)}</h2><span className={`status-badge ${card.status}`}>{statusLabel(card.status, locale)}</span><div className="tool-inspector-meta">{t("tools.turn", { id: card.turnId || "?" })} · {card.startedAt ? formatDate(card.startedAt) : t("tools.inspector.started")}{card.durationMs !== undefined ? ` · ${formatDuration(card.durationMs)}` : ""}</div></div><button type="button" onClick={onClose}>{t("tools.inspector.close")}</button></div>
      <div className="inspector-actions"><button type="button" onClick={() => copy(args, t("tools.inspector.copiedInput"))}>{t("tools.inspector.copyInput")}</button>{output && <button type="button" onClick={() => copy(output, t("tools.inspector.copiedOutput"))}>{t("tools.inspector.copyOutput")}</button>}{details && <button type="button" onClick={() => copy(details, t("tools.inspector.copiedDetails"))}>{t("tools.inspector.copyDetails")}</button>}{isDiff(diff || output) && <button type="button" onClick={() => onOpenDiff(card)}>{t("tools.inspector.openDiff")}</button>}<button type="button" onClick={() => onAddContext(card)}>{t("tools.inspector.addContext")}</button><button type="button" onClick={() => onAsk(askPrompt)}>{t("tools.inspector.ask")}</button></div>
      <section><h3>{t("tools.inspector.livePreview")}</h3><pre>{preview}</pre></section>
      {args && <section><h3>{t("tools.inspector.input")}</h3><pre>{args}</pre></section>}
      {output && <section><h3>{t("tools.inspector.output")}</h3><pre>{output}</pre></section>}
      {details && <section><h3>{t("tools.inspector.details")}</h3><pre>{details}</pre></section>}
    </aside>
  </div>;
}
