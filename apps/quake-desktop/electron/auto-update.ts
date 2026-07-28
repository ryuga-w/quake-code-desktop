/**
 * S-PUB.2 — optional auto-update scaffold (electron-updater).
 *
 * Safe defaults:
 * - No feed → no check, no throw, app boots normally.
 * - Check only when QUAKE_AUTO_UPDATE=1 or user enabled the settings flag,
 *   and a feed is configured (env, userData prefs, or packaged app-update.yml).
 * - Errors are logged only; never crash the main process.
 */

import { app, ipcMain } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type FeedSource = "env" | "prefs" | "embedded" | "none";

export type UpdaterStatus = {
  /** True when a generic URL or packaged app-update.yml is available. */
  feedConfigured: boolean;
  /** User preference (userData/auto-update.json). */
  enabled: boolean;
  /** Forced on via QUAKE_AUTO_UPDATE=1. */
  envForced: boolean;
  /** Would run a check on boot with current config. */
  willCheck: boolean;
  currentVersion: string;
  lastCheckAt?: string;
  lastError?: string;
  updateAvailable?: boolean;
  updateVersion?: string;
  /**
   * Effective feed (env wins over prefs over embedded).
   * Empty when none. For UI display prefer `feedUrlMasked`.
   */
  updateFeedUrl?: string;
  /** Masked form of the effective feed for Settings display. */
  feedUrlMasked?: string;
  /** Feed stored in userData prefs (editable in Settings; may differ from env). */
  prefsFeedUrl?: string;
  /** Where the effective feed comes from. */
  feedSource: FeedSource;
  /** Short Turkish status for Settings UI. */
  statusMessage: string;
};

type Prefs = {
  enabled: boolean;
  /** User-pasted generic update feed base URL (optional). */
  updateFeedUrl?: string;
};

type RuntimeState = {
  lastCheckAt?: string;
  lastError?: string;
  updateAvailable?: boolean;
  updateVersion?: string;
  checking: boolean;
};

const runtime: RuntimeState = { checking: false };

function prefsPath(): string {
  return path.join(app.getPath("userData"), "auto-update.json");
}

