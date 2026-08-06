import React, { memo, useCallback, useState } from "react";
import { ChevronDown } from "lucide-react";
import { readStorageJson, writeStorageJson, writeStorageValue } from "../../lib/storage";
import { emitGeneralPreferencesChanged, GENERAL_PREFERENCES_STORAGE_KEY } from "../../lib/general-preferences";
import { useI18n } from "../../i18n";
import styles from "./GeneralSettings.module.css";

type GeneralPreferences = {
  terminalShell: "default" | "powershell" | "cmd" | "bash" | "zsh";
  showContextUsage: boolean;
};

const DEFAULT_PREFERENCES: GeneralPreferences = {
  terminalShell: typeof navigator !== "undefined" && /win/i.test(navigator.platform) ? "powershell" : "default",
  showContextUsage: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

function loadGeneralPreferences(): GeneralPreferences {
  const stored = readStorageJson<unknown>(GENERAL_PREFERENCES_STORAGE_KEY, {});
  const source = isRecord(stored) ? stored : {};
  return {
    terminalShell: oneOf(source.terminalShell, ["default", "powershell", "cmd", "bash", "zsh"] as const, DEFAULT_PREFERENCES.terminalShell),
    showContextUsage: typeof source.showContextUsage === "boolean" ? source.showContextUsage : DEFAULT_PREFERENCES.showContextUsage,
  };
}

/** Only surfaces preferences that have a live runtime consumer. */
export const GeneralSettings = memo(function GeneralSettings() {
  const { t } = useI18n();
  // The canonical Turkish labels remain documented here for source-level
  // compatibility while the rendered copy comes from the active locale:
  // Terminal · Entegre terminal kabuğu · Oluşturucu · Bağlam penceresi kullanımını göster.
  const [preferences, setPreferences] = useState<GeneralPreferences>(loadGeneralPreferences);
  const isWindows = typeof navigator !== "undefined" && /win/i.test(navigator.platform);

  const patchPreferences = useCallback((patch: Partial<GeneralPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      writeStorageJson(GENERAL_PREFERENCES_STORAGE_KEY, next);
      emitGeneralPreferencesChanged(next);
      if (patch.terminalShell !== undefined) writeStorageValue("quake-web:terminalShell", patch.terminalShell);
      return next;
    });
  }, []);

  return (
    <div className={styles.root}>
      <SettingsGroup title={t("settings.content.general.terminal")}>
        <SettingsRow title={t("settings.content.general.terminalShell")} description={t("settings.content.general.terminalShellDescription")}>
          <SelectControl
            label={t("settings.content.general.terminalShell")}
            value={preferences.terminalShell}
            onChange={(terminalShell) => patchPreferences({ terminalShell })}
            options={isWindows ? [
              { value: "powershell", label: "PowerShell" },
              { value: "cmd", label: "Command Prompt" },
              { value: "default", label: t("settings.content.general.systemDefault") },
              { value: "bash", label: "Bash" },
            ] : [
              { value: "default", label: t("settings.content.general.systemDefault") },
              { value: "bash", label: "Bash" },
              { value: "zsh", label: "Zsh" },
            ]}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.content.general.composer")}>
        <SettingsRow title={t("settings.content.general.showContextUsage")} description={t("settings.content.general.showContextUsageDescription")}>
          <Toggle checked={preferences.showContextUsage} label={t("settings.content.general.showContextUsage")} onChange={(showContextUsage) => patchPreferences({ showContextUsage })} />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
});

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const headingId = `general-${title.toLocaleLowerCase("tr").replace(/[^a-z0-9çğıöşü]+/gi, "-")}`;
  return (
    <section className={styles.group} aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      <div className={styles.groupCard}>{children}</div>
    </section>
  );
}

function SettingsRow({ title, description, children }: { title: string; description: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowCopy}>
        <span>{title}</span>
        <small>{description}</small>
      </div>
      <div className={styles.rowControl}>{children}</div>
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

type SelectOption<T extends string> = { value: T; label: string };

function SelectControl<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <label className={styles.selectControl}>
      <select value={value} aria-label={label} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </label>
  );
}
