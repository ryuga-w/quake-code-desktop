import { readStorageJson } from "./storage";

export const GENERAL_PREFERENCES_STORAGE_KEY = "quake-web:generalPreferences";
export const GENERAL_PREFERENCES_CHANGED_EVENT = "quake:general-preferences-change";

type GeneralPreferencesSnapshot = {
  showContextUsage?: unknown;
  [key: string]: unknown;
};

export function loadShowContextUsagePreference(): boolean {
  const preferences = readStorageJson<GeneralPreferencesSnapshot>(GENERAL_PREFERENCES_STORAGE_KEY, {});
  return typeof preferences.showContextUsage === "boolean" ? preferences.showContextUsage : true;
}

export function emitGeneralPreferencesChanged(preferences: GeneralPreferencesSnapshot): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GENERAL_PREFERENCES_CHANGED_EVENT, { detail: preferences }));
}
