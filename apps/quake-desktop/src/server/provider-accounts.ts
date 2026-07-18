/**
 * Multi-account pool per provider with automatic quota rotation.
 *
 * Active credential is always mirrored into AuthStorage (auth.json) so the
 * CLI agent runtime keeps working without upstream pool support.
 *
 * Pool file: ~/.quake-code/agent/provider-accounts.json
 * (or QUAKE_CODE_CODING_AGENT_DIR / ~/.grok/agent when set)
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { AuthStorage } from "@mrquake/quakecode-cli";
import type { WebProviderAccountSummary } from "../shared/protocol.js";

export type AccountKind = "oauth" | "api_key";

export type StoredAccountCredential =
  | { type: "api_key"; key: string }
  | ({ type: "oauth" } & Record<string, unknown>);

export type ProviderAccount = {
  label: string;
  kind: AccountKind;
  credential: StoredAccountCredential;
  exhaustedUntil?: number | null;
  lastUsedAt?: number;
  lastError?: string;
  createdAt?: number;
};

export type ProviderAccountPool = {
  activeAccountId: string;
  rotationEnabled: boolean;
  order: string[];
  accounts: Record<string, ProviderAccount>;
};

export type ProviderAccountsFile = {
  version: 1;
  providers: Record<string, ProviderAccountPool>;
};

export type RotateResult = {
  rotated: boolean;
  providerId: string;
  fromAccountId?: string;
  toAccountId?: string;
  fromLabel?: string;
  toLabel?: string;
  reason?: string;
  exhaustedUntil?: number;
};

const DEFAULT_EXHAUST_MS = 60 * 60 * 1000; // 1h rate-limit
const QUOTA_EXHAUST_MS = 6 * 60 * 60 * 1000; // 6h hard quota

function agentDir(): string {
  if (process.env.QUAKE_CODE_CODING_AGENT_DIR) return process.env.QUAKE_CODE_CODING_AGENT_DIR;
  const grok = join(homedir(), ".grok", "agent");
  if (existsSync(join(grok, "models.json")) || existsSync(join(grok, "auth.json"))) return grok;
  return join(homedir(), ".quake-code", "agent");
}

function poolPath(): string {
  return join(agentDir(), "provider-accounts.json");
}

function emptyFile(): ProviderAccountsFile {
  return { version: 1, providers: {} };
}

function loadFile(): ProviderAccountsFile {
  const path = poolPath();
  try {
    if (!existsSync(path)) return emptyFile();
    const raw = JSON.parse(readFileSync(path, "utf8")) as ProviderAccountsFile;
    if (!raw || raw.version !== 1 || typeof raw.providers !== "object") return emptyFile();
    return raw;
  } catch {
    return emptyFile();
  }
}

function saveFile(data: ProviderAccountsFile): void {
  const path = poolPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore on Windows */
  }
}

function isExhausted(account: ProviderAccount, now = Date.now()): boolean {
  return typeof account.exhaustedUntil === "number" && account.exhaustedUntil > now;
}

function oauthLabel(cred: Record<string, unknown>): string {
  if (typeof cred.email === "string" && cred.email) return cred.email;
  if (typeof cred.login === "string" && cred.login) return cred.login;
  if (typeof cred.account === "string" && cred.account) return cred.account;
  if (typeof cred.accountId === "string" && cred.accountId) return cred.accountId;
  return "OAuth hesabı";
}

function apiKeyLabel(key: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const tail = key.length > 8 ? key.slice(-4) : "****";
  return `API key ···${tail}`;
}

function ensurePoolOrder(pool: ProviderAccountPool): void {
  const ids = Object.keys(pool.accounts);
  pool.order = pool.order.filter((id) => pool.accounts[id]);
  for (const id of ids) {
    if (!pool.order.includes(id)) pool.order.push(id);
  }
  if (!pool.accounts[pool.activeAccountId] && pool.order.length) {
    pool.activeAccountId = pool.order[0];
  }
}

function getOrCreatePool(data: ProviderAccountsFile, providerId: string): ProviderAccountPool {
  let pool = data.providers[providerId];
  if (!pool) {
    pool = {
      activeAccountId: "",
      rotationEnabled: true,
      order: [],
      accounts: {},
    };
    data.providers[providerId] = pool;
  }
  if (typeof pool.rotationEnabled !== "boolean") pool.rotationEnabled = true;
  if (!pool.accounts) pool.accounts = {};
  if (!Array.isArray(pool.order)) pool.order = [];
  return pool;
}

