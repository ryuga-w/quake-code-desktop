import { resolve } from "node:path";

function workspaceKey(path: string): string {
  const normalized = resolve(String(path || ""));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function parseWorkspaceRootsJson(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      : [];
  } catch {
    return [];
  }
}

/**
 * Process-local set of folders that belong to the current desktop window.
 * One root is active for cwd-bound UI services, while agent sessions in every
 * registered root may remain alive in the runtime.
 */
export class WorkspaceRegistry {
  private readonly roots = new Map<string, string>();
  private activeRoot: string;

  constructor(activeRoot: string, initialRoots: string[] = []) {
    this.activeRoot = resolve(activeRoot);
    for (const root of initialRoots) this.add(root);
    this.add(this.activeRoot);
  }

  get active(): string {
    return this.activeRoot;
  }

  list(): string[] {
    return [...this.roots.values()];
  }

  has(path: string): boolean {
    return this.roots.has(workspaceKey(path));
  }

  add(path: string): string {
    const normalized = resolve(path);
    this.roots.set(workspaceKey(normalized), normalized);
    return normalized;
  }

  addMany(paths: string[]): string[] {
    return paths.map((path) => this.add(path));
  }

  activate(path: string): string {
    const normalized = this.add(path);
    this.activeRoot = normalized;
    return normalized;
  }

  remove(path: string): boolean {
    const key = workspaceKey(path);
    if (key === workspaceKey(this.activeRoot)) return false;
    return this.roots.delete(key);
  }
}
