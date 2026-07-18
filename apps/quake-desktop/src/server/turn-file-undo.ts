import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { FileMutationService } from "./file-mutations.js";

export type TurnFileUndoEntry = {
  path: string;
  kind: "create" | "modify" | "delete";
  diff?: string;
  previousPath?: string;
};

export type TurnFileUndoResult = {
  reverted: number;
  paths: string[];
};

type DiffLine = {
  kind: "context" | "add" | "remove";
  text: string;
  lineNumber?: number;
};

type ReverseBlock = {
  lines: DiffLine[];
  lineHint?: number;
};

type FileSnapshot = {
  exists: boolean;
  content: string;
};

type UndoPlan = {
  path: string;
  absolutePath: string;
  action: "write" | "delete";
  content?: string;
  original: FileSnapshot;
};

const MAX_UNDO_FILES = 100;
const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_DIFF_BYTES = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export class TurnFileUndoError extends Error {
  constructor(message: string, readonly statusCode = 409) {
    super(message);
    this.name = "TurnFileUndoError";
  }
}

function isDiffMetadata(line: string): boolean {
  return line.startsWith("diff --git ")
    || line.startsWith("index ")
    || /^(?:---|\+\+\+) (?:[ab]\/|\/dev\/null)/.test(line)
    || line.startsWith("\\ No newline at end of file");
}

function isNumberedDisplayDiff(lines: string[]): boolean {
  if (lines.some((line) => line.startsWith("@@"))) return false;
  return lines.some((line) => /^[+\- ]\s*\d+\s/.test(line));
}

function parseNumberedPayload(raw: string): { text: string; lineNumber?: number } {
  const match = raw.match(/^\s*(\d+)\s(.*)$/);
  if (!match) return { text: raw };
  return { text: match[2], lineNumber: Number(match[1]) };
}

/**
 * Parse both Codex apply_patch hunks and Quake's numbered edit/write diff.
 * Blocks are intentionally exact: later edits inside a changed block produce a
 * conflict instead of silently overwriting user work.
 */
export function parseReverseDiffBlocks(diff: string): ReverseBlock[] {
  const lines = String(diff || "").replace(/\r\n/g, "\n").split("\n");
  const numbered = isNumberedDisplayDiff(lines);
  const blocks: ReverseBlock[] = [];
  let current: DiffLine[] = [];
  let currentHint: number | undefined;
  let pendingHunkHint: number | undefined;

  const flush = () => {
    if (current.some((line) => line.kind !== "context")) {
      blocks.push({ lines: current, lineHint: currentHint ?? pendingHunkHint });
    }
    current = [];
    currentHint = undefined;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      pendingHunkHint = undefined;
      continue;
    }
    if (isDiffMetadata(line) || /^\*\*\* (?:Begin|End) Patch/.test(line)) continue;
    if (line.startsWith("@@")) {
      flush();
      const hunk = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)/);
      pendingHunkHint = hunk ? Number(hunk[1]) : undefined;
      continue;
    }
    if (!line) {
      flush();
      continue;
    }

    const prefix = line[0];
    if (prefix !== "+" && prefix !== "-" && prefix !== " ") continue;
    const raw = line.slice(1);
    const payload = numbered ? parseNumberedPayload(raw) : { text: raw, lineNumber: undefined };
    if (numbered && prefix === " " && payload.text.trim() === "...") {
      flush();
      continue;
    }
    const kind = prefix === "+" ? "add" : prefix === "-" ? "remove" : "context";
    current.push({ kind, text: payload.text, lineNumber: payload.lineNumber });
    if (currentHint === undefined && payload.lineNumber !== undefined) {
      currentHint = payload.lineNumber;
    }
  }
  flush();
  return blocks;
}

function splitContent(content: string): { lines: string[]; eol: "\n" | "\r\n"; trailingNewline: boolean } {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const normalized = content.replace(/\r\n/g, "\n");
  const trailingNewline = normalized.endsWith("\n");
  if (!normalized) return { lines: [], eol, trailingNewline: false };
  const lines = normalized.split("\n");
  if (trailingNewline) lines.pop();
  return { lines, eol, trailingNewline };
}

