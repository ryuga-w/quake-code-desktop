import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface ConversationMetadata {
  version: 1;
  archivedSessionPaths: string[];
  pinnedSessionPaths: string[];
  sessionAliases: Record<string, string>;
}

const EMPTY_METADATA: ConversationMetadata = {
  version: 1,
  archivedSessionPaths: [],
  pinnedSessionPaths: [],
  sessionAliases: {},
};

export function normalizeSessionMetadataPath(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = resolve(text).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function normalizePathList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeSessionMetadataPath).filter(Boolean))];
}

function normalizeAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [path, alias] of Object.entries(value)) {
    const key = normalizeSessionMetadataPath(path);
    const text = typeof alias === "string" ? alias.trim().slice(0, 160) : "";
    if (key && text) result[key] = text;
  }
  return result;
}

export class ConversationMetadataService {
  private readonly path: string;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(path = join(homedir(), ".quake-code", "desktop", "conversation-metadata.json")) {
    this.path = path;
  }

  async read(): Promise<ConversationMetadata> {
    await this.pendingWrite.catch(() => {});
    return this.readCurrent();
  }

  private async readCurrent(): Promise<ConversationMetadata> {
    if (!existsSync(this.path)) return { ...EMPTY_METADATA };
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8"));
      return {
        version: 1,
        archivedSessionPaths: normalizePathList(parsed?.archivedSessionPaths),
        pinnedSessionPaths: normalizePathList(parsed?.pinnedSessionPaths),
        sessionAliases: normalizeAliases(parsed?.sessionAliases),
      };
    } catch {
      return { ...EMPTY_METADATA };
    }
  }

  async patch(patch: Partial<ConversationMetadata>): Promise<ConversationMetadata> {
    const run = async () => {
      const current = await this.readCurrent();
      const next: ConversationMetadata = {
        version: 1,
        archivedSessionPaths: patch.archivedSessionPaths === undefined
          ? current.archivedSessionPaths
          : normalizePathList(patch.archivedSessionPaths),
        pinnedSessionPaths: patch.pinnedSessionPaths === undefined
          ? current.pinnedSessionPaths
          : normalizePathList(patch.pinnedSessionPaths),
        sessionAliases: patch.sessionAliases === undefined
          ? current.sessionAliases
          : normalizeAliases(patch.sessionAliases),
      };
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      await rm(this.path, { force: true });
      await rename(temporary, this.path);
      return next;
    };
    const result = this.pendingWrite.then(run, run);
    this.pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }
}
