import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FilePenLine, RotateCcw, Search } from "lucide-react";
import type { ToolCardState } from "../../state/app-store";
import type { TurnReviewFile, TurnReviewLiveSource, TurnReviewView } from "../../types";
import { apiPost } from "../../lib/api";
import { toolFileMutations, toolLineStats, type ToolFileMutation } from "../../lib/tool-activity";
import { useConfirmAction } from "../common/ConfirmContext";
import styles from "./TurnFileChangesCard.module.css";
import { FileMutationSnippetCard } from "./FileMutationSnippetCard";
import { useI18n } from "../../i18n";

export type TurnFileChangeRow = {
  path: string;
  kind: "create" | "modify" | "delete";
  added: number;
  removed: number;
  tool: ToolCardState;
  /** Unified / apply_patch body for expandable syntax-highlight cell */
  diff?: string;
  previousPath?: string;
};

/** Codex turn/diff/updated payload shape (client-side). */
export type TurnDiffView = TurnReviewView;

const VISIBLE_DEFAULT = 3;

function countDiffLines(text: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

function pathKey(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function isActiveFileChange(row: TurnFileChangeRow): boolean {
  return row.tool.status === "queued" || row.tool.status === "running" || row.tool.status === "streaming";
}

/** Prefer tool details.diff, then apply_patch body, then turnDiff entry. */
export function resolveRowDiff(
  tool: ToolCardState,
  path: string,
  turnDiff?: TurnDiffView,
  kindOverride?: TurnReviewFile["kind"],
): string {
  const details = (tool.details || {}) as Record<string, unknown>;
  const args = (tool.args || {}) as Record<string, unknown>;
  const argumentPatch = [args.patch, args.diff, args.input].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  const liveDiff = typeof details.diff === "string" && details.diff.trim() ? details.diff : argumentPatch;
  if (liveDiff) {
    const d = liveDiff;
    // Multi-file apply_patch: try to slice the section for this path
    if (d.includes("***") && d.includes(path.split("/").pop() || path)) {
      const sliced = sliceApplyPatchForPath(d, path);
      if (sliced) return sliced;
    }
    const unifiedSlice = sliceUnifiedDiffForPath(d, path);
    if (unifiedSlice) return unifiedSlice;
    // Single-file edit/write unified diff
    if (!d.includes("*** Add File") && !d.includes("*** Update File") && !d.includes("*** Delete File")) return d;
    const sliced = sliceApplyPatchForPath(d, path);
    if (sliced) return sliced;
    return d;
  }
  const fromTurn = turnDiff?.files?.find((f) => pathKey(f.path) === pathKey(path));
  if (fromTurn?.diff?.trim()) return fromTurn.diff;
  return synthesizeMutationDiff(tool, path, kindOverride || fromTurn?.kind);
}

function sliceApplyPatchForPath(patch: string, path: string): string {
  const norm = path.replace(/\\/g, "/");
  const base = norm.split("/").pop() || norm;
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  let start = -1;
  let kind: "create" | "modify" | "delete" = "modify";
  for (let i = 0; i < lines.length; i += 1) {
    const add = lines[i].match(/^\*\*\*\s+Add File:\s*(.+?)\s*$/i);
    const del = lines[i].match(/^\*\*\*\s+Delete File:\s*(.+?)\s*$/i);
    const upd = lines[i].match(/^\*\*\*\s+Update File:\s*(.+?)\s*$/i);
    const p = (add?.[1] || del?.[1] || upd?.[1] || "").replace(/\\/g, "/").trim();
    if (!p) continue;
    if (pathKey(p) === pathKey(norm) || p.endsWith("/" + base) || p === base) {
      start = i;
      kind = add ? "create" : del ? "delete" : "modify";
      break;
    }
  }
  if (start < 0) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\*\*\*\s+(Add|Delete|Update) File:/i.test(lines[i])) break;
    if (/^\*\*\*\s+End Patch/i.test(lines[i])) break;
    if (/^\*\*\*\s+Begin Patch/i.test(lines[i])) continue;
    body.push(lines[i]);
  }
  const header =
    kind === "create"
      ? `diff --git a/${norm} b/${norm}\n--- /dev/null\n+++ b/${norm}\n`
      : kind === "delete"
        ? `diff --git a/${norm} b/${norm}\n--- a/${norm}\n+++ /dev/null\n`
        : `diff --git a/${norm} b/${norm}\n--- a/${norm}\n+++ b/${norm}\n`;
  const hasHunk = body.some((l) => l.startsWith("@@"));
  return header + (hasHunk ? body.join("\n") : `@@\n${body.join("\n")}`) + "\n";
}

