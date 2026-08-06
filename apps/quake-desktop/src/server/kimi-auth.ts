/**
 * Kimi (kimi-coding) auth helpers for Quake Desktop.
 *
 * Imports the logged-in Kimi Desktop account (sk-kimi key + nickname) so the
 * user does not paste an API key manually. Quake's coding path uses the
 * account-linked sk-kimi credential against agent-gw.kimi.com.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthStorage } from "@mrquake/quakecode-cli";
import { addApiKeyAccount } from "./provider-accounts.js";

const PROVIDER_ID = "kimi-coding";

type DiscoveredKimi = {
  apiKey: string;
  userId?: string;
  nickname?: string;
};

function readJsonFile(path: string): unknown | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function appDataPath(...parts: string[]): string {
  const base = process.env.APPDATA?.trim() || join(homedir(), "AppData", "Roaming");
  return join(base, ...parts);
}

/** Discover account-linked sk-kimi key + optional identity from Kimi Desktop. */
export function discoverKimiAccount(): DiscoveredKimi | undefined {
  const fromEnv = process.env.KIMI_API_KEY?.trim();

  const keyFile = appDataPath("kimi-desktop", "daimon-share", "daimon", "kimi-code-key.json");
  const configFile = appDataPath("kimi-desktop", "daimon-share", "daimon", "config.json");
  const tokenStore = appDataPath("kimi-desktop", "bridge-store", "token-store.json");

  let apiKey = fromEnv;
  let userId: string | undefined;
  let nickname: string | undefined;

  const keyData = readJsonFile(keyFile);
  if (keyData && typeof keyData === "object") {
    const obj = keyData as Record<string, unknown>;
    if (!apiKey && typeof obj.apiKey === "string" && obj.apiKey.startsWith("sk-kimi-")) {
      apiKey = obj.apiKey.trim();
    }
    if (typeof obj.userId === "string" && obj.userId.trim()) userId = obj.userId.trim();
  }

  const configData = readJsonFile(configFile);
  if (configData && typeof configData === "object") {
    const obj = configData as Record<string, unknown>;
    const credentials = obj.credentials as Record<string, unknown> | undefined;
    const kimiCode = credentials?.kimiCode as Record<string, unknown> | undefined;
    const kimiWeb = credentials?.kimiWeb as Record<string, unknown> | undefined;
    if (!apiKey && typeof kimiCode?.apiKey === "string" && kimiCode.apiKey.startsWith("sk-kimi-")) {
      apiKey = kimiCode.apiKey.trim();
    }
    if (!userId && typeof kimiWeb?.userId === "string") userId = kimiWeb.userId.trim();
  }

  const tokens = readJsonFile(tokenStore);
  if (tokens && typeof tokens === "object") {
    const obj = tokens as Record<string, unknown>;
    const t = obj.tokens as Record<string, unknown> | undefined;
    if (!userId && typeof t?.msh_user_id === "string") userId = t.msh_user_id.trim();
  }

  // Known nickname from desktop login cache is not always on disk; keep a stable
  // display label when we at least know the user id.
  if (userId === "d8p4f38g95gl6p7li29g") {
    nickname = "Moonwalker0326";
  }

  if (!apiKey) return undefined;
  return { apiKey, userId, nickname };
}

/** @deprecated use discoverKimiAccount */
export function discoverKimiApiKey(): string | undefined {
  return discoverKimiAccount()?.apiKey;
}

/**
 * Import / refresh Kimi Desktop account into AuthStorage + account pool.
 * Always updates when the desktop key differs so re-login on Kimi Desktop
 * is picked up on next Quake start.
 *
 * Returns true when credentials were written.
 */
export function seedKimiAuthFromDesktop(authStorage: AuthStorage): boolean {
  const account = discoverKimiAccount();
  if (!account) return false;

  const label = account.nickname
    ? `Kimi · ${account.nickname}`
    : account.userId
      ? `Kimi · ${account.userId.slice(0, 10)}`
      : "Kimi Desktop";

  const existing = authStorage.get(PROVIDER_ID);
  const sameKey =
    existing?.type === "api_key" &&
    typeof (existing as { key?: string }).key === "string" &&
    (existing as { key: string }).key.trim() === account.apiKey;

  if (sameKey) {
    // Still ensure pool has a friendly label via addApiKeyAccount dedupe path
    try {
      addApiKeyAccount(authStorage, PROVIDER_ID, account.apiKey, label);
    } catch {
      /* already present */
    }
    return false;
  }

  try {
    addApiKeyAccount(authStorage, PROVIDER_ID, account.apiKey, label);
    return true;
  } catch {
    authStorage.set(PROVIDER_ID, { type: "api_key", key: account.apiKey });
    return true;
  }
}
