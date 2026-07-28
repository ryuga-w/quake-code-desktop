import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";

const execFileAsync = promisify(execFile);

const RG_TIMEOUT = 8000;
const RG_MAX_BUFFER = 16 * 1024 * 1024;
const MAX_FILE_RESULTS = 200;
const MAX_WALK_DEPTH = 12;
const MAX_LINE_LENGTH = 400;
const MAX_SCAN_FILE_BYTES = 1024 * 1024;

/** Directories that never contain user-relevant search hits. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".vite",
  "out",
  ".cache",
]);

/** Match the Search API CONTRACT shapes. */
export interface SearchFileMatch {
  path: string;
  line: number;
  text: string;
}

export interface SearchSessionMatch {
  path: string;
  name: string;
  snippet: string;
}

export interface SearchAllResult {
  files: SearchFileMatch[];
  sessions: SearchSessionMatch[];
}

/**
 * Minimal shape the integrator passes from `runtime.listSessions()`.
 * Mirrors WebSessionSummary without importing it (keeps this file self-contained
 * and decoupled from protocol changes).
 */
export interface SearchableSession {
  path: string;
  name?: string;
  firstMessage?: string;
  lastUserMessage?: string;
  lastAssistantMessage?: string;
}

interface RipgrepJsonMatch {
  type: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
  };
}

/** Cache the ripgrep availability probe per process. */
let ripgrepAvailable: boolean | undefined;

async function hasRipgrep(): Promise<boolean> {
  if (ripgrepAvailable !== undefined) return ripgrepAvailable;
  try {
    await execFileAsync("rg", ["--version"], { timeout: 3000, windowsHide: true });
    ripgrepAvailable = true;
  } catch {
    ripgrepAvailable = false;
  }
  return ripgrepAvailable;
}

function toRelative(root: string, fullPath: string): string {
  const rel = relative(root, fullPath).replaceAll("\\", "/");
  return rel || fullPath.replaceAll("\\", "/");
}

function trimLine(text: string): string {
  const collapsed = text.replace(/\r?\n$/, "");
  return collapsed.length > MAX_LINE_LENGTH ? `${collapsed.slice(0, MAX_LINE_LENGTH)}…` : collapsed;
}

/**
 * File-content search via `rg --json` when available, otherwise a bounded
 * recursive JS grep. Caps at MAX_FILE_RESULTS, skips generated/VCS dirs.
 */
export async function searchContent(cwd: string, query: string): Promise<SearchFileMatch[]> {
  const q = query.trim();
  if (!q) return [];

  if (await hasRipgrep()) {
    const viaRg = await searchWithRipgrep(cwd, q);
    if (viaRg) return viaRg;
  }
  return searchWithFallback(cwd, q);
}

async function searchWithRipgrep(cwd: string, query: string): Promise<SearchFileMatch[] | undefined> {
  const args = [
    "--json",
    "--fixed-strings",
    "--smart-case",
    "--max-count",
    "5",
    "--max-filesize",
    "1M",
    "--max-columns",
    String(MAX_LINE_LENGTH),
  ];
  for (const dir of SKIP_DIRS) {
    args.push("--glob", `!${dir}/**`);
  }
  args.push("--", query);

  try {
    const { stdout } = await execFileAsync("rg", args, {
      cwd,
      timeout: RG_TIMEOUT,
      maxBuffer: RG_MAX_BUFFER,
      windowsHide: true,
    });
    return parseRipgrepJson(cwd, stdout);
  } catch (error) {
    // rg exits 1 when there are no matches — that is a valid empty result.
    const withCode = error as { code?: number; stdout?: string | Buffer };
    if (withCode?.code === 1) {
      return parseRipgrepJson(cwd, withCode.stdout ? String(withCode.stdout) : "");
    }
    // Any other failure (spawn error, exit 2) → let the caller fall back.
    return undefined;
  }
}

