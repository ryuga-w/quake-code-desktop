import React, { memo, useCallback, useState } from "react";
import { ChevronDown, FolderOpen, Import, Link2, Scale } from "lucide-react";
import { loadNotificationConfig, saveNotificationConfig, type NotificationConfig } from "../../lib/notifications";
import { readStorageJson, writeStorageJson, writeStorageValue } from "../../lib/storage";
import { emitGeneralPreferencesChanged, GENERAL_PREFERENCES_STORAGE_KEY } from "../../lib/general-preferences";
import { useAppStore } from "../../state/app-store";
import { useConfirmAction } from "../common/ConfirmContext";
import {
  loadAutoReview,
  loadDefaultPermissions,
  loadFullAccess,
  saveAutoReview,
  saveDefaultPermissions,
  saveFullAccess,
} from "./settings-storage";
import styles from "./GeneralSettings.module.css";

type TerminalPolicyMode = "safe" | "allow-all" | "disabled";
type CompletionNotificationMode = "always" | "unfocused" | "never";

type GeneralPreferences = {
  autoReview: boolean;
  fileOpenTarget: "explorer" | "quake";
  agentEnvironment: "local";
  terminalShell: "default" | "powershell" | "cmd" | "bash" | "zsh";
  language: "auto" | "tr" | "en";
  showBottomPanelAction: boolean;
  showContextUsage: boolean;
  sendShortcut: "enter" | "ctrl-enter";
  followBehavior: "queue" | "steer";
  popupShortcut: "off" | "alt-space" | "ctrl-shift-space";
  defaultNoProject: boolean;
  permissionNotifications: boolean;
  questionNotifications: boolean;
};

type GeneralSettingsProps = {
  onTerminalPolicy?: (mode: TerminalPolicyMode) => void | Promise<void>;
  onOpenPermissions: () => void;
};

const DEFAULT_PREFERENCES: GeneralPreferences = {
  autoReview: true,
  fileOpenTarget: "explorer",
  agentEnvironment: "local",
  terminalShell: typeof navigator !== "undefined" && /win/i.test(navigator.platform) ? "powershell" : "default",
  language: "auto",
  showBottomPanelAction: false,
  showContextUsage: true,
  sendShortcut: "enter",
  followBehavior: "queue",
  popupShortcut: "off",
  defaultNoProject: false,
  permissionNotifications: true,
  questionNotifications: true,
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
    autoReview: typeof source.autoReview === "boolean" ? source.autoReview : loadAutoReview(DEFAULT_PREFERENCES.autoReview),
    fileOpenTarget: oneOf(source.fileOpenTarget, ["explorer", "quake"] as const, DEFAULT_PREFERENCES.fileOpenTarget),
    agentEnvironment: "local",
    terminalShell: oneOf(source.terminalShell, ["default", "powershell", "cmd", "bash", "zsh"] as const, DEFAULT_PREFERENCES.terminalShell),
    language: oneOf(source.language, ["auto", "tr", "en"] as const, DEFAULT_PREFERENCES.language),
    showBottomPanelAction: typeof source.showBottomPanelAction === "boolean" ? source.showBottomPanelAction : DEFAULT_PREFERENCES.showBottomPanelAction,
    showContextUsage: typeof source.showContextUsage === "boolean" ? source.showContextUsage : DEFAULT_PREFERENCES.showContextUsage,
    sendShortcut: oneOf(source.sendShortcut, ["enter", "ctrl-enter"] as const, DEFAULT_PREFERENCES.sendShortcut),
    followBehavior: oneOf(source.followBehavior, ["queue", "steer"] as const, DEFAULT_PREFERENCES.followBehavior),
    popupShortcut: oneOf(source.popupShortcut, ["off", "alt-space", "ctrl-shift-space"] as const, DEFAULT_PREFERENCES.popupShortcut),
    defaultNoProject: typeof source.defaultNoProject === "boolean" ? source.defaultNoProject : DEFAULT_PREFERENCES.defaultNoProject,
    permissionNotifications: typeof source.permissionNotifications === "boolean" ? source.permissionNotifications : DEFAULT_PREFERENCES.permissionNotifications,
    questionNotifications: typeof source.questionNotifications === "boolean" ? source.questionNotifications : DEFAULT_PREFERENCES.questionNotifications,
  };
}

