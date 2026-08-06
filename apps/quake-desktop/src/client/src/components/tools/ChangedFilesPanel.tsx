import React, { useMemo } from "react";
import { useAppStore, type ToolCardState } from "../../state/app-store";
import { isDiff } from "../../lib/render";
import {
  changeKindLabel,
  fileIcon,
  handleActivationKey,
  statusLabel,
} from "../../lib/format-utils";
import { extractFileChanges } from "../../lib/diff-utils";
import {
  selectRecentToolsForChangesFromMap,
  toolDisplayName,
} from "../../lib/tool-helpers";
import { copyTextWithToast } from "../../lib/copy-toast";
import { useI18n } from "../../i18n";

export function ChangedFilesPanel({ onOpenFile, onOpenDiff, onAsk }: { onOpenFile: (path: string) => void; onOpenDiff: (card: ToolCardState) => void; onAsk: (text: string) => void }) {
  const { locale } = useI18n();
  const toolMap = useAppStore((s) => s.tools);
  const recentTools = useMemo(() => selectRecentToolsForChangesFromMap(toolMap), [toolMap]);
  const copy = (text: string) => copyTextWithToast(text, locale === "en" ? "Change copied" : "Değişiklik kopyalandı");
  const changes = useMemo(() => extractFileChanges(recentTools).slice(0, 28), [recentTools]);
  return <div className="panel changed-files"><div className="panel-title-row"><div className="panel-title">{locale === "en" ? "Workspace changes" : "Çalışma alanı değişiklikleri"}</div><span>{changes.length}</span></div>{changes.length ? <div className="changed-file-list">{changes.map((change) => <div className={`changed-file ${change.kind}`} key={`${change.path}-${change.tool.id}`}><div className="changed-main" role="button" tabIndex={0} aria-label={locale === "en" ? `Open ${change.path}` : `${change.path} dosyasını aç`} onClick={() => onOpenFile(change.path)} onKeyDown={(event) => handleActivationKey(event, () => onOpenFile(change.path))}><span className="file-icon">{fileIcon(change.path)}</span><div><div className="title">{change.path}</div><div className="sub"><b>{changeKindLabel(change.kind, locale)}</b> · {toolDisplayName(change.tool.toolName, locale)} · {statusLabel(change.tool.status, locale)} · {locale === "en" ? "Turn" : "Tur"} #{change.tool.turnId || "?"}{change.summary ? ` · ${change.summary}` : ""}</div></div></div><div className="changed-actions"><button type="button" onClick={() => onOpenFile(change.path)}>{locale === "en" ? "Open" : "Aç"}</button>{isDiff(change.patch) && <button type="button" onClick={() => onOpenDiff(change.tool)}>{locale === "en" ? "Open diff" : "Diff aç"}</button>}<button type="button" onClick={() => copy(change.patch || change.path)}>{locale === "en" ? "Copy change" : "Değişikliği kopyala"}</button><button type="button" onClick={() => onAsk(`${locale === "en" ? "Review this file change and explain its impact" : "Bu dosya değişikliğini incele ve etkisini açıkla"}:\n\n${locale === "en" ? "File" : "Dosya"}: ${change.path}\n${locale === "en" ? "Operation" : "İşlem"}: ${change.kind}\n${locale === "en" ? "Tool" : "Araç"}: ${change.tool.toolName}\n${locale === "en" ? "Summary" : "Özet"}: ${change.summary || "-"}\n\n${locale === "en" ? "Change/output" : "Değişiklik/çıktı"}:\n${(change.patch || "").slice(0, 6000)}`)}>{locale === "en" ? "Ask" : "Sor"}</button></div></div>)}</div> : <div className="muted">{locale === "en" ? "No file changes yet" : "Henüz dosya değişikliği yok"}</div>}</div>;
}