function parseRipgrepJson(cwd: string, stdout: string): SearchFileMatch[] {
  const results: SearchFileMatch[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    if (results.length >= MAX_FILE_RESULTS) break;
    if (!rawLine.trim()) continue;
    let parsed: RipgrepJsonMatch;
    try {
      parsed = JSON.parse(rawLine) as RipgrepJsonMatch;
    } catch {
      continue;
    }
    if (parsed.type !== "match" || !parsed.data) continue;
    const pathText = parsed.data.path?.text;
    const lineText = parsed.data.lines?.text;
    if (!pathText || lineText === undefined) continue;
    results.push({
      path: toRelative(cwd, resolve(cwd, pathText)),
      line: parsed.data.line_number ?? 0,
      text: trimLine(lineText),
    });
  }
  return results;
}

/** Bounded recursive grep used when ripgrep is unavailable. */
async function searchWithFallback(cwd: string, query: string): Promise<SearchFileMatch[]> {
  const needle = query.toLowerCase();
  const results: SearchFileMatch[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (results.length >= MAX_FILE_RESULTS || depth > MAX_WALK_DEPTH) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (results.length >= MAX_FILE_RESULTS) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      await scanFile(fullPath, needle, cwd, results);
    }
  };

  await walk(cwd, 0);
  return results;
}

async function scanFile(fullPath: string, needle: string, cwd: string, results: SearchFileMatch[]): Promise<void> {
  if (results.length >= MAX_FILE_RESULTS) return;
  const info = await stat(fullPath).catch(() => undefined);
  if (!info || !info.isFile() || info.size > MAX_SCAN_FILE_BYTES) return;

  let content: string;
  try {
    content = await readFile(fullPath, "utf8");
  } catch {
    return;
  }
  // Skip likely-binary files (NUL byte in the first chunk).
  if (content.indexOf("\u0000") !== -1) return;

  const lines = content.split(/\r?\n/);
  let perFile = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (results.length >= MAX_FILE_RESULTS || perFile >= 5) break;
    if (lines[i].toLowerCase().includes(needle)) {
      results.push({
        path: toRelative(cwd, fullPath),
        line: i + 1,
        text: trimLine(lines[i]),
      });
      perFile += 1;
    }
  }
}

function buildSnippet(session: SearchableSession, needle: string): string | undefined {
  const haystacks = [
    session.lastUserMessage,
    session.lastAssistantMessage,
    session.firstMessage,
    session.name,
  ];
  for (const field of haystacks) {
    if (!field) continue;
    const idx = field.toLowerCase().indexOf(needle);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 40);
    const end = Math.min(field.length, idx + needle.length + 80);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < field.length ? "…" : "";
    return `${prefix}${field.slice(start, end).trim()}${suffix}`;
  }
  return undefined;
}

/**
 * Search session summaries/messages. The integrator supplies the sessions
 * (e.g. from `runtime.listSessions(true)`) so this stays decoupled.
 */
export function searchSessions(query: string, sessions: SearchableSession[]): SearchSessionMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle || !Array.isArray(sessions)) return [];

  const results: SearchSessionMatch[] = [];
  for (const session of sessions) {
    if (!session || typeof session.path !== "string") continue;
    const snippet = buildSnippet(session, needle);
    if (snippet === undefined) continue;
    results.push({
      path: session.path,
      name: session.name?.trim() || session.firstMessage?.trim() || session.path,
      snippet,
    });
    if (results.length >= MAX_FILE_RESULTS) break;
  }
  return results;
}

/**
 * GET /api/search?q= -> { files:[{path,line,text}], sessions:[{path,name,snippet}] }
 * Combines content + session search. `sessions` is provided by the caller.
 */
export async function searchAll(
  cwd: string,
  query: string,
  sessions: SearchableSession[] = [],
): Promise<SearchAllResult> {
  const trimmed = query.trim();
  if (!trimmed) return { files: [], sessions: [] };

  const [files, sessionMatches] = await Promise.all([
    searchContent(cwd, trimmed),
    Promise.resolve(searchSessions(trimmed, sessions)),
  ]);

  return { files, sessions: sessionMatches };
}