function loadPrefs(): Prefs {
  try {
    const raw = readFileSync(prefsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const updateFeedUrl =
      typeof parsed?.updateFeedUrl === "string" ? parsed.updateFeedUrl.trim() : undefined;
    return {
      enabled: Boolean(parsed?.enabled),
      ...(updateFeedUrl ? { updateFeedUrl } : {}),
    };
  } catch {
    return { enabled: false };
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    const payload: Prefs = {
      enabled: Boolean(prefs.enabled),
    };
    const feed = typeof prefs.updateFeedUrl === "string" ? prefs.updateFeedUrl.trim() : "";
    if (feed) payload.updateFeedUrl = feed;
    writeFileSync(prefsPath(), JSON.stringify(payload, null, 2), "utf8");
  } catch (err) {
    console.warn("[auto-update] failed to save prefs", err);
  }
}

function envForced(): boolean {
  const v = String(process.env.QUAKE_AUTO_UPDATE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Mask a feed URL for Settings UI (host kept, path truncated). */
export function maskFeedUrl(url: string): string {
  if (!url) return "";
  if (url === "embedded") return "(paket içi app-update.yml)";
  try {
    const u = new URL(url);
    const pathPart = u.pathname === "/" ? "" : u.pathname;
    if (!pathPart || pathPart.length <= 6) {
      return `${u.origin}${pathPart}${u.search ? "?**" : ""}`;
    }
    return `${u.origin}${pathPart.slice(0, 6)}…***`;
  } catch {
    if (url.length <= 20) return url;
    return `${url.slice(0, 14)}…***`;
  }
}

/**
 * Normalize and validate a user-supplied generic feed URL.
 * Returns cleaned URL or undefined if empty; throws on invalid scheme.
 */
export function normalizeFeedUrl(raw: unknown): string | undefined {
  const value = String(raw ?? "").trim();
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Geçersiz feed URL. https://… biçiminde olmalı.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Feed URL yalnızca http(s) olabilir.");
  }
  // Strip trailing slash for stable generic provider base.
  return value.replace(/\/+$/, "");
}

/**
 * Resolve update feed.
 * Priority:
 * 1. Runtime override: QUAKE_UPDATE_FEED_URL (generic provider base URL)
 * 2. User prefs: userData/auto-update.json → updateFeedUrl
 * 3. Packaged: electron-builder resources/app-update.yml when `publish` was set
 */
export function resolveFeedUrl(): string | undefined {
  return resolveFeed().url;
}

export function resolveFeed(): { url?: string; source: FeedSource } {
  const fromEnv = String(process.env.QUAKE_UPDATE_FEED_URL || "").trim();
  if (fromEnv) return { url: fromEnv.replace(/\/+$/, ""), source: "env" };

  const prefs = loadPrefs();
  if (prefs.updateFeedUrl) {
    return { url: prefs.updateFeedUrl.replace(/\/+$/, ""), source: "prefs" };
  }

  if (app.isPackaged) {
    const yml = path.join(process.resourcesPath || "", "app-update.yml");
    if (existsSync(yml)) return { url: "embedded", source: "embedded" };
  }
  return { source: "none" };
}

export function isFeedConfigured(): boolean {
  return Boolean(resolveFeedUrl());
}

function buildStatusMessage(
  status: Omit<UpdaterStatus, "statusMessage">,
  checking: boolean,
): string {
  if (!status.feedConfigured) {
    return "Güncelleme kanalı yapılandırılmadı. Feed URL kaydedin veya QUAKE_UPDATE_FEED_URL ayarlayın.";
  }
  if (status.lastError) {
    return `Son hata: ${status.lastError}`;
  }
  if (status.updateAvailable && status.updateVersion) {
    return `Yeni sürüm mevcut: ${status.updateVersion}`;
  }
  if (checking) {
    return "Güncelleme kontrol ediliyor…";
  }
  if (status.envForced) {
    return "Etkin (QUAKE_AUTO_UPDATE=1).";
  }
  if (status.enabled) {
    return status.lastCheckAt
      ? `Etkin. Son kontrol: ${status.lastCheckAt}`
      : "Etkin. İlk kontrol için yeniden başlatın veya “Kontrol et”e basın.";
  }
  return "Kanal hazır. Otomatik güncellemeyi açabilirsiniz.";
}

export function getUpdaterStatus(): UpdaterStatus {
  const prefs = loadPrefs();
  const feed = resolveFeed();
  const feedConfigured = Boolean(feed.url);
  const forced = envForced();
  const enabled = prefs.enabled;
  const willCheck = feedConfigured && (forced || enabled);
  const base: Omit<UpdaterStatus, "statusMessage"> = {
    feedConfigured,
    enabled,
    envForced: forced,
    willCheck,
    currentVersion: app.getVersion(),
    lastCheckAt: runtime.lastCheckAt,
    lastError: runtime.lastError,
    updateAvailable: runtime.updateAvailable,
    updateVersion: runtime.updateVersion,
    updateFeedUrl: feed.url && feed.url !== "embedded" ? feed.url : undefined,
    feedUrlMasked: feed.url ? maskFeedUrl(feed.url) : undefined,
    prefsFeedUrl: prefs.updateFeedUrl,
    feedSource: feed.source,
  };
  return {
    ...base,
    statusMessage: buildStatusMessage(base, runtime.checking),
  };
}

function setEnabled(enabled: boolean): UpdaterStatus {
  const prefs = loadPrefs();
  savePrefs({ ...prefs, enabled: Boolean(enabled) });
  return getUpdaterStatus();
}

/**
 * Persist user feed URL to userData prefs (clears when empty).
 * Env QUAKE_UPDATE_FEED_URL still takes priority at resolve time.
 */
function setUpdateFeedUrl(raw: unknown): UpdaterStatus {
  const prefs = loadPrefs();
  try {
    const normalized = normalizeFeedUrl(raw);
    if (normalized) {
      savePrefs({ ...prefs, updateFeedUrl: normalized });
      runtime.lastError = undefined;
    } else {
      // Clear stored feed
      const next: Prefs = { enabled: prefs.enabled };
      savePrefs(next);
    }
  } catch (err) {
    runtime.lastError = String((err as Error)?.message || err);
    // Still return status so UI can show the error message
    const status = getUpdaterStatus();
    return {
      ...status,
      lastError: runtime.lastError,
      statusMessage: `Son hata: ${runtime.lastError}`,
    };
  }
  return getUpdaterStatus();
}

async function runCheck(reason: string): Promise<UpdaterStatus> {
  const feed = resolveFeedUrl();
  if (!feed) {
    runtime.lastError = undefined;
    return getUpdaterStatus();
  }

  runtime.checking = true;
  runtime.lastError = undefined;

  try {
    // Lazy require so missing/optional resolution never breaks boot import graph.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    if (feed !== "embedded") {
      autoUpdater.setFeedURL({ provider: "generic", url: feed });
    }

    // Avoid duplicate listeners if check is invoked more than once.
    autoUpdater.removeAllListeners("error");
    autoUpdater.removeAllListeners("update-available");
    autoUpdater.removeAllListeners("update-not-available");

    autoUpdater.on("error", (err: Error) => {
      runtime.lastError = String(err?.message || err);
      console.warn(`[auto-update] error (${reason}):`, runtime.lastError);
    });
    autoUpdater.on("update-available", (info: { version?: string }) => {
      runtime.updateAvailable = true;
      runtime.updateVersion = info?.version;
      console.log(`[auto-update] update available: ${info?.version || "?"}`);
    });
    autoUpdater.on("update-not-available", () => {
      runtime.updateAvailable = false;
      runtime.updateVersion = undefined;
      console.log("[auto-update] no update available");
    });

    const result = await autoUpdater.checkForUpdates();
    runtime.lastCheckAt = new Date().toISOString();
    if (result?.updateInfo?.version) {
      // Presence of result does not always mean newer; listeners handle semantics.
      runtime.updateVersion = result.updateInfo.version;
    }
    console.log(`[auto-update] check finished (${reason})`);
  } catch (err) {
    runtime.lastError = String((err as Error)?.message || err);
    console.warn(`[auto-update] check failed (${reason}, non-fatal):`, runtime.lastError);
  } finally {
    runtime.checking = false;
  }

  return getUpdaterStatus();
}

/**
 * Register IPC for Settings UI. Safe to call once during boot.
 */
export function registerAutoUpdateIpc(): void {
  ipcMain.handle("updater:getStatus", () => getUpdaterStatus());
  ipcMain.handle("updater:setEnabled", (_event, enabled: boolean) => setEnabled(Boolean(enabled)));
  ipcMain.handle("updater:setFeedUrl", (_event, url: unknown) => setUpdateFeedUrl(url));
  ipcMain.handle("updater:check", async () => {
    const status = getUpdaterStatus();
    if (!status.feedConfigured) return status;
    return runCheck("manual");
  });
}

/**
 * Optional boot-time check. Never throws.
 */
export function maybeStartAutoUpdater(): void {
  try {
    const status = getUpdaterStatus();
    if (!status.feedConfigured) {
      console.log("[auto-update] feed not configured; skipping (unsigned/local package OK)");
      return;
    }
    if (!status.willCheck) {
      console.log(
        "[auto-update] feed ready but disabled (enable in Settings or set QUAKE_AUTO_UPDATE=1)",
      );
      return;
    }
    // Fire-and-forget; failures stay inside runCheck.
    void runCheck("boot");
  } catch (err) {
    console.warn("[auto-update] maybeStartAutoUpdater failed (non-fatal)", err);
  }
}
