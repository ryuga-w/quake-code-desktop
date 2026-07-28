import { readStorageValue, writeStorageValue } from "../../lib/storage";

/** localStorage keys for settings that live outside main.tsx theme/density. */
export const SETTINGS_KEYS = {
  workMode: "quake-web:workMode",
  defaultPermissions: "quake-web:defaultPermissions",
  autoReview: "quake-web:autoReview",
  fullAccess: "quake-web:fullAccess",
  verboseChat: "quake-web:verboseChat",
  /** S-TRUST.3 first-run trust onboarding dismissed. */
  trustOnboardingSeen: "quake-web:trustOnboardingSeen",
} as const;

export type WorkMode = "coding" | "daily";

function readBool(key: string, fallback: boolean): boolean {
  const raw = readStorageValue(key);
  if (raw === "") return fallback;
  return raw === "1" || raw === "true";
}

function writeBool(key: string, value: boolean): void {
  writeStorageValue(key, value ? "1" : "0");
}

export function loadWorkMode(fallback: WorkMode = "coding"): WorkMode {
  const raw = readStorageValue(SETTINGS_KEYS.workMode, fallback);
  return raw === "daily" ? "daily" : "coding";
}

export function saveWorkMode(value: WorkMode): void {
  writeStorageValue(SETTINGS_KEYS.workMode, value);
}

export function loadDefaultPermissions(fallback = true): boolean {
  return readBool(SETTINGS_KEYS.defaultPermissions, fallback);
}

export function saveDefaultPermissions(value: boolean): void {
  writeBool(SETTINGS_KEYS.defaultPermissions, value);
}

export function loadAutoReview(fallback = true): boolean {
  return readBool(SETTINGS_KEYS.autoReview, fallback);
}

export function saveAutoReview(value: boolean): void {
  writeBool(SETTINGS_KEYS.autoReview, value);
}

export function loadFullAccess(fallback = false): boolean {
  return readBool(SETTINGS_KEYS.fullAccess, fallback);
}

export function saveFullAccess(value: boolean): void {
  writeBool(SETTINGS_KEYS.fullAccess, value);
}

export function loadVerboseChat(fallback = true): boolean {
  return readBool(SETTINGS_KEYS.verboseChat, fallback);
}

export function saveVerboseChat(value: boolean): void {
  writeBool(SETTINGS_KEYS.verboseChat, value);
}

/** S-TRUST.3 — whether the first-run trust modal was dismissed. */
export function loadTrustOnboardingSeen(fallback = false): boolean {
  return readBool(SETTINGS_KEYS.trustOnboardingSeen, fallback);
}

export function saveTrustOnboardingSeen(value: boolean): void {
  writeBool(SETTINGS_KEYS.trustOnboardingSeen, value);
}
