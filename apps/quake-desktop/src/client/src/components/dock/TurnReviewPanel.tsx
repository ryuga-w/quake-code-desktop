import React, { useMemo, useState } from "react";
import { ChevronRight, Copy, ExternalLink } from "lucide-react";
import { localeForIntl, type Translate, useI18n } from "../../i18n";
import { useAppStore } from "../../state/app-store";
import type { TurnReviewFile, TurnReviewView } from "../../types";
import { refreshLiveSingleFileReview } from "../tools/TurnFileChangesCard";
import styles from "./TurnReviewPanel.module.css";

type ReviewLine = {
  kind: "add" | "delete" | "context" | "omitted";
  text: string;
  oldLine?: number;
  newLine?: number;
};

const MAX_RENDERED_LINES = 6_000;

function parseReviewLines(diff: string, t: Translate): { lines: ReviewLine[]; truncated: boolean } {
  const source = diff.replace(/\r\n/g, "\n").split("\n");
  const lines: ReviewLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  let sawHunk = false;
  let truncated = false;

  for (let index = 0; index < source.length; index += 1) {
    if (lines.length >= MAX_RENDERED_LINES) {
      truncated = true;
      break;
    }

    const raw = source[index];
    const hunk = raw.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunk) {
      const nextOldLine = Number(hunk[1]) || 1;
      const nextNewLine = Number(hunk[2]) || 1;
      const omitted = sawHunk
        ? Math.max(nextOldLine - oldLine, nextNewLine - newLine)
        : Math.max(nextOldLine - 1, nextNewLine - 1);
      if (omitted > 0) {
        lines.push({ kind: "omitted", text: t("runtime.review.unchangedLines", { count: omitted }) });
      }
      oldLine = nextOldLine;
      newLine = nextNewLine;
      sawHunk = true;
      continue;
    }

    if (raw.startsWith("@@")) {
      sawHunk = true;
      continue;
    }
    if (
      raw.startsWith("diff ")
      || raw.startsWith("index ")
      || raw.startsWith("---")
      || raw.startsWith("+++")
      || raw.startsWith("*** Begin Patch")
      || raw.startsWith("*** End Patch")
      || /^\*\*\*\s+(Add|Delete|Update) File:/.test(raw)
      || raw.startsWith("\\ No newline")
    ) {
      continue;
    }

    if (raw.startsWith("+")) {
      lines.push({ kind: "add", text: raw.slice(1), newLine });
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      lines.push({ kind: "delete", text: raw.slice(1), oldLine });
      oldLine += 1;
      continue;
    }

    if (!sawHunk && !raw && index === source.length - 1) continue;
    const text = raw.startsWith(" ") ? raw.slice(1) : raw;
    lines.push({ kind: "context", text, oldLine, newLine });
    oldLine += 1;
    newLine += 1;
  }

  return { lines, truncated };
}