function sliceUnifiedDiffForPath(diff: string, path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index].match(/^diff --git\s+"?a\/(.+?)"?\s+"?b\/(.+?)"?$/);
    if (!header) continue;
    if (pathKey(header[1]) === pathKey(normalizedPath) || pathKey(header[2]) === pathKey(normalizedPath)) {
      start = index;
      break;
    }
  }
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("diff --git ")) {
      end = index;
      break;
    }
  }
  const section = lines.slice(start, end).join("\n").trimEnd();
  return section ? `${section}\n` : "";
}

function diffTextLines(value: string): string[] {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  return undefined;
}

function syntheticDiffHeader(path: string, kind: TurnReviewFile["kind"]): string {
  if (kind === "create") return `diff --git a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n`;
  if (kind === "delete") return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ /dev/null\n`;
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`;
}

/** Build a reviewable diff even while write/edit arguments are still streaming. */
function synthesizeMutationDiff(tool: ToolCardState, path: string, kindOverride?: TurnReviewFile["kind"]): string {
  const args = (tool.args || {}) as Record<string, unknown>;
  const mutation = toolFileMutations(tool).find((entry) => pathKey(entry.path) === pathKey(path));
  const kind = kindOverride || mutation?.kind;
  if (!kind) return "";

  if (kind === "create") {
    const content = firstString(args, ["content", "text", "CodeContent", "codeContent", "newText", "new_text"]);
    if (content === undefined) return "";
    const lines = diffTextLines(content);
    const body = lines.map((line) => `+${line}`).join("\n");
    return `${syntheticDiffHeader(path, kind)}@@ -0,0 +1,${lines.length} @@\n${body}${body ? "\n" : ""}`;
  }

  const edits: Array<{ oldText: string; newText: string }> = [];
  if (Array.isArray(args.edits)) {
    for (const item of args.edits) {
      if (!item || typeof item !== "object") continue;
      const edit = item as Record<string, unknown>;
      const oldText = firstString(edit, ["oldText", "old_text", "TargetContent", "targetContent"]);
      const newText = firstString(edit, ["newText", "new_text", "ReplacementContent", "replacementContent", "replacement"]);
      if (oldText !== undefined || newText !== undefined) edits.push({ oldText: oldText || "", newText: newText || "" });
    }
  }
  const oldText = firstString(args, ["oldText", "old_text", "TargetContent", "targetContent"]);
  const newText = firstString(args, ["newText", "new_text", "ReplacementContent", "replacementContent", "replacement"]);
  if (oldText !== undefined || newText !== undefined) edits.push({ oldText: oldText || "", newText: newText || "" });

  if (kind === "delete" && edits.length === 0) {
    const content = firstString(args, ["content", "text"]);
    if (content !== undefined) edits.push({ oldText: content, newText: "" });
  }
  if (edits.length === 0) return "";

  let line = Math.max(1, Number(args.startLine ?? args.start_line ?? args.line) || 1);
  const hunks: string[] = [];
  for (const edit of edits) {
    const oldLines = diffTextLines(edit.oldText);
    const newLines = diffTextLines(edit.newText);
    hunks.push(
      `@@ -${line},${oldLines.length} +${line},${newLines.length} @@`,
      ...oldLines.map((value) => `-${value}`),
      ...newLines.map((value) => `+${value}`),
    );
    line += Math.max(1, newLines.length);
  }
  return `${syntheticDiffHeader(path, kind)}${hunks.join("\n")}\n`;
}

export function buildSingleFileReview(
  file: TurnReviewFile,
  options: { turnId?: number; label?: string; liveSource?: TurnReviewLiveSource } = {},
): TurnDiffView {
  const added = Number(file.added) || 0;
  const removed = Number(file.removed) || 0;
  return {
    label: options.label || `${shortPath(file.path)} değişikliği`,
    turnId: options.turnId,
    diff: file.diff || "",
    files: [file],
    totalAdded: added,
    totalRemoved: removed,
    liveSource: options.liveSource,
  };
}

