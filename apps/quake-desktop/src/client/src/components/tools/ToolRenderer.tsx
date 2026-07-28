import React, { useState } from "react";
import { FilePenLine, FilePlus2, FileText, Globe2, Search, Wrench } from "lucide-react";
import type { ToolCardImage, ToolCardState } from "../../state/app-store";
import styles from "./ToolRenderer.module.css";
import { SourceFavicons } from "./SourceFavicons";
import { useI18n } from "../../i18n";
import { extractWebSources, sourceFromUrl } from "../../lib/extract-web-sources";
import {
  isReadTool,
  isWriteTool,
  isEditTool,
  isCommandTool,
  isSearchTool,
  isBrowserTool,
} from "../../lib/tool-activity";

interface ToolRendererProps {
  tool: ToolCardState;
  onOpenFile?: (path: string) => void;
}

export function ToolRenderer({ tool, onOpenFile }: ToolRendererProps) {
  const renderer = getToolRenderer(tool.toolName);
  return <div className={styles.container}>{renderer(tool, onOpenFile)}</div>;
}

// Dosya yolu — gercek <button> (klavye + focus erisilebilir). .path CSS'i butonu
// inline metin gibi gosterir. Onceden <span onClick> idi, klavyeyle ulasilamiyordu.
function PathButton({ path, onOpenFile }: { path: string; onOpenFile?: (path: string) => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className={styles.path} onClick={() => onOpenFile?.(path)} title={`${path} — ${t("tools.renderer.openFile")}`}>
      {path}
    </button>
  );
}

function getToolRenderer(toolName: string): (tool: ToolCardState, onOpenFile?: (path: string) => void) => React.ReactNode {
  const name = toolName.toLowerCase();
  if (isCommandTool(name)) {
    return (tool, onOpenFile) => <BashRenderer tool={tool} onOpenFile={onOpenFile} />;
  }
  if (isReadTool(name)) return (tool, onOpenFile) => <ReadRenderer tool={tool} onOpenFile={onOpenFile} />;
  if (isWriteTool(name)) return (tool, onOpenFile) => <WriteRenderer tool={tool} onOpenFile={onOpenFile} />;
  if (isEditTool(name)) return (tool, onOpenFile) => <EditRenderer tool={tool} onOpenFile={onOpenFile} />;
  if (name.startsWith("web_") || name === "web_search" || name === "search_web") {
    return (tool, onOpenFile) => <WebSearchRenderer tool={tool} onOpenFile={onOpenFile} />;
  }
  if (isSearchTool(name)) {
    return (tool, onOpenFile) => <SearchRenderer tool={tool} onOpenFile={onOpenFile} />;
  }
  if (isBrowserTool(name)) return (tool, onOpenFile) => <BrowserRenderer tool={tool} onOpenFile={onOpenFile} />;
  return (tool, onOpenFile) => <DefaultRenderer tool={tool} onOpenFile={onOpenFile} />;
}

function BashRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const args = (tool.args || {}) as Record<string, any>;
  const command = args.command || args.CommandLine || "";
  const output = tool.output || "";
  const exitCode = extractExitCode(output);
  const duration = tool.durationMs ? formatDuration(tool.durationMs) : null;
  return (
    <div className={styles.bash}>
      <div className={styles.header}>
        <span className={styles.badge}>$</span>
        <code className={styles.command}>{command}</code>
        {duration && <span className={styles.meta}>{duration}</span>}
      </div>
      <pre className={styles.output}>{output || t("tools.renderer.noOutput")}</pre>
      {exitCode !== null && exitCode !== 0 && (
        <div className={styles.error}>Exit code: {exitCode}</div>
      )}
    </div>
  );
}

function ReadRenderer({ tool, onOpenFile }: ToolRendererProps) {
  const { t } = useI18n();
  const args = (tool.args || {}) as Record<string, any>;
  const path = args.path || args.filePath || args.AbsolutePath || "";
  const output = tool.output || "";
  const lines = output.split("\n").length;
  return (
    <div className={styles.read}>
      <div className={styles.header}>
        <span className={styles.badge} aria-hidden="true"><FileText size={14} /></span>
        <PathButton path={path} onOpenFile={onOpenFile} />
        <span className={styles.meta}>{lines} {t("tools.renderer.lines")}</span>
      </div>
      <pre className={styles.preview}>{output || t("tools.renderer.noOutput")}</pre>
    </div>
  );
}