function completionMode(config: NotificationConfig): CompletionNotificationMode {
  if (!config.types.task) return "never";
  return config.onlyWhenUnfocused ? "unfocused" : "always";
}

export const GeneralSettings = memo(function GeneralSettings({ onTerminalPolicy, onOpenPermissions }: GeneralSettingsProps) {
  const config = useAppStore((state) => state.config) || {};
  const { confirm } = useConfirmAction();
  const [preferences, setPreferences] = useState<GeneralPreferences>(loadGeneralPreferences);
  const [notificationConfig, setNotificationConfig] = useState<NotificationConfig>(loadNotificationConfig);
  const [permissionFallback, setPermissionFallback] = useState(() => loadDefaultPermissions(true));
  const [fullAccessFallback, setFullAccessFallback] = useState(() => loadFullAccess(false));
  const [policyPending, setPolicyPending] = useState(false);

  const policyMode = config.terminalPolicyMode === "allow-all" || config.terminalPolicyMode === "disabled" || config.terminalPolicyMode === "safe"
    ? config.terminalPolicyMode as TerminalPolicyMode
    : undefined;
  const defaultPermissions = policyMode ? policyMode !== "disabled" : permissionFallback;
  const fullAccess = policyMode ? policyMode === "allow-all" : fullAccessFallback;

  const patchPreferences = useCallback((patch: Partial<GeneralPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      writeStorageJson(GENERAL_PREFERENCES_STORAGE_KEY, next);
      emitGeneralPreferencesChanged(next);
      if (patch.autoReview !== undefined) saveAutoReview(patch.autoReview);
      if (patch.terminalShell !== undefined) writeStorageValue("quake-web:terminalShell", patch.terminalShell);
      return next;
    });
  }, []);

  const persistNotifications = useCallback((next: NotificationConfig) => {
    setNotificationConfig(next);
    saveNotificationConfig(next);
  }, []);

  const changeDefaultPermissions = useCallback(async (checked: boolean) => {
    if (policyPending) return;
    setPolicyPending(true);
    try {
      if (onTerminalPolicy) await onTerminalPolicy(checked ? "safe" : "disabled");
      setPermissionFallback(checked);
      setFullAccessFallback(false);
      saveDefaultPermissions(checked);
      saveFullAccess(false);
    } catch {
      // The shared settings action already surfaces an error toast.
    } finally {
      setPolicyPending(false);
    }
  }, [onTerminalPolicy, policyPending]);

  const changeFullAccess = useCallback(async (checked: boolean) => {
    if (policyPending) return;
    if (checked) {
      const accepted = await confirm({
        title: "Tam erişim açılsın mı?",
        message: "Ajan onay almadan komut çalıştırabilir, ağ erişimini kullanabilir ve çalışma alanı dışındaki dosyalara yazabilir. Yalnızca güvendiğiniz ortamlarda açın.",
        variant: "warning",
        confirmLabel: "Tam erişimi aç",
      });
      if (!accepted) return;
    }

    setPolicyPending(true);
    try {
      if (onTerminalPolicy) await onTerminalPolicy(checked ? "allow-all" : "safe");
      setPermissionFallback(true);
      setFullAccessFallback(checked);
      saveDefaultPermissions(true);
      saveFullAccess(checked);
    } catch {
      // The shared settings action already surfaces an error toast.
    } finally {
      setPolicyPending(false);
    }
  }, [confirm, onTerminalPolicy, policyPending]);

  const changeCompletionNotifications = useCallback((mode: CompletionNotificationMode) => {
    persistNotifications({
      ...notificationConfig,
      enabled: mode === "never" ? notificationConfig.enabled : true,
      types: { ...notificationConfig.types, task: mode !== "never" },
      onlyWhenUnfocused: mode === "unfocused",
    });
  }, [notificationConfig, persistNotifications]);

  const showScaffoldNotice = useCallback((feature: string) => {
    useAppStore.getState().showToast(`${feature} iskeleti hazır; işlev sonraki aşamada bağlanacak.`, "info");
  }, []);

  const isWindows = typeof navigator !== "undefined" && /win/i.test(navigator.platform);

  return (
    <div className={styles.root}>
      <SettingsGroup title="İzinler">
        <SettingsRow
          title="Varsayılan izinler"
          description="Quake Code, varsayılan olarak çalışma alanındaki dosyaları okuyabilir ve düzenleyebilir. Gerektiğinde ek erişim isteyebilir."
        >
          <Toggle checked={defaultPermissions} disabled={policyPending} label="Varsayılan izinler" onChange={(checked) => void changeDefaultPermissions(checked)} />
        </SettingsRow>
        <SettingsRow
          title="Otomatik inceleme"
          description={<>Quake Code, ek erişim isteklerini otomatik olarak inceler. Otomatik inceleme hata yapabilir. <button type="button" className={styles.inlineLink} onClick={onOpenPermissions}>Daha fazla bilgi edinin.</button></>}
        >
          <Toggle checked={preferences.autoReview} label="Otomatik inceleme" onChange={(autoReview) => patchPreferences({ autoReview })} />
        </SettingsRow>
        <SettingsRow
          title="Tam erişim"
          description={<>Tam erişim açıkken onay almadan ağ erişimi kullanılabilir, dosyalar düzenlenebilir ve komutlar çalıştırılabilir. Veri kaybı veya beklenmedik davranış riski artar. <button type="button" className={styles.inlineLink} onClick={onOpenPermissions}>Daha fazla bilgi edinin.</button></>}
        >
          <Toggle checked={fullAccess} disabled={policyPending} label="Tam erişim" onChange={(checked) => void changeFullAccess(checked)} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Genel">
        <SettingsRow title="Varsayılan dosya açma hedefi" description="Varsayılan olarak dosyaların ve klasörlerin açıldığı yer">
          <SelectControl
            label="Varsayılan dosya açma hedefi"
            value={preferences.fileOpenTarget}
            icon={<FolderOpen size={14} aria-hidden="true" />}
            onChange={(fileOpenTarget) => patchPreferences({ fileOpenTarget })}
            options={[
              { value: "explorer", label: isWindows ? "File Explorer" : "Dosya yöneticisi" },
              { value: "quake", label: "Quake Code" },
            ]}
          />
        </SettingsRow>
        <SettingsRow title="Otonom ajan ortamı" description="Otonom ajanın çalışacağı ortamı seç">
          <SelectControl
            label="Otonom ajan ortamı"
            value={preferences.agentEnvironment}
            onChange={(agentEnvironment) => patchPreferences({ agentEnvironment })}
            options={[{ value: "local", label: isWindows ? "Windows'ta yerel olarak" : "Yerel olarak" }]}
          />
        </SettingsRow>
        <SettingsRow title="Entegre terminal kabuğu" description="Entegre terminalde hangi kabuğun açılacağını seç">
          <SelectControl
            label="Entegre terminal kabuğu"
            value={preferences.terminalShell}
            onChange={(terminalShell) => patchPreferences({ terminalShell })}
            options={isWindows ? [
              { value: "powershell", label: "PowerShell" },
              { value: "cmd", label: "Command Prompt" },
              { value: "default", label: "Sistem varsayılanı" },
              { value: "bash", label: "Bash" },
            ] : [
              { value: "default", label: "Sistem varsayılanı" },
              { value: "bash", label: "Bash" },
              { value: "zsh", label: "Zsh" },
            ]}
          />
        </SettingsRow>
        <SettingsRow title="Dil" description="Uygulama arayüzü dili">
          <SelectControl
            label="Dil"
            value={preferences.language}
            onChange={(language) => patchPreferences({ language })}
            options={[
              { value: "auto", label: "Otomatik algıla" },
              { value: "tr", label: "Türkçe" },
              { value: "en", label: "English" },
            ]}
          />
        </SettingsRow>
        <SettingsRow title="Alt panel" description="Alt panel düğmesini uygulama başlığında göster">
          <Toggle checked={preferences.showBottomPanelAction} label="Alt panel düğmesini göster" onChange={(showBottomPanelAction) => patchPreferences({ showBottomPanelAction })} />
        </SettingsRow>
        <SettingsRow title="Diğer AI uygulamalarından çalışmaları içe aktar" description="Ayarlarınızı, projelerinizi ve son sohbetlerinizi içe aktarın">
          <ActionButton icon={<Import size={14} aria-hidden="true" />} onClick={() => showScaffoldNotice("Çalışmaları içe aktarma")}>İçe aktar</ActionButton>
        </SettingsRow>
        <SettingsRow title="Açık kaynak lisansları" description="Paketlenmiş bağımlılıklar için üçüncü taraf uyarıları">
          <ActionButton icon={<Scale size={14} aria-hidden="true" />} onClick={() => showScaffoldNotice("Açık kaynak lisansları")}>Görüntüle</ActionButton>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Oluşturucu">
        <SettingsRow title="Bağlam penceresi kullanımını göster" description="Aktif konuşmanın bağlam kullanımını oluşturucuda göster">
          <Toggle checked={preferences.showContextUsage} label="Bağlam penceresi kullanımını göster" onChange={(showContextUsage) => patchPreferences({ showContextUsage })} />
        </SettingsRow>
        <SettingsRow title="Gönderme kısayolu" description="Enter'ın ne zaman istem göndereceğini veya yeni satır ekleyeceğini seç">
          <SelectControl
            label="Gönderme kısayolu"
            value={preferences.sendShortcut}
            onChange={(sendShortcut) => patchPreferences({ sendShortcut })}
            options={[
              { value: "enter", label: "Enter" },
              { value: "ctrl-enter", label: "Ctrl + Enter" },
            ]}
          />
        </SettingsRow>
        <SettingsRow title="Takip davranışı" description="Ajan çalışırken takip mesajlarını sıraya al veya mevcut çalıştırmayı yönlendir">
          <SegmentedControl
            label="Takip davranışı"
            value={preferences.followBehavior}
            onChange={(followBehavior) => patchPreferences({ followBehavior })}
            options={[
              { value: "queue", label: "Sıraya al" },
              { value: "steer", label: "Yönlendir" },
            ]}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Açılır Pencere">
        <SettingsRow title="Açılır Pencere kısayolu" description="Açılır Pencere için genel bir kısayol ayarlayın">
          <SelectControl
            label="Açılır Pencere kısayolu"
            value={preferences.popupShortcut}
            icon={<Link2 size={13} aria-hidden="true" />}
            onChange={(popupShortcut) => patchPreferences({ popupShortcut })}
            options={[
              { value: "off", label: "Kapalı" },
              { value: "alt-space", label: "Alt + Space" },
              { value: "ctrl-shift-space", label: "Ctrl + Shift + Space" },
            ]}
          />
        </SettingsRow>
        <SettingsRow title="Projesiz görev için varsayılan yap" description="Yeni görevleri proje olmadan başlat">
          <Toggle checked={preferences.defaultNoProject} label="Projesiz görevi varsayılan yap" onChange={(defaultNoProject) => patchPreferences({ defaultNoProject })} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Bildirimler">
        <SettingsRow title="Tur tamamlama bildirimlerini etkinleştir" description="İşlem tamamlandığında Quake Code'un sizi ne zaman uyaracağını ayarlayın">
          <SelectControl
            label="Tur tamamlama bildirimleri"
            value={completionMode(notificationConfig)}
            onChange={changeCompletionNotifications}
            options={[
              { value: "unfocused", label: "Yalnızca odaklanmadığında" },
              { value: "always", label: "Her zaman" },
              { value: "never", label: "Kapalı" },
            ]}
          />
        </SettingsRow>
        <SettingsRow title="İzin bildirimlerini etkinleştir" description="Bildirim izinleri gerektiğinde uyarıları göster">
          <Toggle checked={preferences.permissionNotifications} label="İzin bildirimlerini etkinleştir" onChange={(permissionNotifications) => patchPreferences({ permissionNotifications })} />
        </SettingsRow>
        <SettingsRow title="Soru bildirimlerini etkinleştir" description="Devam etmek için girdi gerektiğinde uyarıları göster">
          <Toggle checked={preferences.questionNotifications} label="Soru bildirimlerini etkinleştir" onChange={(questionNotifications) => patchPreferences({ questionNotifications })} />
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

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`${styles.toggle} ${checked ? styles.toggleOn : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

type SelectOption<T extends string> = { value: T; label: string };

function SelectControl<T extends string>({ label, value, options, icon, onChange }: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  icon?: React.ReactNode;
  onChange: (value: T) => void;
}) {
  return (
    <label className={styles.selectControl}>
      {icon && <span className={styles.selectIcon}>{icon}</span>}
      <select value={value} aria-label={label} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </label>
  );
}

function SegmentedControl<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
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

function ActionButton({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" className={styles.actionButton} onClick={onClick}>{icon}{children}</button>;
}