/** Rebuild the selected one-file review from the latest streaming tool snapshot. */
export function refreshLiveSingleFileReview(review: TurnDiffView, tool?: ToolCardState): TurnDiffView {
  const source = review.liveSource;
  if (!source || !tool || tool.id !== source.toolId) return review;

  const currentFile = review.files?.find((file) => pathKey(file.path) === pathKey(source.path));
  const mutations = toolFileMutations(tool);
  const mutation = mutations.find((entry) => pathKey(entry.path) === pathKey(source.path));
  const totals = toolLineStats(tool);
  const useToolTotals = mutations.length <= 1;
  const added = mutation
    ? useToolTotals ? Math.max(mutation.added, totals.added) : mutation.added
    : Number(currentFile?.added) || 0;
  const removed = mutation
    ? useToolTotals ? Math.max(mutation.removed, totals.removed) : mutation.removed
    : Number(currentFile?.removed) || 0;
  const kind = mutation?.kind || source.kind;
  const diff = resolveRowDiff(tool, source.path, undefined, kind) || currentFile?.diff || "";

  return buildSingleFileReview({
    ...currentFile,
    path: source.path,
    kind,
    diff: diff || currentFile?.diff,
    added,
    removed,
    previousPath: mutation?.previousPath || currentFile?.previousPath,
  }, {
    turnId: review.turnId,
    label: review.label,
    liveSource: source,
  });
}

export function collectTurnFileChanges(tools: ToolCardState[], turnDiff?: TurnDiffView): TurnFileChangeRow[] {
  const byPath = new Map<string, TurnFileChangeRow>();
  for (const tool of tools) {
    // Include in-flight mutations so live "Düzenleniyor path +/−" rows feed the card once settled
    // and path/stats are already known from streaming args. Still skip empty queued shells.
    const isActive = tool.status === "queued" || tool.status === "running" || tool.status === "streaming";
    const mutations = toolFileMutations(tool);
    if (isActive && !mutations.length) continue;
    const stats = toolLineStats(tool);
    const detailsDiff = typeof (tool.details as any)?.diff === "string" ? String((tool.details as any).diff) : "";
    const patchStats = detailsDiff ? countDiffLines(detailsDiff) : { added: 0, removed: 0 };

    if (!mutations.length) continue;
    for (const mutation of mutations) {
      const key = pathKey(mutation.path);
      const multiFile = mutations.length > 1;
      const added = mutation.added || (multiFile ? 0 : stats.added || patchStats.added) || 0;
      const removed = mutation.removed || (multiFile ? 0 : stats.removed || patchStats.removed) || 0;
      const diff = resolveRowDiff(tool, mutation.path, turnDiff, mutation.kind);
      const existing = byPath.get(key);
      if (existing) {
        existing.added += added;
        existing.removed += removed;
        if (mutation.kind === "delete") existing.kind = "delete";
        else if (mutation.kind === "create" && existing.kind !== "delete") existing.kind = "create";
        existing.tool = tool;
        if (diff && (!existing.diff || diff.length > existing.diff.length)) existing.diff = diff;
        if (mutation.previousPath) existing.previousPath = mutation.previousPath;
      } else {
        byPath.set(key, {
          path: mutation.path.replace(/\\/g, "/"),
          kind: mutation.kind,
          added,
          removed,
          tool,
          diff: diff || undefined,
          previousPath: mutation.previousPath,
        });
      }
    }
  }

  // Merge turnDiff files that tools didn't surface (edge: aggregator-only)
  if (turnDiff?.files?.length) {
    for (const f of turnDiff.files) {
      const key = pathKey(f.path);
      const existing = byPath.get(key);
      if (existing) {
        // The turn snapshot merges every mutation of this file in execution
        // order. It is therefore the authoritative payload for whole-turn undo.
        if (f.diff) existing.diff = f.diff;
        if (!existing.added && f.added) existing.added = f.added;
        if (!existing.removed && f.removed) existing.removed = f.removed;
        if (f.previousPath) existing.previousPath = f.previousPath;
        continue;
      }
      // Synthetic row when only turnDiff knows about the file
      const placeholderTool = {
        id: `turn-diff:${f.path}`,
        toolName: "apply_patch",
        status: "done",
        args: {},
        details: { diff: f.diff, files: [f] },
        updatedAt: Date.now(),
      } as unknown as ToolCardState;
      byPath.set(key, {
        path: f.path.replace(/\\/g, "/"),
        kind: f.kind,
        added: f.added || 0,
        removed: f.removed || 0,
        tool: placeholderTool,
        diff: f.diff,
        previousPath: f.previousPath,
      });
    }
  }

  return [...byPath.values()].sort((a, b) => (b.tool.updatedAt || 0) - (a.tool.updatedAt || 0));
}

