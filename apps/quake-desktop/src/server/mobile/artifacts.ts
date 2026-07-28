import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";

export type MobileArtifactKind = "screenshot" | "video" | "snapshot" | "logs" | "build" | "test";
export type MobileArtifact = { id: string; sessionKey: string; kind: MobileArtifactKind; name: string; path: string; size: number; createdAt: string; sensitive: boolean };

export class MobileArtifactStore {
  constructor(private workspace: string, private maxBytes = 500 * 1024 * 1024) {}
  setWorkspace(workspace: string): void { this.workspace = workspace; }
  private root(sessionKey: string): string {
    const safe = sessionKey.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
    return join(this.workspace, ".quake-code", "mobile-artifacts", safe || "default");
  }
  save(sessionKey: string, kind: MobileArtifactKind, name: string, data: Buffer | string, sensitive = true): MobileArtifact {
    const root = this.root(sessionKey); mkdirSync(root, { recursive: true });
    const id = randomUUID(); const path = join(root, `${id}-${basename(name)}`);
    writeFileSync(path, data);
    this.enforceRetention(root);
    return { id, sessionKey, kind, name: basename(name), path, size: statSync(path).size, createdAt: new Date().toISOString(), sensitive };
  }
  list(sessionKey: string): MobileArtifact[] {
    const root = this.root(sessionKey);
    try { return readdirSync(root).map((name) => { const path = join(root, name); const stat = statSync(path); const [id] = name.split("-"); return { id: id!, sessionKey, kind: name.endsWith(".png") ? "screenshot" : name.endsWith(".mp4") ? "video" : "logs", name, path, size: stat.size, createdAt: stat.birthtime.toISOString(), sensitive: true } as MobileArtifact; }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); } catch { return []; }
  }
  clear(sessionKey: string): void { rmSync(this.root(sessionKey), { recursive: true, force: true }); }
  private enforceRetention(root: string): void {
    const entries = readdirSync(root).map((name) => ({ path: join(root, name), stat: statSync(join(root, name)) })).sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
    let total = entries.reduce((sum, entry) => sum + entry.stat.size, 0);
    for (const entry of entries) if (total > this.maxBytes) { total -= entry.stat.size; rmSync(entry.path, { force: true }); }
  }
}
