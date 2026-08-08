import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
import {
  getToolActivity,
  getToolExecutionBody,
  toolContextText,
  isReadTool,
  isCommandTool,
  isSubagentTool,
  isSearchTool,
  type ToolLineStats,
} from "../../lib/tool-activity";
import type { ToolCardState } from "../../state/app-store";
import { warmShikiHighlighter } from "../../lib/shiki-highlight";
import { ToolCodeBlock } from "../tools/ToolCodeBlock";
import { FileMutationSnippetCard, isFileMutationTool } from "../tools/FileMutationSnippetCard";
import styles from "./MarkdownMessage.module.css";
import { runOpenKey, useDetailsOpen } from "./tool-activity-open-state";
import { useI18n } from "../../i18n";

// Expanded tool previews use Shiki; warm it without blocking the first open.
if (typeof window !== "undefined") warmShikiHighlighter();

export function MutationPencilIcon({ compact = false }: { compact?: boolean } = {}) {
  return <span className={compact ? styles.compactCommandIcon : styles.toolNoticeMutationIcon} aria-hidden="true">
    <svg viewBox="0 0 16 16" fill="none">
      <path d="m3.1 10.9-.6 2.6 2.6-.6 7.5-7.5-2-2-7.5 7.5Z" />
      <path d="m9.7 4.3 2 2" />
    </svg>
  </span>;
}

function SubagentIcon() {
  return <span className={styles.toolNoticeMutationIcon} aria-hidden="true">
    <svg viewBox="0 0 16 16" fill="none">
      <rect x="3" y="4.2" width="10" height="8" rx="2" />
      <path d="M8 2.2v2M5.5 8h.01M10.5 8h.01M5.6 10.1h4.8" />
    </svg>
  </span>;
}

function MutationCreateIcon() {
  return <span className={styles.toolNoticeMutationIcon} aria-hidden="true">
    <svg viewBox="0 0 16 16" fill="none">
      <path d="M4 2.5h5.2L12 5.3V13.5H4V2.5Z" />
      <path d="M9 2.5v3h3" />
      <path d="M6.5 9h3M8 7.5v3" />
    </svg>
  </span>;
}

function MutationDeleteIcon() {
  return <span className={styles.toolNoticeMutationIcon} aria-hidden="true">
    <svg viewBox="0 0 16 16" fill="none">
      <path d="M3.5 4.5h9" />
      <path d="M6 4.5V3.2h4v1.3" />
      <path d="M5.2 4.5 5.7 13h4.6l.5-8.5" />
    </svg>
  </span>;
}

function CommandTerminalIcon() {
  return <span className={styles.compactCommandIcon} aria-hidden="true">
    <svg viewBox="0 0 16 16" fill="none">
      <rect x="1.7" y="2.2" width="12.6" height="11.6" rx="1.8" />
      <path d="m4.3 6 2 2-2 2M8.2 10.1h3.2" />
    </svg>
  </span>;
}

function ReadFileIcon() {
  return <span className={styles.compactCommandIcon} aria-hidden="true">
    <svg viewBox="0 0 16 16" fill="none">
      <path d="M4 1.8h5.1L12.5 5v9.2H4z" />
      <path d="M9.1 1.8V5h3.4M6.2 7.4h4M6.2 9.6h4M6.2 11.8h2.5" />
    </svg>
  </span>;
}

function SearchActivityIcon() {
  return <span className={styles.toolNoticeMutationIcon} aria-hidden="true"><Search size={13} strokeWidth={1.5} /></span>;
}


/** Hook to track live elapsed seconds while a tool is active. */
function useLiveToolElapsed(startedAt?: number, active?: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !startedAt) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [active, startedAt]);

  if (!active || !startedAt) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function formatLiveElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

/** Extract Quake Chrome Bridge presentation extras (site favicon + real-input
 *  flag) from a chrome_* tool result's details payload. */
