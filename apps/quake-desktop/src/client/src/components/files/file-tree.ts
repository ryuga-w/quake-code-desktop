export type WorkspaceEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
};

export type VisibleTreeRow = { entry: WorkspaceEntry; depth: number };
export type VisibleTreeSelection = { rows: VisibleTreeRow[]; total: number };

export function normalizeDir(path: string): string {
  return !path || path === "." ? "." : path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

export function parentDir(path: string): string {
  const normalized = normalizeDir(path);
  if (normalized === "." || !normalized.includes("/")) return ".";
  return normalized.split("/").slice(0, -1).join("/") || ".";
}

export function joinWorkspacePath(parent: string, name: string): string {
  const cleanName = name.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  return normalizeDir(parent) === "." ? cleanName : `${normalizeDir(parent)}/${cleanName}`;
}

export function ancestorDirs(path: string): string[] {
  const normalized = normalizeDir(path);
  if (normalized === ".") return [];
  const parts = normalized.split("/").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function shouldShowTreeEntry(entry: WorkspaceEntry, showHidden: boolean, showGenerated: boolean): boolean {
  if (!showHidden && entry.name.startsWith(".")) return false;
  if (!showGenerated && GENERATED_DIRS.has(entry.name)) return false;
  return true;
}

export function selectVisibleTreeRows(
  childrenByDir: Record<string, WorkspaceEntry[]>,
  rootEntries: WorkspaceEntry[],
  expanded: Set<string>,
  showHidden: boolean,
  showGenerated: boolean,
  limit: number,
): VisibleTreeSelection {
  const rows: VisibleTreeRow[] = [];
  let total = 0;
  const visit = (entries: WorkspaceEntry[], depth: number) => {
    for (const entry of entries) {
      if (!shouldShowTreeEntry(entry, showHidden, showGenerated)) continue;
      total += 1;
      if (rows.length < limit) rows.push({ entry, depth });
      if (entry.type === "directory" && expanded.has(entry.path) && childrenByDir[entry.path]) {
        visit(childrenByDir[entry.path], depth + 1);
      }
    }
  };
  visit(rootEntries, 0);
  return { rows, total };
}

export function countLoadedFileEntries(childrenByDir: Record<string, WorkspaceEntry[]>): number {
  return Object.values(childrenByDir).reduce((total, entries) => total + entries.length, 0);
}

export function normalizeEntries(value: unknown): WorkspaceEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.name !== "string" || typeof entry.path !== "string") return [];
    if (entry.type !== "file" && entry.type !== "directory") return [];
    return [{
      name: entry.name,
      path: normalizeDir(entry.path),
      type: entry.type,
      size: typeof entry.size === "number" ? entry.size : undefined,
      modified: typeof entry.modified === "string" ? entry.modified : undefined,
    } satisfies WorkspaceEntry];
  });
}

export function formatBytes(value?: number): string {
  if (value === undefined) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function isValidEntryName(name: string): boolean {
  const value = name.trim();
  return Boolean(value && value !== "." && value !== ".." && !value.includes("..") && !/[\\/:*?"<>|]/.test(value));
}

const GENERATED_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".next", ".turbo", ".vite", "out"]);
