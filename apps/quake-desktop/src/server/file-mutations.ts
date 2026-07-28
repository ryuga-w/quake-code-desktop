import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, rm, rename, readdir, stat } from "node:fs/promises";
import { resolve, relative, dirname, join } from "node:path";
import type { FileHistoryService } from "./file-history.js";

export class FileMutationError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = "FileMutationError";
  }
}

export class FileMutationService {
  private maxFileSize = 10 * 1024 * 1024;

  constructor(
    private readonly root: string,
    private readonly history: FileHistoryService,
  ) {}

  async writeFile(relPath: string, content: string, options?: { createBackup?: boolean }): Promise<{ path: string; bytes: number; backedUp: boolean }> {
    const target = this.resolveSafe(relPath);
    const backedUp = options?.createBackup !== false && existsSync(target);
    
    if (backedUp) {
      await this.history.createBackup(target, this.root);
    }
    
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    
    const info = await stat(target);
    return { path: relative(this.root, target).replaceAll("\\", "/"), bytes: info.size, backedUp };
  }

  async deleteFile(relPath: string): Promise<{ path: string; wasDirectory: boolean }> {
    const target = this.resolveSafe(relPath);
    if (!existsSync(target)) throw new FileMutationError("Dosya bulunamadı", 404);
    
    const info = await stat(target);
    if (info.isDirectory()) {
      await rm(target, { recursive: true, force: true });
      return { path: relative(this.root, target).replaceAll("\\", "/"), wasDirectory: true };
    }
    
    await this.history.createBackup(target, this.root);
    await rm(target);
    return { path: relative(this.root, target).replaceAll("\\", "/"), wasDirectory: false };
  }

  async createDirectory(relPath: string): Promise<{ path: string }> {
    const target = this.resolveSafe(relPath);
    if (existsSync(target)) throw new FileMutationError("Klasör zaten var", 409);
    
    await mkdir(target, { recursive: true });
    return { path: relative(this.root, target).replaceAll("\\", "/") };
  }

  async renameEntry(fromRel: string, toRel: string): Promise<{ from: string; to: string }> {
    const fromTarget = this.resolveSafe(fromRel);
    const toTarget = this.resolveSafe(toRel);
    
    if (!existsSync(fromTarget)) throw new FileMutationError("Kaynak bulunamadı", 404);
    if (existsSync(toTarget)) throw new FileMutationError("Hedef zaten var", 409);
    
    await mkdir(dirname(toTarget), { recursive: true });
    await rename(fromTarget, toTarget);
    
    return {
      from: relative(this.root, fromTarget).replaceAll("\\", "/"),
      to: relative(this.root, toTarget).replaceAll("\\", "/"),
    };
  }

  async patchFile(relPath: string, patches: Array<{ oldText: string; newText: string }>): Promise<{ path: string; edits: number; backedUp: boolean }> {
    const target = this.resolveSafe(relPath);
    if (!existsSync(target)) throw new FileMutationError("Dosya bulunamadı", 404);
    
    const info = await stat(target);
    if (info.size > this.maxFileSize) throw new FileMutationError("Dosya çok büyük", 413);
    
    const content = await readFile(target, "utf8");
    const backedUp = true;
    await this.history.createBackup(target, this.root);
    
    let result = content;
    let edits = 0;
    for (const patch of patches) {
      if (!result.includes(patch.oldText)) {
        throw new FileMutationError(`Eski metin bulunamadı: "${patch.oldText.slice(0, 50)}…"`, 400);
      }
      result = result.replace(patch.oldText, patch.newText);
      edits += 1;
    }
    
    await writeFile(target, result, "utf8");
    return { path: relative(this.root, target).replaceAll("\\", "/"), edits, backedUp };
  }

  async listDirectory(relPath: string, options?: { includeHidden?: boolean; includeGenerated?: boolean }): Promise<Array<{ name: string; path: string; type: "file" | "directory"; size?: number; modified?: string }>> {
    const target = this.resolveSafe(relPath);
    if (!existsSync(target)) throw new FileMutationError("Klasör bulunamadı", 404);
    
    const info = await stat(target);
    if (!info.isDirectory()) throw new FileMutationError("Klasör değil", 400);
    
    const entries = await readdir(target, { withFileTypes: true });
    const result: Array<{ name: string; path: string; type: "file" | "directory"; size?: number; modified?: string }> = [];
    
    for (const entry of entries) {
      if (!options?.includeHidden && entry.name.startsWith(".")) continue;
      if (!options?.includeGenerated && GENERATED_DIRS.has(entry.name)) continue;
      
      const fullPath = join(target, entry.name);
      const entryInfo = await stat(fullPath).catch(() => undefined);
      result.push({
        name: entry.name,
        path: relative(this.root, fullPath).replaceAll("\\", "/"),
        type: entry.isDirectory() ? "directory" : "file",
        size: entryInfo?.size,
        modified: entryInfo?.mtime?.toISOString(),
      });
    }
    
    return result.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));
  }

  private resolveSafe(relPath: string): string {
    const normalized = String(relPath || ".").replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
    const target = resolve(this.root, normalized || ".");
    const rel = relative(this.root, target);
    if (rel.startsWith("..") || rel === ".." || resolve(rel) === rel) {
      throw new FileMutationError("Çalışma alanı dışına çıkılamaz", 403);
    }
    return target;
  }
}

const GENERATED_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".next", ".turbo", ".vite", "out"]);
