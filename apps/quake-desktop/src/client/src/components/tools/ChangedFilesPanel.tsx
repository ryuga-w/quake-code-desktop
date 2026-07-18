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

export function ChangedFilesPanel({ onOpenFile, onOpenDiff, onAsk }: { onOpenFile: (path: string) => void; onOpenDiff: (card: ToolCardState) => void; onAsk: (text: string) => void }) {
  const toolMap = useAppStore((s) => s.tools);
  const recentTools = useMemo(() => selectRecentToolsForChangesFromMap(toolMap), [toolMap]);
  const copy = (text: string) => copyTextWithToast(text, "Değişiklik kopyalandı");
  const changes = useMemo(() => extractFileChanges(recentTools).slice(0, 28), [recentTools]);
  return <div className="panel changed-files"><div className="panel-title-row"><div className="panel-title">Çalışma alanı değişiklikleri</div><span>{changes.length}</span></div>{changes.length ? <div className="changed-file-list">{changes.map((change) => <div className={`changed-file ${change.kind}`} key={`${change.path}-${change.tool.id}`}><div className="changed-main" role="button" tabIndex={0} aria-label={`${change.path} dosyasını aç`} onClick={() => onOpenFile(change.path)} onKeyDown={(event) => handleActivationKey(event, () => onOpenFile(change.path))}><span className="file-icon">{fileIcon(change.path)}</span><div><div className="title">{change.path}</div><div className="sub"><b>{changeKindLabel(change.kind)}</b> · {toolDisplayName(change.tool.toolName)} · {statusLabel(change.tool.status)} · Tur #{change.tool.turnId || "?"}{change.summary ? ` · ${change.summary}` : ""}</div></div></div><div className="changed-actions"><button type="button" onClick={() => onOpenFile(change.path)}>Aç</button>{isDiff(change.patch) && <button type="button" onClick={() => onOpenDiff(change.tool)}>Diff aç</button>}<button type="button" onClick={() => copy(change.patch || change.path)}>Değişikliği kopyala</button><button type="button" onClick={() => onAsk(`Bu dosya değişikliğini incele ve etkisini açıkla:\n\nDosya: ${change.path}\nİşlem: ${change.kind}\nAraç: ${change.tool.toolName}\nÖzet: ${change.summary || "-"}\n\nDeğişiklik/çıktı:\n${(change.patch || "").slice(0, 6000)}`)}>Sor</button></div></div>)}</div> : <div className="muted">Henüz dosya değişikliği yok</div>}</div>;
}
