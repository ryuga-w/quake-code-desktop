import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, Code2, Copy, ExternalLink, FolderOpen, Minus, Plus, WrapText, X } from "lucide-react";
import { normalizeThemeId } from "../settings/SettingsPanels";
import { readStorageValue, writeStorageValue } from "../../lib/storage";
import { DEFAULT_THEME, monacoThemeFor } from "../../lib/theme";
import { detectLanguage, isBinaryPath } from "../../lib/path-utils";
import { formatBytes } from "../../lib/format-utils";
import { copyTextWithToast } from "../../lib/copy-toast";
import { MarkdownContent } from "../markdown/MarkdownContent";
import { useI18n } from "../../i18n";

const Editor = React.lazy(() => import("@monaco-editor/react").then((m) => ({ default: m.default })));

export function PreviewPanel({ filePreview, onOpen, onClose, onOpenFile }: { filePreview: { path?: string; content: string }; onOpen: () => void; onClose?: () => void; onOpenFile?: (path: string) => void }) {
  const { t, locale } = useI18n();
  const monacoTheme = monacoThemeFor(normalizeThemeId(readStorageValue("quake-web:theme", DEFAULT_THEME)));
  const [fontSize, setFontSize] = useState(() => Number(readStorageValue("quake-web:previewFontSize", "13")) || 13);
  const [wordWrap, setWordWrap] = useState(() => readStorageValue("quake-web:previewWordWrap") === "1");
  const path = filePreview.path || "";
  const content = filePreview.content || "";
  const isBinary = isBinaryPath(path);
  const language = useMemo(() => detectLanguage(path), [path]);
  const isMarkdown = language === "markdown";
  const [showMarkdownSource, setShowMarkdownSource] = useState(false);
  const pathParts = path.replace(/[\/]/g, "\\").split("\\").filter(Boolean);
  const fileName = pathParts.pop() || t("files.preview");
  const dirPath = pathParts.join(" \u003e ");
  const copy = (text: string, msg: string) => copyTextWithToast(text, msg);

  useEffect(() => setShowMarkdownSource(false), [path]);

  function handleFontSize(delta: number) {
    const next = Math.min(24, Math.max(10, fontSize + delta));
    setFontSize(next);
    writeStorageValue("quake-web:previewFontSize", String(next));
  }

  if (isMarkdown) {
    return <div className="preview-panel-github preview-document-shell">
      <div className="preview-document-header">
        <div className="preview-document-path" title={path}>
          <span>{dirPath || "quake code"}</span><b>/</b><strong>{fileName}</strong>
        </div>
        <div className="preview-document-actions">
          <button type="button" onClick={() => setShowMarkdownSource((value) => !value)} aria-pressed={showMarkdownSource}>
            <Code2 size={13} aria-hidden="true" />
            {showMarkdownSource ? (locale === "en" ? "View document" : "Belgeyi görüntüle") : (locale === "en" ? "View source" : "Kaynağı görüntüle")}
          </button>
          <button type="button" className="preview-document-open" onClick={onOpen}>{locale === "en" ? "Open" : "Aç"} <ChevronDown size={12} aria-hidden="true" /></button>
          {onClose && <button type="button" className="preview-icon-btn" onClick={onClose} aria-label={locale === "en" ? "Close preview" : "Önizlemeyi kapat"} title={locale === "en" ? "Close preview" : "Önizlemeyi kapat"}><X size={14} /></button>}
        </div>
      </div>
      {showMarkdownSource ? (
        <div className="preview-monaco-container">
          <React.Suspense fallback={<div className="panel-loading" style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%"}}>{locale === "en" ? "Loading…" : "Yükleniyor…"}</div>}>
            <Editor theme={monacoTheme} language="markdown" value={content} options={{ readOnly: true, minimap: { enabled: false }, lineNumbers: "on", fontSize, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", wordWrap: wordWrap ? "on" : "off", scrollBeyondLastLine: false, automaticLayout: true, overviewRulerLanes: 0, hideCursorInOverviewRuler: true, overviewRulerBorder: false, padding: { top: 12, bottom: 12 } }} />
          </React.Suspense>
        </div>
      ) : (
        <article className="preview-markdown-document">
          <MarkdownContent content={content} isStreaming={false} onOpenFile={onOpenFile || (() => undefined)} />
        </article>
      )}
    </div>;
  }

  function handleToggleWordWrap() {
    const next = !wordWrap;
    setWordWrap(next);
    writeStorageValue("quake-web:previewWordWrap", next ? "1" : "0");
  }

  if (!path) {
    return <div className="preview-panel-github preview-empty-shell">
      <div className="preview-empty-path">/</div>
      <div className="preview-empty"><FolderOpen size={25} strokeWidth={1.45} aria-hidden="true" /><strong>{locale === "en" ? "Open a file" : "Dosya aç"}</strong><span>{locale === "en" ? "Select a file from the workspace tree" : "Çalışma alanı ağacından bir dosya seç"}</span></div>
    </div>;
  }

  if (isBinary) {
    return <div className="panel preview-panel"><div className="preview-tabbar"><button type="button" className="active">{fileName}</button><button type="button" onClick={() => copy(path, locale === "en" ? "Path copied" : "Yol kopyalandı")}>{locale === "en" ? "Copy path" : "Yolu kopyala"}</button>{onClose && <button type="button" onClick={onClose}>{locale === "en" ? "Close" : "Kapat"}</button>}</div><div className="preview-binary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg><span>{locale === "en" ? "Preview is not supported for this file type" : "Dosya türü önizleme desteklemiyor"}</span><small>{fileName}</small></div></div>;
  }

  return <div className="preview-panel-github">
    <div className="preview-breadcrumb"><span className="breadcrumb-path">{dirPath}</span>{dirPath && <span className="breadcrumb-sep">/</span>}<span className="breadcrumb-file">{fileName}</span></div>
    <div className="preview-toolbar">
      <div className="preview-toolbar-left"><span className="preview-lang">{language}</span><span className="preview-size">{formatBytes(content.length)}</span></div>
      <div className="preview-toolbar-right">
        <button type="button" className="preview-icon-btn preview-font-btn" onClick={() => handleFontSize(-1)} title={locale === "en" ? "Decrease text size" : "Yazıyı küçült"} aria-label={locale === "en" ? "Decrease text size" : "Yazıyı küçült"}><Minus size={14} /></button>
        <span className="preview-font-label">{fontSize}</span>
        <button type="button" className="preview-icon-btn preview-font-btn" onClick={() => handleFontSize(1)} title={locale === "en" ? "Increase text size" : "Yazıyı büyüt"} aria-label={locale === "en" ? "Increase text size" : "Yazıyı büyüt"}><Plus size={14} /></button>
        <button type="button" className={`preview-icon-btn preview-wrap-btn ${wordWrap ? "active" : ""}`} onClick={handleToggleWordWrap} title={locale === "en" ? "Word wrap" : "Sözcük kaydırma"} aria-label={locale === "en" ? "Toggle word wrap" : "Sözcük kaydırmayı değiştir"} aria-pressed={wordWrap}><WrapText size={15} /></button>
        <button type="button" className="preview-icon-btn" onClick={() => copy(path, locale === "en" ? "Path copied" : "Yol kopyalandı")} title={locale === "en" ? "Copy path" : "Yolu kopyala"} aria-label={locale === "en" ? "Copy file path" : "Dosya yolunu kopyala"}><Copy size={14} /></button>
        <button type="button" className="preview-icon-btn" onClick={() => copy(content, locale === "en" ? "Content copied" : "İçerik kopyalandı")} title={locale === "en" ? "Copy content" : "İçeriği kopyala"} aria-label={locale === "en" ? "Copy file content" : "Dosya içeriğini kopyala"}><Copy size={14} /></button>
        <button type="button" className="preview-icon-btn preview-open-btn" onClick={onOpen} title={locale === "en" ? "Open in editor" : "Editörde aç"} aria-label={locale === "en" ? "Open file in editor" : "Dosyayı editörde aç"}><ExternalLink size={15} /></button>
        {onClose && <button type="button" className="preview-icon-btn preview-close-btn" onClick={onClose} aria-label={locale === "en" ? "Close preview" : "Önizlemeyi kapat"} title={locale === "en" ? "Close preview" : "Önizlemeyi kapat"}><X size={15} /></button>}
      </div>
    </div>
    <div className="preview-monaco-container">
      <React.Suspense fallback={<div className="panel-loading" style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%"}}>{locale === "en" ? "Loading…" : "Yükleniyor…"}</div>}>
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
