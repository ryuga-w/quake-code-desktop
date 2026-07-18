import React, { useRef } from "react";
import { normalizeThemeId } from "../settings/SettingsPanels";
import { readStorageValue } from "../../lib/storage";
import { DEFAULT_THEME, monacoThemeFor } from "../../lib/theme";
import { EditableMonaco } from "./EditableMonaco";
import type { FileTab } from "../../types";

const DiffEditor = React.lazy(() => import("@monaco-editor/react").then((m) => ({ default: m.DiffEditor })));

export function EditorTabsInner({ tabs, activePath, onSelect, onClose, onCloseAll, onReveal, onOpenMonaco, onTabSave }: { tabs: FileTab[]; activePath?: string; onSelect: (tab: FileTab) => void; onClose: (path: string) => void; onCloseAll: () => void; onReveal: (path: string) => void; onOpenMonaco: (tab: FileTab) => void; onTabSave?: (path: string, content: string) => void }) {
  const monacoTheme = monacoThemeFor(normalizeThemeId(readStorageValue("quake-web:theme", DEFAULT_THEME)));
  const editorRef = useRef<any>(null);
  if (!tabs.length) return null;
  const active = tabs.find((tab) => tab.path === activePath) || tabs[0];
  const title = active.path.startsWith("diff:") ? active.path.replace(/^diff:/, "") : active.path.split(/[\\/]/).pop();
  const runFind = () => editorRef.current?.getAction?.("actions.find")?.run?.();
  return <div className="editor-tabs-shell"><div className="editor-tabs-head"><div className="editor-tabs">{tabs.map((tab) => {
    const name = tab.path.split(/[\\/]/).pop();
    const stateLabel = [tab.dirty ? "Kaydedilmemiş değişiklik" : "", tab.mode === "diff" ? "Diff" : ""].filter(Boolean).join(", ");
    return <div key={tab.path} role="tab" tabIndex={0} aria-label={stateLabel ? `${tab.path}, ${stateLabel}` : tab.path} aria-selected={tab.path === active.path} className={`editor-tab ${tab.path === active.path ? "active" : ""}`} onClick={() => onSelect(tab)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(tab); } }}><span className="editor-tab-title">{tab.dirty && <span className="editor-tab-dirty" aria-hidden="true" />}{tab.mode === "diff" && <span className="editor-tab-kind">Diff</span>}<span className="editor-tab-name">{name}</span></span><small>{tab.path}</small><button type="button" className="editor-tab-close" aria-label={`${tab.path} sekmesini kapat`} onClick={(event) => { event.stopPropagation(); onClose(tab.path); }}>×</button></div>;
  })}</div><button type="button" className="close-all-tabs" onClick={onCloseAll}>Hepsini kapat</button></div><div className="editor-tab-preview"><div className="editor-tab-head"><span>{title}</span><div>{active.mode === "diff" && <button type="button" onClick={runFind}>Bul</button>}{active.mode === "editor" && <button type="button" onClick={() => onReveal(active.path)}>Göster</button>}<button type="button" onClick={() => onOpenMonaco(active)}>Ayrı aç</button></div></div><div className="inline-monaco">{active.mode === "editor" ? <EditableMonaco path={active.path} content={active.content} onSave={onTabSave} /> : <React.Suspense fallback={<div className="panel-loading">Yükleniyor…</div>}><DiffEditor theme={monacoTheme} original={active.original} modified={active.modified} onMount={(editor) => { editorRef.current = editor.getModifiedEditor(); }} options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false }} /></React.Suspense>}</div></div></div>;
}

export const EditorTabs = React.memo(EditorTabsInner);
