import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Upload } from "lucide-react";
import { APPEARANCE_STORAGE_KEY, applyAppearanceRuntimeAttributes } from "../../lib/appearance-runtime";
import { readStorageJson, readStorageValue, writeStorageJson } from "../../lib/storage";
import styles from "./AppearanceSettings.module.css";

type ThemeId = "dark" | "light";
type ThemeMode = ThemeId | "system";
type MotionPreference = "system" | "on" | "off";
type DifferenceMarkers = "color" | "symbols";

type ThemeDraft = {
  accent: string;
  background: string;
  foreground: string;
  uiFont: string;
  codeFont: string;
  translucentSidebar: boolean;
  contrast: number;
};

type AppearancePreferences = {
  themeMode: ThemeMode;
  lightCodeTheme: string;
  darkCodeTheme: string;
  lightTheme: ThemeDraft;
  darkTheme: ThemeDraft;
  pointerCursors: boolean;
  composerPet: boolean;
  motion: MotionPreference;
  uiFontSize: number;
  codeFontSize: number;
  differenceMarkers: DifferenceMarkers;
};

type AppearanceSettingsProps = {
  density: string;
  theme: ThemeId;
  onDensity: (value: "comfortable" | "compact" | "dense") => void;
  onTheme: (value: ThemeId) => void;
};

const DEFAULT_LIGHT_THEME: ThemeDraft = {
  accent: "#DD36E6",
  background: "#FFFFFF",
  foreground: "#0D0D0D",
  uiFont: "-apple-system, BlinkMacSystemFont",
  codeFont: "ui-monospace, SFMono-Regular",
  translucentSidebar: true,
  contrast: 35,
};