function findSequenceMatches(lines: string[], expected: string[]): number[] {
  if (!expected.length) return [];
  const matches: number[] = [];
  for (let start = 0; start <= lines.length - expected.length; start += 1) {
    let matchesAtStart = true;
    for (let offset = 0; offset < expected.length; offset += 1) {
      if (lines[start + offset] !== expected[offset]) {
        matchesAtStart = false;
        break;
      }
    }
    if (matchesAtStart) matches.push(start);
  }
  return matches;
}

function chooseMatch(matches: number[], lineHint?: number): number | undefined {
  if (matches.length === 1) return matches[0];
  if (!matches.length || lineHint === undefined) return undefined;
  const target = Math.max(0, lineHint - 1);
  const ranked = matches
    .map((start) => ({ start, distance: Math.abs(start - target) }))
    .sort((a, b) => a.distance - b.distance);
  if (ranked.length > 1 && ranked[0].distance === ranked[1].distance) return undefined;
  return ranked[0]?.start;
}

/** Reverse a file diff against its current content, failing closed on drift. */
export function reverseFileDiff(currentContent: string, diff: string, path = "dosya"): string {
  const blocks = parseReverseDiffBlocks(diff);
  if (!blocks.length) {
    throw new TurnFileUndoError(`${path} için geri alınabilir diff bulunamadı`);
  }

  const split = splitContent(currentContent);
  const currentLines = [...split.lines];
  let appliedBlocks = 0;

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    const expected = block.lines
      .filter((line) => line.kind !== "remove")
      .map((line) => line.text);
    const replacement = block.lines
      .filter((line) => line.kind !== "add")
      .map((line) => line.text);

    if (expected.length === replacement.length && expected.every((line, lineIndex) => line === replacement[lineIndex])) {
      continue;
    }

    let start: number | undefined;
    if (expected.length === 0) {
      if (block.lineHint !== undefined) start = Math.min(currentLines.length, Math.max(0, block.lineHint - 1));
    } else {
      start = chooseMatch(findSequenceMatches(currentLines, expected), block.lineHint);
    }
    if (start === undefined) {
      throw new TurnFileUndoError(`${path} geri alınamadı: dosya bu turdan sonra değişmiş veya diff belirsiz`);
    }
    currentLines.splice(start, expected.length, ...replacement);
    appliedBlocks += 1;
  }

  if (!appliedBlocks) throw new TurnFileUndoError(`${path} için geri alınabilir değişiklik bulunamadı`);
  const trailingNewline = currentLines.length > 0 && (split.trailingNewline || currentContent === "");
  return currentLines.join(split.eol) + (trailingNewline ? split.eol : "");
}

function resolveWorkspaceFile(workspaceRoot: string, inputPath: string): { absolutePath: string; relativePath: string } {
  const normalized = String(inputPath || "").replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!normalized) throw new TurnFileUndoError("Geri alınacak dosya yolu boş", 400);
  const absolutePath = resolve(workspaceRoot, normalized);
  const relativePath = relative(workspaceRoot, absolutePath);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(relativePath)) {
    throw new TurnFileUndoError("Çalışma alanı dışındaki dosya geri alınamaz", 403);
  }
  return { absolutePath, relativePath: relativePath.replaceAll("\\", "/") };
}

async function readSnapshot(absolutePath: string): Promise<FileSnapshot> {
  const info = await stat(absolutePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!info) return { exists: false, content: "" };
  if (!info.isFile()) throw new TurnFileUndoError("Geri alma yalnızca dosyalar için destekleniyor");
  if (info.size > MAX_FILE_BYTES) throw new TurnFileUndoError("Geri alınacak dosya çok büyük", 413);
  return { exists: true, content: await readFile(absolutePath, "utf8") };
}

function validateUndoEntries(entries: TurnFileUndoEntry[]): void {
  if (!entries.length) throw new TurnFileUndoError("Geri alınacak dosya bulunamadı", 400);
  if (entries.length > MAX_UNDO_FILES) throw new TurnFileUndoError("Tek seferde çok fazla dosya geri alınamaz", 413);
  let totalDiffBytes = 0;
  const paths = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new TurnFileUndoError("Geçersiz geri alma kaydı", 400);
    if (entry.kind !== "create" && entry.kind !== "modify" && entry.kind !== "delete") {
      throw new TurnFileUndoError(`Geçersiz dosya değişikliği türü: ${String(entry.kind || "")}`, 400);
    }
    const diffBytes = Buffer.byteLength(String(entry.diff || ""), "utf8");
    if (diffBytes > MAX_DIFF_BYTES) throw new TurnFileUndoError(`${entry.path} diff'i çok büyük`, 413);
    totalDiffBytes += diffBytes;
    const key = String(entry.path || "").replaceAll("\\", "/").toLowerCase();
    if (paths.has(key)) throw new TurnFileUndoError(`Aynı dosya birden fazla kez gönderildi: ${entry.path}`, 400);
    paths.add(key);
  }
  if (totalDiffBytes > MAX_TOTAL_DIFF_BYTES) throw new TurnFileUndoError("Toplam geri alma diff'i çok büyük", 413);
}