function WriteRenderer({ tool, onOpenFile }: ToolRendererProps) {
  const { t } = useI18n();
  const args = (tool.args || {}) as Record<string, any>;
  const path = args.path || args.filePath || args.targetFile || args.TargetFile || "";
  const content = args.content || args.text || args.codeContent || args.CodeContent || "";
  const lines = content ? String(content).split("\n").length : 0;
  const isRunning = tool.status === "streaming" || tool.status === "running" || tool.status === "queued";
  const isNew = tool.output?.includes("new file") || tool.output?.includes("created") || isWriteTool(tool.toolName);
  return (
    <div className={styles.write}>
      <div className={styles.header}>
        <span className={`${styles.badge} ${isNew ? styles.created : styles.modified}`} aria-hidden="true">{isNew ? <FilePlus2 size={14} /> : <FilePenLine size={14} />}</span>
        <PathButton path={path} onOpenFile={onOpenFile} />
        <span className={styles.meta}>
          {isRunning ? (lines ? `${t("tools.renderer.writing")} · ${lines} ${t("tools.renderer.lines")}` : t("tools.renderer.writingEllipsis")) : `${lines} ${t("tools.renderer.lines")}`}
        </span>
        {lines > 0 && (
          <span className={styles.meta} style={{ color: "var(--success, #16a34a)" }}>+{lines}</span>
        )}
      </div>
      {content ? (
        <pre className={styles.preview}>{String(content).slice(0, 4000)}{String(content).length > 4000 ? "\n…" : ""}</pre>
      ) : isRunning ? (
        <pre className={styles.preview}>{t("tools.renderer.contentFlowing")}</pre>
      ) : null}
    </div>
  );
}

function EditRenderer({ tool, onOpenFile }: ToolRendererProps) {
  const { t } = useI18n();
  const args = (tool.args || {}) as Record<string, any>;
  const path = args.path || args.filePath || args.targetFile || args.TargetFile || "";
  const edits = Array.isArray(args.edits) ? args.edits : (Array.isArray(args.replacementChunks) ? args.replacementChunks : (Array.isArray(args.ReplacementChunks) ? args.ReplacementChunks : []));
  const oldText = args.oldText || args.old_text || args.TargetContent || args.targetContent || "";
  const newText = args.newText || args.new_text || args.ReplacementContent || args.replacementContent || "";
  const totalEdits = edits.length || (oldText || newText ? 1 : 0);
  const isRunning = tool.status === "streaming" || tool.status === "running" || tool.status === "queued";
  const diff = tool.details && typeof tool.details === "object" && "diff" in tool.details
    ? String((tool.details as any).diff || "")
    : "";
  return (
    <div className={styles.edit}>
      <div className={styles.header}>
        <span className={`${styles.badge} ${styles.modified}`} aria-hidden="true"><FilePenLine size={14} /></span>
        <PathButton path={path} onOpenFile={onOpenFile} />
        <span className={styles.meta}>
          {isRunning
            ? (totalEdits ? `${t("tools.renderer.editing")} · ${totalEdits}` : t("tools.renderer.editingEllipsis"))
            : `${totalEdits} ${t("tools.renderer.edits")}`}
        </span>
      </div>
      {diff ? (
        <DiffPreview diff={diff} />
      ) : (oldText || newText) ? (
        <pre className={styles.preview}>
          {oldText ? `- ${String(oldText).slice(0, 800)}\n` : ""}
          {newText ? `+ ${String(newText).slice(0, 800)}` : ""}
        </pre>
      ) : isRunning ? (
        <pre className={styles.preview}>{t("tools.renderer.preparingChanges")}</pre>
      ) : null}
    </div>
  );
}

function SearchRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const args = (tool.args || {}) as Record<string, any>;
  const query = args.pattern || args.query || args.q || "";
  const output = tool.output || "";
  const matchCount = (output.match(/\n/g) || []).length + (output ? 1 : 0);
  return (
    <div className={styles.search}>
      <div className={styles.header}>
        <span className={styles.badge} aria-hidden="true"><Search size={14} /></span>
        <code>{query}</code>
        <span className={styles.meta}>{matchCount} {t("tools.renderer.matches")}</span>
      </div>
      <pre className={styles.output}>{output.slice(0, 1000)}{output.length > 1000 ? "\n…" : ""}</pre>
    </div>
  );
}

type StructuredWebResult = { title: string; url: string; snippet: string; hostname: string };

function WebSearchRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const args = (tool.args || {}) as Record<string, any>;
  const details = tool.details && typeof tool.details === "object" ? tool.details as Record<string, any> : {};
  const query = args.query || args.q || args.search || details.query || "";
  const isRunning = tool.status === "streaming" || tool.status === "running";
  const status = String(details.status || "");
  const provider = String(details.provider || "");
  const results: StructuredWebResult[] = Array.isArray(details.results)
    ? details.results.filter((item: any) => item && typeof item.url === "string" && typeof item.title === "string").slice(0, 10)
    : [];
  const sources = extractWebSources({ args: tool.args, output: tool.output, result: details, limit: 12 });
  const [expanded, setExpanded] = useState(false);
  const visibleResults = expanded ? results : results.slice(0, 5);
  const failed = tool.status === "error";
  return (
    <div className={styles.webSearch}>
      <div className={styles.webSearchHeader}>
        <span className={styles.badge} aria-hidden="true"><Globe2 size={14} /></span>
        <div className={styles.webSearchIdentity}>
          <span>{isRunning ? t("tools.renderer.webSearching") : failed ? t("tools.renderer.webSearchFailed") : status === "empty" ? t("tools.renderer.noResults") : t("tools.renderer.webResults")}</span>
          {query && <code>{query}</code>}
        </div>
        <div className={styles.webSearchMeta}>
          {provider && <span>{provider === "cache" ? t("tools.renderer.cache") : provider}</span>}
          {!isRunning && !failed && <strong>{results.length} {t("tools.renderer.results")}</strong>}
        </div>
      </div>
      {(sources.length > 0 || isRunning) && <SourceFavicons sources={sources} isRunning={isRunning} label={t("tools.renderer.sources")} max={8} />}
      {isRunning && <div className={styles.webSearchLoading} role="status"><i /><span>{t("tools.renderer.scanning")}</span></div>}
      {!isRunning && failed && <div className={styles.webSearchState}><strong>{t("tools.renderer.searchFailed")}</strong><span>{t("tools.renderer.searchFailedDescription")}</span><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("quake:retry-web-search", { detail: { query } }))}>{t("tools.renderer.retry")}</button></div>}
      {!isRunning && !failed && status === "empty" && <div className={styles.webSearchState}><strong>{t("tools.renderer.queryNoResults")}</strong><span>{t("tools.renderer.queryNoResultsDescription")}</span><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("quake:retry-web-search", { detail: { query } }))}>{t("tools.renderer.searchDifferent")}</button></div>}
      {visibleResults.length > 0 && <div className={styles.webResults}>
        {visibleResults.map((result, index) => <a className={styles.webResult} href={result.url} target="_blank" rel="noopener noreferrer" key={`${result.url}-${index}`}>
          <span className={styles.webResultIndex}>{String(index + 1).padStart(2, "0")}</span>
          <span className={styles.webResultBody}><strong>{result.title}</strong>{result.snippet && <span>{result.snippet}</span>}<small>{result.hostname || sourceFromUrl(result.url)?.hostname}</small></span>
        </a>)}
      </div>}
      {results.length > 5 && <button type="button" className={styles.webResultsToggle} onClick={() => setExpanded((value) => !value)}>{expanded ? t("tools.renderer.showLess") : t("tools.renderer.showAllResults", { count: results.length })}</button>}
      {tool.output && <details className={styles.webRawOutput}><summary>{t("tools.renderer.rawSearchOutput")}</summary><pre>{tool.output}</pre></details>}
    </div>
  );
}

function BrowserRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const args = (tool.args || {}) as Record<string, any>;
  const url = args.url || "";
  const target = args.target || args.selector || "";
  const images = browserToolImages(tool);
  // Tarayici acildiginda (browser_navigate) o sitenin favicon'unu efsane animasyonla goster.
  const navSource = url ? sourceFromUrl(url) : undefined;
  const isRunning = tool.status === "streaming" || tool.status === "running";
  return (
    <div className={styles.browser}>
      <div className={styles.header}>
        <span className={styles.badge} aria-hidden="true"><Globe2 size={14} /></span>
        {url && <span className={styles.path}>{url}</span>}
        {target && <span className={styles.meta}>→ {target}</span>}
      </div>
      {navSource && (
        <div className={styles.favicons}>
          <SourceFavicons sources={[navSource]} isRunning={isRunning} inline />
        </div>
      )}
      {images.length > 0 && (
        <div className={styles.images}>
          {images.map((img, i) => (
            <img
              key={i}
              src={img.src}
              alt={t("tools.renderer.generatedImage", { count: i + 1 })}
              className={styles.generatedImage}
            />
          ))}
        </div>
      )}
      {tool.output && <pre className={styles.output}>{tool.output.slice(0, 1200)}{tool.output.length > 1200 ? "\n…" : ""}</pre>}
    </div>
  );
}

function browserToolImages(tool: ToolCardState): Array<{ src: string }> {
  const cardImages = tool.images as ToolCardImage[] | undefined;
  if (cardImages?.length) {
    return cardImages.map((img) => ({
      src: `data:${img.mimeType};base64,${img.data}`,
    }));
  }
  const details = tool.details as Record<string, unknown> | undefined;
  const nested = details?.images;
  if (Array.isArray(nested)) {
    return nested
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const rec = item as Record<string, unknown>;
        const data = typeof rec.data === "string" ? rec.data : "";
        const mimeType = typeof rec.mimeType === "string" ? rec.mimeType : "image/png";
        return data ? { src: `data:${mimeType};base64,${data}` } : null;
      })
      .filter((item): item is { src: string } => item !== null);
  }
  const screenshot = details?.screenshot;
  if (typeof screenshot === "string" && screenshot.length > 0) {
    const src = screenshot.startsWith("data:") ? screenshot : `data:image/png;base64,${screenshot}`;
    return [{ src }];
  }
  return [];
}

function DefaultRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const images = (tool.images as ToolCardImage[] | undefined) || (tool.details as any)?.images;
  const output = tool.output || "";
  return (
    <div className={styles.default}>
      <div className={styles.header}>
        <span className={styles.badge} aria-hidden="true"><Wrench size={14} /></span>
        <span>{tool.toolName}</span>
      </div>
      {images && images.length > 0 && (
        <div className={styles.images}>
          {images.map((img: ToolCardImage, i: number) => (
            <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt={t("tools.renderer.generatedImage", { count: i + 1 })} className={styles.generatedImage} />
          ))}
        </div>
      )}
      {output && <pre className={styles.output}>{output}</pre>}
    </div>
  );
}

function DiffPreview({ diff }: { diff: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const lines = diff.split("\n").slice(0, expanded ? 100 : 8);
  if (!diff.trim()) return null;
  return (
    <div className={styles.diff}>
      <pre className={styles.diffContent}>
        {lines.map((line, i) => {
          const cls = line.startsWith("+") ? styles.added : line.startsWith("-") ? styles.removed : line.startsWith("@@") ? styles.hunk : "";
          return <div key={i} className={cls}>{line}</div>;
        })}
      </pre>
      {diff.split("\n").length > 8 && (
        <button type="button" className={styles.expandBtn} onClick={() => setExpanded(!expanded)}>
          {expanded ? t("tools.renderer.showLess") : t("tools.renderer.diffMore", { count: diff.split("\n").length - 8 })}
        </button>
      )}
    </div>
  );
}

function extractExitCode(output: string): number | null {
  const match = output.match(/Exit code:\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