/** Mirror active account credential into AuthStorage so agent can use it. */
export function syncActiveToAuthStorage(authStorage: AuthStorage, providerId: string): void {
  const data = loadFile();
  const pool = data.providers[providerId];
  if (!pool || !pool.activeAccountId || !pool.accounts[pool.activeAccountId]) {
    return;
  }
  const account = pool.accounts[pool.activeAccountId];
  account.lastUsedAt = Date.now();
  saveFile(data);
  const cred = account.credential;
  if (cred.type === "api_key") {
    authStorage.set(providerId, { type: "api_key", key: cred.key });
  } else if (cred.type === "oauth") {
    authStorage.set(providerId, cred as any);
  }
}

/** Import a single auth.json credential into the pool if pool is empty. */
export function seedPoolFromAuthStorage(authStorage: AuthStorage, providerId: string): ProviderAccountPool | undefined {
  const data = loadFile();
  let pool = data.providers[providerId];
  if (pool && Object.keys(pool.accounts).length > 0) {
    ensurePoolOrder(pool);
    return pool;
  }
  const stored = authStorage.get(providerId) as any;
  if (!stored) return undefined;
  if (stored.type !== "oauth" && stored.type !== "api_key") return undefined;

  const accountId = randomUUID();
  const kind: AccountKind = stored.type === "oauth" ? "oauth" : "api_key";
  const label =
    kind === "oauth" ? oauthLabel(stored) : apiKeyLabel(String(stored.key || ""));
  pool = {
    activeAccountId: accountId,
    rotationEnabled: true,
    order: [accountId],
    accounts: {
      [accountId]: {
        label,
        kind,
        credential: stored.type === "api_key" ? { type: "api_key", key: stored.key } : { ...stored, type: "oauth" },
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      },
    },
  };
  data.providers[providerId] = pool;
  saveFile(data);
  return pool;
}

export function getPool(providerId: string): ProviderAccountPool | undefined {
  const data = loadFile();
  const pool = data.providers[providerId];
  if (!pool) return undefined;
  ensurePoolOrder(pool);
  return pool;
}

export function listAccountSummaries(providerId: string, authStorage?: AuthStorage): WebProviderAccountSummary[] {
  if (authStorage) seedPoolFromAuthStorage(authStorage, providerId);
  const pool = getPool(providerId);
  if (!pool) return [];
  const now = Date.now();
  return pool.order
    .map((accountId) => {
      const a = pool.accounts[accountId];
      if (!a) return null;
      const exhausted = isExhausted(a, now);
      return {
        accountId,
        label: a.label + (exhausted ? " (kota)" : ""),
        kind: a.kind,
        isActive: accountId === pool.activeAccountId,
        exhaustedUntil: exhausted ? (a.exhaustedUntil ?? undefined) : undefined,
        accountHint: a.lastError,
      } satisfies WebProviderAccountSummary;
    })
    .filter(Boolean) as WebProviderAccountSummary[];
}

export function getPoolMeta(providerId: string, authStorage?: AuthStorage): {
  accountCount: number;
  rotationEnabled: boolean;
  activeLabel?: string;
  accounts: WebProviderAccountSummary[];
} {
  if (authStorage) seedPoolFromAuthStorage(authStorage, providerId);
  const pool = getPool(providerId);
  if (!pool) {
    return { accountCount: 0, rotationEnabled: true, accounts: [] };
  }
  const accounts = listAccountSummaries(providerId);
  const active = pool.accounts[pool.activeAccountId];
  return {
    accountCount: accounts.length,
    rotationEnabled: pool.rotationEnabled !== false,
    activeLabel: active?.label,
    accounts,
  };
}

