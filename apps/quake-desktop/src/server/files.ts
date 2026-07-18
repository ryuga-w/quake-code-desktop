import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import type { WebFileEntry } from "../shared/protocol.js";

export class WebFileServiceError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = "WebFileServiceError";
  }
}

export class WebFileService {
  constructor(private readonly root: string) {}

  async list(dir = ".", options: { includeHidden?: boolean; includeGenerated?: boolean } = {}): Promise<WebFileEntry[]> {
    const target = this.resolveSafe(dir);
    const info = await stat(target).catch(() => undefined);
    if (!info) throw new WebFileServiceError("Klasör bulunamadı", 404);
    if (!info.isDirectory()) throw new WebFileServiceError("Yol bir klasör değil", 400);
    const entries = await readdir(target, { withFileTypes: true });
    const result = await Promise.all(
      entries
        .filter((entry) => this.shouldInclude(entry.name, options))
        .slice(0, 300)
        .map(async (entry) => this.toEntry(resolve(target, entry.name), entry.isDirectory())),
    );
    return this.sortEntries(result);
  }

  async search(query: string, options: { includeHidden?: boolean; includeGenerated?: boolean; limit?: number } = {}): Promise<WebFileEntry[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
    const results: WebFileEntry[] = [];

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (results.length >= limit || depth > 10) return;
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (results.length >= limit || !this.shouldInclude(entry.name, options)) continue;
        const fullPath = resolve(dir, entry.name);
        const webEntry = await this.toEntry(fullPath, entry.isDirectory());
        const haystack = `${webEntry.name} ${webEntry.path}`.toLowerCase();
        if (haystack.includes(q)) results.push(webEntry);
        if (entry.isDirectory()) await walk(fullPath, depth + 1);
      }
    };

    await walk(this.root, 0);
    return this.sortEntries(results);
  }

  async read(path: string): Promise<{ path: string; content: string; size: number }> {
    const target = this.resolveSafe(path);
    const info = await stat(target).catch(() => undefined);
    if (!info) throw new WebFileServiceError("Dosya bulunamadı", 404);
    if (!info.isFile()) throw new WebFileServiceError("Yol bir dosya değil", 400);
    if (info.size > 1024 * 1024) throw new WebFileServiceError("Dosya web önizlemesi için çok büyük (>1MB)", 413);
    return { path: this.toRelative(target), content: await readFile(target, "utf8"), size: info.size };
  }

  private async toEntry(fullPath: string, isDirectory: boolean): Promise<WebFileEntry> {
    const info = await stat(fullPath).catch(() => undefined);
    return {
      name: fullPath.split(/[\\/]/).pop() || fullPath,
      path: this.toRelative(fullPath),
      type: isDirectory ? "directory" : "file",
      size: info?.size,
      modified: info?.mtime.toISOString(),
    } satisfies WebFileEntry;
  }

  private shouldInclude(name: string, options: { includeHidden?: boolean; includeGenerated?: boolean }): boolean {
    if (!options.includeHidden && name.startsWith(".")) return false;
    if (!options.includeGenerated && GENERATED_DIRS.has(name)) return false;
    return true;
  }

  private sortEntries(entries: WebFileEntry[]): WebFileEntry[] {
    return entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));
  }

  private resolveSafe(path: string): string {
    const normalized = this.normalizeInputPath(path);
    const target = this.safeTarget(normalized);
    if (existsSync(target)) return target;
    const fallback = this.stripWorkspacePrefix(normalized);
    if (fallback !== normalized) {
      const fallbackTarget = this.safeTarget(fallback);
      if (existsSync(fallbackTarget)) return fallbackTarget;
    }
    return target;
  }

  private safeTarget(path: string): string {
    const target = resolve(this.root, path || ".");
    const rel = relative(this.root, target);
    if (rel.startsWith("..") || rel === ".." || resolve(rel) === rel) throw new WebFileServiceError("Çalışma alanı dışına çıkılamaz", 403);
    return target;
  }

  private normalizeInputPath(path: string): string {
    const normalized = String(path || ".")
      .replaceAll("\\", "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+$/, "");
    return normalized || ".";
  }

  private stripWorkspacePrefix(path: string): string {
    if (path === ".") return path;
    const inputParts = path.split("/").filter(Boolean);
    const rootParts = this.root.replaceAll("\\", "/").split("/").filter(Boolean);
    for (let length = Math.min(inputParts.length, rootParts.length); length > 0; length -= 1) {
      const rootSuffix = rootParts.slice(-length).map((part) => part.toLowerCase());
      const inputPrefix = inputParts.slice(0, length).map((part) => part.toLowerCase());
      if (rootSuffix.every((part, index) => part === inputPrefix[index])) {
        return inputParts.slice(length).join("/") || ".";
      }
    }
    return path;
  }

  private toRelative(path: string): string {
    return relative(this.root, path).replaceAll("\\", "/") || ".";
  }
}

const GENERATED_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".next", ".turbo", ".vite", "out"]);