function ReviewFileSection({
  file,
  onOpenFile,
}: {
  file: TurnReviewFile;
  onOpenFile?: (path: string) => void;
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(true);
  const parsed = useMemo(() => parseReviewLines(file.diff || "", t), [file.diff, t]);
  const added = Number(file.added) || 0;
  const removed = Number(file.removed) || 0;

  return (
    <section className={styles.fileSection} data-review-file={file.path}>
      <div className={styles.fileHeader}>
        <button
          type="button"
          className={styles.fileToggle}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight className={open ? styles.chevronOpen : styles.chevron} size={14} strokeWidth={1.9} aria-hidden="true" />
          <span className={styles.filePath} title={file.path}>{file.path}</span>
          <span className={styles.fileStats} aria-label={`+${added} -${removed}`}>
            <span className={styles.add}>+{added}</span>
            <span className={styles.remove}>-{removed}</span>
          </span>
        </button>
        {onOpenFile && (
          <button
            type="button"
            className={styles.openFile}
            onClick={() => onOpenFile(file.path)}
            title={t("runtime.review.openFile")}
            aria-label={t("runtime.review.openFileAria", { path: file.path })}
          >
            <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
      </div>

      {open && (
        <div className={styles.diffViewport} role="region" aria-label={t("runtime.review.changesAria", { path: file.path })}>
          {parsed.lines.length > 0 ? parsed.lines.map((line, index) => {
            if (line.kind === "omitted") {
              return <div className={styles.omitted} key={`omitted:${index}`}>{line.text}</div>;
            }
            return (
              <div
                className={`${styles.diffLine} ${
                  line.kind === "add" ? styles.lineAdd : line.kind === "delete" ? styles.lineDelete : styles.lineContext
                }`}
                key={`${line.kind}:${line.oldLine || 0}:${line.newLine || 0}:${index}`}
              >
                <span className={styles.oldNumber}>{line.oldLine || ""}</span>
                <span className={styles.newNumber}>{line.newLine || ""}</span>
                <span className={styles.marker}>{line.kind === "add" ? "+" : line.kind === "delete" ? "−" : ""}</span>
                <span className={styles.code}>{line.text || " "}</span>
              </div>
            );
          }) : (
            <div className={styles.emptyDiff}>{t("runtime.review.noDetailedDiff")}</div>
          )}
          {parsed.truncated && <div className={styles.truncated}>{t("runtime.review.tooLarge", { count: MAX_RENDERED_LINES.toLocaleString(localeForIntl(locale)) })}</div>}
        </div>
      )}
    </section>
  );
}

export function TurnReviewPanel({
  review,
  onOpenFile,
  onToast,
}: {
  review: TurnReviewView;
  onOpenFile?: (path: string) => void;
  onToast?: (message: string, type?: "info" | "success" | "warning" | "error") => void;
}) {
  const { t } = useI18n();
  const liveTool = useAppStore((state) => review.liveSource?.toolId ? state.tools[review.liveSource.toolId] : undefined);
  const presentedReview = useMemo(() => refreshLiveSingleFileReview(review, liveTool), [liveTool, review]);
  const live = Boolean(liveTool && ["queued", "running", "streaming"].includes(liveTool.status));
  const files = useMemo<TurnReviewFile[]>(() => {
    if (presentedReview.files?.length) return presentedReview.files;
    if (presentedReview.diff?.trim()) {
      return [{ path: t("runtime.review.combinedChange"), kind: "modify", diff: presentedReview.diff, added: presentedReview.totalAdded, removed: presentedReview.totalRemoved }];
    }
    return [];
  }, [presentedReview, t]);
  const totalAdded = Number(presentedReview.totalAdded) || files.reduce((sum, file) => sum + (Number(file.added) || 0), 0);
  const totalRemoved = Number(presentedReview.totalRemoved) || files.reduce((sum, file) => sum + (Number(file.removed) || 0), 0);

  const copyDiff = async () => {
    const text = presentedReview.diff?.trim() || files.map((file) => file.diff || "").filter(Boolean).join("\n");
    if (!text) {
      onToast?.(t("runtime.review.noCopyableDiff"), "warning");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      onToast?.(t("runtime.review.copied"), "success");
    } catch {
      onToast?.(t("runtime.review.copyFailed"), "error");
    }
  };

  return (
    <div className={styles.panel} data-turn-review-panel="true" data-live={live ? "true" : undefined}>
      <div className={styles.toolbar}>
        <div className={styles.scope}>
          <span>{presentedReview.label || (presentedReview.turnId ? t("runtime.review.turn", { id: presentedReview.turnId }) : t("runtime.review.lastTurn"))}</span>
          <ChevronRight size={12} strokeWidth={1.8} aria-hidden="true" />
        </div>
        {live && <span className={styles.liveStatus} role="status">{t("runtime.review.live")}</span>}
        <span className={styles.totalStats} aria-label={`${t("runtime.review.total")} +${totalAdded} -${totalRemoved}`}>
          <span className={styles.add}>+{totalAdded}</span>
          <span className={styles.remove}>-{totalRemoved}</span>
        </span>
        <span className={styles.fileCount}>{t("runtime.review.files", { count: files.length })}</span>
        <button type="button" className={styles.copyButton} onClick={() => void copyDiff()} title={t("runtime.review.copyDiff")} aria-label={t("runtime.review.copyDiff")}>
          <Copy size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.fileList}>
        {files.length > 0 ? files.map((file, index) => (
          <ReviewFileSection
            key={`${file.path}:${index}`}
            file={file}
            onOpenFile={file.path === t("runtime.review.combinedChange") ? undefined : onOpenFile}
          />
        )) : (
          <div className={styles.emptyPanel}>{t("runtime.review.noChanges")}</div>
        )}
      </div>
    </div>
  );
}

export default TurnReviewPanel;
