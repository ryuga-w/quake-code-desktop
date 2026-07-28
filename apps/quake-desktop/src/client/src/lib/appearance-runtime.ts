import { readStorageRecord } from "./storage";

export const APPEARANCE_STORAGE_KEY = "quake-web:appearancePreferences";

export type RuntimeMotionPreference = "system" | "on" | "off";

export type RuntimeAppearancePreferences = {
  composerPet: boolean;
  motion: RuntimeMotionPreference;
};

function normalizeMotion(value: unknown): RuntimeMotionPreference {
  return value === "on" || value === "off" ? value : "system";
}

export function readRuntimeAppearancePreferences(): RuntimeAppearancePreferences {
  const stored = readStorageRecord<unknown>(APPEARANCE_STORAGE_KEY);
  return {
    composerPet: stored.composerPet !== false,
    motion: normalizeMotion(stored.motion),
  };
}

export function applyAppearanceRuntimeAttributes(
  preferences: Pick<RuntimeAppearancePreferences, "composerPet" | "motion">,
): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.composerPet = preferences.composerPet ? "on" : "off";
  document.documentElement.dataset.reduceMotion = normalizeMotion(preferences.motion);
}

export function applyStoredAppearanceRuntimeAttributes(): void {
  applyAppearanceRuntimeAttributes(readRuntimeAppearancePreferences());
}
