import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readdir } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { ToolDefinition } from "@mrquake/quakecode-cli";

const execFileAsync = promisify(execFile);

const MAX_SEARCH_RESULTS = 200;
const MAX_CANDIDATES = 50_000;
const MAX_WALK_DEPTH = 32;
const MAX_LIST_RESULTS = 500;
const MAX_OUTPUT_CHARS = 120_000;

/** Generated/VCS folders are noisy and can make a fuzzy search unbounded. */
const DEFAULT_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".vite",
  "out",
  ".cache",
]);

type WorkspaceEntry = {
  path: string;
  type: "file" | "directory";
};

type FileSearchMatch = WorkspaceEntry & {
  score: number;
  indices: number[];
};

type WorkspaceToolParams = Record<string, unknown>;

/**
 * Extra workspace tools that complement the coding-agent built-ins:
 * - `find` remains the precise glob search;
 * - `grep` remains the content/regex search;
 * - `ls` remains the simple directory listing;
 * - `file_search` adds Codex-style fuzzy path search;
 * - `list_directory` returns a structured, workspace-safe listing.
 */
export function createWorkspaceToolDefinitions(getCwd: () => string): ToolDefinition[] {
  return [
    createFileSearchToolDefinition(getCwd),
    createListDirectoryToolDefinition(getCwd),
  ];
}

function createFileSearchToolDefinition(getCwd: () => string): ToolDefinition {
  return {
    name: "file_search",
    label: "file_search",
    description:
      "Fuzzy-search files and directories by path/name in the current workspace. Results are ranked by relevance, include both files and directories, respect .gitignore when ripgrep is available, and are returned relative to the search root.",
    promptSnippet: "Fuzzy-search workspace files and directories by path or name",
    promptGuidelines: [
      "Use file_search for an approximate filename or directory lookup, such as 'auth', 'settings panel', or 'src/server'.",
      "Use find when you have an exact glob pattern, and grep when you need to search file contents.",
      "Refine the query or raise limit when the result is truncated.",
    ],
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Fuzzy path or filename query. Characters may match in order without being adjacent.",
        },
        path: {
          type: "string",
          description: "Optional directory inside the workspace to search (default: workspace root).",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default: 50, maximum: 200).",
        },
        includeHidden: {
          type: "boolean",
          description: "Include hidden entries such as dotfiles (default: true).",
        },
        includeGenerated: {
          type: "boolean",
          description: "Include generated/dependency folders such as node_modules and dist (default: false).",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(_toolCallId: string, params: unknown) {
      const input = (params || {}) as WorkspaceToolParams;
      const query = String(input.query ?? input.pattern ?? "").trim();
      if (!query) return toolError("file_search requires a non-empty query");

      try {
        const root = resolve(String(getCwd() || process.cwd()));
        const searchRoot = resolveWorkspacePath(root, input.path);
        const limit = boundedInteger(input.limit, 50, 1, MAX_SEARCH_RESULTS);
        const includeHidden = input.includeHidden !== false;
        const includeGenerated = input.includeGenerated === true;
        const entries = await collectWorkspaceEntries(searchRoot, {
          includeHidden,
          includeGenerated,
        });
        const matches = entries
          .map((entry) => {
            const score = fuzzyPathScore(query, entry.path);
            if (!score) return undefined;
            return { ...entry, score: score.value, indices: score.indices } satisfies FileSearchMatch;
          })
          .filter((entry): entry is FileSearchMatch => Boolean(entry))
          .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));

        const shown = matches.slice(0, limit);
        const truncated = matches.length > shown.length || entries.length >= MAX_CANDIDATES;
        const output = shown.length
          ? shown.map((entry) => `${entry.path}${entry.type === "directory" ? "/" : ""}`).join("\n")
          : "No files or directories found matching the query";
        const notice = truncated
          ? `\n\n[Showing ${shown.length} of ${matches.length}${entries.length >= MAX_CANDIDATES ? `; candidate scan capped at ${MAX_CANDIDATES}` : ""}. Refine the query or increase limit.]`
          : "";
        return {
          content: [{ type: "text" as const, text: truncateOutput(output + notice) }],
          details: {
            query,
            searchRoot: toRelative(root, searchRoot),
            totalMatches: matches.length,
            shownMatches: shown.length,
            truncated,
            matches: shown,
          },
        };
      } catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
      }
    },
  } as unknown as ToolDefinition;
}

