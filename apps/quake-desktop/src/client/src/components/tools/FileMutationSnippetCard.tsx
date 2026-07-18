import React, { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import type { ToolCardState } from "../../state/app-store";
import {
  toolFileMutations,
  toolLineStats,
  toolArgPath,
  isWriteTool,
  isEditTool,
} from "../../lib/tool-activity";
import styles from "./FileMutationSnippetCard.module.css";

type SnippetLine = {
  kind: "add" | "del" | "ctx";
  text: string;
  /** Always set for code rows — real file line when known, else sequential. */
  lineNo: number;
};

/** Soft safety caps only — user should see the full edit, not a 7-line teaser. */
const MAX_CHARS = 400_000;
const MAX_FULL_FILE_LINES = 4_000;

function shortName(path: string): string {
  const n = path.replace(/\\/g, "/");
  const parts = n.split("/").filter(Boolean);
  return parts.at(-1) || path;
}

function resolveStartLine(args: Record<string, any>, details: Record<string, unknown> | null): number {
  const candidates = [
    args.startLine,
    args.start_line,
    args.line,
    args.lineNumber,
    args.line_number,
    details?.startLine,
    details?.start_line,
    details?.firstChangedLine,
    details?.line,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  const d = typeof details?.diff === "string" ? details.diff : "";
  const m = d.match(/@@\s+-\d+(?:,\d+)?\s+\+(\d+)/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

function splitLines(text: string): string[] {
  const all = text.replace(/\r\n/g, "\n").split("\n");
  if (all.length > 1 && all[all.length - 1] === "") all.pop();
  return all;
}

/** Prefer unified/apply_patch body; else raw written content as pure adds. */
function buildSnippetLines(tool: ToolCardState, pathHint?: string): {
  lines: SnippetLine[];
  added: number;
  removed: number;
  path: string;
  truncated: boolean;
} {
  const args = (tool.args || {}) as Record<string, any>;
  const details =
    tool.details && typeof tool.details === "object" ? (tool.details as Record<string, unknown>) : null;
  const mutations = toolFileMutations(tool);
  const stats = toolLineStats(tool);
  const path =
    pathHint ||
    mutations[0]?.path ||
    toolArgPath(args) ||
    String(args.path || args.filePath || args.targetFile || "") ||
    "dosya";

  const detailsDiff = typeof details?.diff === "string" ? details.diff : "";
  const patch =
    detailsDiff ||
    (typeof args.patch === "string" ? args.patch : "") ||
    (typeof args.diff === "string" ? args.diff : "");

  if (patch.trim() && (patch.includes("@@") || patch.includes("*** ") || /^[+-]/m.test(patch) || patch.includes("diff --git"))) {
    const parsed = parseDiffSnippet(patch);
    return {
      path,
      lines: parsed.lines,
      added: Math.max(stats.added || 0, mutations[0]?.added || 0, parsed.added),
      removed: Math.max(stats.removed || 0, mutations[0]?.removed || 0, parsed.removed),
      truncated: parsed.truncated,
    };
  }

  const startLine = resolveStartLine(args, details) || 1;

  const content =
    (typeof args.content === "string" && args.content) ||
    (typeof args.text === "string" && args.text) ||
    (typeof args.newText === "string" && args.newText) ||
    (typeof args.new_text === "string" && args.new_text) ||
    (typeof args.ReplacementContent === "string" && args.ReplacementContent) ||
    (typeof args.replacementContent === "string" && args.replacementContent) ||
    "";

  if (content) {
    let truncated = false;
    let raw = content;
    if (raw.length > MAX_CHARS) {
      raw = raw.slice(0, MAX_CHARS);
      truncated = true;
    }
    const all = splitLines(raw);
    let slice = all;
    if (all.length > MAX_FULL_FILE_LINES) {
      slice = all.slice(0, MAX_FULL_FILE_LINES);
      truncated = true;
    }
    const lines: SnippetLine[] = slice.map((text, i) => ({
      kind: "add" as const,
      text,
      lineNo: startLine + i,
    }));
    return {
      path,
      lines,
      added: Math.max(stats.added || 0, all.length),
      removed: stats.removed || 0,
      truncated,
    };
  }

  // edit old/new — show the FULL old/new text (this is the actual edit payload)
  const oldText = String(args.oldText || args.old_text || args.TargetContent || "");
  const newText = String(args.newText || args.new_text || args.ReplacementContent || "");
  if (oldText || newText) {
    const lines: SnippetLine[] = [];
    let n = startLine;
    for (const t of splitLines(oldText)) {
      lines.push({ kind: "del", text: t, lineNo: n++ });
    }
    n = startLine;
    for (const t of splitLines(newText)) {
      lines.push({ kind: "add", text: t, lineNo: n++ });
    }
    let truncated = false;
    let out = lines;
    if (out.length > MAX_FULL_FILE_LINES) {
      out = out.slice(0, MAX_FULL_FILE_LINES);
      truncated = true;
    }
    return {
      path,
      lines: out,
      added: Math.max(stats.added || 0, newText ? splitLines(newText).length : 0),
      removed: Math.max(stats.removed || 0, oldText ? splitLines(oldText).length : 0),
      truncated,
    };
  }

  if (isWriteTool(tool.toolName) || isEditTool(tool.toolName) || tool.toolName === "apply_patch") {
    return {
      path,
      lines: [{ kind: "add", text: "…", lineNo: startLine || 1 }],
      added: stats.added || mutations[0]?.added || 0,
      removed: stats.removed || mutations[0]?.removed || 0,
      truncated: false,
    };
  }

  return {
    path,
    lines: [{ kind: "ctx", text: "Önizleme yok", lineNo: 1 }],
    added: stats.added || 0,
    removed: stats.removed || 0,
    truncated: false,
  };
}

/**
 * Parse unified / apply-ish diff into code rows with real file line numbers.
 * Shows the FULL diff (all edited lines), not a short teaser.
 */
function parseDiffSnippet(diff: string): { lines: SnippetLine[]; added: number; removed: number; truncated: boolean } {
  let truncated = false;
  let raw = diff;
  if (raw.length > MAX_CHARS) {
    raw = raw.slice(0, MAX_CHARS);
    truncated = true;
  }
  const src = raw.replace(/\r\n/g, "\n").split("\n");
  const lines: SnippetLine[] = [];
  let added = 0;
  let removed = 0;
  let newLine = 0;
  let oldLine = 0;
  let sawHunk = false;

  for (const line of src) {
    if (lines.length >= MAX_FULL_FILE_LINES) {
      truncated = true;
      break;
    }

    if (line.startsWith("@@")) {
      const m = line.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
      if (m) {
        oldLine = Number(m[1]) || 0;
        newLine = Number(m[2]) || 0;
        sawHunk = true;
      }
      continue;
    }

    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("*** ") ||
      line.startsWith("Binary ")
    ) {
      continue;
    }

    if (line.startsWith("+")) {
      if (!sawHunk && newLine <= 0) {
        newLine = 1;
        sawHunk = true;
      }
      added += 1;
      const lineNo = newLine > 0 ? newLine : added;
      lines.push({ kind: "add", text: line.slice(1), lineNo });
      if (newLine > 0) newLine += 1;
      continue;
    }

    if (line.startsWith("-")) {
      if (!sawHunk && oldLine <= 0) {
        oldLine = 1;
        sawHunk = true;
      }
      removed += 1;
      const lineNo = oldLine > 0 ? oldLine : removed;
      lines.push({ kind: "del", text: line.slice(1), lineNo });
      if (oldLine > 0) oldLine += 1;
      continue;
    }

    if (line.startsWith("\\")) continue;

    if (!sawHunk && newLine <= 0) {
      newLine = 1;
      sawHunk = true;
    }
    const text = line.startsWith(" ") ? line.slice(1) : line;
    const lineNo = newLine > 0 ? newLine : lines.length + 1;
    lines.push({ kind: "ctx", text, lineNo });
    if (newLine > 0) newLine += 1;
    if (oldLine > 0) oldLine += 1;
  }

  if (!lines.length && src.length) {
    let n = 1;
    for (const line of src) {
      if (!line.trim()) continue;
      if (lines.length >= MAX_FULL_FILE_LINES) {
        truncated = true;
        break;
      }
      lines.push({ kind: "ctx", text: line, lineNo: n++ });
    }
  }

  return { lines, added, removed, truncated };
}

export function isFileMutationTool(tool: ToolCardState): boolean {
  const n = tool.toolName.toLowerCase();
  return isWriteTool(n) || isEditTool(n) || n === "apply_patch";
}

/**
 * Codex-style file mutation snippet card:
 * filename +16 -0 | link · full edit body with line numbers
 */
export function FileMutationSnippetCard({
  tool,
  pathOverride,
  onOpenFile,
  onInspect,
}: {
  tool: ToolCardState;
  pathOverride?: string;
  onOpenFile?: (path: string) => void;
  /** Filename click opens this exact change in the review panel. */
  onInspect?: (path: string) => void;
}) {
  const snippet = useMemo(() => buildSnippetLines(tool, pathOverride), [tool, pathOverride]);
  const name = shortName(snippet.path);
  const open = () => {
    if (onOpenFile) onOpenFile(snippet.path);
    else window.dispatchEvent(new CustomEvent("quake:open-tool-file", { detail: { path: snippet.path } }));
  };
  const inspect = () => {
    if (onInspect) onInspect(snippet.path);
    else open();
  };

  const gutterDigits = useMemo(() => {
    let max = 1;
    for (const line of snippet.lines) {
      if (line.lineNo > max) max = line.lineNo;
    }
    return Math.max(2, String(max).length);
  }, [snippet.lines]);

  const shown = snippet.lines.length;
  const claimed = snippet.added + snippet.removed;
  // If header says +16 but we only rendered fewer add rows, surface that clearly
  const incomplete =
    snippet.truncated ||
    (snippet.added > 0 && snippet.lines.filter((l) => l.kind === "add").length < snippet.added && snippet.added > 3);

  return (
    <div className={styles.card} data-file-mutation-snippet="true">
      <div className={styles.head}>
        <button
          type="button"
          className={styles.fileName}
          onClick={inspect}
          title={onInspect ? `${snippet.path} değişikliğini İnceleme panelinde aç` : snippet.path}
          aria-label={onInspect ? `${snippet.path} değişikliğini incele` : `${snippet.path} dosyasını aç`}
        >
          {name}
        </button>
        <span className={styles.stats} aria-label="Satır değişimi">
          <span className={snippet.added ? styles.add : styles.zero}>+{snippet.added}</span>
          <span className={snippet.removed ? styles.del : styles.zero}>-{snippet.removed}</span>
        </span>
        {shown > 0 && (
          <span className={styles.lineCount} title="Kartta gösterilen satır">
            {shown} satır
          </span>
        )}
        <button type="button" className={styles.openBtn} onClick={open} aria-label="Dosyayı aç" title="Dosyayı aç">
          <ExternalLink size={13} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
      <div
        className={styles.body}
        role="region"
        aria-label={`${name} önizleme · ${shown} satır`}
        style={{ ["--gutter-ch" as string]: `${gutterDigits}ch` }}
      >
        {snippet.lines.map((line, i) => (
          <div
            key={`${line.kind}:${line.lineNo}:${i}`}
            className={`${styles.line} ${
              line.kind === "add" ? styles.lineAdd : line.kind === "del" ? styles.lineDel : styles.lineCtx
            }`}
          >
            <span className={styles.gutter} aria-hidden="true">
              {line.lineNo}
            </span>
            <span className={styles.code}>{line.text.length ? line.text : " "}</span>
          </div>
        ))}
        {incomplete && (
          <div className={styles.truncatedNote}>
            {snippet.truncated
              ? `Görüntü limiti · +${snippet.added} −${snippet.removed} toplam (kaydır / dosyayı aç)`
              : `Toplam +${snippet.added} −${snippet.removed} · önizleme kısmi olabilir`}
          </div>
        )}
      </div>
    </div>
  );
}

export default FileMutationSnippetCard;