export function addApiKeyAccount(
  authStorage: AuthStorage,
  providerId: string,
  apiKey: string,
  label?: string,
  options?: { makeActive?: boolean },
): { accountId: string; label: string } {
  const key = apiKey.trim();
  if (key.length < 8) throw new Error("Geçerli bir API key girin");

  const data = loadFile();
  seedPoolFromAuthStorage(authStorage, providerId);
  // reload after seed
  const data2 = loadFile();
  const pool = getOrCreatePool(data2, providerId);

  // Dedupe same key
  for (const [id, acc] of Object.entries(pool.accounts)) {
    if (acc.kind === "api_key" && acc.credential.type === "api_key" && acc.credential.key === key) {
      pool.activeAccountId = id;
      acc.exhaustedUntil = null;
      acc.lastError = undefined;
      acc.lastUsedAt = Date.now();
      ensurePoolOrder(pool);
      saveFile(data2);
      syncActiveToAuthStorage(authStorage, providerId);
      return { accountId: id, label: acc.label };
    }
  }

  const accountId = randomUUID();
  const accountLabel = apiKeyLabel(key, label);
  pool.accounts[accountId] = {
    label: accountLabel,
    kind: "api_key",
    credential: { type: "api_key", key },
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
  pool.order.push(accountId);
  if (options?.makeActive !== false || !pool.activeAccountId || !pool.accounts[pool.activeAccountId]) {
    pool.activeAccountId = accountId;
  }
  ensurePoolOrder(pool);
  saveFile(data2);
  syncActiveToAuthStorage(authStorage, providerId);
  return { accountId, label: accountLabel };
}

/** After OAuth login completed into AuthStorage — capture as pool account. */
export function captureOAuthFromAuthStorage(
  authStorage: AuthStorage,
  providerId: string,
  options?: { makeActive?: boolean; replaceActive?: boolean },
): { accountId: string; label: string } | undefined {
  const stored = authStorage.get(providerId) as any;
  if (!stored || stored.type !== "oauth") return undefined;

  const data = loadFile();
  // If pool empty, seed first; if login replaced auth.json, we need to add as NEW account
  const pool = getOrCreatePool(data, providerId);
  const label = oauthLabel(stored);

  // Match existing by email/login/refresh token
  const refresh = typeof stored.refresh === "string" ? stored.refresh : undefined;
  const email = typeof stored.email === "string" ? stored.email : undefined;
  for (const [id, acc] of Object.entries(pool.accounts)) {
    if (acc.kind !== "oauth" || acc.credential.type !== "oauth") continue;
    const c = acc.credential as Record<string, unknown>;
    if (refresh && c.refresh === refresh) {
      pool.accounts[id] = {
        ...acc,
        label,
        credential: { ...stored, type: "oauth" },
        exhaustedUntil: null,
        lastError: undefined,
        lastUsedAt: Date.now(),
      };
      if (options?.makeActive !== false) pool.activeAccountId = id;
      ensurePoolOrder(pool);
      saveFile(data);
      syncActiveToAuthStorage(authStorage, providerId);
      return { accountId: id, label };
    }
    if (email && c.email === email) {
      pool.accounts[id] = {
        ...acc,
        label,
        credential: { ...stored, type: "oauth" },
        exhaustedUntil: null,
        lastError: undefined,
        lastUsedAt: Date.now(),
      };
      if (options?.makeActive !== false) pool.activeAccountId = id;
      ensurePoolOrder(pool);
      saveFile(data);
      syncActiveToAuthStorage(authStorage, providerId);
      return { accountId: id, label };
    }
  }

  const accountId = randomUUID();
  pool.accounts[accountId] = {
    label,
    kind: "oauth",
    credential: { ...stored, type: "oauth" },
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
  pool.order.push(accountId);
  if (options?.makeActive !== false || !pool.accounts[pool.activeAccountId]) {
    pool.activeAccountId = accountId;
  }
  ensurePoolOrder(pool);
  saveFile(data);
  syncActiveToAuthStorage(authStorage, providerId);
  return { accountId, label };
}

export function setActiveAccount(
  authStorage: AuthStorage,
  providerId: string,
  accountId: string,
): void {
  const data = loadFile();
  const pool = data.providers[providerId];
  if (!pool?.accounts[accountId]) throw new Error("Hesap bulunamadı");
  pool.activeAccountId = accountId;
  pool.accounts[accountId].exhaustedUntil = null;
  pool.accounts[accountId].lastError = undefined;
  pool.accounts[accountId].lastUsedAt = Date.now();
  ensurePoolOrder(pool);
  saveFile(data);
  syncActiveToAuthStorage(authStorage, providerId);
}

export function removeAccount(
  authStorage: AuthStorage,
  providerId: string,
  accountId: string,
): { remaining: number } {
  const data = loadFile();
  const pool = data.providers[providerId];
  if (!pool?.accounts[accountId]) throw new Error("Hesap bulunamadı");
  delete pool.accounts[accountId];
  pool.order = pool.order.filter((id) => id !== accountId);
  if (pool.activeAccountId === accountId) {
    const next = pool.order.find((id) => pool.accounts[id] && !isExhausted(pool.accounts[id]));
    pool.activeAccountId = next || pool.order[0] || "";
  }
  ensurePoolOrder(pool);
  const remaining = Object.keys(pool.accounts).length;
  if (remaining === 0) {
    delete data.providers[providerId];
    saveFile(data);
    authStorage.logout(providerId);
  } else {
    saveFile(data);
    syncActiveToAuthStorage(authStorage, providerId);
  }
  return { remaining };
}

export function setRotationEnabled(providerId: string, enabled: boolean): void {
  const data = loadFile();
  const pool = getOrCreatePool(data, providerId);
  pool.rotationEnabled = enabled;
  saveFile(data);
}

export function reorderAccounts(providerId: string, order: string[]): void {
  const data = loadFile();
  const pool = data.providers[providerId];
  if (!pool) throw new Error("Hesap havuzu yok");
  const valid = order.filter((id) => pool.accounts[id]);
  for (const id of Object.keys(pool.accounts)) {
    if (!valid.includes(id)) valid.push(id);
  }
  pool.order = valid;
  saveFile(data);
}

export function clearProviderAccounts(authStorage: AuthStorage, providerId: string): void {
  const data = loadFile();
  delete data.providers[providerId];
  saveFile(data);
  authStorage.logout(providerId);
}

export function isQuotaOrRateLimitError(message: string): boolean {
  // Note: do NOT match generic 500/timeout — those should not burn a backup account.
  return /rate.?limit|quota|too many requests|\b429\b|resource.?exhausted|usage.?limit|limit exceeded|insufficient.?quota|tokens? per|\btpm\b|\brpm\b|overloaded|exceeded your (current )?quota|billing soft limit/i.test(
    message || "",
  );
}

function exhaustDurationMs(message: string): number {
  if (/quota|billing|insufficient|exceeded.*limit|usage.?limit/i.test(message)) return QUOTA_EXHAUST_MS;
  return DEFAULT_EXHAUST_MS;
}

/**
 * Mark active account exhausted and switch to next available.
 * Returns whether a rotation happened.
 */
export function rotateOnQuotaError(
  authStorage: AuthStorage,
  providerId: string,
  errorMessage: string,
): RotateResult {
  if (!isQuotaOrRateLimitError(errorMessage)) {
    return { rotated: false, providerId, reason: "not_quota" };
  }

  seedPoolFromAuthStorage(authStorage, providerId);
  const data = loadFile();
  const pool = data.providers[providerId];
  if (!pool || Object.keys(pool.accounts).length < 2) {
    return { rotated: false, providerId, reason: "no_backup_accounts" };
  }
  if (pool.rotationEnabled === false) {
    return { rotated: false, providerId, reason: "rotation_disabled" };
  }

  const fromId = pool.activeAccountId;
  const fromAcc = pool.accounts[fromId];
  const now = Date.now();
  const until = now + exhaustDurationMs(errorMessage);

  if (fromAcc) {
    fromAcc.exhaustedUntil = until;
    fromAcc.lastError = errorMessage.slice(0, 240);
  }

  const order = pool.order.length ? pool.order : Object.keys(pool.accounts);
  const start = Math.max(0, order.indexOf(fromId));
  let toId: string | undefined;
  for (let i = 1; i <= order.length; i++) {
    const cand = order[(start + i) % order.length];
    if (!cand || cand === fromId) continue;
    const acc = pool.accounts[cand];
    if (acc && !isExhausted(acc, now)) {
      toId = cand;
      break;
    }
  }
  // Also try any non-exhausted not in order
  if (!toId) {
    for (const [id, acc] of Object.entries(pool.accounts)) {
      if (id === fromId) continue;
      if (!isExhausted(acc, now)) {
        toId = id;
        break;
      }
    }
  }

  if (!toId) {
    saveFile(data);
    return {
      rotated: false,
      providerId,
      fromAccountId: fromId,
      fromLabel: fromAcc?.label,
      reason: "all_exhausted",
      exhaustedUntil: until,
    };
  }

  pool.activeAccountId = toId;
  const toAcc = pool.accounts[toId];
  toAcc.lastUsedAt = now;
  ensurePoolOrder(pool);
  saveFile(data);
  syncActiveToAuthStorage(authStorage, providerId);

  return {
    rotated: true,
    providerId,
    fromAccountId: fromId,
    toAccountId: toId,
    fromLabel: fromAcc?.label,
    toLabel: toAcc.label,
    reason: errorMessage.slice(0, 120),
    exhaustedUntil: until,
  };
}

/** Clear exhausted flags that have passed. */
export function clearExpiredExhaustion(providerId?: string): void {
  const data = loadFile();
  const now = Date.now();
  let dirty = false;
  const ids = providerId ? [providerId] : Object.keys(data.providers);
  for (const pid of ids) {
    const pool = data.providers[pid];
    if (!pool) continue;
    for (const acc of Object.values(pool.accounts)) {
      if (typeof acc.exhaustedUntil === "number" && acc.exhaustedUntil <= now) {
        acc.exhaustedUntil = null;
        acc.lastError = undefined;
        dirty = true;
      }
    }
  }
  if (dirty) saveFile(data);
}
