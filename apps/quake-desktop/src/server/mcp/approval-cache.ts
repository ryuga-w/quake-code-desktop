/**
 * MCP tool approval cache.
 *
 * - sessionAllows: process-memory only (cleared on new session / clearSession)
 * - alwaysAllows: durable under ~/.quake-code/desktop/mcp-always-allows.json
 *   Keys: `${serverId}::${toolName}`
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type McpAlwaysAllowEntry = {
  key: string;
  serverId: string;
  toolName: string;
};

const sessionAllows = new Set<string>();
const alwaysAllows = new Set<string>();

/** Default durable path; overridable for tests via configureMcpAlwaysAllowStore. */
let storePath = join(homedir(), ".quake-code", "desktop", "mcp-always-allows.json");
/** When false, remember/clear/remove only touch memory (safe for pure unit tests). */
let persistEnabled = false;
let pendingWrite: Promise<void> = Promise.resolve();

export function mcpApprovalKey(serverId: string, toolName: string): string {
  return `${serverId}::${toolName}`;
}

export function parseMcpApprovalKey(key: string): { serverId: string; toolName: string } | null {
  const sep = key.indexOf("::");
  if (sep <= 0 || sep >= key.length - 2) return null;
  const serverId = key.slice(0, sep).trim();
  const toolName = key.slice(sep + 2).trim();
  if (!serverId || !toolName) return null;
  return { serverId, toolName };
}

export function isMcpToolApproved(serverId: string, toolName: string): boolean {
  const key = mcpApprovalKey(serverId, toolName);
  return alwaysAllows.has(key) || sessionAllows.has(key);
}

/**
 * Configure durable store path. Resets memory always-allows when `resetMemory` is true.
 * Does not enable persistence until loadDurableMcpAlwaysAllows() is called.
 */
export function configureMcpAlwaysAllowStore(options: {
  path: string;
  resetMemory?: boolean;
}): void {
  storePath = options.path;
  persistEnabled = false;
  if (options.resetMemory !== false) {
    alwaysAllows.clear();
    sessionAllows.clear();
  }
}

/** Absolute path of the durable always-allow store (for diagnostics / tests). */
export function getMcpAlwaysAllowStorePath(): string {
  return storePath;
}

/**
 * Load durable always-allows from disk into memory and enable write-through.
 * Safe to call more than once; replaces in-memory always set from file.
 */
export async function loadDurableMcpAlwaysAllows(path?: string): Promise<string[]> {
  if (path) storePath = path;
  await pendingWrite.catch(() => {});
  const keys = await readAlwaysAllowKeysFromDisk(storePath);
  alwaysAllows.clear();
  for (const key of keys) alwaysAllows.add(key);
  persistEnabled = true;
  return [...alwaysAllows];
}

export function listMcpAlwaysAllows(): McpAlwaysAllowEntry[] {
  const entries: McpAlwaysAllowEntry[] = [];
  for (const key of alwaysAllows) {
    const parsed = parseMcpApprovalKey(key);
    if (!parsed) continue;
    entries.push({ key, serverId: parsed.serverId, toolName: parsed.toolName });
  }
  entries.sort((a, b) => a.key.localeCompare(b.key, "en"));
  return entries;
}

export function rememberMcpToolApproval(
  serverId: string,
  toolName: string,
  scope: "session" | "always",
): void {
  const key = mcpApprovalKey(serverId, toolName);
  if (scope === "always") {
    alwaysAllows.add(key);
    schedulePersist();
  } else {
    sessionAllows.add(key);
  }
}

/** Remove one durable always-allow (memory + disk). Returns whether it existed. */
export function removeMcpAlwaysAllow(serverId: string, toolName: string): boolean {
  const key = mcpApprovalKey(serverId, toolName);
  const existed = alwaysAllows.delete(key);
  if (existed) schedulePersist();
  return existed;
}

/** Remove by full key (`serverId::toolName`). */
export function removeMcpAlwaysAllowKey(key: string): boolean {
  const parsed = parseMcpApprovalKey(key);
  if (!parsed) return false;
  return removeMcpAlwaysAllow(parsed.serverId, parsed.toolName);
}

export function clearMcpSessionApprovals(): void {
  sessionAllows.clear();
}

/** Clear only durable always-allows (memory + disk when persistence enabled). */
export function clearMcpAlwaysAllows(): void {
  if (alwaysAllows.size === 0) {
    if (persistEnabled) schedulePersist();
    return;
  }
  alwaysAllows.clear();
  schedulePersist();
}

/**
 * Clear session + always memory. When persistence is enabled, also empties the durable file.
 * Existing unit tests that never call loadDurableMcpAlwaysAllows stay memory-only.
 */
export function clearAllMcpApprovals(): void {
  sessionAllows.clear();
  alwaysAllows.clear();
  if (persistEnabled) schedulePersist();
}

/** Await queued disk writes (tests / shutdown). */
export async function flushMcpAlwaysAllowWrites(): Promise<void> {
  await pendingWrite.catch(() => {});
}

function schedulePersist(): void {
  if (!persistEnabled) return;
  const snapshot = [...alwaysAllows].sort((a, b) => a.localeCompare(b, "en"));
  const path = storePath;
  const run = async () => {
    await writeAlwaysAllowKeysToDisk(path, snapshot);
  };
  pendingWrite = pendingWrite.then(run, run).then(
    () => undefined,
    () => undefined,
  );
}

async function readAlwaysAllowKeysFromDisk(path: string): Promise<string[]> {
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    return normalizeAlwaysAllowKeys(raw);
  } catch {
    return [];
  }
}

function normalizeAlwaysAllowKeys(raw: unknown): string[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { keys?: unknown }).keys)
      ? (raw as { keys: unknown[] }).keys
      : [];
  const keys = new Set<string>();
  for (const item of list) {
    if (typeof item === "string") {
      const parsed = parseMcpApprovalKey(item);
      if (parsed) keys.add(mcpApprovalKey(parsed.serverId, parsed.toolName));
      continue;
    }
    if (item && typeof item === "object") {
      const record = item as { serverId?: unknown; toolName?: unknown; key?: unknown };
      if (typeof record.key === "string") {
        const parsed = parseMcpApprovalKey(record.key);
        if (parsed) keys.add(mcpApprovalKey(parsed.serverId, parsed.toolName));
        continue;
      }
      if (typeof record.serverId === "string" && typeof record.toolName === "string") {
        const serverId = record.serverId.trim();
        const toolName = record.toolName.trim();
        if (serverId && toolName) keys.add(mcpApprovalKey(serverId, toolName));
      }
    }
  }
  return [...keys];
}

async function writeAlwaysAllowKeysToDisk(path: string, keys: string[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload = {
    version: 1 as const,
    keys,
    updatedAt: new Date().toISOString(),
  };
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rm(path, { force: true });
  await rename(tempPath, path);
}