function createListDirectoryToolDefinition(getCwd: () => string): ToolDefinition {
  return {
    name: "list_directory",
    label: "list_directory",
    description:
      "List the contents of a workspace directory with directory/file type, relative paths, and sizes. The path is constrained to the current workspace.",
    promptSnippet: "List files and folders in a workspace directory",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory inside the workspace (default: workspace root).",
        },
        limit: {
          type: "number",
          description: "Maximum entries to return (default: 200, maximum: 500).",
        },
        includeHidden: {
          type: "boolean",
          description: "Include hidden entries (default: true).",
        },
        includeGenerated: {
          type: "boolean",
          description: "Include generated/dependency folders (default: true for an explicit listing).",
        },
      },
      additionalProperties: false,
    },
    async execute(_toolCallId: string, params: unknown) {
      const input = (params || {}) as WorkspaceToolParams;
      try {
        const root = resolve(String(getCwd() || process.cwd()));
        const directory = resolveWorkspacePath(root, input.path);
        const info = await lstat(directory).catch(() => undefined);
        if (!info) return toolError(`Directory not found: ${input.path || "."}`);
        if (!info.isDirectory()) return toolError(`Not a directory: ${input.path || "."}`);

        const limit = boundedInteger(input.limit, 200, 1, MAX_LIST_RESULTS);
        const includeHidden = input.includeHidden !== false;
        const includeGenerated = input.includeGenerated !== false;
        const rawEntries = await readdir(directory, { withFileTypes: true });
        const entries = rawEntries
          .filter((entry) => includeHidden || !entry.name.startsWith("."))
          .filter((entry) => includeGenerated || !DEFAULT_SKIP_DIRS.has(entry.name))
          .map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? "directory" as const : "file" as const,
          }))
          .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.type === "directory" ? -1 : 1);

        const shown = entries.slice(0, limit);
        const outputLines: string[] = [];
        const detailEntries: Array<{ name: string; path: string; type: "file" | "directory"; size?: number; modified?: string }> = [];
        for (const entry of shown) {
          const absolutePath = resolve(directory, entry.name);
          const stat = await lstat(absolutePath).catch(() => undefined);
          if (!stat) continue;
          const path = toRelative(root, absolutePath);
          outputLines.push(`${entry.type === "directory" ? "[dir] " : "[file] "}${path}${entry.type === "directory" ? "/" : ""}`);
          detailEntries.push({
            name: entry.name,
            path,
            type: entry.type,
            size: entry.type === "file" ? stat.size : undefined,
            modified: stat.mtime.toISOString(),
          });
        }
        const truncated = entries.length > shown.length;
        const output = outputLines.length ? outputLines.join("\n") : "(empty directory)";
        const notice = truncated ? `\n\n[Showing ${shown.length} of ${entries.length} entries. Increase limit for more.]` : "";
        return {
          content: [{ type: "text" as const, text: truncateOutput(output + notice) }],
          details: {
            path: toRelative(root, directory),
            totalEntries: entries.length,
            shownEntries: detailEntries.length,
            truncated,
            entries: detailEntries,
          },
        };
      } catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
      }
    },
  } as unknown as ToolDefinition;
}

async function collectWorkspaceEntries(
  searchRoot: string,
  options: { includeHidden: boolean; includeGenerated: boolean },
): Promise<WorkspaceEntry[]> {
  const info = await lstat(searchRoot).catch(() => undefined);
  if (!info) throw new Error(`Search path not found: ${searchRoot}`);
  if (info.isFile()) return [{ path: basename(searchRoot), type: "file" }];

  // ripgrep's file walker gives us Codex-like ignore semantics (.gitignore,
  // .ignore, global excludes) without adding a second ignore implementation.
  const fromRipgrep = await collectWithRipgrep(searchRoot, options);
  if (fromRipgrep) return fromRipgrep;

  const entries: WorkspaceEntry[] = [];
  await walkEntries(searchRoot, searchRoot, options, entries, 0);
  return entries;
}

