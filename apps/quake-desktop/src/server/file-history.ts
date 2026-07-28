import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, rm, readdir, stat, copyFile } from "node:fs/promises";
import { join, relative, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface FileVersion {
  id: string;
  path: string;
  timestamp: number;
  size: number;
  hash: string;
  backupPath: string;
}

export interface FileHistoryEntry {
  path: string;
  versions: FileVersion[];
}

export class FileHistoryService {
  private historyDir: string;
  private maxVersionsPerFile = 20;
  private maxTotalVersions = 500;

  constructor(workspaceRoot: string) {
    this.historyDir = join(workspaceRoot, ".quake-web", "file-history");
  }

  async init(): Promise<void> {
    if (!existsSync(this.historyDir)) {
      await mkdir(this.historyDir, { recursive: true });
    }
  }

  async createBackup(filePath: string, workspaceRoot: string): Promise<FileVersion | null> {
    if (!existsSync(filePath)) return null;
    
    const content = await readFile(filePath, "utf8");
    const hash = await this.computeHash(content);
    const relPath = relative(workspaceRoot, filePath).replaceAll("\\", "/");
    const versionId = randomUUID();
    const backupPath = join(this.historyDir, `${versionId}.bak`);
    
    await copyFile(filePath, backupPath);
    
    const info = await stat(filePath);
    const version: FileVersion = {
      id: versionId,
      path: relPath,
      timestamp: Date.now(),
      size: info.size,
      hash,
      backupPath,
    };

    await this.appendVersion(relPath, version);
    await this.pruneOldVersions(relPath);
    return version;
  }

  async getHistory(relPath: string): Promise<FileVersion[]> {
    const manifest = await this.readManifest();
    return manifest[relPath]?.versions || [];
  }

  async restoreVersion(versionId: string, workspaceRoot: string): Promise<string | null> {
    const manifest = await this.readManifest();
    for (const entry of Object.values(manifest)) {
      const version = entry.versions.find((v) => v.id === versionId);
      if (version && existsSync(version.backupPath)) {
        const content = await readFile(version.backupPath, "utf8");
        return content;
      }
    }
    return null;
  }

  async restoreToVersion(versionId: string, workspaceRoot: string): Promise<boolean> {
    const content = await this.restoreVersion(versionId, workspaceRoot);
    if (content === null) return false;
    
    const manifest = await this.readManifest();
    for (const entry of Object.values(manifest)) {
      const version = entry.versions.find((v) => v.id === versionId);
      if (version) {
        const targetPath = resolve(workspaceRoot, version.path);
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, content, "utf8");
        return true;
      }
    }
    return false;
  }

  private async appendVersion(relPath: string, version: FileVersion): Promise<void> {
    const manifest = await this.readManifest();
    if (!manifest[relPath]) {
      manifest[relPath] = { path: relPath, versions: [] };
    }
    manifest[relPath].versions.unshift(version);
    await this.writeManifest(manifest);
  }

  private async pruneOldVersions(relPath: string): Promise<void> {
    const manifest = await this.readManifest();
    const entry = manifest[relPath];
    if (!entry) return;
    
    if (entry.versions.length > this.maxVersionsPerFile) {
      const removed = entry.versions.splice(this.maxVersionsPerFile);
      for (const v of removed) {
        if (existsSync(v.backupPath)) await rm(v.backupPath).catch(() => {});
      }
    }
    await this.writeManifest(manifest);
  }

  private async readManifest(): Promise<Record<string, FileHistoryEntry>> {
    const manifestPath = join(this.historyDir, "manifest.json");
    if (!existsSync(manifestPath)) return {};
    try {
      const content = await readFile(manifestPath, "utf8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private async writeManifest(manifest: Record<string, FileHistoryEntry>): Promise<void> {
    const manifestPath = join(this.historyDir, "manifest.json");
    
    let totalVersions = 0;
    for (const entry of Object.values(manifest)) totalVersions += entry.versions.length;
    
    if (totalVersions > this.maxTotalVersions) {
      const allVersions: Array<{ relPath: string; version: FileVersion }> = [];
      for (const entry of Object.values(manifest)) {
        for (const v of entry.versions) allVersions.push({ relPath: entry.path, version: v });
      }
      allVersions.sort((a, b) => b.version.timestamp - a.version.timestamp);
      const keep = new Map<string, Set<string>>();
      for (const { relPath, version } of allVersions.slice(0, this.maxTotalVersions)) {
        if (!keep.has(relPath)) keep.set(relPath, new Set());
        keep.get(relPath)!.add(version.id);
      }
      for (const entry of Object.values(manifest)) {
        entry.versions = entry.versions.filter((v) => keep.get(entry.path)?.has(v.id));
      }
    }
    
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  }

  private async computeHash(content: string): Promise<string> {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(content).digest("hex").slice(0, 12);
  }
}
