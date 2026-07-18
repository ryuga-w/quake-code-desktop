import React, { useMemo, useState } from "react";
import { Copy, ExternalLink, Minus, Plus, WrapText, X } from "lucide-react";
import { normalizeThemeId } from "../settings/SettingsPanels";
import { readStorageValue, writeStorageValue } from "../../lib/storage";
import { DEFAULT_THEME, monacoThemeFor } from "../../lib/theme";
import { detectLanguage, isBinaryPath } from "../../lib/path-utils";
import { formatBytes } from "../../lib/format-utils";
import { copyTextWithToast } from "../../lib/copy-toast";

const Editor = React.lazy(() => import("@monaco-editor/react").then((m) => ({ default: m.default })));

export function PreviewPanel({ filePreview, onOpen, onClose }: { filePreview: { path?: string; content: string }; onOpen: () => void; onClose?: () => void }) {
  const monacoTheme = monacoThemeFor(normalizeThemeId(readStorageValue("quake-web:theme", DEFAULT_THEME)));
  const [fontSize, setFontSize] = useState(() => Number(readStorageValue("quake-web:previewFontSize", "13")) || 13);
  const [wordWrap, setWordWrap] = useState(() => readStorageValue("quake-web:previewWordWrap") === "1");
  const path = filePreview.path || "";
  const content = filePreview.content || "";
  const isBinary = isBinaryPath(path);
  const language = useMemo(() => detectLanguage(path), [path]);
  const pathParts = path.replace(/[\/]/g, "\\").split("\\").filter(Boolean);
  const fileName = pathParts.pop() || "Önizleme";
  const dirPath = pathParts.join(" \u003e ");
  const copy = (text: string, msg: string) => copyTextWithToast(text, msg);

  function handleFontSize(delta: number) {
    const next = Math.min(24, Math.max(10, fontSize + delta));
    setFontSize(next);
    writeStorageValue("quake-web:previewFontSize", String(next));
  }

  function handleToggleWordWrap() {
    const next = !wordWrap;
    setWordWrap(next);
    writeStorageValue("quake-web:previewWordWrap", next ? "1" : "0");
  }

  if (!path) {
    return <div className="preview-panel-github preview-empty"><div className="preview-empty-icon" aria-hidden="true">‹/›</div><strong>Dosya aç</strong><span>Çalışma alanı ağacından bir dosya seç</span></div>;
  }

  if (isBinary) {
    return <div className="panel preview-panel"><div className="preview-tabbar"><button type="button" className="active">{fileName}</button><button type="button" onClick={() => copy(path, "Yol kopyalandı")}>Yolu kopyala</button>{onClose && <button type="button" onClick={onClose}>Kapat</button>}</div><div className="preview-binary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg><span>Dosya türü önizleme desteklemiyor</span><small>{fileName}</small></div></div>;
  }

  return <div className="preview-panel-github">
    <div className="preview-breadcrumb"><span className="breadcrumb-path">{dirPath}</span>{dirPath && <span className="breadcrumb-sep">/</span>}<span className="breadcrumb-file">{fileName}</span></div>
    <div className="preview-toolbar">
      <div className="preview-toolbar-left"><span className="preview-lang">{language}</span><span className="preview-size">{formatBytes(content.length)}</span></div>
      <div className="preview-toolbar-right">
        <button type="button" className="preview-icon-btn preview-font-btn" onClick={() => handleFontSize(-1)} title="Yazıyı küçült" aria-label="Yazıyı küçült"><Minus size={14} /></button>
        <span className="preview-font-label">{fontSize}</span>
        <button type="button" className="preview-icon-btn preview-font-btn" onClick={() => handleFontSize(1)} title="Yazıyı büyüt" aria-label="Yazıyı büyüt"><Plus size={14} /></button>
        <button type="button" className={`preview-icon-btn preview-wrap-btn ${wordWrap ? "active" : ""}`} onClick={handleToggleWordWrap} title="Sözcük kaydırma" aria-label="Sözcük kaydırmayı değiştir" aria-pressed={wordWrap}><WrapText size={15} /></button>
        <button type="button" className="preview-icon-btn" onClick={() => copy(path, "Yol kopyalandı")} title="Yolu kopyala" aria-label="Dosya yolunu kopyala"><Copy size={14} /></button>
        <button type="button" className="preview-icon-btn" onClick={() => copy(content, "İçerik kopyalandı")} title="İçeriği kopyala" aria-label="Dosya içeriğini kopyala"><Copy size={14} /></button>
        <button type="button" className="preview-icon-btn preview-open-btn" onClick={onOpen} title="Editörde aç" aria-label="Dosyayı editörde aç"><ExternalLink size={15} /></button>
        {onClose && <button type="button" className="preview-icon-btn preview-close-btn" onClick={onClose} aria-label="Önizlemeyi kapat" title="Önizlemeyi kapat"><X size={15} /></button>}
      </div>
    </div>
    <div className="preview-monaco-container">
      <React.Suspense fallback={<div className="panel-loading" style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%"}}>Yükleniyor…</div>}>
      <Editor
        theme={monacoTheme}
        language={language}
        value={content}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          lineNumbers: "on",
          fontSize,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontLigatures: true,
          wordWrap: wordWrap ? "on" : "off",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          renderWhitespace: "selection",
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          padding: { top: 12, bottom: 12 },
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        }}
      />
      </React.Suspense>
    </div>
  </div>;
}