async function collectWithRipgrep(
  searchRoot: string,
  options: { includeHidden: boolean; includeGenerated: boolean },
): Promise<WorkspaceEntry[] | undefined> {
  const args = ["--files", "--color", "never", "--no-messages", "--follow"];
  if (options.includeHidden) args.push("--hidden");
  if (!options.includeGenerated) {
    for (const name of DEFAULT_SKIP_DIRS) args.push("--glob", `!${name}/**`);
  }
  try {
    const { stdout } = await execFileAsync("rg", args, {
      cwd: searchRoot,
      timeout: 15_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    const result: WorkspaceEntry[] = [];
    const directories = new Set<string>();
    for (const raw of String(stdout).split(/\r?\n/)) {
      const relativePath = raw.trim().replaceAll("\\", "/");
      if (!relativePath) continue;
      const absolutePath = resolve(searchRoot, relativePath);
      const normalized = toRelative(searchRoot, absolutePath);
      result.push({ path: normalized, type: "file" });
      let parent = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : "";
      while (parent) {
        directories.add(parent.replaceAll("\\", "/"));
        const slash = parent.lastIndexOf("/");
        parent = slash >= 0 ? parent.slice(0, slash) : "";
      }
    }
    for (const directory of directories) result.push({ path: directory, type: "directory" });
    return result.slice(0, MAX_CANDIDATES);
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 1) return [];
    return undefined;
  }
}

async function walkEntries(
  directory: string,
  root: string,
  options: { includeHidden: boolean; includeGenerated: boolean },
  result: WorkspaceEntry[],
  depth: number,
): Promise<void> {
  if (result.length >= MAX_CANDIDATES || depth > MAX_WALK_DEPTH) return;
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (result.length >= MAX_CANDIDATES) return;
    if (!options.includeHidden && entry.name.startsWith(".")) continue;
    if (!options.includeGenerated && DEFAULT_SKIP_DIRS.has(entry.name)) continue;
    const absolutePath = resolve(directory, entry.name);
    const relativePath = toRelative(root, absolutePath);
    if (entry.isDirectory()) {
      result.push({ path: relativePath, type: "directory" });
      await walkEntries(absolutePath, root, options, result, depth + 1);
    } else if (entry.isFile()) {
      result.push({ path: relativePath, type: "file" });
    }
  }
}

function fuzzyPathScore(query: string, candidate: string): { value: number; indices: number[] } | undefined {
  const needle = query.normalize("NFKC").toLocaleLowerCase();
  const haystack = candidate.normalize("NFKC").toLocaleLowerCase();
  if (!needle) return { value: 0, indices: [] };

  const indices: number[] = [];
  let cursor = 0;
  let score = 0;
  const fileNameStart = Math.max(haystack.lastIndexOf("/"), haystack.lastIndexOf("\\")) + 1;
  for (const character of needle) {
    const index = haystack.indexOf(character, cursor);
    if (index < 0) return undefined;
    indices.push(index);
    const previous = index > 0 ? haystack[index - 1] : "";
    const boundary = index === 0 || "/\\._- :".includes(previous);
    const contiguous = indices.length > 1 && index === indices[indices.length - 2] + 1;
    const inFileName = index >= fileNameStart;
    score += 100;
    if (boundary) score += 45;
    if (contiguous) score += 35;
    if (inFileName) score += 25;
    score -= Math.min(index, 240) * 0.12;
    cursor = index + 1;
  }

  if (haystack === needle) score += 1_000;
  if (haystack.slice(fileNameStart) === needle) score += 700;
  if (haystack.slice(fileNameStart).startsWith(needle)) score += 300;
  if (haystack.includes(needle)) score += 180;
  score -= haystack.length * 0.25;
  return { value: Math.round(score), indices };
}

function resolveWorkspacePath(root: string, input: unknown): string {
  const raw = String(input ?? ".").trim() || ".";
  const target = resolve(root, raw);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Workspace tools cannot access paths outside the current workspace");
  }
  return target;
}

function toRelative(root: string, target: string): string {
  const value = relative(root, target).replaceAll("\\", "/");
  return value || ".";
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function truncateOutput(value: string): string {
  return value.length <= MAX_OUTPUT_CHARS ? value : `${value.slice(0, MAX_OUTPUT_CHARS)}\n\n[Output truncated]`;
}

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: { ok: false, error: message },
    isError: true,
  };
}
