import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { APPEARANCE_STORAGE_KEY, applyAppearanceRuntimeAttributes } from "../../lib/appearance-runtime";
import { readStorageJson, writeStorageJson } from "../../lib/storage";
import { type LocalePreference, useI18n } from "../../i18n";
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
  const { preference, setPreference, t } = useI18n();
  const [preferences, setPreferences] = useState<AppearancePreferences>(() => loadAppearancePreferences(theme));
  const themeOptions = useMemo<{ value: ThemeMode; label: string }[]>(() => [
    { value: "system", label: t("appearance.system") },
    { value: "light", label: t("appearance.light") },
    { value: "dark", label: t("appearance.dark") },
  ], [t]);
  const densityOptions = useMemo(() => [
    { value: "comfortable", label: t("appearance.densityComfortable") },
    { value: "compact", label: t("appearance.densityCompact") },
    { value: "dense", label: t("appearance.densityDense") },
  ] as const, [t]);

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
      <fieldset className={styles.themePicker} role="radiogroup" aria-label={t("appearance.theme")}>
        <legend className={styles.sectionLabel}>{t("appearance.theme")}</legend>
        <div className={styles.themeOptions}>
          {themeOptions.map((option) => (
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
        <h3 id="appearance-preferences-title" className={styles.sectionLabel}>{t("appearance.preferences")}</h3>
        <div className={styles.preferencesCard}>
          <PreferenceRow title={t("appearance.reduceMotion")} description={t("appearance.reduceMotionDescription")}>
            <SegmentedControl
              label={t("appearance.reduceMotion")}
              value={preferences.motion}
              options={[
                { value: "system", label: t("appearance.system") },
                { value: "on", label: t("appearance.motionOn") },
                { value: "off", label: t("appearance.motionOff") },
              ]}
              onChange={(motion) => patchPreferences({ motion })}
            />
          </PreferenceRow>
          <PreferenceRow title={t("appearance.composerPet")} description={t("appearance.composerPetDescription")}>
            <Toggle
              checked={preferences.composerPet}
              label={t("appearance.showComposerPet")}
              onChange={(composerPet) => patchPreferences({ composerPet })}
            />
          </PreferenceRow>
          <PreferenceRow title={t("appearance.language")} description={t("appearance.languageDescription")}>
            <ThemedSelect
              label={t("appearance.language")}
              value={preference}
              onChange={(value) => setPreference(value as LocalePreference)}
              options={[
                { value: "auto", label: t("appearance.languageAuto") },
                { value: "tr", label: t("appearance.languageTurkish") },
                { value: "en", label: t("appearance.languageEnglish") },
              ]}
            />
          </PreferenceRow>
          <PreferenceRow title={t("appearance.density")} description={t("appearance.densityDescription")}>
            <ThemedSelect
              label={t("appearance.density")}
              value={density === "comfortable" || density === "compact" || density === "dense" ? density : "comfortable"}
              onChange={onDensity}
              options={[...densityOptions]}
            />
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

function ThemedSelect<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = React.useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex);
  const selected = options[selectedIndex] || options[0];

  useEffect(() => {
    if (!open) return undefined;
    setHighlightedIndex(selectedIndex);
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnBlur = () => setOpen(false);
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("blur", closeOnBlur);
    };
  }, [open, selectedIndex]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setHighlightedIndex(index);
    setOpen(false);
  };

  const moveHighlight = (delta: number) => {
    if (options.length === 0) return;
    setHighlightedIndex((current) => (current + delta + options.length) % options.length);
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setHighlightedIndex(selectedIndex);
        setOpen(true);
      } else {
        moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      }
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      setHighlightedIndex(0);
      return;
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      setHighlightedIndex(Math.max(0, options.length - 1));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(highlightedIndex);
      else setOpen(true);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={`${styles.selectControl} ${open ? styles.selectControlOpen : ""}`}>
      <button
        type="button"
        className={styles.selectTrigger}
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        onClick={() => {
          setHighlightedIndex(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span>{selected?.label || ""}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div id={listboxId} className={styles.selectMenu} role="listbox" aria-label={label}>
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isHighlighted = index === highlightedIndex;
            return (
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                key={option.value}
                className={`${styles.selectOption} ${isSelected ? styles.selectOptionSelected : ""} ${isHighlighted ? styles.selectOptionHighlighted : ""}`}
                onPointerEnter={() => setHighlightedIndex(index)}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {isSelected && <Check size={12} strokeWidth={2} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