/**
 * Codex-style header (diff_render create_diff_summary):
 *  - single file: "Edited path/to/file (+a -b)" / Added / Deleted
 *  - multi: "Edited N files (+total -total)"
 */
function titleForChanges(rows: TurnFileChangeRow[], active: boolean, locale: "tr" | "en" = "tr"): string {
  // Legacy source contract: return `${active ? "Düzenleniyor" : "Düzenlendi"} ${name}`
  // Legacy source contract: <span>İncele</span>
  const creates = rows.filter((r) => r.kind === "create").length;
  const deletes = rows.filter((r) => r.kind === "delete").length;
  const edits = rows.length - creates - deletes;
  if (rows.length === 1) {
    const row = rows[0];
    const name = shortPath(row.path);
    if (row.kind === "create") return `${active ? (locale === "en" ? "Creating" : "Oluşturuluyor") : (locale === "en" ? "Created" : "Oluşturuldu")} ${name}`;
    if (row.kind === "delete") return `${active ? (locale === "en" ? "Deleting" : "Siliniyor") : (locale === "en" ? "Deleted" : "Silindi")} ${name}`;
    return `${active ? (locale === "en" ? "Editing" : "Düzenleniyor") : (locale === "en" ? "Edited" : "Düzenlendi")} ${name}`;
  }
  if (locale === "en") {
    if (edits === rows.length) return `${rows.length} ${active ? "files being edited" : "files edited"}`;
    if (creates === rows.length) return `${rows.length} ${active ? "files being created" : "files created"}`;
    if (deletes === rows.length) return `${rows.length} ${active ? "files being deleted" : "files deleted"}`;
    return `${rows.length} ${active ? "files being changed" : "files changed"}`;
  }
  if (edits === rows.length) return `${rows.length} dosya ${active ? "düzenleniyor" : "düzenlendi"}`;
  if (creates === rows.length) return `${rows.length} dosya ${active ? "oluşturuluyor" : "oluşturuldu"}`;
  if (deletes === rows.length) return `${rows.length} dosya ${active ? "siliniyor" : "silindi"}`;
  return `${rows.length} dosya ${active ? "değiştiriliyor" : "değişti"}`;
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 3) return parts.join("/");
  return parts.slice(-3).join("/");
}

