import React, { memo, useCallback, useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { APPEARANCE_STORAGE_KEY, applyAppearanceRuntimeAttributes } from "../../lib/appearance-runtime";
import { readStorageJson, writeStorageJson } from "../../lib/storage";
import styles from "./AppearanceSettings.module.css";

type ThemeId = "dark" | "light";
type ThemeMode = ThemeId | "system";
type MotionPreference = "system" | "on" | "off";

type AppearancePreferences = {
  themeMode: ThemeMode;
  composerPet: boolean;
  motion: MotionPreference;
};

type AppearanceSettingsProps = {
  density: string;
  theme: ThemeId;
  onDensity: (value: "comfortable" | "compact" | "dense") => void;
  onTheme: (value: ThemeId) => void;
};

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "Sistem" },
  { value: "light", label: "Açık" },
  { value: "dark", label: "Koyu" },
];

const DENSITY_OPTIONS = [
  { value: "comfortable", label: "Rahat" },
  { value: "compact", label: "Kompakt" },
  { value: "dense", label: "Yoğun" },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function loadAppearancePreferences(theme: ThemeId): AppearancePreferences {
  const stored = readStorageJson<unknown>(APPEARANCE_STORAGE_KEY, {});
  const source = isRecord(stored) ? stored : {};
  return {
    themeMode: source.themeMode === "system" || source.themeMode === "light" || source.themeMode === "dark" ? source.themeMode : theme,
    composerPet: typeof source.composerPet === "boolean" ? source.composerPet : true,
    motion: source.motion === "system" || source.motion === "on" || source.motion === "off" ? source.motion : "system",
  };
}

function systemTheme(): ThemeId {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Exposes only appearance preferences that are applied to the live UI. */
export const AppearanceSettings = memo(function AppearanceSettings({ density, theme, onDensity, onTheme }: AppearanceSettingsProps) {
  const [preferences, setPreferences] = useState<AppearancePreferences>(() => loadAppearancePreferences(theme));

  useEffect(() => {
    writeStorageJson(APPEARANCE_STORAGE_KEY, preferences);
    applyAppearanceRuntimeAttributes(preferences);
  }, [preferences]);

  useEffect(() => {
    if (preferences.themeMode !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemTheme = () => onTheme(media.matches ? "dark" : "light");
    applySystemTheme();
    media.addEventListener("change", applySystemTheme);
    return () => media.removeEventListener("change", applySystemTheme);
  }, [onTheme, preferences.themeMode]);

  const chooseTheme = useCallback((mode: ThemeMode) => {
    setPreferences((current) => ({ ...current, themeMode: mode }));
    onTheme(mode === "system" ? systemTheme() : mode);
  }, [onTheme]);

  const patchPreferences = useCallback((patch: Partial<AppearancePreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  }, []);

  return (
    <div className={styles.root}>
      <fieldset className={styles.themePicker} role="radiogroup" aria-label="Tema">
        <legend className={styles.sectionLabel}>Tema</legend>
        <div className={styles.themeOptions}>
          {THEME_OPTIONS.map((option) => (
            <label key={option.value} className={styles.themeOption}>
              <input
                className={styles.visuallyHidden}
                type="radio"
                name="appearance-theme"
                value={option.value}
                checked={preferences.themeMode === option.value}
                onChange={() => chooseTheme(option.value)}
                aria-label={option.label}
              />
              <span className={styles.themeOptionVisual}>
                <ThemeThumbnail variant={option.value} />
                <span className={styles.themeOptionLabel}>{option.label}</span>
                <span className={styles.selectedMark} aria-hidden="true"><Check size={10} /></span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <section className={styles.preferencesSection} aria-labelledby="appearance-preferences-title">
        <h3 id="appearance-preferences-title" className={styles.sectionLabel}>Tercihler</h3>
        <div className={styles.preferencesCard}>
          <PreferenceRow title="Hareketi azalt" description="Animasyonları azaltın veya sisteminizle eşleştirin">
            <SegmentedControl
              label="Hareketi azalt"
              value={preferences.motion}
              options={[
                { value: "system", label: "Sistem" },
                { value: "on", label: "Açık" },
                { value: "off", label: "Kapalı" },
              ]}
              onChange={(motion) => patchPreferences({ motion })}
            />
          </PreferenceRow>
          <PreferenceRow title="Composer peti" description="Quakelet composer durumlarına sessiz mikro hareketlerle eşlik etsin">
            <Toggle
              checked={preferences.composerPet}
              label="Composer petini göster"
              onChange={(composerPet) => patchPreferences({ composerPet })}
            />
          </PreferenceRow>
          <PreferenceRow title="Arayüz yoğunluğu" description="Arayüz boşluk ve satır aralığını ayarla">
            <label className={styles.selectControl}>
              <span className={styles.visuallyHidden}>Yoğunluk</span>
              <select
                value={density === "comfortable" || density === "compact" || density === "dense" ? density : "comfortable"}
                onChange={(event) => onDensity(event.target.value as "comfortable" | "compact" | "dense")}
                aria-label="Yoğunluk"
              >
                {DENSITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <ChevronDown size={12} aria-hidden="true" />
            </label>
          </PreferenceRow>
        </div>
      </section>
    </div>
  );
});

function ThemeThumbnail({ variant }: { variant: ThemeMode }) {
  return (
    <span className={styles.themeThumbnail} data-preview={variant} aria-hidden="true">
      <span className={styles.thumbnailTop} />
      <span className={styles.thumbnailRail} />
      <span className={styles.thumbnailPane}>
        <span /><span /><span />
      </span>
      {variant === "system" && <span className={styles.thumbnailSplit} />}
    </span>
  );
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`${styles.toggle} ${checked ? styles.toggleOn : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function PreferenceRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className={styles.preferenceRow}>
      <div className={styles.preferenceCopy}>
        <span>{title}</span>
        <small>{description}</small>
      </div>
      <div className={styles.preferenceControl}>{children}</div>
    </div>
  );
}

function SegmentedControl<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmentedControl} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={value === option.value ? styles.segmentActive : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