async function createUndoPlans(workspaceRoot: string, entries: TurnFileUndoEntry[]): Promise<UndoPlan[]> {
  const plans: UndoPlan[] = [];
  for (const entry of entries) {
    if (entry.previousPath && entry.previousPath !== entry.path) {
      throw new TurnFileUndoError(`${entry.path}: taşınan dosyaları geri alma henüz desteklenmiyor`);
    }
    const target = resolveWorkspaceFile(workspaceRoot, entry.path);
    const original = await readSnapshot(target.absolutePath);
    const diff = String(entry.diff || "");

    if (entry.kind === "create") {
      if (!original.exists) throw new TurnFileUndoError(`${target.relativePath} zaten silinmiş`);
      const before = !diff.trim() && original.content === ""
        ? ""
        : reverseFileDiff(original.content, diff, target.relativePath);
      if (before !== "") {
        throw new TurnFileUndoError(`${target.relativePath} oluşturulmadan önce boş değildi; güvenli geri alma yapılamadı`);
      }
      plans.push({ path: target.relativePath, absolutePath: target.absolutePath, action: "delete", original });
      continue;
    }

    if (entry.kind === "delete") {
      if (original.exists) throw new TurnFileUndoError(`${target.relativePath} silindikten sonra yeniden oluşturulmuş`);
      const before = diff.trim() ? reverseFileDiff("", diff, target.relativePath) : "";
      plans.push({ path: target.relativePath, absolutePath: target.absolutePath, action: "write", content: before, original });
      continue;
    }

    if (!original.exists) throw new TurnFileUndoError(`${target.relativePath} artık mevcut değil`);
    const before = reverseFileDiff(original.content, diff, target.relativePath);
    plans.push({ path: target.relativePath, absolutePath: target.absolutePath, action: "write", content: before, original });
  }
  return plans;
}

async function rollbackPlans(fileMutations: FileMutationService, plans: UndoPlan[]): Promise<void> {
  for (let index = plans.length - 1; index >= 0; index -= 1) {
    const plan = plans[index];
    try {
      if (plan.original.exists) {
        await fileMutations.writeFile(plan.path, plan.original.content, { createBackup: false });
      } else {
        await fileMutations.deleteFile(plan.path);
      }
    } catch {
      // Preserve the primary error; rollback is best effort after a filesystem failure.
    }
  }
}

/** Preflight every file, then apply the complete turn undo as one operation. */
export async function undoTurnFileChanges(
  workspaceRoot: string,
  fileMutations: FileMutationService,
  entries: TurnFileUndoEntry[],
): Promise<TurnFileUndoResult> {
  validateUndoEntries(entries);
  const plans = await createUndoPlans(workspaceRoot, entries);
  const applied: UndoPlan[] = [];
  try {
    for (const plan of plans) {
      const latest = await readSnapshot(plan.absolutePath);
      if (latest.exists !== plan.original.exists || latest.content !== plan.original.content) {
        throw new TurnFileUndoError(`${plan.path} geri alma sırasında yeniden değişti`);
      }
      // Register before execution as the mutation may succeed and a trailing
      // metadata/stat step may still throw.
      applied.push(plan);
      if (plan.action === "delete") {
        await fileMutations.deleteFile(plan.path);
      } else {
        await fileMutations.writeFile(plan.path, plan.content || "", { createBackup: plan.original.exists });
      }
    }
  } catch (error) {
    await rollbackPlans(fileMutations, applied);
    throw new TurnFileUndoError(
      `Tur geri alınamadı; tamamlanan adımlar geri çevrildi: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof TurnFileUndoError ? error.statusCode : 500,
    );
  }
  return { reverted: plans.length, paths: plans.map((plan) => plan.path) };
}
