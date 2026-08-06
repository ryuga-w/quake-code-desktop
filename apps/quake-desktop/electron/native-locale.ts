import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The renderer owns the language preference; this is the small native mirror
 * used by Electron-owned UI between renderer loads and after app relaunches.
 */
export type NativeLocale = "tr" | "en";

type NativeLocalePreferences = {
  locale?: NativeLocale;
};

let cachedLocale: NativeLocale | undefined;

function normalizeLocale(value: unknown): NativeLocale | undefined {
  return value === "tr" || value === "en" ? value : undefined;
}

function preferencesPath(): string {
  return path.join(app.getPath("userData"), "native-locale.json");
}

function loadLocale(): NativeLocale {
  try {
    const raw = readFileSync(preferencesPath(), "utf8");
    const parsed = JSON.parse(raw) as NativeLocalePreferences;
    return normalizeLocale(parsed?.locale) || "tr";
  } catch {
    // Match the renderer's automatic-language behavior until it reports a
    // resolved preference on first paint.
    try {
      return app.getLocale().toLowerCase().startsWith("tr") ? "tr" : "en";
    } catch {
      return "tr";
    }
  }
}

export function getNativeLocale(): NativeLocale {
  if (!cachedLocale) cachedLocale = loadLocale();
  return cachedLocale;
}

/** Persist only validated renderer-resolved locales; never expose filesystem access to the renderer. */
export function setNativeLocale(value: unknown): NativeLocale {
  const locale = normalizeLocale(value);
  if (!locale) return getNativeLocale();

  cachedLocale = locale;
  try {
    const file = preferencesPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ locale }, null, 2), "utf8");
  } catch (error) {
    // The in-process value still keeps this session's native UI in sync if
    // userData is temporarily unavailable or read-only.
    console.warn("[locale] failed to persist native locale", error);
  }
  return locale;
}
