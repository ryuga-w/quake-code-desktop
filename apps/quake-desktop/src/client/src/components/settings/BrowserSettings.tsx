import React, { memo, useCallback, useState } from "react";
import { ChevronDown, FolderOpen, Import } from "lucide-react";
import { desktop } from "../../lib/desktop";
import { readStorageJson, writeStorageJson } from "../../lib/storage";
import { useAppStore } from "../../state/app-store";
import { useConfirmAction } from "../common/ConfirmContext";
import styles from "./BrowserSettings.module.css";

type BrowserPreferences = {
  enabled: boolean;
  webOpenTarget: "system" | "quake";
  localOpenTarget: "quake" | "system";
  screenshotPolicy: "always" | "ask" | "never";
  downloadDirectory: string;
  askDownloadLocation: boolean;
  siteApproval: "always-ask" | "trusted-only" | "never-ask";
};

type BrowserSettingsProps = {
  onOpenComputerUse: () => void;
  onOpenPermissions: () => void;
};

const BROWSER_STORAGE_KEY = "quake-web:browserPreferences";

const DEFAULT_PREFERENCES: BrowserPreferences = {
  enabled: true,
  webOpenTarget: "system",
  localOpenTarget: "quake",
  screenshotPolicy: "always",
  downloadDirectory: "",
  askDownloadLocation: false,
  siteApproval: "always-ask",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

function loadBrowserPreferences(): BrowserPreferences {
  const stored = readStorageJson<unknown>(BROWSER_STORAGE_KEY, {});
  const source = isRecord(stored) ? stored : {};
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_PREFERENCES.enabled,
    webOpenTarget: oneOf(source.webOpenTarget, ["system", "quake"] as const, DEFAULT_PREFERENCES.webOpenTarget),
    localOpenTarget: oneOf(source.localOpenTarget, ["quake", "system"] as const, DEFAULT_PREFERENCES.localOpenTarget),
    screenshotPolicy: oneOf(source.screenshotPolicy, ["always", "ask", "never"] as const, DEFAULT_PREFERENCES.screenshotPolicy),
    downloadDirectory: typeof source.downloadDirectory === "string" ? source.downloadDirectory : "",
    askDownloadLocation: typeof source.askDownloadLocation === "boolean" ? source.askDownloadLocation : DEFAULT_PREFERENCES.askDownloadLocation,
    siteApproval: oneOf(source.siteApproval, ["always-ask", "trusted-only", "never-ask"] as const, DEFAULT_PREFERENCES.siteApproval),
  };
}