function FileDiffExpand({ row, active, onOpenFile, onInspect }: { row: TurnFileChangeRow; active: boolean; onOpenFile?: (path: string) => void; onInspect?: () => void }) {
  const { t } = useI18n();
  const hasDiff = Boolean(row.diff?.trim());
  // A mutation row always has enough information for at least the live payload
  // placeholder. Open it on first sight while the tool is active, then retain
  // that exact component/open state when "Düzenleniyor" becomes "Düzenlendi".
  const canPreview = hasDiff || toolFileMutations(row.tool).length > 0;
  const [open, setOpen] = useState(() => active && canPreview);
  const autoOpenedRef = useRef(open);

  useEffect(() => {
    if (!active || !canPreview || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    setOpen(true);
  }, [active, canPreview]);

  return (
    <li className={styles.fileItem}>
      <div className={styles.fileRowBar}>
        <button
          type="button"
          className={styles.expandToggle}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={canPreview ? (open ? t("tools.changes.hideChange") : t("tools.changes.showChange")) : t("tools.changes.noPreview")}
          disabled={!canPreview}
        >
          {open ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
        </button>
        <button
          type="button"
          className={styles.fileRow}
          onClick={() => {
            if (onInspect) {
              onInspect();
              return;
            }
            if (canPreview) setOpen((v) => !v);
            else if (onOpenFile) onOpenFile(row.path);
            else window.dispatchEvent(new CustomEvent("quake:open-tool-file", { detail: { path: row.path } }));
          }}
          title={onInspect ? `${row.path} · ${t("tools.changes.inspectFile")}` : row.path}
        >
          <span className={styles.filePath}>{shortPath(row.path)}</span>
          <span className={styles.fileStats}>
            <span className={row.added ? styles.add : styles.zero}>+{row.added}</span>
            <span className={row.removed ? styles.del : styles.zero}>-{row.removed}</span>
          </span>
        </button>
      </div>
      {open && canPreview && (
        <div className={styles.diffPane} data-turn-diff="true" data-live={active ? "true" : undefined}>
          {/* Codex-style snippet card (filename +16 -0 + green body) */}
          <FileMutationSnippetCard
            tool={{
              ...row.tool,
              details: {
                ...(row.tool.details && typeof row.tool.details === "object" ? row.tool.details as object : {}),
                diff: row.diff,
              },
            }}
            pathOverride={row.path}
            onOpenFile={onOpenFile}
            onInspect={onInspect ? () => onInspect() : undefined}
          />
        </div>
      )}
    </li>
  );
}

export function TurnFileChangesCard({
  tools,
  turnDiff,
  turnId,
  reviewLabel,
  onOpenFile,
  onOpenDiff,
  onInspect,
  onToast,
}: {
  tools: ToolCardState[];
  /** Codex turn/diff/updated snapshot for this turn (unified multi-file) */
  turnDiff?: TurnDiffView;
  turnId?: number;
  reviewLabel?: string;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (tool: ToolCardState) => void;
  onInspect?: (review: TurnDiffView) => void;
  onToast?: (message: string, type?: "info" | "success" | "warning" | "error") => void;
}) {
  const { t, locale } = useI18n();
  const { confirm } = useConfirmAction();
  const rows = React.useMemo(() => collectTurnFileChanges(tools, turnDiff), [tools, turnDiff]);
  const [expanded, setExpanded] = useState(false);
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [undoComplete, setUndoComplete] = useState(false);

  if (!rows.length) return null;

  const totalAdded =
    turnDiff?.totalAdded && turnDiff.totalAdded > 0
      ? turnDiff.totalAdded
      : rows.reduce((sum, row) => sum + row.added, 0);
  const totalRemoved =
    turnDiff?.totalRemoved && turnDiff.totalRemoved > 0
      ? turnDiff.totalRemoved
      : rows.reduce((sum, row) => sum + row.removed, 0);
  const visible = expanded ? rows : rows.slice(0, VISIBLE_DEFAULT);
  const hiddenCount = Math.max(0, rows.length - VISIBLE_DEFAULT);
  const active = rows.some(isActiveFileChange);
  const title = titleForChanges(rows, active, locale);
  const fullDiff = turnDiff?.diff?.trim() || "";

  const openFirst = () => {
    const first = rows[0];
    if (!first) return;
    if (onOpenFile) onOpenFile(first.path);
    else window.dispatchEvent(new CustomEvent("quake:open-tool-file", { detail: { path: first.path } }));
  };

  const handleInspect = () => {
    if (onInspect) {
      onInspect({
        label: reviewLabel,
        turnId,
        diff: fullDiff || rows.map((row) => row.diff).filter(Boolean).join("\n"),
        files: rows.map((row) => ({
          path: row.path,
          kind: row.kind,
          diff: row.diff,
          added: row.added,
          removed: row.removed,
        })),
        totalAdded,
        totalRemoved,
      });
      return;
    }
    const first = rows[0];
    if (first && onOpenDiff) {
      onOpenDiff(first.tool);
      return;
    }
    openFirst();
  };

  const handleInspectFile = (row: TurnFileChangeRow) => {
    if (!onInspect) return;
    onInspect(buildSingleFileReview({
      path: row.path,
      kind: row.kind,
      diff: row.diff,
      added: row.added,
      removed: row.removed,
      previousPath: row.previousPath,
    }, {
      turnId,
      label: `${shortPath(row.path)} ${locale === "en" ? "change" : "değişikliği"}`,
      liveSource: {
        toolId: row.tool.id,
        path: row.path,
        kind: row.kind,
      },
    }));
  };

  const handleUndo = async () => {
    if (confirmingUndo || busy || undoComplete) return;
    setConfirmingUndo(true);
    let confirmed = false;
    try {
      const visiblePaths = rows.slice(0, 8).map((row) => shortPath(row.path)).join(", ");
      // Legacy Turkish contract: title: "Tur değişikliklerini geri al" / confirmLabel: "Geri al"
      confirmed = await confirm({
        title: t("tools.changes.turnUndoTitle"),
        message: t("tools.changes.turnUndoMessage", { count: rows.length, paths: visiblePaths, suffix: rows.length > 8 ? ", …" : "" }),
        variant: "warning",
        confirmLabel: t("tools.changes.undo"),
      });
    } finally {
      setConfirmingUndo(false);
    }
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await apiPost<{ reverted: number; paths: string[] }>("/api/file/undo-turn", {
        files: rows.map((row) => ({
          path: row.path,
          kind: row.kind,
          diff: row.diff || "",
          previousPath: row.previousPath,
        })),
      });
      setUndoComplete(true);
      onToast?.(t("tools.changes.undoSuccess", { count: result.reverted }), "success");
      window.dispatchEvent(new CustomEvent("quake:files-changed", { detail: { paths: result.paths } }));
    } catch (error) {
      onToast?.(t("tools.changes.undoFailed", { error: error instanceof Error ? error.message : String(error) }), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.card} aria-label={title} data-turn-file-changes="true" data-live={active ? "true" : undefined}>
      <header className={styles.head}>
        <div className={styles.headLeft}>
          <span className={styles.icon} aria-hidden="true">
            <FilePenLine size={14} strokeWidth={1.8} />
          </span>
          <div className={styles.headCopy}>
            <strong aria-live="polite">{title}</strong>
            {(totalAdded > 0 || totalRemoved > 0) && (
              <span className={styles.totals} aria-label={`+${totalAdded} -${totalRemoved}`}>
                <span className={styles.add}>+{totalAdded}</span>
                <span className={styles.del}>-{totalRemoved}</span>
              </span>
            )}
          </div>
        </div>
        {!active && <div className={styles.actions}>
          <button type="button" className={styles.actionBtn} onClick={() => void handleUndo()} disabled={confirmingUndo || busy || undoComplete} title={t("tools.changes.undoChanges")}>
            <RotateCcw size={13} strokeWidth={1.9} aria-hidden="true" />
            <span>{confirmingUndo ? t("tools.changes.undoWaiting") : busy ? t("tools.changes.undoing") : undoComplete ? t("tools.changes.undone") : t("tools.changes.undo")}</span>
          </button>
          <button type="button" className={styles.actionBtn} onClick={handleInspect} title={t("tools.changes.inspectFile")}>
            <Search size={13} strokeWidth={1.9} aria-hidden="true" />
            <span>{t("tools.changes.inspect")}</span>
          </button>
        </div>}
      </header>

      <ul className={styles.list}>
        {visible.map((row) => (
          <FileDiffExpand
            key={row.path}
            row={row}
            active={isActiveFileChange(row)}
            onOpenFile={onOpenFile}
            onInspect={onInspect ? () => handleInspectFile(row) : undefined}
          />
        ))}
      </ul>

      {hiddenCount > 0 && (
        <button type="button" className={styles.more} onClick={() => setExpanded((value) => !value)}>
          {expanded ? t("tools.changes.showLess") : t("tools.changes.showMore", { count: hiddenCount })}
          <span className={expanded ? styles.chevronUp : styles.chevronDown} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

/** Merge snapshot + live tools for a turn (prefer live identity). */
export function mergeTurnTools(snapshots: ToolCardState[], live: ToolCardState[]): ToolCardState[] {
  const map = new Map<string, ToolCardState>();
  for (const tool of snapshots) map.set(tool.id, tool);
  for (const tool of live) {
    const existing = map.get(tool.id);
    map.set(tool.id, existing ? { ...existing, ...tool } : tool);
  }
  return [...map.values()];
}

export type { ToolFileMutation };