const DEFAULT_DARK_THEME: ThemeDraft = {
  accent: "#606ACC",
  background: "#0F0F11",
  foreground: "#E3E4E6",
  uiFont: "Inter",
  codeFont: "ui-monospace, SFMono-Regular",
  translucentSidebar: false,
  contrast: 60,
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

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function normalizedThemeDraft(value: unknown, fallback: ThemeDraft): ThemeDraft {
  const source = isRecord(value) ? value : {};
  return {
    accent: typeof source.accent === "string" ? source.accent : fallback.accent,
    background: typeof source.background === "string" ? source.background : fallback.background,
    foreground: typeof source.foreground === "string" ? source.foreground : fallback.foreground,
    uiFont: typeof source.uiFont === "string" ? source.uiFont : fallback.uiFont,
    codeFont: typeof source.codeFont === "string" ? source.codeFont : fallback.codeFont,
    translucentSidebar: typeof source.translucentSidebar === "boolean" ? source.translucentSidebar : fallback.translucentSidebar,
    contrast: boundedNumber(source.contrast, fallback.contrast, 0, 100),
  };
}

function loadAppearancePreferences(theme: ThemeId): AppearancePreferences {
  const stored = readStorageJson<unknown>(APPEARANCE_STORAGE_KEY, {});
  const source = isRecord(stored) ? stored : {};
  const storedMode = source.themeMode;
  const legacyFontSize = Number.parseFloat(readStorageValue("quake-web:fontSize", "14"));
  const legacyMotion = readStorageValue("quake-web:animationSpeed", "");

  return {
    themeMode: storedMode === "system" || storedMode === "light" || storedMode === "dark" ? storedMode : theme,
    lightCodeTheme: typeof source.lightCodeTheme === "string" ? source.lightCodeTheme : "Codex",
    darkCodeTheme: typeof source.darkCodeTheme === "string" ? source.darkCodeTheme : "Linear",
    lightTheme: normalizedThemeDraft(source.lightTheme, DEFAULT_LIGHT_THEME),
    darkTheme: normalizedThemeDraft(source.darkTheme, DEFAULT_DARK_THEME),
    pointerCursors: typeof source.pointerCursors === "boolean" ? source.pointerCursors : true,
    composerPet: typeof source.composerPet === "boolean" ? source.composerPet : true,
    motion: source.motion === "system" || source.motion === "on" || source.motion === "off"
      ? source.motion
      : legacyMotion === "0" ? "on" : legacyMotion === "1" ? "off" : "system",
    uiFontSize: boundedNumber(source.uiFontSize, Number.isFinite(legacyFontSize) ? legacyFontSize : 14, 11, 20),
    codeFontSize: boundedNumber(source.codeFontSize, 12, 10, 20),
    differenceMarkers: source.differenceMarkers === "symbols" ? "symbols" : "color",
  };
}

function systemTheme(): ThemeId {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const AppearanceSettings = memo(function AppearanceSettings({ density, theme, onDensity, onTheme }: AppearanceSettingsProps) {
  const [preferences, setPreferences] = useState<AppearancePreferences>(() => loadAppearancePreferences(theme));
  const [announcement, setAnnouncement] = useState("");
  const announcementTimer = useRef<number | null>(null);

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

  useEffect(() => () => {
    if (announcementTimer.current !== null) window.clearTimeout(announcementTimer.current);
  }, []);

  const announce = useCallback((message: string) => {
    setAnnouncement(message);
    if (announcementTimer.current !== null) window.clearTimeout(announcementTimer.current);
    announcementTimer.current = window.setTimeout(() => setAnnouncement(""), 2400);
  }, []);

  const chooseTheme = useCallback((mode: ThemeMode) => {
    setPreferences((current) => ({ ...current, themeMode: mode }));
    onTheme(mode === "system" ? systemTheme() : mode);
  }, [onTheme]);

  const patchPreferences = useCallback((patch: Partial<AppearancePreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  }, []);

  const updateThemeDraft = useCallback((variant: ThemeId, key: keyof ThemeDraft, value: ThemeDraft[keyof ThemeDraft]) => {
    setPreferences((current) => variant === "light"
      ? { ...current, lightTheme: { ...current.lightTheme, [key]: value } as ThemeDraft }
      : { ...current, darkTheme: { ...current.darkTheme, [key]: value } as ThemeDraft });
  }, []);

  const copyTheme = useCallback(async (variant: ThemeId) => {
    const draft = variant === "light" ? preferences.lightTheme : preferences.darkTheme;
    const codeTheme = variant === "light" ? preferences.lightCodeTheme : preferences.darkCodeTheme;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(JSON.stringify({ appearance: variant, codeTheme, ...draft }, null, 2));
      announce(`${variant === "light" ? "Aydınlık" : "Karanlık"} tema panoya kopyalandı`);
    } catch {
      announce("Tema kopyalanamadı");
    }
  }, [announce, preferences]);

  const importTheme = useCallback(async (variant: ThemeId, file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const fallback = variant === "light" ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
      const draft = normalizedThemeDraft(parsed, fallback);
      setPreferences((current) => variant === "light"
        ? { ...current, lightTheme: draft }
        : { ...current, darkTheme: draft });
      announce(`${variant === "light" ? "Aydınlık" : "Karanlık"} tema içeri aktarıldı`);
    } catch {
      announce("Tema dosyası okunamadı");
    }
  }, [announce]);

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

      <DiffPreview />

      <div className={styles.themeEditors}>
        <ThemeEditor
          variant="light"
          title="Aydınlık tema"
          draft={preferences.lightTheme}
          codeTheme={preferences.lightCodeTheme}
          codeThemeOptions={["Codex", "GitHub Light", "Solarized Light"]}
          onCodeTheme={(value) => patchPreferences({ lightCodeTheme: value })}
          onChange={(key, value) => updateThemeDraft("light", key, value)}
          onCopy={() => void copyTheme("light")}
          onImport={(file) => void importTheme("light", file)}
        />
        <ThemeEditor
          variant="dark"
          title="Karanlık tema"
          draft={preferences.darkTheme}
          codeTheme={preferences.darkCodeTheme}
          codeThemeOptions={["Linear", "Codex Dark", "Dracula", "Nord"]}
          onCodeTheme={(value) => patchPreferences({ darkCodeTheme: value })}
          onChange={(key, value) => updateThemeDraft("dark", key, value)}
          onCopy={() => void copyTheme("dark")}
          onImport={(file) => void importTheme("dark", file)}
        />
      </div>

      <section className={styles.preferencesSection} aria-labelledby="appearance-preferences-title">
        <h3 id="appearance-preferences-title" className={styles.sectionLabel}>Tercihler</h3>
        <div className={styles.preferencesCard}>
          <PreferenceRow
            title="İşaretçi imleçleri kullan"
            description="Etkileşimli öğelerin üzerine gelindiğinde imleci işaretçiye dönüştür"
          >
            <Toggle
              checked={preferences.pointerCursors}
              label="İşaretçi imleçlerini kullan"
              onChange={(pointerCursors) => patchPreferences({ pointerCursors })}
            />
          </PreferenceRow>
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
          <PreferenceRow title="Arayüz yazı tipi boyutu" description="Quake Code arayüzü için kullanılan temel metin boyutunu ayarla">
            <NumberControl
              label="Arayüz yazı tipi boyutu"
              value={preferences.uiFontSize}
              minimum={11}
              maximum={20}
              onChange={(uiFontSize) => patchPreferences({ uiFontSize })}
            />
          </PreferenceRow>
          <PreferenceRow title="Kod yazı tipi boyutu" description="Görevlerde ve farklılıklarda kod için kullanılan temel metin boyutunu ayarla">
            <NumberControl
              label="Kod yazı tipi boyutu"
              value={preferences.codeFontSize}
              minimum={10}
              maximum={20}
              onChange={(codeFontSize) => patchPreferences({ codeFontSize })}
            />
          </PreferenceRow>
          <PreferenceRow title="Fark işaretleri" description="Değişiklikleri renklerle veya +/- işaretleriyle göster">
            <SegmentedControl
              label="Fark işaretleri"
              value={preferences.differenceMarkers}
              options={[
                { value: "color", label: "Renk" },
                { value: "symbols", label: "+/-" },
              ]}
              onChange={(differenceMarkers) => patchPreferences({ differenceMarkers })}
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
          <PreferenceRow title="Araç etkinliği görünümü" description="Araç çağrılarını sohbet içinde semantik ve kompakt göster">
            <span className={styles.enabledPill}><span aria-hidden="true" />Etkin</span>
          </PreferenceRow>
        </div>
      </section>

      <span className={styles.visuallyHidden} role="status" aria-live="polite">{announcement}</span>
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

function DiffPreview() {
  return (
    <div className={styles.diffPreview} role="img" aria-label="Aydınlık ve karanlık tema için kod farkı önizlemesi">
      <div className={`${styles.diffPane} ${styles.diffRemoved}`} aria-hidden="true">
        <CodeLine number="1"><b>const</b> themePreview: <i>ThemeConfig</i> = {'{'}</CodeLine>
        <CodeLine number="2">surface: <em>"sidebar"</em>,</CodeLine>
        <CodeLine number="3">accent: <em>"#2563eb"</em>,</CodeLine>
        <CodeLine number="4">contrast: <strong>42</strong>,</CodeLine>
        <CodeLine number="5">{'}'};</CodeLine>
      </div>
      <div className={`${styles.diffPane} ${styles.diffAdded}`} aria-hidden="true">
        <CodeLine number="1"><b>const</b> themePreview: <i>ThemeConfig</i> = {'{'}</CodeLine>
        <CodeLine number="2">surface: <em>"sidebar-elevated"</em>,</CodeLine>
        <CodeLine number="3">accent: <em>"#0ea5e9"</em>,</CodeLine>
        <CodeLine number="4">contrast: <strong>68</strong>,</CodeLine>
        <CodeLine number="5">{'}'};</CodeLine>
      </div>
    </div>
  );
}

function CodeLine({ number, children }: { number: string; children: React.ReactNode }) {
  return <div className={styles.codeLine}><span>{number}</span><code>{children}</code></div>;
}

type ThemeEditorProps = {
  variant: ThemeId;
  title: string;
  draft: ThemeDraft;
  codeTheme: string;
  codeThemeOptions: string[];
  onCodeTheme: (value: string) => void;
  onChange: (key: keyof ThemeDraft, value: ThemeDraft[keyof ThemeDraft]) => void;
  onCopy: () => void;
  onImport: (file: File) => void;
};

function ThemeEditor({ variant, title, draft, codeTheme, codeThemeOptions, onCodeTheme, onChange, onCopy, onImport }: ThemeEditorProps) {
  const importRef = useRef<HTMLInputElement | null>(null);

  return (
    <section className={styles.themeEditor} aria-labelledby={`${variant}-theme-title`}>
      <header className={styles.themeEditorHeader}>
        <h3 id={`${variant}-theme-title`}>{title}</h3>
        <div className={styles.themeEditorActions}>
          <button type="button" className={styles.textAction} onClick={() => importRef.current?.click()}>
            <Upload size={11} aria-hidden="true" />
            İçeri aktar
          </button>
          <button type="button" className={styles.textAction} onClick={onCopy}>
            <Copy size={11} aria-hidden="true" />
            Temayı kopyala
          </button>
          <label className={styles.codeThemeSelect}>
            <span className={styles.codeThemeBadge} aria-hidden="true">Aa</span>
            <span className={styles.visuallyHidden}>{title} kod teması</span>
            <select value={codeTheme} onChange={(event) => onCodeTheme(event.target.value)} aria-label={`${title} kod teması`}>
              {codeThemeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <ChevronDown size={11} aria-hidden="true" />
          </label>
          <input
            ref={importRef}
            className={styles.hiddenInput}
            type="file"
            accept="application/json,.json"
            aria-label={`${title} dosyasını içeri aktar`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImport(file);
              event.target.value = "";
            }}
          />
        </div>
      </header>
      <div className={styles.themeEditorBody}>
        <EditorRow label="Vurgu">
          <ColorControl label={`${title} vurgu`} value={draft.accent} onChange={(value) => onChange("accent", value)} />
        </EditorRow>
        <EditorRow label="Arka plan">
          <ColorControl label={`${title} arka plan`} value={draft.background} onChange={(value) => onChange("background", value)} />
        </EditorRow>
        <EditorRow label="Ön plan">
          <ColorControl label={`${title} ön plan`} value={draft.foreground} onChange={(value) => onChange("foreground", value)} />
        </EditorRow>
        <EditorRow label="Arayüz yazı tipi">
          <input
            className={styles.fontInput}
            value={draft.uiFont}
            onChange={(event) => onChange("uiFont", event.target.value)}
            aria-label={`${title} arayüz yazı tipi`}
            spellCheck={false}
          />
        </EditorRow>
        <EditorRow label="Kod yazı tipi">
          <input
            className={styles.fontInput}
            value={draft.codeFont}
            onChange={(event) => onChange("codeFont", event.target.value)}
            aria-label={`${title} kod yazı tipi`}
            spellCheck={false}
          />
        </EditorRow>
        <EditorRow label="Yarı saydam kenar çubuğu">
          <Toggle
            checked={draft.translucentSidebar}
            label={`${title} yarı saydam kenar çubuğu`}
            onChange={(translucentSidebar) => onChange("translucentSidebar", translucentSidebar)}
          />
        </EditorRow>
        <EditorRow label="Kontrast">
          <label className={styles.rangeControl}>
            <span className={styles.visuallyHidden}>{title} kontrastı</span>
            <input
              type="range"
              min="0"
              max="100"
              value={draft.contrast}
              style={{ "--range-value": `${draft.contrast}%` } as React.CSSProperties}
              onChange={(event) => onChange("contrast", Number(event.target.value))}
              aria-label={`${title} kontrastı`}
            />
            <output>{draft.contrast}</output>
          </label>
        </EditorRow>
      </div>
    </section>
  );
}

function EditorRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className={styles.editorRow}><span>{label}</span><div>{children}</div></div>;
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const safeColor = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <div className={styles.colorControl}>
      <label className={styles.colorSwatch} style={{ "--swatch": safeColor } as React.CSSProperties}>
        <span className={styles.visuallyHidden}>{label} rengini seç</span>
        <input type="color" value={safeColor} onChange={(event) => onChange(event.target.value.toUpperCase())} aria-label={`${label} rengini seç`} />
      </label>
      <input
        className={styles.colorText}
        value={value}
        maxLength={7}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        aria-label={`${label} hex değeri`}
        spellCheck={false}
      />
    </div>
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

function NumberControl({ label, value, minimum, maximum, onChange }: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.numberControl}>
      <input
        type="number"
        min={minimum}
        max={maximum}
        value={value}
        onChange={(event) => onChange(boundedNumber(event.target.value, value, minimum, maximum))}
        aria-label={label}
      />
      <span>px</span>
    </label>
  );
}