function chromeRowExtras(tool: ToolCardState): { favicon?: string; site?: string; host?: string; trusted?: boolean; favicons?: Array<{ host: string; favicon: string }> } {
  if (!tool.toolName.toLowerCase().startsWith("chrome_")) return {};
  const d = tool.details;
  if (!d || typeof d !== "object") return {};
  const rec = d as Record<string, unknown>;
  const site = (rec._site && typeof rec._site === "object" ? rec._site : {}) as Record<string, unknown>;
  const favicon = typeof site.favicon === "string" && site.favicon.startsWith("http") ? site.favicon : undefined;
  // chrome_list_tabs supplies a deduped favicon strip (one per host).
  const rawList = Array.isArray(rec._favicons) ? rec._favicons : undefined;
  const favicons = rawList
    ? rawList
        .filter((f): f is { host: string; favicon: string } => !!f && typeof f === "object" && typeof (f as Record<string, unknown>).favicon === "string")
        .slice(0, 12)
    : undefined;
  return {
    favicon,
    site: typeof site.site === "string" ? site.site : undefined,
    host: typeof site.host === "string" ? site.host : undefined,
    trusted: rec.trusted === true,
    favicons,
  };
}

/** Small site-favicon badge; hides itself if the image fails to load. */
function FaviconBadge({ src, host }: { src: string; host?: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <img
      src={src}
      alt={host || "site"}
      title={host}
      width={14}
      height={14}
      loading="lazy"
      onError={() => setOk(false)}
      style={{ borderRadius: 3, flex: "0 0 auto", verticalAlign: "middle" }}
    />
  );
}