export const BrowserSettings = memo(function BrowserSettings({ onOpenComputerUse, onOpenPermissions }: BrowserSettingsProps) {
  const { confirm } = useConfirmAction();
  const [preferences, setPreferences] = useState<BrowserPreferences>(loadBrowserPreferences);
  const [status, setStatus] = useState("");

  const patchPreferences = useCallback((patch: Partial<BrowserPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      writeStorageJson(BROWSER_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const notifyScaffold = useCallback((feature: string) => {
    const message = `${feature} arayüzü hazır; çalışma katmanı sonraki aşamada bağlanacak.`;
    setStatus(message);
    useAppStore.getState().showToast(message, "info");
  }, []);

  const chooseDownloadDirectory = useCallback(async () => {
    if (!desktop?.pickFolder) {
      notifyScaffold("İndirme konumu seçimi");
      return;
    }
    try {
      const directory = await desktop.pickFolder();
      if (!directory) return;
      patchPreferences({ downloadDirectory: directory });
      setStatus("İndirme konumu kaydedildi.");
      useAppStore.getState().showToast("İndirme konumu kaydedildi", "success");
    } catch {
      useAppStore.getState().showToast("İndirme konumu seçilemedi", "error");
    }
  }, [notifyScaffold, patchPreferences]);

  const requestClearBrowsingData = useCallback(async () => {
    const accepted = await confirm({
      title: "Tarama verileri temizlensin mi?",
      message: "Yerleşik tarayıcının geçmişi, site verileri, önbelleği ve indirme geçmişi temizlenecek.",
      variant: "warning",
      confirmLabel: "Verileri temizle",
    });
    if (accepted) notifyScaffold("Tarama verilerini temizleme");
  }, [confirm, notifyScaffold]);

  const changeBrowserEnabled = useCallback((enabled: boolean) => {
    patchPreferences({ enabled });
    const message = `Yerleşik tarayıcı denetimi ${enabled ? "etkinleştirildi" : "devre dışı bırakıldı"}.`;
    setStatus(message);
    useAppStore.getState().showToast(message, "success");
  }, [patchPreferences]);

  const downloadDescription = preferences.downloadDirectory || "Sistem İndirilenler klasörü";

  return (
    <div className={styles.root}>
      <div className={styles.introBlock}>
        <p className={styles.intro}>
          Yerleşik tarayıcıyı yönetin. Sistem tarayıcısı ve masaüstü etkileşimi ayarları,
          {" "}<button type="button" className={styles.inlineLink} onClick={onOpenComputerUse}>Computer Use ayarlarından</button> yönetilebilir.
        </p>

        <section className={styles.masterCard} aria-labelledby="browser-control-title">
          <span className={styles.masterIcon} aria-hidden="true"><BrowserControlIcon /></span>
          <span className={styles.masterCopy}>
            <b id="browser-control-title">Tarayıcı</b>
            <small>Quake Code&apos;un yerleşik tarayıcıyı kontrol etmesine izin ver</small>
          </span>
          <Toggle checked={preferences.enabled} label="Yerleşik tarayıcı denetimi" onChange={changeBrowserEnabled} />
        </section>
      </div>

      <SettingsGroup
        title="Genel"
        action={<ActionButton icon={<Import size={14} aria-hidden="true" />} onClick={() => notifyScaffold("Tarayıcı verilerini içe aktarma")}>İçe aktar…</ActionButton>}
      >
        <SettingsRow title="Web URL ve bağlantı açma hedefi" description="Bağlantıların varsayılan olarak açıldığı yer">
          <SelectControl
            label="Web URL ve bağlantı açma hedefi"
            value={preferences.webOpenTarget}
            onChange={(webOpenTarget) => patchPreferences({ webOpenTarget })}
            options={[
              { value: "system", label: "Varsayılan tarayıcı" },
              { value: "quake", label: "Quake Code" },
            ]}
          />
        </SettingsRow>
        <SettingsRow title="Yerel URL açma hedefi" description="Yerel geliştirme sitelerinin varsayılan olarak açıldığı yer">
          <SelectControl
            label="Yerel URL açma hedefi"
            value={preferences.localOpenTarget}
            onChange={(localOpenTarget) => patchPreferences({ localOpenTarget })}
            options={[
              { value: "quake", label: "Quake Code" },
              { value: "system", label: "Varsayılan tarayıcı" },
            ]}
          />
        </SettingsRow>
        <SettingsRow title="Tarama verileri" description="Yerleşik tarayıcıdaki göz atma geçmişini, site verilerini, önbelleği ve indirme geçmişini temizle">
          <ActionButton trailing={<ChevronDown size={13} aria-hidden="true" />} onClick={() => void requestClearBrowsingData()}>Tüm tarama verilerini temizle</ActionButton>
        </SettingsRow>
        <SettingsRow title="Açıklama ekran görüntüleri" description="Ekran görüntüleri, Quake Code'un yorumları daha iyi anlamasına yardımcı olur ancak plan kullanımını artırabilir">
          <SelectControl
            label="Açıklama ekran görüntüleri"
            value={preferences.screenshotPolicy}
            onChange={(screenshotPolicy) => patchPreferences({ screenshotPolicy })}
            options={[
              { value: "always", label: "Her zaman dahil et" },
              { value: "ask", label: "Her zaman sor" },
              { value: "never", label: "Dahil etme" },
            ]}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Otomatik doldurma ve parolalar">
        <SettingsRow title="Şifre yöneticisi" description="Kayıtlı parolaları ekle, sil ve düzenle">
          <ActionButton label="Şifre yöneticisini yönet" onClick={() => notifyScaffold("Şifre yöneticisi")}>Yönet</ActionButton>
        </SettingsRow>
        <SettingsRow title="İletişim bilgileri" description="Kayıtlı adresleri, telefon numaralarını ve e-posta adreslerini ekle, sil ve düzenle">
          <ActionButton label="İletişim bilgilerini yönet" onClick={() => notifyScaffold("İletişim bilgileri")}>Yönet</ActionButton>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="İndirilenler">
        <SettingsRow title="Konum" description={downloadDescription}>
          <ActionButton icon={<FolderOpen size={14} aria-hidden="true" />} onClick={() => void chooseDownloadDirectory()}>Değiştir</ActionButton>
        </SettingsRow>
        <SettingsRow title="İndirilenlerin nereye kaydedileceğini sor" description="Yerleşik tarayıcıda başlatılan indirmeler için kaydetme iletişim kutusunu göster">
          <Toggle checked={preferences.askDownloadLocation} label="Her indirmede kayıt konumunu sor" onChange={(askDownloadLocation) => patchPreferences({ askDownloadLocation })} />
        </SettingsRow>
        <SettingsRow title="İndirme geçmişi" description="Yerleşik tarayıcıdan indirilen dosyaları görüntüle ve yönet">
          <ActionButton label="İndirme geçmişini yönet" onClick={() => notifyScaffold("İndirme geçmişi")}>Yönet</ActionButton>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="İzinler">
        <SettingsRow title="Site ayarları" description="Yerleşik tarayıcıda kamera ve mikrofon izinlerini kontrol et">
          <ActionButton label="Site ayarlarını yönet" onClick={onOpenPermissions}>Yönet</ActionButton>
        </SettingsRow>
        <SettingsRow
          title="Onay"
          description={<>Web sitelerini açmadan önce Quake Code&apos;un izin isteyip istemeyeceğini seç. <button type="button" className={styles.inlineLink} onClick={onOpenPermissions}>Daha fazla bilgi</button></>}
        >
          <SelectControl
            label="Web sitesi açma onayı"
            value={preferences.siteApproval}
            onChange={(siteApproval) => patchPreferences({ siteApproval })}
            options={[
              { value: "always-ask", label: "Her zaman sor" },
              { value: "trusted-only", label: "Yalnızca yeni sitelerde sor" },
              { value: "never-ask", label: "Sormadan aç" },
            ]}
          />
        </SettingsRow>
      </SettingsGroup>

      <span className={styles.liveStatus} role="status" aria-live="polite">{status}</span>
    </div>
  );
});

function BrowserControlIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="16" height="13" rx="2.5" />
      <path d="M3 8h16M7 6h.01M10 6h.01" />
      <path d="m14 13 6 3-2.7 1.1L16 20z" />
    </svg>
  );
}

function SettingsGroup({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const headingId = `browser-${title.toLocaleLowerCase("tr").replace(/[^a-z0-9çğıöşü]+/gi, "-")}`;
  return (
    <section className={styles.group} aria-labelledby={headingId}>
      <div className={styles.groupHeading}>
        <h3 id={headingId}>{title}</h3>
        {action}
      </div>
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

function ActionButton({ icon, trailing, label, children, onClick }: {
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  label?: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.actionButton} aria-label={label} onClick={onClick}>
      {icon}
      <span>{children}</span>
      {trailing}
    </button>
  );
}