export function ToolRunDetails({
  tool,
  hideSummary = false,
  compactCommand = false,
  compactMutation = false,
  showLineStats = false,
  lineStatsOverride,
  openFileOnSubjectClick = false,
  openKeyOverride,
  actionOverride,
  subjectOverride,
  filePathOverride,
  panelSubjectOverride,
  panelTitleOverride,
  onFileChangeClick,
  fileChangeClickTitle,
}: {
  tool: ToolCardState;
  hideSummary?: boolean;
  compactCommand?: boolean;
  compactMutation?: boolean;
  /** Show +/− line stats even in compact mutation rows (tool colors). */
  showLineStats?: boolean;
  lineStatsOverride?: ToolLineStats;
  /** Makes the path independently clickable instead of toggling the card. */
  openFileOnSubjectClick?: boolean;
  openKeyOverride?: string;
  actionOverride?: string;
  subjectOverride?: string;
  filePathOverride?: string;
  panelSubjectOverride?: string;
  panelTitleOverride?: string;
  /** When supplied, filename clicks inspect this change; the external-link action still opens the file. */
  onFileChangeClick?: (path: string) => void;
  fileChangeClickTitle?: string;
}) {
  // Lightweight — no multi-line body until expanded.
  const { locale } = useI18n();
  const activity = getToolActivity(tool, locale);
  const active = activity.active;
  const action = actionOverride ?? activity.actionLabel;
  const subject = subjectOverride ?? activity.subject;
  const lineStats = lineStatsOverride ?? activity.lineStats;
  const filePath = filePathOverride ?? (activity.mutationKind || isReadTool(tool.toolName) ? activity.subject : undefined);
  // hideSummary is legacy; never default-open bodies (freeze risk).
  const [open, setOpen] = useDetailsOpen(openKeyOverride ?? runOpenKey(tool), false);

  const mutationIcon = activity.mutationKind === "modify"
    ? <MutationPencilIcon />
    : activity.mutationKind === "create"
      ? <MutationCreateIcon />
      : activity.mutationKind === "delete"
        ? <MutationDeleteIcon />
        : null;
  const semanticIcon = isSubagentTool(tool.toolName)
    ? <SubagentIcon />
    : mutationIcon || (isSearchTool(tool.toolName) ? <SearchActivityIcon /> : null);

  const openFile = (event: React.MouseEvent) => {
    if (!openFileOnSubjectClick || !filePath) return;
    event.preventDefault();
    event.stopPropagation();
    if (onFileChangeClick) onFileChangeClick(filePath);
    else window.dispatchEvent(new CustomEvent("quake:open-tool-file", { detail: { path: filePath } }));
  };

  const chromeExtras = chromeRowExtras(tool);
  const liveSeconds = useLiveToolElapsed(tool.startedAt, active);
  const isRead = isReadTool(tool.toolName);
  const compactActivity = compactCommand || isCommandTool(tool.toolName) || isRead;
  // No +/- line-stat meter for non-mutation narration tools (chrome_*, plan, ask).
  const isNarrationTool = tool.toolName.toLowerCase().startsWith("chrome_") || tool.toolName === "update_plan" || tool.toolName === "request_user_input";
  const showStats = (showLineStats || !compactActivity) && !isNarrationTool;
  const displaySubject = compactActivity ? subject : compactToolSubject(subject);
  const hideActiveCommandSubject = false;

  // Narration tools (chrome_*, update_plan, request_user_input) have no useful
  // expandable body — render a plain, non-collapsible row (no chevron/toggle).
  if (isNarrationTool) {
    return <div
      className={`${styles.toolRun} ${styles.toolRunStatic ?? ""} ${active ? styles.toolRunLive : ""}`.trim()}
      data-active={active ? "true" : "false"}
      aria-label={`${action} ${subject}`.trim()}
    >
      <span className={styles.toolRunStaticRow ?? ""} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {chromeExtras.favicon && <FaviconBadge src={chromeExtras.favicon} host={chromeExtras.host} />}
        {chromeExtras.trusted && (
          <span
            title={locale === "en" ? "Real OS-level input (trusted)" : "Gerçek OS-seviyesi giriş (trusted)"}
            style={{ display: "inline-flex", flex: "0 0 auto", verticalAlign: "middle" }}
            aria-label={locale === "en" ? "real input" : "gerçek tıklama"}
          >
            <ShieldCheck size={13} strokeWidth={2.2} style={{ color: "#188038" }} />
          </span>
        )}
        {action ? <span className={styles.toolRunAction}>{action}</span> : null}
        <span className={`${styles.toolRunSubject} ${active ? styles.textShimmer : ""}`.trim()} title={subject}>
          {displaySubject}
        </span>
        {active && (
          <span style={{ opacity: 0.75, fontSize: "11.5px", fontFamily: "var(--font-mono)", marginLeft: 2 }}>
            · {formatLiveElapsed(liveSeconds)}
          </span>
        )}
        {chromeExtras.favicons && chromeExtras.favicons.length > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 4, flexWrap: "wrap" }}>
            {chromeExtras.favicons.map((f, i) => (
              <FaviconBadge key={`${f.host}-${i}`} src={f.favicon} host={f.host} />
            ))}
          </span>
        )}
        {tool.status === "error" && (
          <span className={`${styles.fileMutationResultMark} ${styles.fileMutationResultError}`} aria-hidden="true">!</span>
        )}
      </span>
    </div>;
  }

  return <details
    className={`${styles.toolRun} ${compactActivity ? styles.compactCommandRun : ""} ${compactMutation ? styles.compactMutationRun : ""} ${active ? styles.toolRunLive : ""}`}
    open={open}
    onToggle={(event) => setOpen(event.currentTarget.open)}
    data-active={active ? "true" : "false"}
    data-command={isCommandTool(tool.toolName) ? "true" : undefined}
    data-mutation={compactMutation ? "true" : undefined}
  >
    <summary aria-label={`${action} ${subject}`}>
      {compactActivity && (compactMutation ? <MutationPencilIcon compact /> : isRead ? <ReadFileIcon /> : <CommandTerminalIcon />)}
      {!compactActivity && semanticIcon}
      {chromeExtras.favicon && <FaviconBadge src={chromeExtras.favicon} host={chromeExtras.host} />}
      {chromeExtras.trusted && (
        <span
          title={locale === "en" ? "Real OS-level input (trusted)" : "Gerçek OS-seviyesi giriş (trusted)"}
          style={{ display: "inline-flex", flex: "0 0 auto", verticalAlign: "middle" }}
          aria-label={locale === "en" ? "real input" : "gerçek tıklama"}
        >
          <ShieldCheck size={13} strokeWidth={2.2} style={{ color: "#188038" }} />
        </span>
      )}
      {!hideActiveCommandSubject && openFileOnSubjectClick && filePath ? (
        <button
          type="button"
          className={`${styles.toolRunSubject} ${styles.toolRunSubjectLink} ${active ? styles.textShimmer : ""}`.trim()}
          title={fileChangeClickTitle || `${filePath} — ${locale === "en" ? "open in file panel" : "dosya panelinde aç"}`}
          onClick={openFile}
          onMouseDown={(event) => {
            // Prevent <summary> toggle when clicking the path.
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {displaySubject}
        </button>
      ) : !hideActiveCommandSubject ? (
        <span className={`${styles.toolRunSubject} ${active && !compactActivity ? styles.textShimmer : ""}`.trim()} title={subject}>
          {displaySubject}
        </span>
      ) : null}
      {showStats && <LineStatsMeter stats={lineStats} active={active} />}
      {compactActivity && active && <span className={styles.fileMutationLiveDot} aria-hidden="true" />}
      {compactActivity && !active && tool.status === "error" && (
        <span className={`${styles.fileMutationResultMark} ${styles.fileMutationResultError}`} aria-hidden="true">!</span>
      )}
    </summary>
    {open ? (
      <ToolRunExecutionBody
        tool={tool}
        activity={activity}
        filePathOverride={filePathOverride}
        panelSubjectOverride={panelSubjectOverride}
        panelTitleOverride={panelTitleOverride}
        onFileChangeClick={onFileChangeClick}
      />
    ) : null}
  </details>;
}

const TOOL_PREVIEW_HIGHLIGHT_MAX_CHARS = 12_000;

/** Heavy body: syntax-highlighted preview only while the row is open. */
function ToolRunExecutionBody({
  tool,
  activity,
  filePathOverride,
  panelSubjectOverride,
  panelTitleOverride,
  onFileChangeClick,
}: {
  tool: ToolCardState;
  activity: ReturnType<typeof getToolActivity>;
  filePathOverride?: string;
  panelSubjectOverride?: string;
  panelTitleOverride?: string;
  onFileChangeClick?: (path: string) => void;
}) {
  // Legacy source contract: getToolExecutionBody(tool)
  const { t, locale } = useI18n();
  const body = useMemo(() => getToolExecutionBody(tool, locale), [locale, tool]);
  const preview = body.preview;
  const hasPreview = Boolean(preview.trim());
  const showLineNumbers = isReadTool(tool.toolName);
  const previewLanguage = body.language;
  const panelSubject = panelSubjectOverride ?? activity.panelSubject;
  const panelTitle = panelTitleOverride ?? activity.panelTitle;
  const subject = activity.subject;
  const toolImages = (tool as ToolCardState & { images?: Array<{ data: string; mimeType: string }> }).images;
  const filePath = filePathOverride ?? (activity.mutationKind || isReadTool(tool.toolName) ? subject : undefined);
  const mutationSnippet = isFileMutationTool(tool) || Boolean(activity.mutationKind);

  // Codex-style file card: filename +16 -0 + green code body (matches desktop screenshot).
  if (mutationSnippet) {
    return (
      <div className={styles.toolExecutionCard} data-mutation-snippet="true">
        <FileMutationSnippetCard
          tool={tool}
          pathOverride={filePath}
          onOpenFile={(path) => window.dispatchEvent(new CustomEvent("quake:open-tool-file", { detail: { path } }))}
          onInspect={onFileChangeClick}
        />
        {tool.status === "error" && (
          <div className={`${styles.toolExecutionStatus} ${styles.error}`}>{activity.resultLabel}</div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.toolExecutionCard}>
      <div className={styles.toolExecutionHeader}>
        <div className={styles.toolExecutionIdentity}>
          <span>{panelTitle}</span>
          {panelSubject && <small title={filePathOverride || subject}>{panelSubject}</small>}
        </div>
        <div className={styles.toolExecutionActions}>
          {filePath && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("quake:open-tool-file", { detail: { path: filePath } }))}>{t("tools.renderer.openFile")}</button>}
          <button
            type="button"
            onClick={() => {
              try {
                const text = toolContextText(tool) || preview;
                void navigator.clipboard?.writeText(text);
              } catch { /* ignore */ }
            }}
          >
            {t("tools.renderer.copyOutput")}
          </button>
        </div>
      </div>
      {toolImages && toolImages.length > 0 && (
        <div className={styles.toolImages}>
          {toolImages.slice(0, 4).map((img, i) => (
            <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt={t("tools.renderer.generatedImage", { count: i + 1 })} className={styles.toolGeneratedImage} />
          ))}
        </div>
      )}
      {hasPreview && (
        <div className={styles.toolPreviewDetails}>
          {/* Shiki (VS Code grammars) — no thousands of React highlight nodes */}
          <ToolCodeBlock
            code={preview}
            language={showLineNumbers ? previewLanguage : (previewLanguage || "bash")}
            maxChars={TOOL_PREVIEW_HIGHLIGHT_MAX_CHARS}
          />
        </div>
      )}
      {tool.status === "error" && <div className={`${styles.toolExecutionStatus} ${activity.resultLabel === "Sonuç bulunamadı" || activity.resultLabel === "No results" ? styles.notice : styles.error}`}>{activity.resultLabel}</div>}
    </div>
  );
}

function compactToolSubject(subject: string): string {
  const normalized = subject.replace(/\\/g, "/");
  if (!normalized.includes("/")) return subject;
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

function LineStatsMeter({ stats, active }: { stats: ToolLineStats; active: boolean }) {
  const { t } = useI18n();
  const showFiles = stats.filesCreated > 0 || stats.filesDeleted > 0;
  // While live with unknown counts yet, still reserve the meter shell so layout does not jump.
  if (!stats.added && !stats.removed && !showFiles) {
    if (!active) return null;
    return (
      <span className={`${styles.lineStats} ${styles.lineStatsLive} ${styles.lineStatsPending}`} aria-label={t("tools.renderer.lineChangesPending")}>
        <span className={`${styles.lineStatPill} ${styles.added}`} title={t("tools.renderer.addingLine")}><b>+</b></span>
        <span className={`${styles.lineStatPill} ${styles.removed}`} title={t("tools.renderer.removingLine")}><b>−</b></span>
      </span>
    );
  }
  const netValue = stats.added - stats.removed;
  return <span className={`${styles.lineStats} ${active ? styles.lineStatsLive : ""}`} aria-label={t("tools.renderer.netLines")}>
    {stats.added > 0 && <span className={`${styles.lineStatPill} ${styles.added}`} title={active ? t("tools.renderer.addingLine") : t("tools.renderer.addedLine")}><b>+{stats.added}</b></span>}
    {stats.removed > 0 && <span className={`${styles.lineStatPill} ${styles.removed}`} title={active ? t("tools.renderer.removingLine") : t("tools.renderer.removedLine")}><b>−{stats.removed}</b></span>}
    {netValue !== 0 && stats.added > 0 && stats.removed > 0 && <span className={`${styles.lineStatPill} ${styles.neutral}`} title={t("tools.renderer.netLines")}><b>{netValue > 0 ? `+${netValue}` : netValue}</b><small>net</small></span>}
    {showFiles && <span className={`${styles.lineStatPill} ${styles.neutral}`}><b>{stats.filesCreated ? `+${stats.filesCreated}` : `−${stats.filesDeleted}`}</b><small>{t("tools.renderer.files")}</small></span>}
  </span>;
}
