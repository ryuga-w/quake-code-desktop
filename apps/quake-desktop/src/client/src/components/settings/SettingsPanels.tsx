import React, { memo, useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { ArrowLeft, Search, X } from "lucide-react";
import { configuredModels as listConfiguredModels, formatModelDisplayLabel, formatModelRefLabel } from "../../lib/models";
import { readStorageArray, removeStorageValue, writeStorageJson } from "../../lib/storage";
import { useAppStore } from "../../state/app-store";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../lib/api";
import { desktop, type UpdaterStatus } from "../../lib/desktop";
import { exportConversation, downloadFile } from "../../lib/export";
import {
  loadNotificationConfig,
  notifyError,
  notifyTaskComplete,
  saveNotificationConfig,
  type NotificationConfig,
  type NotificationType,
} from "../../lib/notifications";
import { playDemoSound, SOUND_OPTIONS, stopDemoSound, type SoundID } from "../../lib/sound";
import { useConfirmAction } from "../common/ConfirmContext";
import { AppearanceSettings } from "./AppearanceSettings";
import { GeneralSettings } from "./GeneralSettings";
import styles from "./SettingsPanels.module.css";
import { ProvidersSection } from "./ProvidersSection";

// Sifirlanan tum yerel arayuz durumu anahtarlari (onceden eksikti: model/pin/
// rightWidth/notifications/fontSize vb. kaliyordu).
const LOCAL_UI_STATE_KEYS = [
  "quake-web:density",
  "quake-web:theme",
  "quake-web:leftOpen",
  "quake-web:leftWidth",
  "quake-web:leftSidebarSize",
  "quake-web:rightOpen",
  "quake-web:rightTab",
  "quake-web:rightWidth",
  "quake-web:fileDir",
  "quake-web:showHiddenFiles",
  "quake-web:showGeneratedFiles",
  "quake-web:pinnedSessions",
  "quake-web:archivedSessions",
  "quake-web:sessionAliases",
  "quake-web:promptHistory",
  "quake-web:terminalHistory",
  "quake-web:recentSlashCommands",
  "quake-web:recentWorkspaces",
  "quake-web:pinnedComposerModels",
  "quake-web:model",
  "quake-web:notifications",
  "quake-web:goalSettings",
  "quake-web:fontSize",
  "quake-web:animationSpeed",
  "quake-web:appearancePreferences",
  "quake-web:generalPreferences",
  "quake-web:terminalShell",
  "quake-web:workMode",
  "quake-web:defaultPermissions",
  "quake-web:autoReview",
  "quake-web:fullAccess",
  "quake-web:verboseChat",
  "quake-web:previewFontSize",
  "quake-web:previewWordWrap",
  "quake-web:hiddenWorkspaces",
  "quake-web:unreadSessions",
  "quake-web:composerMode",
  "quake-web:browserLayout",
  "quake-web:browserFocusComposer",
  "quake-web:filesLayout",
  "quake-web:bottomHeight",
  "quake-web:noProject",
];

export type ThemeId = "dark" | "light";

export const THEMES: Record<ThemeId, { label: string; description: string }> = {
  dark: { label: "Siyah", description: "Profesyonel koyu arayüz — saf siyah, yumuşak katmanlar" },
  light: { label: "Beyaz", description: "Aydınlık, sade arayüz" },
};

export function normalizeThemeId(value: unknown): ThemeId {
  return value === "light" ? "light" : "dark";
}

const LOCALHOST_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0"]);

export type SettingsView =
  | "general"
  | "appearance"
  | "customizations"
  | "shortcuts"
  | "mcp"
  | "computer-use"
  | "permissions"
  | "goal-mode"
  | "models"
  | "providers"
  | "app"
  | "about"
  | "advanced";

type NavItem = { id: SettingsView; label: string; title: string; desc: string };

/** Antigravity-style flat left nav (primary + footer). */
const NAV_PRIMARY: NavItem[] = [
  { id: "general", label: "Genel", title: "Genel", desc: "" },
  { id: "app", label: "Bildirimler", title: "Bildirimler", desc: "Sistem bildirimleri, sesler ve tamamlanma uyarıları." },
  { id: "permissions", label: "İzinler", title: "İzinler", desc: "Terminal, dosya ve ağ erişim kuralları." },
  { id: "goal-mode", label: "Goal Mode", title: "Goal Mode", desc: "Bilgisayar başında değilken otonom çalışma sınırları." },
  { id: "appearance", label: "Görünüm", title: "Görünüm", desc: "" },
  { id: "models", label: "Modeller", title: "Modeller", desc: "Model seçimi ve düşünme seviyesi." },
  { id: "providers", label: "Provider’lar", title: "Provider’lar", desc: "OAuth, API key ve bulut sağlayıcı bağlantıları." },
  { id: "customizations", label: "Kişiselleştirme", title: "Kişiselleştirme", desc: "Uzantılar, promptlar ve komutlar." },
  { id: "computer-use", label: "Computer Use", title: "Computer Use", desc: "Masaüstü etkileşim araçları ve güvenlik sınırları." },
];

const NAV_SECONDARY: NavItem[] = [
  { id: "mcp", label: "MCP", title: "MCP sunucuları", desc: "Model Context Protocol araçları ve sunucuları." },
  { id: "advanced", label: "Arşiv", title: "Arşiv ve veri", desc: "Dışa aktarma, sıfırlama ve arşiv." },
];

const NAV_FOOTER: NavItem[] = [
  { id: "shortcuts", label: "Kısayollar", title: "Klavye kısayolları", desc: "Kısayol tuşları ve hızlı eylemler." },
  { id: "about", label: "Hakkında", title: "Quake Code hakkında", desc: "Sürüm ve çalışma zamanı bilgileri." },
];

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Temel", items: NAV_PRIMARY },
  { label: "Gelişmiş", items: NAV_SECONDARY },
  { label: "Destek", items: NAV_FOOTER },
];

const ALL_NAV_ITEMS: NavItem[] = [...NAV_PRIMARY, ...NAV_SECONDARY, ...NAV_FOOTER];

const SEARCH_INDEX: { label: string; section: SettingsView; keywords: string }[] = [
  { label: "Tema", section: "appearance", keywords: "tema renk grok theme görünüm" },
  { label: "Çalışma alanı", section: "general", keywords: "proje klasör dizin çalışma alanı" },
  { label: "İzinler", section: "permissions", keywords: "izin güvenlik terminal localhost görsel dosya erişim" },
  { label: "Computer-Use", section: "computer-use", keywords: "masaüstü bilgisayar kullanımı ekran fare" },
  { label: "Goal Mode", section: "goal-mode", keywords: "goal hedef otonom unattended tur uyku yeniden deneme doğrulama" },
  { label: "Uzantılar", section: "customizations", keywords: "uzantı extension eklenti" },
  { label: "MCP", section: "mcp", keywords: "mcp sunucu araç stdio komut argüman" },
  { label: "Model", section: "models", keywords: "model provider sağlayıcı düşünme thinking" },
  { label: "Provider’lar", section: "providers", keywords: "provider oauth api key anthropic openai azure bedrock bağla login" },
  { label: "Terminal", section: "permissions", keywords: "terminal güvenlik komut" },
  { label: "Bildirimler", section: "app", keywords: "bildirim ses hata yanıt arka plan" },
  { label: "Görünüm", section: "appearance", keywords: "yoğunluk sohbet araç etkinliği açık koyu" },
  { label: "Klavye kısayolları", section: "shortcuts", keywords: "klavye kısayol shortcut tuş" },
  { label: "Dışa aktar", section: "advanced", keywords: "dışa aktar export arşiv içe aktar sıfırla sıkıştırma geçmiş" },
  { label: "Hakkında", section: "about", keywords: "sürüm platform runtime yazar mustafa mrquake" },
  { label: "Otomatik güncelleme", section: "about", keywords: "güncelleme update auto-update feed yayın sürüm feed url kaydet" },
];

const SectionIcon = memo(function SectionIcon({ id }: { id: SettingsView }) {
  const p = { viewBox: "0 0 24 24", "aria-hidden": true as const, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (id) {
    case "appearance":
      return <svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></svg>;
    case "goal-mode":
      return <svg {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>;
    case "models":
    case "permissions":
      return <svg {...p}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="m9.5 12 1.8 1.8 3.2-3.4" /></svg>;
    case "providers":
      return (
        <svg {...p}>
          <circle cx="6" cy="7" r="2.2" />
          <circle cx="18" cy="7" r="2.2" />
          <circle cx="12" cy="17" r="2.2" />
          <path d="M8 7h8M7.2 8.6l3.5 6.2M16.8 8.6l-3.5 6.2" />
        </svg>
      );
    case "customizations":
    case "mcp":
      return <svg {...p}><path d="M10 4a2 2 0 1 1 4 0v2h2a1 1 0 0 1 1 1v2h2a2 2 0 1 1 0 4h-2v3a1 1 0 0 1-1 1h-3v-2a2 2 0 1 0-4 0v2H6a1 1 0 0 1-1-1v-3a2 2 0 1 1 0-4V7a1 1 0 0 1 1-1h4z" /></svg>;
    case "app":
    case "computer-use":
      return <svg {...p}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" /></svg>;
    case "general":
    case "shortcuts":
      return <svg {...p}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>;
    case "advanced":
      return <svg {...p}><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="14" cy="18" r="2" /></svg>;
    case "about":
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
    default:
      return null;
  }
});

const Switch = memo(function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`${styles.switch} ${checked ? styles.switchOn : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchThumb} />
    </button>
  );
});

export type SettingsPageProps = {
  density: string;
  theme: ThemeId;
  onDensity: (value: "comfortable" | "compact" | "dense") => void;
  onTheme: (value: ThemeId) => void;
  onThinking: (level: any) => void;
  onSetModel: (value: string) => void;
  onClose: () => void;
  onOpenWorkspace?: () => void;
  onCompact?: () => void;
  onClearPromptHistory?: () => void;
  onSetDefaultModel?: (value: string) => void;
  onSetDefaultThinking?: (level: string) => void;
  onAutoCompaction?: (enabled: boolean) => void;
  onTerminalPolicy?: (mode: "safe" | "allow-all" | "disabled") => void | Promise<void>;
  onBlockImages?: (blocked: boolean) => void;
  onShowImages?: (show: boolean) => void;
  initialView?: SettingsView;
  layout?: "page" | "modal";
};

function SettingsPageInner({ density, theme, onDensity, onTheme, onThinking, onSetModel, onClose, onOpenWorkspace, onCompact, onClearPromptHistory, onSetDefaultModel, onSetDefaultThinking, onAutoCompaction, onTerminalPolicy, onBlockImages, onShowImages, initialView, layout = "page" }: SettingsPageProps) {
  const [view, setView] = useState<SettingsView>(initialView || "general");

  const [navSearch, setNavSearch] = useState("");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(Boolean(initialView));
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (layout !== "modal") return;
    const root = rootRef.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusableSelector = "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex='-1'])";
    const focusFirst = window.setTimeout(() => root.querySelector<HTMLElement>(focusableSelector)?.focus({ preventScroll: true }), 0);
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => element.offsetWidth > 0 && element.offsetHeight > 0);
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    root.addEventListener("keydown", trapFocus);
    return () => {
      window.clearTimeout(focusFirst);
      root.removeEventListener("keydown", trapFocus);
      if (previous && document.contains(previous)) window.setTimeout(() => previous.focus({ preventScroll: true }), 0);
    };
  }, [layout]);

  const active = useMemo(
    () => ALL_NAV_ITEMS.find((s) => s.id === view) || ALL_NAV_ITEMS[0],
    [view],
  );

  const searchQuery = navSearch.trim().toLocaleLowerCase("tr");
  const filteredGroups = useMemo(() => {
    if (!searchQuery) return NAV_GROUPS;
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.label.toLocaleLowerCase("tr").includes(searchQuery) ||
          item.desc.toLocaleLowerCase("tr").includes(searchQuery) ||
          SEARCH_INDEX.some(
            (entry) =>
              entry.section === item.id &&
              (entry.label.toLocaleLowerCase("tr").includes(searchQuery) ||
                entry.keywords.toLocaleLowerCase("tr").includes(searchQuery)),
          ),
      ),
    })).filter((group) => group.items.length > 0);
  }, [searchQuery]);

  const goTo = useCallback((section: SettingsView) => {
    startTransition(() => {
      setView(section);
      setNavSearch("");
      setMobileDetailOpen(true);
    });
  }, []);

  return (
    <div ref={rootRef} className={`${styles.settingsModalRoot} ${layout === "page" ? styles.settingsPageRoot : styles.settingsModalShell} ${layout === "modal" ? styles.settingsAntigravity : ""} ${mobileDetailOpen ? styles.mobileDetailOpen : ""}`} role="region" aria-label="Ayarlar">
      <div className={layout === "page" ? styles.settingsPageBody : styles.settingsModalBody}>
      <nav className={styles.settingsNav} aria-label="Ayar bölümleri">
        <button type="button" className={styles.backToAppButton} onClick={onClose}>
          <ArrowLeft size={15} aria-hidden="true" />
          <span>Uygulamaya geri dön</span>
        </button>
        <div className={styles.navSearchWrap}>
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            placeholder="Ayarlarda ara…"
            value={navSearch}
            onChange={(e) => setNavSearch(e.target.value)}
            className={styles.navSearch}
            aria-label="Ayarlarda ara"
          />
        </div>
        <div className={styles.navScroll}>
          {(searchQuery ? filteredGroups : NAV_GROUPS).map((group, gi) => (
            <div key={group.label || `g-${gi}`} className={styles.navGroup}>
              {group.label ? <div className={styles.navGroupLabel}>{group.label}</div> : null}
              {group.items.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={`${styles.settingsNavItem} ${view === section.id ? styles.settingsNavActive : ""}`}
                  onClick={() => goTo(section.id)}
                  aria-current={view === section.id ? "page" : undefined}
                >
                  <span className={styles.navIcon}><SectionIcon id={section.id} /></span>
                  <span>{section.label}</span>
                </button>
              ))}
            </div>
          ))}
          {searchQuery && filteredGroups.length === 0 && (
            <div className={styles.navEmpty}>Sonuç bulunamadı</div>
          )}
        </div>
      </nav>

      {/* Right content pane */}
      <div className={styles.settingsContent} data-settings-view={view}>
        {layout === "modal" && (
          <button type="button" className={styles.settingsCloseX} onClick={onClose} aria-label="Ayarları kapat"><X size={18} aria-hidden="true" /></button>
        )}

        <div className={styles.settingsHeader}>
          <button type="button" className={styles.mobileBack} onClick={() => setMobileDetailOpen(false)}>
            <ArrowLeft size={16} aria-hidden="true" />
            Tüm ayarlar
          </button>
          <h2>{active.title}</h2>
          {active.desc && <p className={styles.settingsDesc}>{active.desc}</p>}
        </div>

        {view === "general" && (
          <GeneralSettings />
        )}

        {view === "appearance" && (
          <AppearanceSettings density={density} theme={theme} onDensity={onDensity} onTheme={onTheme} />
        )}

        {view === "goal-mode" && (
          <div className={styles.settingsViewContent}>
            <GoalModeSettingsSection />
          </div>
        )}

        {view === "permissions" && (
          <div className={styles.settingsViewContent}>
            <SecuritySection
              onOpenWorkspace={onOpenWorkspace}
              onTerminalPolicy={onTerminalPolicy}
              onBlockImages={onBlockImages}
              onShowImages={onShowImages}
            />
            <GuardianDurableAllowsSection />
          </div>
        )}

        {view === "models" && (
          <div className={styles.settingsViewContent}>
            <ModelSection onThinking={onThinking} onSetModel={onSetModel} onSetDefaultModel={onSetDefaultModel} onSetDefaultThinking={onSetDefaultThinking} />
          </div>
        )}

        {view === "providers" && (
          <div className={styles.settingsViewContent}>
            <ProvidersSection onSetModel={onSetModel} onSetDefaultModel={onSetDefaultModel} />
          </div>
        )}

        {view === "computer-use" && (
          <div className={styles.settingsViewContent}>
            <ComputerUseSettingsSection />
          </div>
        )}

        {view === "mcp" && (
          <div className={styles.settingsViewContent}>
            <McpServersSection />
          </div>
        )}

        {view === "shortcuts" && (
          <div className={styles.settingsViewContent}>
            <KeyboardSection />
          </div>
        )}

        {view === "about" && (
          <div className={styles.settingsViewContent}>
            <AboutSection />
          </div>
        )}

        {view === "customizations" && (
          <div className={styles.settingsViewContent}>
            <ExtensionsSection />
            <PromptsSection />
          </div>
        )}

        {view === "app" && (
          <div className={styles.settingsViewContent}>
            <NotificationsSection />
          </div>
        )}

        {view === "advanced" && (
          <div className={styles.settingsViewContent}>
            <AdvancedSection onCompact={onCompact} onClearPromptHistory={onClearPromptHistory} onAutoCompaction={onAutoCompaction} />
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

/** Memoized so parent App re-renders (chat stream) do not repaint the whole settings tree. */
export const SettingsPage = memo(SettingsPageInner);

function ModelSection({ onThinking, onSetModel, onSetDefaultModel, onSetDefaultThinking }: { onThinking: (level: any) => void; onSetModel: (value: string) => void; onSetDefaultModel?: (value: string) => void; onSetDefaultThinking?: (level: string) => void }) {
  // Narrow selectors — never subscribe to full `state` (updates every stream token).
  const models = useAppStore((s) => s.models);
  const thinkingLevel = useAppStore((s) => (s.state as any)?.thinkingLevel as string | undefined);
  const runtimeSettings = useAppStore((s) => s.runtimeSettings) || {};
  const configured = useMemo(() => listConfiguredModels(models as any[]), [models]);
  const current = useMemo(() => models.find((model: any) => model.current), [models]);
  const [pinned, setPinned] = useState<string[]>(() => readStorageArray<string>("quake-web:pinnedComposerModels"));

  useEffect(() => {
    let cancelled = false;
    void apiGet<any>("/api/web-settings").then((result) => {
      if (cancelled) return;
      const persisted = result?.settings?.pinnedComposerModels;
      if (!Array.isArray(persisted)) return;
      const next = persisted.filter((value: unknown): value is string => typeof value === "string");
      setPinned(next);
      writeStorageJson("quake-web:pinnedComposerModels", next);
      window.dispatchEvent(new CustomEvent("quake:pinned-models-change", { detail: next }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const togglePinned = useCallback((value: string) => {
    setPinned((prev) => {
      const next = prev.includes(value) ? prev.filter((m) => m !== value) : [...prev, value];
      writeStorageJson("quake-web:pinnedComposerModels", next);
      window.dispatchEvent(new CustomEvent("quake:pinned-models-change", { detail: next }));
      void apiPost("/api/web-settings", { pinnedComposerModels: next }).catch(() => {
        // Server persistence is authoritative; roll back the optimistic local copy on failure.
        setPinned(prev);
        writeStorageJson("quake-web:pinnedComposerModels", prev);
        window.dispatchEvent(new CustomEvent("quake:pinned-models-change", { detail: prev }));
      });
      return next;
    });
  }, []);

  return (
    <>
      <section className={styles.card}>
        <h3>Model</h3>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Geçerli model<small>Yeni mesajlarda kullanılır</small></span>
          <select className={styles.select} value={current ? `${current.provider}/${current.id}` : ""} onChange={(event) => onSetModel(event.target.value)}>
            {configured.length === 0 && <option value="">Yapılandırılmış model yok</option>}
            {configured.map((model: any) => (
              <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>{formatModelRefLabel(model)}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Düşünme seviyesi {!current?.reasoning && <span className={styles.badge}>desteklenmiyor</span>}<small>Akıl yürütme derinliği</small></span>
          <select className={styles.select} value={thinkingLevel || runtimeSettings.defaultThinkingLevel || "medium"} onChange={(event) => onThinking(event.target.value)} disabled={!current?.reasoning}>
            <option value="off">Kapalı</option>
            <option value="minimal">Minimum</option>
            <option value="low">Düşük</option>
            <option value="medium">Orta</option>
            <option value="high">Yüksek</option>
            {current?.supportsXhigh && <option value="xhigh">Ekstra yüksek</option>}
            {current?.supportsMax && <option value="max">Maksimum</option>}
          </select>
        </label>
      </section>

      {(onSetDefaultModel || onSetDefaultThinking) && (
        <section className={styles.card}>
          <h3>Yeni oturum varsayılanları</h3>
          <p className={styles.cardDesc}>Yeni sohbetlerin başlayacağı model ve düşünme seviyesi (geçerli oturumu etkilemez).</p>
          <div className={styles.facts}>
            {onSetDefaultModel && (
              <div className={styles.factRow}>
                <b>Varsayılan model</b>
                <span className={styles.inlineControl}>
                  <span>{runtimeSettings.defaultModel
                    ? formatModelDisplayLabel(
                        `${runtimeSettings.defaultProvider ? `${runtimeSettings.defaultProvider}/` : ""}${runtimeSettings.defaultModel}`,
                        configured.find((m: any) => m.provider === runtimeSettings.defaultProvider && m.id === runtimeSettings.defaultModel)?.name,
                      )
                    : "ayarlı değil"}</span>
                  {current && <button type="button" className={styles.smallBtn} onClick={() => onSetDefaultModel(`${current.provider}/${current.id}`)}>Geçerliyi ata</button>}
                </span>
              </div>
            )}
            {onSetDefaultThinking && (
              <div className={styles.factRow}>
                <b>Varsayılan düşünme</b>
                <span className={styles.inlineControl}>
                  <span>{runtimeSettings.defaultThinkingLevel || "ayarlı değil"}</span>
                  <button type="button" className={styles.smallBtn} onClick={() => onSetDefaultThinking(String(thinkingLevel || runtimeSettings.defaultThinkingLevel || "medium"))} disabled={!current?.reasoning}>Geçerliyi ata</button>
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      <section className={styles.card}>
        <h3>Sohbet model listesi</h3>
        <p className={styles.cardDesc}>Sohbet çubuğunda görünecek modelleri seç. Hiçbiri seçilmezse bağlı provider’ların tüm modelleri gösterilir (giriş yapılmamış provider’lar listede yoktur).</p>
        <div className={styles.checkList}>
          {configured.length === 0 && <p className={styles.muted}>Yapılandırılmış model yok.</p>}
          {configured.map((model: any) => {
            const value = `${model.provider}/${model.id}`;
            return (
              <label key={value} className={styles.checkRow}>
                <input type="checkbox" checked={pinned.includes(value)} onChange={() => togglePinned(value)} />
                <span>{formatModelRefLabel(model)}</span>
              </label>
            );
          })}
        </div>
      </section>
    </>
  );
}

type GuardianDurableAllows = {
  commandKeys: string[];
  prefixes: string[][];
  hosts: { allow: string[]; deny: string[] };
};

function emptyGuardianAllows(): GuardianDurableAllows {
  return { commandKeys: [], prefixes: [], hosts: { allow: [], deny: [] } };
}

/** Settings → İzinler → Kalıcı izinler (S-TRUST.2) — durable guardian allows, not MCP. */
function GuardianDurableAllowsSection() {
  const [allows, setAllows] = useState<GuardianDurableAllows>(emptyGuardianAllows);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const showToast = useAppStore((state) => state.showToast);
  const { confirm } = useConfirmAction();

  useEffect(() => {
    let alive = true;
    apiGet<{ allows?: GuardianDurableAllows }>("/api/security/guardian-allows")
      .then((result) => {
        if (!alive) return;
        setAllows(result?.allows && typeof result.allows === "object" ? {
          commandKeys: Array.isArray(result.allows.commandKeys) ? result.allows.commandKeys : [],
          prefixes: Array.isArray(result.allows.prefixes) ? result.allows.prefixes : [],
          hosts: {
            allow: Array.isArray(result.allows.hosts?.allow) ? result.allows.hosts.allow : [],
            deny: Array.isArray(result.allows.hosts?.deny) ? result.allows.hosts.deny : [],
          },
        } : emptyGuardianAllows());
      })
      .catch(() => {
        if (alive) showToast("Kalıcı izinler yüklenemedi", "error");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [showToast]);

  const total =
    allows.commandKeys.length +
    allows.prefixes.length +
    allows.hosts.allow.length +
    allows.hosts.deny.length;

  async function removeCommandKey(key: string) {
    if (pending) return;
    setPending(true);
    try {
      const result = await apiDelete<{ allows?: GuardianDurableAllows }>(
        `/api/security/guardian-allows?kind=commandKey&key=${encodeURIComponent(key)}`,
      );
      if (result?.allows) setAllows(result.allows);
      showToast("Kalıcı komut izni kaldırıldı", "success");
    } catch (error: any) {
      showToast(error?.message || "İzin kaldırılamadı", "error");
    } finally {
      setPending(false);
    }
  }

  async function removePrefix(prefix: string[]) {
    if (pending) return;
    setPending(true);
    try {
      const result = await apiDelete<{ allows?: GuardianDurableAllows }>(
        `/api/security/guardian-allows?kind=prefix&prefix=${encodeURIComponent(JSON.stringify(prefix))}`,
      );
      if (result?.allows) setAllows(result.allows);
      showToast("Kalıcı önek izni kaldırıldı", "success");
    } catch (error: any) {
      showToast(error?.message || "İzin kaldırılamadı", "error");
    } finally {
      setPending(false);
    }
  }

  async function removeHost(host: string, action: "allow" | "deny") {
    if (pending) return;
    setPending(true);
    try {
      const result = await apiDelete<{ allows?: GuardianDurableAllows }>(
        `/api/security/guardian-allows?kind=host&host=${encodeURIComponent(host)}&action=${action}`,
      );
      if (result?.allows) setAllows(result.allows);
      showToast("Kalıcı host kuralı kaldırıldı", "success");
    } catch (error: any) {
      showToast(error?.message || "İzin kaldırılamadı", "error");
    } finally {
      setPending(false);
    }
  }

  async function clearAll() {
    if (pending || total === 0) return;
    const accepted = await confirm({
      title: "Tüm kalıcı izinler silinsin mi?",
      message:
        "Komut, önek ve host kalıcı izinleri temizlenecek. Oturum izinleri ve MCP “her zaman izin” listesi etkilenmez.",
      variant: "danger",
      confirmLabel: "Tümünü temizle",
    });
    if (!accepted) return;
    setPending(true);
    try {
      await apiPost("/api/security/guardian-allows/clear", {});
      setAllows(emptyGuardianAllows());
      showToast("Kalıcı izinler temizlendi", "success");
    } catch (error: any) {
      showToast(error?.message || "Kalıcı izinler temizlenemedi", "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.card}>
      <h3>Kalıcı izinler</h3>
      <p className={styles.cardDesc}>
        Composer’da “Her zaman izin ver” veya kalıcı önek/host seçenekleriyle kaydedilen izinler yeniden başlatmadan
        sonra da geçerlidir. Oturum boyu izinler bellek-içidir ve kapanınca silinir; oturum temizliği bu listeyi silmez.
        MCP araç izinleri ayrıdır (MCP bölümü).
      </p>
      {loading ? (
        <p className={styles.muted}>Yükleniyor…</p>
      ) : total === 0 ? (
        <p className={styles.muted}>Kalıcı komut, önek veya host izni yok.</p>
      ) : (
        <>
          {allows.commandKeys.length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <b style={{ fontSize: 12, opacity: 0.85 }}>Komutlar (tool::özet)</b>
              <div className={styles.list} style={{ marginTop: 6 }}>
                {allows.commandKeys.map((key) => (
                  <div key={key} className={styles.listItem}>
                    <div className={styles.listItemMain}>
                      <b style={{ fontFamily: "var(--font-mono)", fontSize: 12, wordBreak: "break-all" }}>{key}</b>
                      <span>Tam eşleşme · kalıcı</span>
                    </div>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      disabled={pending}
                      onClick={() => void removeCommandKey(key)}
                      aria-label={`${key} kalıcı iznini kaldır`}
                    >
                      Kaldır
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {allows.prefixes.length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <b style={{ fontSize: 12, opacity: 0.85 }}>Komut önekleri</b>
              <div className={styles.list} style={{ marginTop: 6 }}>
                {allows.prefixes.map((prefix) => {
                  const label = prefix.join(" ");
                  return (
                    <div key={label} className={styles.listItem}>
                      <div className={styles.listItemMain}>
                        <b style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{label}</b>
                        <span>Önek eşleşmesi · kalıcı</span>
                      </div>
                      <button
                        type="button"
                        className={styles.smallBtn}
                        disabled={pending}
                        onClick={() => void removePrefix(prefix)}
                        aria-label={`${label} önek iznini kaldır`}
                      >
                        Kaldır
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {allows.hosts.allow.length > 0 || allows.hosts.deny.length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <b style={{ fontSize: 12, opacity: 0.85 }}>Host’lar</b>
              <div className={styles.list} style={{ marginTop: 6 }}>
                {allows.hosts.allow.map((host) => (
                  <div key={`allow:${host}`} className={styles.listItem}>
                    <div className={styles.listItemMain}>
                      <b style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{host}</b>
                      <span>İzin ver · kalıcı</span>
                    </div>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      disabled={pending}
                      onClick={() => void removeHost(host, "allow")}
                      aria-label={`${host} host iznini kaldır`}
                    >
                      Kaldır
                    </button>
                  </div>
                ))}
                {allows.hosts.deny.map((host) => (
                  <div key={`deny:${host}`} className={styles.listItem}>
                    <div className={styles.listItemMain}>
                      <b style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{host}</b>
                      <span>Engelle · kalıcı</span>
                    </div>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      disabled={pending}
                      onClick={() => void removeHost(host, "deny")}
                      aria-label={`${host} host engelini kaldır`}
                    >
                      Kaldır
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className={styles.inlineControl} style={{ marginTop: 4 }}>
            <button type="button" className={styles.smallBtn} disabled={pending} onClick={() => void clearAll()}>
              Tümünü temizle
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function SecuritySection({ onOpenWorkspace, onTerminalPolicy, onBlockImages, onShowImages }: { onOpenWorkspace?: () => void; onTerminalPolicy?: (mode: "safe" | "allow-all" | "disabled") => void | Promise<void>; onBlockImages?: (blocked: boolean) => void; onShowImages?: (show: boolean) => void }) {
  const config = useAppStore((s) => s.config) || {};
  const runtimeSettings = useAppStore((s) => s.runtimeSettings) || {};
  const setStore = useAppStore((s) => s.set);
  const { confirm } = useConfirmAction();
  const [terminalPending, setTerminalPending] = useState(false);
  const [proxyPending, setProxyPending] = useState(false);
  const [osSandboxPending, setOsSandboxPending] = useState(false);
  const [worktreePending, setWorktreePending] = useState(false);
  const host = String(config.host ?? "");

  function applyConfigPatch(nextConfig: Record<string, unknown> | undefined) {
    if (!nextConfig || typeof nextConfig !== "object") return;
    const prev = useAppStore.getState().config || {};
    setStore({ config: { ...prev, ...nextConfig } });
  }

  async function changeTerminalPolicy(mode: "safe" | "allow-all" | "disabled") {
    if (!onTerminalPolicy || terminalPending || mode === config.terminalPolicyMode) return;
    if (mode === "allow-all") {
      const accepted = await confirm({
        title: "Full Access açılsın mı?",
        message:
          "Codex Full Access: ajan onay sormadan komut çalıştırabilir ve workspace dışına yazabilir. Yalnızca güvendiğiniz ortamlarda kullanın.",
        variant: "warning",
        confirmLabel: "Full Access",
      });
      if (!accepted) return;
    }
    setTerminalPending(true);
    try { await onTerminalPolicy(mode); } finally { setTerminalPending(false); }
  }

  async function changeAgentHttpProxy(enabled: boolean) {
    if (proxyPending || enabled === Boolean(config.agentHttpProxyEnabled)) return;
    if (enabled) {
      const accepted = await confirm({
        title: "Ajan ağ proxy açılsın mı?",
        message:
          "Bu ayar yalnızca HTTP_PROXY / HTTPS_PROXY’ye uyan araçları (ör. curl, git, bazı paket yöneticileri) loopback üzerinden yönlendirir. İşletim sistemi duvarı veya şeffaf MITM değildir. Uçuş sırasında bilinmeyen host’lar reddedilir (fail-closed). Ham soketler proxy’yi atlar.",
        variant: "warning",
        confirmLabel: "Etkinleştir",
      });
      if (!accepted) return;
    }
    setProxyPending(true);
    try {
      const result = await apiPatch<{ config?: Record<string, unknown> }>("/api/security/agent-http-proxy", { enabled });
      applyConfigPatch(result.config);
      useAppStore.getState().showToast(
        enabled ? "Ajan ağ proxy etkinleştirildi" : "Ajan ağ proxy kapatıldı",
        "success",
      );
    } catch (error: any) {
      useAppStore.getState().showToast(
        `Ajan ağ proxy ayarlanamadı: ${error?.message || "bilinmeyen hata"}`,
        "error",
      );
    } finally {
      setProxyPending(false);
    }
  }

  async function changeOsSandboxExperimental(experimental: boolean) {
    if (osSandboxPending || experimental === Boolean(config.osSandboxExperimental)) return;
    if (experimental) {
      const accepted = await confirm({
        title: "Deneysel OS sandbox bayrağı açılsın mı?",
        message:
          "Bu Windows Sandbox değildir. Yardımcı (QUAKE_COMMAND_RUNNER) yokken bash komutları fail-closed ile başarısız olur — sessizce host’a düşmez. PTY terminal paneli sandboxed değildir. Yalnızca yardımcı kurulu ortamda veya bilinçli test için açın.",
        variant: "warning",
        confirmLabel: "Bayrağı aç",
      });
      if (!accepted) return;
    }
    setOsSandboxPending(true);
    try {
      const result = await apiPatch<{ config?: Record<string, unknown> }>("/api/security/os-sandbox", { experimental });
      applyConfigPatch(result.config);
      useAppStore.getState().showToast(
        experimental ? "Deneysel OS sandbox bayrağı açıldı" : "OS sandbox host (politika) moduna döndü",
        experimental ? "warning" : "success",
      );
    } catch (error: any) {
      useAppStore.getState().showToast(
        `OS sandbox ayarlanamadı: ${error?.message || "bilinmeyen hata"}`,
        "error",
      );
    } finally {
      setOsSandboxPending(false);
    }
  }

  async function changeAgentWorktreeIsolation(enabled: boolean) {
    // Default is true (Codex parity); only treat explicit false as off.
    const current = config.agentWorktreeIsolation !== false;
    if (worktreePending || enabled === current) return;
    if (!enabled) {
      const accepted = await confirm({
        title: "Worktree izolasyonu kapatılsın mı?",
        message:
          "Kapatılırsa paralel ajanlar aynı klasörde çalışır ve dosyaları birbirinin üzerine yazabilir. Codex tarzı güvenli paralel çalışma için açık bırakmanız önerilir.",
        variant: "warning",
        confirmLabel: "Kapat",
      });
      if (!accepted) return;
    }
    setWorktreePending(true);
    try {
      const result = await apiPatch<{ config?: Record<string, unknown> }>("/api/security/agent-worktree-isolation", { enabled });
      applyConfigPatch(result.config);
      useAppStore.getState().showToast(
        enabled ? "Paralel ajan worktree izolasyonu açık" : "Paralel ajanlar ana klasörde çalışacak",
        enabled ? "success" : "warning",
      );
    } catch (error: any) {
      useAppStore.getState().showToast(
        `Worktree izolasyonu ayarlanamadı: ${error?.message || "bilinmeyen hata"}`,
        "error",
      );
    } finally {
      setWorktreePending(false);
    }
  }

  const proxyStatus = String(config.agentHttpProxyStatus || (config.agentHttpProxyEnabled ? "error" : "off"));
  const proxyUrl = typeof config.agentHttpProxyUrl === "string" ? config.agentHttpProxyUrl : "";
  const proxyHostPort = (() => {
    if (!proxyUrl) return "";
    try {
      const u = new URL(proxyUrl);
      return `${u.hostname}:${u.port}`;
    } catch {
      return proxyUrl.replace(/^https?:\/\//, "");
    }
  })();

  const osMode = config.osSandboxMode === "experimental" || config.osSandboxExperimental ? "experimental" : "off";
  const osBackendId = String(config.osSandboxBackendId || (osMode === "experimental" ? "experimental-unavailable" : "host"));
  const osAvailable = config.osSandboxAvailable !== false || osMode === "off";
  const osStatusLabel =
    osMode === "off"
      ? "Host (politika)"
      : osAvailable && osBackendId !== "experimental-unavailable"
        ? `Experimental — ${osBackendId}`
        : "Experimental — helper yok (fail-closed)";
  const osHelperPath = typeof config.osSandboxHelperPath === "string" && config.osSandboxHelperPath
    ? config.osSandboxHelperPath
    : null;

  const isLocal = LOCALHOST_HOSTS.has(host);
  return (
    <>
      <section className={styles.card}>
        <h3>Bağlantı & kimlik doğrulama</h3>
        <p className={styles.cardDesc}>Sunucu adresi, kimlik doğrulama ve erişim kapsamı.</p>
        <div className={styles.facts}>
          <div className={styles.factRow}><b>Sunucu</b><span>{host || "—"}:{config.port ?? "—"}</span></div>
          <div className={styles.factRow}><b>Kimlik doğrulama</b><span>{config.authEnabled ? <Pill tone="ok">Açık</Pill> : <Pill tone="warn">Kapalı</Pill>}</span></div>
          <div className={styles.factRow}><b>Uzak erişim</b><span>{isLocal ? <Pill tone="ok">Yalnızca localhost</Pill> : <Pill tone="warn">Uzak bağlantı açık</Pill>}</span></div>
        </div>
      </section>

      <section className={styles.card}>
        <h3>Erişim rejimi (Codex approval)</h3>
        <p className={styles.cardDesc}>
          Codex’teki gibi: Read Only / Default / Full Access. Riskli komutlarda “Onayla”, “Benim için onayla (oturum)”, “Reddet”, “İptal” sorulur.
        </p>
        <div className={styles.facts}>
          <div className={styles.factRow}><b>Durum</b><span>{config.terminalEnabled ? <Pill tone="ok">Açık</Pill> : <Pill tone="muted">Kapalı</Pill>}</span></div>
          <div className={styles.factRow}>
            <b>Rejim</b>
            <span>{onTerminalPolicy ? (
              <select className={styles.select} style={{ maxWidth: 260 }} value={String(config.terminalPolicyMode || "safe")} disabled={terminalPending} aria-busy={terminalPending} onChange={(event) => void changeTerminalPolicy(event.target.value as "safe" | "allow-all" | "disabled")}>
                <option value="disabled">Read Only — yalnız oku, yazma/komut onayı ister</option>
                <option value="safe">Default — workspace’te çalış, riskli işlerde sor</option>
                <option value="allow-all">Full Access — onay sorma (dikkat)</option>
              </select>
            ) : "Sunucu tarafında uygulanır"}</span>
          </div>
        </div>
        <p className={styles.cardDesc} style={{ marginTop: 8 }}>
          Full Access = Codex “Full Access” (approval never + danger-full-access). Default = workspace write + on-request. Read Only = dosya/shell için onay.
        </p>
        <p className={styles.muted} style={{ marginTop: 8 }}>
          Seçiminiz kaydedilir ve uygulama yeniden başlatıldığında korunur. Bu rejim onay politikasıdır; işletim sistemi izolasyonu değildir.
        </p>
      </section>

      <section className={styles.card}>
        <h3>Ajan ağ proxy (işbirlikçi)</h3>
        <p className={styles.cardDesc}>
          Yalnızca HTTP_PROXY / HTTPS_PROXY’ye uyan araçları loopback proxy’ye yönlendirir. Şeffaf işletim sistemi duvarı veya MITM değildir.
          Uçuş sırasında bilinmeyen host’lar reddedilir. Varsayılan: kapalı.
        </p>
        <div className={styles.toggleRow}>
          <span className={styles.toggleLabel}>
            İşbirlikçi HTTP proxy
            <small>Ajan bash çocuk süreçlerine HTTP(S)_PROXY enjekte edilir</small>
          </span>
          <Switch
            checked={Boolean(config.agentHttpProxyEnabled)}
            onChange={(value) => void changeAgentHttpProxy(value)}
            disabled={proxyPending}
            label="İşbirlikçi HTTP proxy"
          />
        </div>
        <div className={styles.facts}>
          <div className={styles.factRow}>
            <b>Durum</b>
            <span>
              {proxyStatus === "active" ? (
                <Pill tone="ok">Aktif ({proxyHostPort || "127.0.0.1"})</Pill>
              ) : proxyStatus === "error" ? (
                <Pill tone="error">Hata</Pill>
              ) : (
                <Pill tone="muted">Kapalı</Pill>
              )}
            </span>
          </div>
          {proxyStatus === "error" && config.agentHttpProxyError ? (
            <div className={styles.factRow}>
              <b>Ayrıntı</b>
              <span className={styles.muted}>{String(config.agentHttpProxyError)}</span>
            </div>
          ) : null}
        </div>
        <p className={styles.muted} style={{ marginTop: 8 }}>
          Ham TCP/UDP soketleri ve proxy’yi yok sayan araçlar kapsanmaz. Ayar uygulama genelinde kaydedilir.
        </p>
      </section>

      <section className={styles.card}>
        <h3>İşletim sistemi izolasyonu</h3>
        <p className={styles.cardDesc}>
          Bugünkü varsayılan yol politika tabanlıdır (workspace / execpolicy / guardian). Gerçek OS süreç izolasyonu için yerel yardımcı gerekir;
          yardımcı yokken deneysel bayrak fail-closed çalışır. Bu “Windows Sandbox” değildir.
        </p>
        <div className={styles.facts}>
          <div className={styles.factRow}>
            <b>Durum</b>
            <span>
              {osMode === "off" ? (
                <Pill tone="ok">{osStatusLabel}</Pill>
              ) : osAvailable ? (
                <Pill tone="warn">{osStatusLabel}</Pill>
              ) : (
                <Pill tone="error">{osStatusLabel}</Pill>
              )}
            </span>
          </div>
          <div className={styles.factRow}><b>Backend</b><span>{osBackendId}</span></div>
          {osHelperPath ? (
            <div className={styles.factRow}><b>Yardımcı</b><span>{osHelperPath}</span></div>
          ) : (
            <div className={styles.factRow}><b>Yardımcı</b><span className={styles.muted}>QUAKE_COMMAND_RUNNER tanımlı değil</span></div>
          )}
        </div>
        <div className={styles.toggleRow} style={{ marginTop: "var(--space-3)" }}>
          <span className={styles.toggleLabel}>
            Experimental OS sandbox bayrağı
            <small>QUAKE_OS_SANDBOX=experimental — helper yoksa bash fail-closed</small>
          </span>
          <Switch
            checked={Boolean(config.osSandboxExperimental) || osMode === "experimental"}
            onChange={(value) => void changeOsSandboxExperimental(value)}
            disabled={osSandboxPending}
            label="Experimental OS sandbox bayrağı"
          />
        </div>
        <p className={styles.muted} style={{ marginTop: 8 }}>
          PTY (etkileşimli terminal paneli) OS izolasyonu dışındadır: TerminalPolicy / OsSandboxBackend uygulanmaz
          ve ajan worktree izolasyonunu atlayabilir. Yalnızca ajan bash yolu OsSandboxBackend üzerinden geçer.
          Ayrıntılar için docs/CODEX_WINDOWS_SANDBOX.md.
        </p>
      </section>

      <section className={styles.card}>
        <h3>Paralel izole ajanlar (worktree)</h3>
        <p className={styles.cardDesc}>
          Codex gibi: birden fazla ajan aynı anda çalışırken her biri git worktree ile ayrı kopyada düzenler.
          Biten ajanın değişiklikleri bir branch’e yazılır; sen <code>git merge …</code> ile birleştirirsin.
          Git deposu ve en az bir commit gerekir; aksi halde spawn fail-closed olur.
        </p>
        <div className={styles.toggleRow}>
          <span className={styles.toggleLabel}>
            Worktree izolasyonu
            <small>Varsayılan açık — QUAKE_CODE_AGENT_ISOLATION=worktree</small>
          </span>
          <Switch
            checked={config.agentWorktreeIsolation !== false}
            onChange={(value) => void changeAgentWorktreeIsolation(value)}
            disabled={worktreePending}
            label="Paralel ajan worktree izolasyonu"
          />
        </div>
        <div className={styles.facts}>
          <div className={styles.factRow}>
            <b>Durum</b>
            <span>
              {config.agentWorktreeIsolation !== false ? (
                <Pill tone="ok">Açık (izole kopya)</Pill>
              ) : (
                <Pill tone="warn">Kapalı (paylaşılan klasör)</Pill>
              )}
            </span>
          </div>
        </div>
        <p className={styles.muted} style={{ marginTop: 8 }}>
          Kullanım: sohbette “iki paralel worker ile X ve Y’yi ayrı worktree’de yap” deyin; ana ajan spawn_agent ile dallanır.
          Sohbet özetinde worktree rozeti görünür.
        </p>
      </section>

      {(onBlockImages || onShowImages) && (
        <section className={styles.card}>
          <h3>Gizlilik</h3>
          <p className={styles.cardDesc}>Sağlayıcıya gönderilen ve arayüzde gösterilen içerikleri denetle.</p>
          {onBlockImages && (
            <div className={styles.toggleRow}>
              <span className={styles.toggleLabel}>Görselleri modele gönderme<small>Görseller sağlayıcıya iletilmez</small></span>
              <Switch checked={Boolean(runtimeSettings.blockImages)} onChange={onBlockImages} label="Görselleri modele gönderme" />
            </div>
          )}
          {onShowImages && (
            <div className={styles.toggleRow}>
              <span className={styles.toggleLabel}>Görselleri arayüzde göster<small>Üretilen/eklenen görsel önizlemeleri</small></span>
              <Switch checked={Boolean(runtimeSettings.showImages)} onChange={onShowImages} label="Görselleri arayüzde göster" />
            </div>
          )}
        </section>
      )}

      <section className={styles.card}>
        <h3>Çalışma alanı</h3>
        <p className={styles.cardDesc}>Aktif dizin, izinli kökler ve dosya önizleme sınırları.</p>
        <div className={styles.facts}>
          <div className={styles.factRow}><b>Dizin</b><span>{config.cwd || "—"}</span></div>
          <div className={styles.factRow}><b>İzinli kökler</b><span>{config.workspaceAllowlist?.length ? config.workspaceAllowlist.join(", ") : "Tanımlı değil"}</span></div>
          <div className={styles.factRow}><b>Dosya önizleme sınırı</b><span>{config.maxFilePreviewBytes ? `${Math.round(config.maxFilePreviewBytes / 1024)} KB` : "—"}</span></div>
        </div>
        {onOpenWorkspace && (
          <div className={styles.actionRow} style={{ marginTop: "var(--space-4)" }}>
            <div className={styles.actionText}>
              <b>Çalışma alanını değiştir</b>
              <span>Başka bir klasör aç (aktif workspace).</span>
            </div>
            <button type="button" className={styles.smallBtn} onClick={onOpenWorkspace}>Değiştir…</button>
          </div>
        )}
      </section>
    </>
  );
}

function Pill({ tone, children }: { tone: "ok" | "warn" | "muted" | "error"; children: React.ReactNode }) {
  return <span className={`${styles.pill} ${styles[`pill_${tone}`]}`}>{children}</span>;
}

function ComputerUseSettingsSection() {
  const [policy, setPolicy] = useState<{ actuateEnabled: boolean; stepLimit: number; toolMode?: string } | null>(null);
  const [extensionEnabled, setExtensionEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string>();
  const [stepDraft, setStepDraft] = useState("40");
  const { confirm } = useConfirmAction();

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiGet<any>("/api/computer-use/policy").then((d) => d.policy).catch(() => null),
      apiGet<any>("/api/extensions").then((d) => d.extensions || []).catch(() => []),
    ]).then(([pol, extensions]) => {
      if (!alive) return;
      if (pol) { setPolicy(pol); setStepDraft(String(pol.stepLimit ?? 40)); }
      const computer = extensions.find((ext: any) => ext.id === "quake-computer-use" || ext.name === "Computer Use");
      setExtensionEnabled(Boolean(computer?.enabled));
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  async function patchPolicy(patch: Partial<{ actuateEnabled: boolean; stepLimit: number; toolMode: string }>, key: string) {
    if (pending) return;
    if (patch.actuateEnabled === true) {
      const accepted = await confirm({ title: "Masaüstü etkileşimi etkinleştirilsin mi?", message: "Ajan gerçek fare ve klavye girdileri gönderebilir. Yalnızca görevi ve açık uygulamaları kontrol ettiğinizde etkinleştirin.", variant: "warning", confirmLabel: "Etkinleştir" });
      if (!accepted) return;
    }
    const previous = policy || { actuateEnabled: false, stepLimit: 40, toolMode: "custom" };
    const next = { ...previous, ...patch };
    setPolicy(next);
    setPending(key);
    try {
      const result = await apiPost<any>("/api/computer-use/policy", next);
      const saved = result?.policy || next;
      setPolicy(saved);
      setStepDraft(String(saved.stepLimit ?? 40));
      useAppStore.getState().showToast("Computer-Use ayarı kaydedildi", "success");
    } catch {
      setPolicy(previous);
      setStepDraft(String(previous.stepLimit ?? 40));
      useAppStore.getState().showToast("Computer-Use ayarı kaydedilemedi", "error");
    } finally { setPending(undefined); }
  }

  async function toggleExtension(enabled: boolean) {
    if (pending) return;
    if (enabled) {
      const accepted = await confirm({ title: "Computer Use eklentisi etkinleştirilsin mi?", message: "Bu eklenti masaüstü otomasyon araçlarını runtime'a yükler. Etkileşim araçları ayrıca aşağıdan açılmalıdır.", variant: "warning", confirmLabel: "Eklentiyi etkinleştir" });
      if (!accepted) return;
    }
    const previous = extensionEnabled;
    setExtensionEnabled(enabled);
    setPending("extension");
    try { await apiPost("/api/extensions/toggle", { id: "quake-computer-use", enabled }); }
    catch {
      setExtensionEnabled(previous);
      useAppStore.getState().showToast("Computer-Use eklentisi değiştirilemedi", "error");
    } finally { setPending(undefined); }
  }

  function commitStepLimit() {
    const value = Math.max(5, Math.min(200, Number(stepDraft) || 40));
    setStepDraft(String(value));
    if (value !== policy?.stepLimit) void patchPolicy({ stepLimit: value }, "steps");
  }

  return (
    <section className={styles.card}>
      <h3>Masaüstü Computer-Use</h3>
      <p className={styles.cardDesc}>
        Ajan gerçek Windows masaüstünde fare/klavye kullanır (SendInput + UI Automation). Web siteleri için değil —
        web için tarayıcı panelini (<code>browser_*</code>) kullanın.
      </p>
      {loading ? (
        <p className={styles.muted}>Yükleniyor…</p>
      ) : (
        <div className={styles.list}>
          <div className={styles.listItem}>
            <div className={styles.listItemMain}>
              <b>Eklentiyi etkinleştir</b>
              <span>Varsayılan kapalıdır; kurulum sonrası opt-in gerektirir.</span>
            </div>
            <Switch checked={extensionEnabled} disabled={Boolean(pending)} onChange={(value) => void toggleExtension(value)} label="Computer-Use eklentisi" />
          </div>
          <div className={styles.listItem}>
            <div className={styles.listItemMain}>
              <b>Etkileşim araçlarını etkinleştir</b>
              <span>Tıklama, yazma ve kaydırma araçları (desktop_click, desktop_type, desktop_ui_*, …).</span>
            </div>
            <Switch
              checked={Boolean(policy?.actuateEnabled)}
              disabled={Boolean(pending) || !extensionEnabled}
              onChange={(value) => void patchPolicy({ actuateEnabled: value }, "actuate")}
              label="Masaüstü etkileşim araçları"
            />
          </div>
          <div className={styles.listItem}>
            <div className={styles.listItemMain}>
              <b>Adım limiti</b>
              <span>Bir oturumda izin verilen maksimum computer-use adımı.</span>
            </div>
            <input
              className={styles.navSearch}
              type="number"
              min={5}
              max={200}
              value={stepDraft}
              disabled={Boolean(pending)}
              onChange={(event) => setStepDraft(event.target.value)}
              onBlur={commitStepLimit}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
              aria-label="Computer-use adım limiti"
            />
          </div>
          <div className={styles.listItem}>
            <div className={styles.listItemMain}>
              <b>Araç modu</b>
              <span>custom = desktop_* araçları; claude_native = Anthropic computer aracı.</span>
            </div>
            <select
              className={styles.convSelect}
              value={policy?.toolMode || "custom"}
              disabled={Boolean(pending)}
              onChange={(event) => void patchPolicy({ toolMode: event.target.value }, "toolMode")}
              aria-label="Computer-use araç modu"
            >
              <option value="custom">custom (desktop_*)</option>
              <option value="claude_native">claude_native (computer)</option>
            </select>
          </div>
          <div className={styles.listItem}>
            <div className={styles.listItemMain}>
              <b>Model önerisi</b>
              <span>
                Computer-Use için güçlü bir model seçin (Claude Opus/Sonnet, Gemini 3.x). Zayıf free modeller
                yanlış tıklar, oturumu bitirmez veya web ile masaüstünü karıştırır. Chat’te{" "}
                <code>@bilgisayar</code> ile masaüstü modunu açın.
              </span>
            </div>
          </div>
          <div className={styles.listItem}>
            <div className={styles.listItemMain}>
              <b>Ne yapar / ne yapmaz</b>
              <span>
                <b>İyi:</b> Calc, Notepad, Explorer, Edge/Chrome shell, Ayarlar, Open/Save diyalogları, menü/buton
                (UIA isimleriyle). <b>Zayıf / yok:</b> oyunlar, DirectX, özel canvas, DRM, UAC admin şifresi (asla
                otomatik), her app her zaman. Oturumdayken kenar pulse açıktır; sahte ajan imleci kapalıdır — gerçek fare hareket eder.
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

type McpDecision = "allow" | "ask" | "deny";
type McpServerSetting = {
  id: string; name: string; transport: "stdio" | "streamable-http" | "sse"; enabled: boolean; autoStart: boolean;
  command?: string; args?: string[]; cwd?: string; env?: Record<string, string>; url?: string; headers?: Record<string, string>;
  timeoutMs: number; toolPolicy: { default: McpDecision; overrides?: Record<string, McpDecision> }; reconnect?: { enabled: boolean; maxAttempts: number; baseDelayMs: number };
};
type McpToolSetting = { name: string; qualifiedName: string; title?: string; description?: string; decision: McpDecision; annotations?: { readOnly?: boolean; destructive?: boolean } };
type McpServerSnapshot = { config: McpServerSetting; status: string; tools: McpToolSetting[]; resources: any[]; prompts: any[]; lastError?: string };

type McpAlwaysAllowEntry = { key: string; serverId: string; toolName: string };

function McpServersSection() {
  const [servers, setServers] = useState<McpServerSetting[]>([]);
  const [snapshots, setSnapshots] = useState<McpServerSnapshot[]>([]);
  const [alwaysAllows, setAlwaysAllows] = useState<McpAlwaysAllowEntry[]>([]);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpServerSetting["transport"]>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [secretRefs, setSecretRefs] = useState("");
  const [defaultDecision, setDefaultDecision] = useState<McpDecision>("allow");
  const [expandedServer, setExpandedServer] = useState<string>();
  const [logsByServer, setLogsByServer] = useState<Record<string, Array<{ timestamp: number; level: string; message: string }>>>({});
  const [vaultNames, setVaultNames] = useState<string[]>([]);
  const [mcpPreview, setMcpPreview] = useState("");
  const [vaultName, setVaultName] = useState("");
  const [vaultValue, setVaultValue] = useState("");
  /** Bearer token MVP fields (remote HTTP MCP auth without full OAuth). */
  const [bearerTokenName, setBearerTokenName] = useState("MCP_BEARER_TOKEN");
  const [bearerTokenValue, setBearerTokenValue] = useState("");
  const [authHeaderMode, setAuthHeaderMode] = useState<"none" | "bearer-vault">("none");
  const [authVaultRef, setAuthVaultRef] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const showToast = useAppStore((state) => state.showToast);
  const { confirm } = useConfirmAction();

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiGet<any>("/api/web-settings"),
      apiGet<any>("/api/mcp/servers"),
      apiGet<{ tools?: McpAlwaysAllowEntry[] }>("/api/mcp/always-allows").catch(() => ({ tools: [] })),
      desktop?.mcpSecrets?.list().catch(() => []) || Promise.resolve([]),
    ]).then(([settingsResult, runtimeResult, alwaysResult, secretNames]) => {
      if (!alive) return;
      setServers(Array.isArray(settingsResult?.settings?.mcpServers) ? settingsResult.settings.mcpServers : []);
      setSnapshots(Array.isArray(runtimeResult?.servers) ? runtimeResult.servers : []);
      setAlwaysAllows(Array.isArray(alwaysResult?.tools) ? alwaysResult.tools : []);
      setVaultNames(Array.isArray(secretNames) ? secretNames : []);
    }).catch(() => showToast("MCP ayarları yüklenemedi", "error")).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [showToast]);

  async function removeServer(server: McpServerSetting) {
    const accepted = await confirm({ title: "MCP sunucusu silinsin mi?", message: `${server.name} yapılandırması bu çalışma alanından kaldırılacak ve çalışan process kapatılacak.`, variant: "danger", confirmLabel: "Sil" });
    if (!accepted || pending) return;
    setPending(true);
    try {
      await apiDelete(`/api/mcp/servers/${encodeURIComponent(server.id)}`);
      setServers((current) => current.filter((item) => item.id !== server.id));
      setSnapshots((current) => current.filter((item) => item.config.id !== server.id));
      showToast("MCP sunucusu kaldırıldı", "success");
    } catch { showToast("MCP sunucusu kaldırılamadı", "error"); }
    finally { setPending(false); }
  }

  function buildRemoteHeaders(): Record<string, string> | undefined {
    let referenceMap: Record<string, string> = {};
    if (secretRefs.trim()) {
      try {
        const parsed = JSON.parse(secretRefs);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) {
          throw new Error();
        }
        referenceMap = parsed as Record<string, string>;
      } catch {
        showToast("Env/header alanı geçerli bir JSON string sözlüğü olmalı", "warning");
        return undefined;
      }
    }
    if (authHeaderMode === "bearer-vault") {
      const refName = (authVaultRef || bearerTokenName || "MCP_BEARER_TOKEN").trim().toUpperCase();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(refName)) {
        showToast("Vault secret adı geçersiz", "warning");
        return undefined;
      }
      // Prefer explicit JSON Authorization if user provided one; otherwise wire Bearer vault ref.
      if (!referenceMap.Authorization && !referenceMap.authorization) {
        referenceMap.Authorization = `Bearer \${vault:${refName}}`;
      }
    }
    return Object.keys(referenceMap).length ? referenceMap : undefined;
  }

  function addServer(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || pending || (transport === "stdio" ? !command.trim() : !remoteUrl.trim())) return;
    if (servers.some((server) => server.name.toLocaleLowerCase("tr") === name.trim().toLocaleLowerCase("tr"))) {
      showToast("Bu adda bir MCP sunucusu zaten var", "warning");
      return;
    }
    let referenceMap: Record<string, string> | undefined;
    if (transport === "stdio") {
      if (secretRefs.trim()) {
        try {
          const parsed = JSON.parse(secretRefs);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) throw new Error();
          referenceMap = parsed;
        } catch {
          showToast("Env/header alanı geçerli bir JSON string sözlüğü olmalı", "warning");
          return;
        }
      }
    } else {
      referenceMap = buildRemoteHeaders();
      // buildRemoteHeaders shows toast on invalid JSON; empty map is ok (no auth).
      if (secretRefs.trim() && referenceMap === undefined) return;
      if (authHeaderMode === "bearer-vault" && referenceMap === undefined) return;
    }
    const server = {
      version: 1 as const,
      id: crypto.randomUUID(),
      name: name.trim(),
      transport,
      ...(transport === "stdio" ? {
        command: command.trim(),
        args: args.trim() ? args.match(/(?:[^\s\"]+|\"[^\"]*\")+/g)?.map((value) => value.replace(/^\"|\"$/g, "")) : [],
        ...(referenceMap ? { env: referenceMap } : {}),
      } : { url: remoteUrl.trim(), ...(referenceMap ? { headers: referenceMap } : {}) }),
      enabled: true,
      autoStart: true,
      timeoutMs: 30_000,
      toolPolicy: { default: defaultDecision },
    };
    setPending(true);
    void apiPost<any>("/api/mcp/servers", server).then((result) => {
      setServers((current) => [...current, result.server?.config || server]);
      if (result.server) setSnapshots((current) => [...current.filter((item) => item.config.id !== server.id), result.server]);
      setName(""); setCommand(""); setArgs(""); setRemoteUrl(""); setSecretRefs("");
      setAuthHeaderMode("none"); setAuthVaultRef("");
      showToast("MCP sunucusu eklendi", "success");
    }).catch(() => showToast("MCP sunucusu eklenemedi", "error")).finally(() => setPending(false));
  }

  async function previewResource(serverId: string, uri: string) {
    try {
      const result = await apiGet<any>(`/api/mcp/servers/${encodeURIComponent(serverId)}/resources?uri=${encodeURIComponent(uri)}`);
      setMcpPreview(JSON.stringify(result.resource, null, 2));
      showToast("Resource önizlemesi yüklendi", "success");
    } catch (error: any) { showToast(error?.message || "Resource okunamadı", "error"); }
  }

  async function copyResourceUri(uri: string) {
    if (!uri) {
      showToast("Kopyalanacak URI yok", "warning");
      return;
    }
    if (!navigator.clipboard?.writeText) {
      showToast("Kopyalama desteklenmiyor", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(uri);
      showToast("Resource URI kopyalandı", "success");
    } catch (error: any) {
      showToast(error?.message || "URI kopyalanamadı", "error");
    }
  }

  function insertResourceToComposer(resource: { uri?: string; name?: string; title?: string; description?: string; mimeType?: string }) {
    const label = resource.title || resource.name || "resource";
    const lines = [
      `MCP resource: ${label}`,
      resource.uri ? `URI: ${resource.uri}` : "",
      resource.mimeType ? `MIME: ${resource.mimeType}` : "",
      resource.description ? resource.description : "",
    ].filter(Boolean);
    const text = lines.join("\n");
    if (!text.trim()) {
      showToast("Composer'a eklenecek resource metni yok", "warning");
      return;
    }
    window.dispatchEvent(new CustomEvent("quake:set-composer-draft", { detail: text }));
    showToast("Resource composer'a eklendi", "success");
  }

  async function insertPrompt(serverId: string, name: string) {
    try {
      const result = await apiGet<any>(`/api/mcp/servers/${encodeURIComponent(serverId)}/prompts?name=${encodeURIComponent(name)}`);
      const messages = result.prompt?.messages || [];
      const text = messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : [message.content]).map((content: any) => content?.text || "").filter(Boolean).join("\n\n");
      window.dispatchEvent(new CustomEvent("quake:set-composer-draft", { detail: text || JSON.stringify(result.prompt, null, 2) }));
      showToast("MCP prompt composer'a eklendi", "success");
    } catch (error: any) { showToast(error?.message || "Prompt alınamadı", "error"); }
  }

  function scrollToMcpSecretVault() {
    const el = document.getElementById("mcp-secret-vault");
    if (!el) {
      showToast("Güvenli secret kasası bu ortamda yok", "warning");
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveVaultSecret(event: React.FormEvent) {
    event.preventDefault();
    if (!desktop?.mcpSecrets || !vaultName.trim() || !vaultValue || pending) return;
    setPending(true);
    try {
      setVaultNames(await desktop.mcpSecrets.set(vaultName.trim(), vaultValue));
      setVaultName(""); setVaultValue("");
      showToast("Secret güvenli kasaya kaydedildi. Bağlantının görmesi için uygulamayı yeniden başlat.", "success");
    } catch (error: any) { showToast(error?.message || "Secret kaydedilemedi", "error"); }
    finally { setPending(false); }
  }

  async function saveBearerTokenToVault(event: React.FormEvent) {
    event.preventDefault();
    if (!desktop?.mcpSecrets || !bearerTokenName.trim() || !bearerTokenValue || pending) return;
    const name = bearerTokenName.trim().toUpperCase();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      showToast("Token adı geçersiz (ör. MCP_BEARER_TOKEN)", "warning");
      return;
    }
    setPending(true);
    try {
      // Store raw token only — Authorization header uses "Bearer ${vault:NAME}".
      setVaultNames(await desktop.mcpSecrets.set(name, bearerTokenValue.trim()));
      setBearerTokenValue("");
      setAuthHeaderMode("bearer-vault");
      setAuthVaultRef(name);
      setSecretRefs(JSON.stringify({ Authorization: `Bearer \${vault:${name}}` }));
      showToast(
        `Token'ı kasaya kaydet tamam. Header: Authorization: Bearer \${vault:${name}}. Uygulamayı yeniden başlat, sonra uzak sunucuyu bağla.`,
        "success",
      );
    } catch (error: any) {
      showToast(error?.message || "Token kasaya kaydedilemedi", "error");
    } finally {
      setPending(false);
    }
  }

  async function deleteVaultSecret(name: string) {
    if (!desktop?.mcpSecrets || pending) return;
    setPending(true);
    try { setVaultNames(await desktop.mcpSecrets.remove(name)); showToast("Secret güvenli kasadan kaldırıldı", "success"); }
    catch (error: any) { showToast(error?.message || "Secret kaldırılamadı", "error"); }
    finally { setPending(false); }
  }

  async function testConnection(id: string) {
    if (pending) return;
    setPending(true);
    try {
      const result = await apiPost<any>(`/api/mcp/servers/${encodeURIComponent(id)}/connect`, {});
      const status = result?.server?.status || "unknown";
      const toolCount = Array.isArray(result?.server?.tools) ? result.server.tools.length : 0;
      setSnapshots((await apiGet<any>("/api/mcp/servers")).servers || []);
      if (status === "connected") {
        showToast(`Bağlantı testi başarılı (${toolCount} araç)`, "success");
      } else if (status === "auth_required") {
        showToast("Bağlantı testi: kimlik doğrulama gerekli (Bearer token / header kontrol edin)", "warning");
      } else {
        showToast(result?.server?.lastError || `Bağlantı testi: ${status}`, "warning");
      }
    } catch (error: any) {
      setSnapshots((await apiGet<any>("/api/mcp/servers").catch(() => ({ servers: [] }))).servers || []);
      showToast(error?.message || "Bağlantı testi başarısız", "error");
    } finally {
      setPending(false);
    }
  }

  async function toggleDetails(id: string) {
    if (expandedServer === id) { setExpandedServer(undefined); return; }
    setExpandedServer(id);
    try {
      const result = await apiGet<any>(`/api/mcp/servers/${encodeURIComponent(id)}/logs`);
      setLogsByServer((current) => ({ ...current, [id]: result.logs || [] }));
    } catch { /* connection details remain usable without logs */ }
  }

  async function updateServer(id: string, patch: unknown) {
    if (pending) return;
    setPending(true);
    try {
      const result = await apiPatch<any>(`/api/mcp/servers/${encodeURIComponent(id)}`, patch);
      if (result.server) {
        setSnapshots((current) => [...current.filter((item) => item.config.id !== id), result.server]);
        setServers((current) => current.map((item) => item.id === id ? result.server.config : item));
      }
      showToast("MCP politikası kaydedildi", "success");
    } catch (error: any) { showToast(error?.message || "MCP politikası kaydedilemedi", "error"); }
    finally { setPending(false); }
  }

  async function runAction(id: string, action: "connect" | "disconnect" | "restart") {
    setPending(true);
    try {
      await apiPost(`/api/mcp/servers/${encodeURIComponent(id)}/${action}`, {});
      setSnapshots((await apiGet<any>("/api/mcp/servers")).servers || []);
    } catch (error: any) { showToast(error?.message || "MCP işlemi başarısız", "error"); }
    finally { setPending(false); }
  }

  async function removeAlwaysAllow(entry: McpAlwaysAllowEntry) {
    if (pending) return;
    setPending(true);
    try {
      const result = await apiDelete<{ tools?: McpAlwaysAllowEntry[] }>(
        `/api/mcp/always-allows?serverId=${encodeURIComponent(entry.serverId)}&toolName=${encodeURIComponent(entry.toolName)}`,
      );
      setAlwaysAllows(Array.isArray(result?.tools) ? result.tools : []);
      showToast("Kalıcı MCP izni kaldırıldı", "success");
    } catch (error: any) {
      showToast(error?.message || "Kalıcı izin kaldırılamadı", "error");
    } finally {
      setPending(false);
    }
  }

  async function clearAllAlwaysAllows() {
    if (pending || alwaysAllows.length === 0) return;
    const accepted = await confirm({
      title: "Tüm kalıcı MCP izinleri silinsin mi?",
      message: "Her zaman izin verilen MCP araçları listesi temizlenecek. Oturum izinleri ve araç politikası (izin ver / sor / engelle) etkilenmez.",
      variant: "danger",
      confirmLabel: "Tümünü temizle",
    });
    if (!accepted) return;
    setPending(true);
    try {
      await apiPost("/api/mcp/always-allows/clear", {});
      setAlwaysAllows([]);
      showToast("Kalıcı MCP izinleri temizlendi", "success");
    } catch (error: any) {
      showToast(error?.message || "Kalıcı izinler temizlenemedi", "error");
    } finally {
      setPending(false);
    }
  }

  return <>
    <section className={styles.card}>
      <h3>Her zaman izin verilen MCP araçları</h3>
      <p className={styles.cardDesc}>
        Composer’da “Her zaman izin ver” ile kaydedilen araçlar yeniden başlatmadan sonra da geçerli kalır.
        Oturum boyu izin bellek-içi kalır ve uygulama kapanınca silinir. Araç politikası (izin ver / sor / engelle) bundan ayrıdır.
      </p>
      {loading ? (
        <p className={styles.muted}>Yükleniyor…</p>
      ) : alwaysAllows.length === 0 ? (
        <p className={styles.muted}>Kalıcı olarak izin verilen MCP aracı yok.</p>
      ) : (
        <>
          <div className={styles.list}>
            {alwaysAllows.map((entry) => {
              const serverLabel = servers.find((s) => s.id === entry.serverId)?.name || entry.serverId;
              return (
                <div key={entry.key} className={styles.listItem}>
                  <div className={styles.listItemMain}>
                    <b>{entry.toolName}</b>
                    <span>{serverLabel} · {entry.serverId}</span>
                  </div>
                  <button
                    type="button"
                    className={styles.smallBtn}
                    disabled={pending}
                    onClick={() => void removeAlwaysAllow(entry)}
                    aria-label={`${entry.toolName} kalıcı iznini kaldır`}
                  >
                    Kaldır
                  </button>
                </div>
              );
            })}
          </div>
          <div className={styles.inlineControl} style={{ marginTop: 10 }}>
            <button type="button" className={styles.smallBtn} disabled={pending} onClick={() => void clearAllAlwaysAllows()}>
              Tümünü temizle
            </button>
          </div>
        </>
      )}
    </section>
    <section className={styles.card}>
      <h3>MCP sunucuları</h3>
      <p className={styles.cardDesc}>Yerel MCP sunucularını başlatır, araçlarını keşfeder ve bağlantı durumunu canlı gösterir.</p>
      {loading ? <p className={styles.muted}>Yükleniyor…</p> : servers.length === 0 ? <p className={styles.muted}>Yapılandırılmış MCP sunucusu yok.</p> : <div className={styles.list}>
        {servers.map((server) => {
          const runtime = snapshots.find((item) => item.config.id === server.id);
          const connected = runtime?.status === "connected";
          return <div key={server.id} className={styles.listItem}>
            <div className={styles.listItemMain}><b>{server.name}</b><span>{server.transport === "stdio" ? `${server.command} ${(server.args || []).join(" ")}` : server.url}</span>{runtime?.lastError && <span className={styles.mcpError}>{runtime.lastError}</span>}</div>
            <div className={styles.inlineControl}>
              <Pill tone={connected ? "ok" : runtime?.status === "error" || runtime?.status === "auth_required" ? "warn" : "muted"}>{connected ? `${runtime.tools.length} araç` : runtime?.status || "Kaydedildi"}</Pill>
              <button type="button" className={styles.smallBtn} disabled={pending} onClick={() => void runAction(server.id, connected ? "disconnect" : "connect")}>{connected ? "Bağlantıyı kes" : "Bağlan"}</button>
              {server.transport !== "stdio" && (
                <button type="button" className={styles.smallBtn} disabled={pending} onClick={() => void testConnection(server.id)} title="Uzak sunucuya bağlanıp durumu kontrol et">
                  Bağlantıyı test et
                </button>
              )}
              {connected && <button type="button" className={styles.smallBtn} disabled={pending} onClick={() => void runAction(server.id, "restart")}>Yeniden başlat</button>}
              <button type="button" className={styles.smallBtn} disabled={pending} onClick={() => void toggleDetails(server.id)}>{expandedServer === server.id ? "Ayrıntıyı kapat" : "Ayrıntılar"}</button>
              <button type="button" className={styles.smallBtn} disabled={pending} onClick={() => void removeServer(server)}>Sil</button>
            </div>
            {expandedServer === server.id && <div className={styles.mcpDetails}>
              <label>Sunucu etkin<Switch checked={server.enabled !== false} disabled={pending} onChange={(enabled) => void updateServer(server.id, { enabled })} label={`${server.name} sunucusunu etkinleştir`} /></label>
              <label>Açılışta bağlan<Switch checked={server.autoStart !== false} disabled={pending} onChange={(autoStart) => void updateServer(server.id, { autoStart })} label={`${server.name} açılışta bağlansın`} /></label>
              <label>Otomatik yeniden bağlan<Switch checked={server.reconnect?.enabled !== false} disabled={pending} onChange={(enabled) => void updateServer(server.id, { reconnect: { ...(server.reconnect || { maxAttempts: 5, baseDelayMs: 1000 }), enabled } })} label={`${server.name} otomatik yeniden bağlansın`} /></label>
              <label>Varsayılan araç politikası<select value={server.toolPolicy?.default || "allow"} disabled={pending} onChange={(event) => void updateServer(server.id, { toolPolicy: { ...server.toolPolicy, default: event.target.value } })}><option value="allow">İzin ver</option><option value="ask">Her seferinde sor</option><option value="deny">Engelle</option></select></label>
              <div className={styles.mcpCapabilitySummary}>{runtime?.tools.length || 0} araç · {runtime?.resources.length || 0} kaynak · {runtime?.prompts.length || 0} prompt</div>
              {(runtime?.tools || []).map((tool) => <div key={tool.name} className={styles.mcpToolRow}><div><b>{tool.title || tool.name}</b><span>{tool.annotations?.readOnly ? "Read-only" : tool.annotations?.destructive ? "Yazma/yıkıcı olabilir" : "Etki belirtilmemiş"}</span></div><select value={server.toolPolicy?.overrides?.[tool.name] || tool.decision || server.toolPolicy?.default || "allow"} disabled={pending} onChange={(event) => void updateServer(server.id, { toolPolicy: { ...server.toolPolicy, overrides: { ...(server.toolPolicy?.overrides || {}), [tool.name]: event.target.value } } })}><option value="allow">İzin ver</option><option value="ask">Sor</option><option value="deny">Engelle</option></select></div>)}
              {(runtime?.resources || []).length > 0 && (
                <details>
                  <summary>Kaynaklar ({runtime?.resources.length || 0})</summary>
                  <div className={styles.mcpMetadataList}>
                    {(runtime?.resources || []).map((resource: any) => (
                      <div key={resource.uri || resource.name} className={styles.mcpResourceRow}>
                        <div className={styles.mcpResourceMeta}>
                          <b>{resource.title || resource.name || "Adsız kaynak"}</b>
                          <span className={styles.mcpResourceUri} title={resource.uri}>{resource.uri}</span>
                          {(resource.mimeType || resource.description) && (
                            <span>
                              {resource.mimeType ? resource.mimeType : ""}
                              {resource.mimeType && resource.description ? " · " : ""}
                              {resource.description || ""}
                            </span>
                          )}
                        </div>
                        <div className={styles.mcpResourceActions}>
                          <button
                            type="button"
                            className={styles.smallBtn}
                            disabled={pending || !resource.uri}
                            onClick={() => void previewResource(server.id, resource.uri)}
                            title="Kaynak içeriğini önizle"
                            aria-label={`${resource.title || resource.name || resource.uri} önizle`}
                          >
                            Önizle
                          </button>
                          <button
                            type="button"
                            className={styles.smallBtn}
                            disabled={!resource.uri}
                            onClick={() => void copyResourceUri(resource.uri)}
                            title="Resource URI kopyala"
                            aria-label={`${resource.title || resource.name || resource.uri} URI kopyala`}
                          >
                            URI kopyala
                          </button>
                          <button
                            type="button"
                            className={styles.smallBtn}
                            onClick={() => insertResourceToComposer(resource)}
                            title="Kaynak URI ve meta bilgisini composer taslağına ekle"
                            aria-label={`${resource.title || resource.name || resource.uri} composer'a ekle`}
                          >
                            Composer'a ekle
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {(runtime?.prompts || []).length > 0 && <details><summary>Promptlar ({runtime?.prompts.length || 0})</summary><div className={styles.mcpMetadataList}>{(runtime?.prompts || []).map((prompt: any) => <button type="button" key={prompt.name} onClick={() => void insertPrompt(server.id, prompt.name)} title="Promptu composer taslağına ekle">{prompt.title || prompt.name}{prompt.description ? ` · ${prompt.description}` : ""}</button>)}</div></details>}
              {mcpPreview && (
                <div className={styles.mcpPreviewBlock}>
                  <div className={styles.mcpPreviewHeader}>
                    <span>Resource önizlemesi</span>
                    <button type="button" className={styles.smallBtn} onClick={() => setMcpPreview("")}>Önizlemeyi kapat</button>
                  </div>
                  <pre className={styles.codePreview}>{mcpPreview}</pre>
                </div>
              )}
              {(logsByServer[server.id] || []).length > 0 && <details><summary>Bağlantı logları ({logsByServer[server.id].length})</summary><div className={styles.mcpLog}>{logsByServer[server.id].map((entry, index) => <span key={`${entry.timestamp}-${index}`} data-level={entry.level}>{new Date(entry.timestamp).toLocaleTimeString("tr-TR")} · {entry.message}</span>)}</div></details>}
            </div>}
          </div>;
        })}
      </div>}
    </section>
    <section className={styles.card} id="mcp-oauth-bearer-mvp">
      <h3>MCP OAuth / Bearer token (MVP)</h3>
      <p className={styles.cardDesc}>
        Uzak HTTP MCP sunucuları için token tabanlı kimlik doğrulama. Bearer token’ı kasaya kaydedin;
        bağlantı header’ı <code>Authorization: Bearer ${"${vault:NAME}"}</code> kalıbıyla çözülür.
        Bu tam OAuth değildir — tarayıcı oturum açma ve refresh yok.
      </p>
      {desktop?.mcpSecrets ? (
        <form className={styles.mcpForm} onSubmit={saveBearerTokenToVault}>
          <input
            value={bearerTokenName}
            onChange={(event) => setBearerTokenName(event.target.value.toUpperCase())}
            placeholder="MCP_BEARER_TOKEN"
            aria-label="Bearer token vault adı"
          />
          <input
            value={bearerTokenValue}
            onChange={(event) => setBearerTokenValue(event.target.value)}
            type="password"
            autoComplete="new-password"
            placeholder="Bearer token yapıştır"
            aria-label="Bearer token değeri"
          />
          <button
            type="submit"
            className={styles.smallBtn}
            disabled={pending || !bearerTokenName.trim() || !bearerTokenValue}
          >
            Token'ı kasaya kaydet
          </button>
        </form>
      ) : (
        <p className={styles.muted}>
          Desktop secret kasası bu ortamda yok; işletim sistemi ortam değişkenlerini
          (<code>${"${env:NAME}"}</code>) veya header secret referanslarını kullanın.
        </p>
      )}
      <div className={styles.mcpAuthHint}>
        <p className={styles.muted}>
          <b>Authorization header kalıbı:</b>{" "}
          <code>{`{"Authorization":"Bearer \${vault:${(bearerTokenName || "MCP_BEARER_TOKEN").trim().toUpperCase() || "MCP_BEARER_TOKEN"}}"}`}</code>
        </p>
        <p className={styles.muted}>
          Eşdeğer: <code>${"${env:NAME}"}</code> (kasa sunucu açılışında process env’e enjekte edilir).
          Streamable HTTP / SSE transport header’ları vault referanslarını çözer.
        </p>
        <p className={styles.muted}>
          <b>Phase 2 (planlı):</b> Tarayıcı OAuth / hosted login (authorization code + refresh token).
          Henüz kullanılamıyor — yarım popup akışı bilinçli olarak sunulmuyor.
        </p>
      </div>
      {desktop?.mcpSecrets && (
        <div className={styles.inlineControl} style={{ marginTop: 10 }}>
          <button type="button" className={styles.smallBtn} onClick={scrollToMcpSecretVault}>
            Güvenli secret kasasına git
          </button>
        </div>
      )}
    </section>
    <section className={styles.card}>
      <h3>Sunucu ekle</h3>
      <p className={styles.cardDesc}>Çalıştırılabilir komutu ve isteğe bağlı argümanları gir. Uzak HTTP için Bearer vault header’ı seçebilirsin.</p>
      <div className={styles.presetRow}>
        <button type="button" className={styles.presetBtn} onClick={() => { setName("Context7"); setTransport("stdio"); setCommand("npx"); setArgs("-y @upstash/context7-mcp@latest"); setDefaultDecision("allow"); setAuthHeaderMode("none"); }}>Context7 hazır ayarı</button>
      </div>
      <form className={styles.mcpForm} onSubmit={addServer}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Sunucu adı" aria-label="MCP sunucu adı" />
        <select value={transport} onChange={(event) => setTransport(event.target.value as McpServerSetting["transport"])} aria-label="MCP transport"><option value="stdio">stdio</option><option value="streamable-http">Streamable HTTP</option><option value="sse">Legacy SSE</option></select>
        {transport === "stdio" ? (
          <>
            <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Komut (örn. npx)" aria-label="MCP komutu" />
            <input value={args} onChange={(event) => setArgs(event.target.value)} placeholder="Argümanlar" aria-label="MCP argümanları" />
          </>
        ) : (
          <>
            <input className={styles.mcpWideField} value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://mcp.example.com/mcp" aria-label="MCP sunucu URL'si" />
            <label className={styles.mcpWideField}>
              <span className={styles.mcpFieldLabel}>Authorization header</span>
              <select
                value={authHeaderMode}
                onChange={(event) => {
                  const mode = event.target.value as "none" | "bearer-vault";
                  setAuthHeaderMode(mode);
                  if (mode === "bearer-vault") {
                    const ref = (authVaultRef || bearerTokenName || vaultNames[0] || "MCP_BEARER_TOKEN").toUpperCase();
                    setAuthVaultRef(ref);
                    setSecretRefs(JSON.stringify({ Authorization: `Bearer \${vault:${ref}}` }));
                  }
                }}
                aria-label="Authorization header modu"
              >
                <option value="none">Yok (headers JSON ile)</option>
                <option value="bearer-vault">Bearer token (vault)</option>
              </select>
            </label>
            {authHeaderMode === "bearer-vault" && (
              <select
                className={styles.mcpWideField}
                value={authVaultRef || bearerTokenName}
                onChange={(event) => {
                  const ref = event.target.value.toUpperCase();
                  setAuthVaultRef(ref);
                  setSecretRefs(JSON.stringify({ Authorization: `Bearer \${vault:${ref}}` }));
                }}
                aria-label="Bearer vault secret adı"
              >
                {(vaultNames.length ? vaultNames : [bearerTokenName || "MCP_BEARER_TOKEN"]).map((secretName) => (
                  <option key={secretName} value={secretName}>{`${secretName} · Bearer \${vault:${secretName}}`}</option>
                ))}
                {vaultNames.length > 0 && bearerTokenName && !vaultNames.includes(bearerTokenName.trim().toUpperCase()) && (
                  <option value={bearerTokenName.trim().toUpperCase()}>{bearerTokenName.trim().toUpperCase()} (yeni)</option>
                )}
              </select>
            )}
          </>
        )}
        <input
          className={styles.mcpWideField}
          value={secretRefs}
          onChange={(event) => setSecretRefs(event.target.value)}
          placeholder={transport === "stdio" ? '{"CONTEXT7_API_KEY":"${env:CONTEXT7_API_KEY}"}' : '{"Authorization":"Bearer ${vault:MCP_BEARER_TOKEN}"}'}
          aria-label="MCP env veya header secret referansları"
        />
        <select value={defaultDecision} onChange={(event) => setDefaultDecision(event.target.value as McpDecision)} aria-label="Varsayılan MCP araç politikası"><option value="allow">Araçlara izin ver</option><option value="ask">Her çağrıda sor</option><option value="deny">Araçları engelle</option></select>
        <button type="submit" className={styles.smallBtn} disabled={pending || !name.trim() || (transport === "stdio" ? !command.trim() : !remoteUrl.trim())}>{pending ? "Kaydediliyor…" : "Ekle"}</button>
      </form>
      <p className={styles.muted}>
        Secret değerlerini düz metin yerine <code>${"${env:NAME}"}</code> veya <code>${"${vault:NAME}"}</code> /
        <code>Bearer ${"${vault:NAME}"}</code> biçiminde env/header alanlarında kullan.
        Uzak HTTP yalnızca localhost için kabul edilir; diğer adreslerde HTTPS zorunludur.
      </p>
      <p className={styles.muted}>Değişiklikler çalışma alanının <code>.quake-code/web-settings.json</code> dosyasına kaydedilir.</p>
    </section>
    {desktop?.mcpSecrets && <section id="mcp-secret-vault" className={styles.card}>
      <h3>Güvenli secret kasası</h3>
      <p className={styles.cardDesc}>
        Değerler Electron safeStorage ile işletim sistemi hesabına bağlı olarak şifrelenir.
        MCP config yalnızca <code>${"${env:NAME}"}</code> / <code>${"${vault:NAME}"}</code> referansını tutar.
        Phase 2 tarayıcı OAuth gelene kadar uzak Bearer token’lar buradan veya header referanslarıyla bağlanır.
      </p>
      <form className={styles.mcpForm} onSubmit={saveVaultSecret}><input value={vaultName} onChange={(event) => setVaultName(event.target.value.toUpperCase())} placeholder="MCP_TOKEN" aria-label="Secret değişken adı" /><input value={vaultValue} onChange={(event) => setVaultValue(event.target.value)} type="password" autoComplete="new-password" placeholder="Secret değeri" aria-label="Secret değeri" /><button type="submit" className={styles.smallBtn} disabled={pending || !vaultName.trim() || !vaultValue}>Güvenli kaydet</button></form>
      <div className={styles.list}>{vaultNames.length ? vaultNames.map((secretName) => <div key={secretName} className={styles.listItem}><div className={styles.listItemMain}><b>{secretName}</b><span>{`Referans: \${vault:${secretName}} · \${env:${secretName}}`}</span></div><button type="button" className={styles.smallBtn} disabled={pending} onClick={() => void deleteVaultSecret(secretName)}>Kaldır</button></div>) : <p className={styles.muted}>Kasada MCP secret yok.</p>}</div>
    </section>}
  </>;
}

function ExtensionsSection() {
  const [extensions, setExtensions] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pendingId, setPendingId] = useState<string>();

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiGet<any>("/api/extensions").then((d) => d.extensions || []).catch(() => { setError(true); return []; }),
      apiGet<any>("/api/skills").then((d) => d.skills || []).catch(() => []),
    ]).then(([ext, sk]) => {
      if (!alive) return;
      setExtensions(ext);
      setSkills(sk);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  async function toggleExtension(id: string, enabled: boolean) {
    if (pendingId) return;
    const previous = extensions;
    setPendingId(id);
    setExtensions((items) => items.map((ext) => ((ext.id || ext.name) === id ? { ...ext, enabled } : ext)));
    try {
      await apiPost("/api/extensions/toggle", { id, enabled });
      const refreshed = await apiGet<any>("/api/extensions");
      setExtensions(refreshed.extensions || []);
      useAppStore.getState().showToast(`Uzantı ${enabled ? "etkinleştirildi" : "devre dışı bırakıldı"}`, "success");
    } catch {
      setExtensions(previous);
      useAppStore.getState().showToast("Uzantı durumu değiştirilemedi", "error");
    } finally { setPendingId(undefined); }
  }

  return (
    <>
      <section className={styles.card}>
        <h3>Uzantılar</h3>
        <p className={styles.cardDesc}>Yüklü uzantıları aç veya kapat.</p>
        {loading ? (
          <p className={styles.muted}>Yükleniyor…</p>
        ) : error ? (
          <p className={styles.muted}>Uzantılar yüklenemedi.</p>
        ) : extensions.length === 0 ? (
          <p className={styles.muted}>Yüklü uzantı yok.</p>
        ) : (
          <div className={styles.list}>
            {extensions.map((ext: any) => (
              <div key={ext.id || ext.name} className={styles.listItem}>
                <div className={styles.listItemMain}>
                  <b>{ext.name}</b>
                  <span>{ext.description || "Açıklama yok"}</span>
                </div>
                <Switch
                  checked={Boolean(ext.enabled)}
                  disabled={Boolean(pendingId)}
                  onChange={(value) => void toggleExtension(ext.id || ext.name, value)}
                  label={`${ext.name} uzantısı`}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.card}>
        <h3>Yetenekler (Skills)</h3>
        <p className={styles.cardDesc}>Ajanın kullanabildiği aktif yetenekler.</p>
        {loading ? (
          <p className={styles.muted}>Yükleniyor…</p>
        ) : skills.length === 0 ? (
          <p className={styles.muted}>Yetenek bulunamadı.</p>
        ) : (
          <div className={styles.list}>
            {skills.map((skill: any) => (
              <div key={skill.name} className={styles.listItem}>
                <div className={styles.listItemMain}>
                  <b>{skill.name}</b>
                  <span>{skill.description || ""}</span>
                </div>
                {skill.source && <span className={styles.badge}>{skill.source}</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function PromptsSection() {
  const [prompts, setPrompts] = useState<any[]>([]);
  const [commands, setCommands] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiGet<any>("/api/prompts").then((d) => d.prompts || []).catch(() => []),
      apiGet<any>("/api/commands").then((d) => d.commands || []).catch(() => []),
    ]).then(([pr, cmd]) => {
      if (!alive) return;
      setPrompts(pr);
      setCommands(cmd);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  return (
    <>
      <section className={styles.card}>
        <h3>Özel prompt şablonları</h3>
        <p className={styles.cardDesc}>Şablon içeriğini görmek için satıra tıkla.</p>
        {loading ? (
          <p className={styles.muted}>Yükleniyor…</p>
        ) : prompts.length === 0 ? (
          <p className={styles.muted}>Prompt şablonu bulunamadı.</p>
        ) : (
          <div className={styles.list}>
            {prompts.map((prompt: any) => {
              const isOpen = expanded === prompt.name;
              const body = String(prompt.content || prompt.template || prompt.description || "");
              return (
                <div key={prompt.name} className={styles.listCol}>
                  <button type="button" className={styles.listItemBtn} aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : prompt.name)}>
                    <div className={styles.listItemMain}>
                      <b>{prompt.name}</b>
                      <span>{body.slice(0, 90)}{body.length > 90 ? "…" : ""}</span>
                    </div>
                    <span className={styles.chevron} data-open={isOpen}>›</span>
                  </button>
                  {isOpen && body && <pre className={styles.codePreview}>{body}</pre>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.card}>
        <h3>Slash komutları</h3>
        <p className={styles.cardDesc}>Sohbet çubuğundan / ile çağrılabilen komutlar.</p>
        {loading ? (
          <p className={styles.muted}>Yükleniyor…</p>
        ) : commands.length === 0 ? (
          <p className={styles.muted}>Komut bulunamadı.</p>
        ) : (
          <div className={styles.list}>
            {commands.map((cmd: any) => (
              <div key={cmd.name} className={styles.listItem}>
                <div className={styles.listItemMain}>
                  <b>{String(cmd.name).startsWith("/") ? cmd.name : `/${cmd.name}`}</b>
                  <span>{cmd.description || ""}</span>
                </div>
                {cmd.source && <span className={styles.badge}>{cmd.source}</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Ctrl + K", action: "Komut paletini aç" },
  { keys: "Ctrl + B", action: "Sol paneli aç/kapat" },
  { keys: "Ctrl + J", action: "Terminal panelini aç/kapat" },
  { keys: "Alt + 1 / 2 / 3", action: "Sağ panel sekmeleri (Dosyalar / Önizleme / Terminal)" },
  { keys: "Ctrl + S", action: "Açık dosyayı kaydet" },
  { keys: "Enter", action: "Mesajı gönder" },
  { keys: "Shift + Enter", action: "Yeni satır" },
  { keys: "Shift + Tab", action: "Composer odaktayken Plan modunu aç/kapat" },
  { keys: "Escape", action: "Ayarları / açık pencereyi kapat" },
];

function KeyboardSection() {
  return (
    <section className={styles.card}>
      <h3>Klavye kısayolları</h3>
      <div className={styles.shortcuts}>
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className={styles.shortcutRow}>
            <span className={styles.shortcutAction}>{s.action}</span>
            <span className={styles.kbdGroup}>
              {s.keys.split(" ").map((part, index) => (
                part === "+" || part === "/" ? <span key={index} className={styles.kbdSep}>{part}</span> : <kbd key={index} className={styles.kbd}>{part}</kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

const SOUND_SELECT_OPTIONS: { id: "none" | SoundID; label: string }[] = [
  { id: "none", label: "Kapalı (ses yok)" },
  ...SOUND_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
];

function SoundSelect({
  label,
  description,
  enabled,
  soundId,
  onEnabledChange,
  onSoundChange,
}: {
  label: string;
  description: string;
  enabled: boolean;
  soundId: SoundID | "none";
  onEnabledChange: (value: boolean) => void;
  onSoundChange: (id: SoundID | "none") => void;
}) {
  const value = enabled ? soundId : "none";
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingText}>
        <div className={styles.settingTitle}>{label}</div>
        <div className={styles.settingDesc}>{description}</div>
      </div>
      <select
        className={styles.select}
        value={value}
        onChange={(e) => {
          const next = e.target.value as SoundID | "none";
          if (next === "none") {
            onEnabledChange(false);
            stopDemoSound();
            return;
          }
          onEnabledChange(true);
          onSoundChange(next);
          playDemoSound(next);
        }}
        onFocus={() => {
          if (value !== "none") playDemoSound(value);
        }}
        aria-label={label}
      >
        {SOUND_SELECT_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const GOAL_SETTINGS_KEY = "quake-web:goalSettings";

type GoalUiSettings = {
  maxTurns: number;
  maxStagnantTurns: number;
  preventSleep: boolean;
  autoRecover: boolean;
  completionNotification: boolean;
};

export function loadGoalUiSettings(): GoalUiSettings {
  const defaults: GoalUiSettings = { maxTurns: 30, maxStagnantTurns: 5, preventSleep: true, autoRecover: true, completionNotification: true };
  try {
    const parsed = JSON.parse(localStorage.getItem(GOAL_SETTINGS_KEY) || "null");
    return {
      maxTurns: clampInteger(parsed?.maxTurns, 10, 100, defaults.maxTurns),
      maxStagnantTurns: clampInteger(parsed?.maxStagnantTurns, 2, 12, defaults.maxStagnantTurns),
      preventSleep: parsed?.preventSleep !== false,
      autoRecover: parsed?.autoRecover !== false,
      completionNotification: parsed?.completionNotification !== false,
    };
  } catch {
    return defaults;
  }
}

function GoalModeSettingsSection() {
  const [settings, setSettings] = useState<GoalUiSettings>(() => loadGoalUiSettings());
  const activeGoal = useAppStore((state) => (state.state as any)?.goal);
  const activeGoalStatus = activeGoal?.status as string | undefined;
  const hasActiveGoal = Boolean(activeGoal && ["planning", "executing", "verifying", "paused", "blocked"].includes(activeGoalStatus || ""));
  const persist = (patch: Partial<GoalUiSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(GOAL_SETTINGS_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("quake:goal-settings-change", { detail: next }));
      return next;
    });
  };

  return <>
    <section className={styles.goalHero}>
      <div><span className={styles.goalEyebrow}>UNATTENDED AUTONOMY</span><h3>Hedefi ver, bilgisayardan ayrıl.</h3><p>Ajan çalışma alanında planlar, uygular, hataları düzeltir ve doğrulama kanıtı üretmeden tamamlanmaz.</p></div>
      <Pill tone={activeGoalStatus === "executing" || activeGoalStatus === "verifying" ? "ok" : activeGoalStatus === "blocked" ? "warn" : "muted"}>{activeGoalStatus === "executing" ? "Çalışıyor" : activeGoalStatus === "verifying" ? "Doğruluyor" : activeGoalStatus === "paused" ? "Duraklatıldı" : activeGoalStatus === "blocked" ? "Müdahale gerekli" : "Hazır"}</Pill>
    </section>
    {hasActiveGoal && <section className={styles.activeGoalSummary}><div><b>Aktif Goal</b><span>{activeGoal.objective}</span></div><div><b>Tur</b><span>{activeGoal.currentTurn}/{activeGoal.budget?.maxTurns ?? "—"}</span></div><div><b>İlerleme</b><span>{activeGoal.evidence?.length || 0} kanıt · {activeGoal.stagnantTurns || 0} ilerlemesiz tur</span></div>{activeGoal.blockedReason && <div><b>Bloke nedeni</b><span>{activeGoal.blockedReason}</span></div>}</section>}
    <section className={styles.card}>
      <h3>Çalışma bütçesi</h3>
      <p className={styles.cardDesc}>Yeni Goal çalışmalarında uygulanır. Aktif Goal’un bütçesi değişmez.</p>
      <div className={styles.presetRow} aria-label="Goal bütçe profilleri">
        <button type="button" className={styles.presetBtn} onClick={() => persist({ maxTurns: 15, maxStagnantTurns: 3 })}>Hızlı</button>
        <button type="button" className={styles.presetBtn} onClick={() => persist({ maxTurns: 30, maxStagnantTurns: 5 })}>Dengeli</button>
        <button type="button" className={styles.presetBtn} onClick={() => persist({ maxTurns: 60, maxStagnantTurns: 8 })}>Uzun görev</button>
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Maksimum tur<small>Uzun görevler için 30 önerilir</small></span>
        <input className={styles.numberInput} type="number" min={10} max={100} value={settings.maxTurns} onChange={(event) => persist({ maxTurns: clampInteger(event.target.value, 10, 100, 30) })} />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>İlerlemesiz tur toleransı<small>Farklı çözümler denendikten sonra bloke olur</small></span>
        <input className={styles.numberInput} type="number" min={2} max={12} value={settings.maxStagnantTurns} onChange={(event) => persist({ maxStagnantTurns: clampInteger(event.target.value, 2, 12, 5) })} />
      </label>
    </section>
    <section className={styles.card}>
      <h3>Kesintisiz çalışma</h3>
      <div className={styles.toggleRow}><span className={styles.toggleLabel}>Uykuya geçişi engelle<small>Goal aktifken uygulamanın askıya alınmasını önler</small></span><Switch checked={settings.preventSleep} onChange={(value) => persist({ preventSleep: value })} label="Goal çalışırken uykuya geçişi engelle" /></div>
      <div className={styles.toggleRow}><span className={styles.toggleLabel}>Yeniden başlatınca otomatik devam et<small>Bu tercih yeni Goal’a kaydedilir; yarım kalan çalışma mevcut dosyaları inceleyerek sürer</small></span><Switch checked={settings.autoRecover} onChange={(value) => persist({ autoRecover: value })} label="Goal'u yeniden başlatınca sürdür" /></div>
      <div className={styles.toggleRow}><span className={styles.toggleLabel}>Tamamlanınca bildir<small>Uygulama arka plandaysa sistem bildirimi gönderir</small></span><Switch checked={settings.completionNotification} onChange={(value) => persist({ completionNotification: value })} label="Goal tamamlanma bildirimi" /></div>
    </section>
    <section className={styles.safetyNote}><b>Güvenlik sınırı</b><span>Normal kodlama, test ve build işlemlerinde onay beklenmez. Secret, production deploy, ödeme veya yıkıcı dış işlemlerde Goal durur.</span></section>
  </>;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback;
}

function NotificationsSection() {
  const [config, setConfig] = useState<NotificationConfig>(() => loadNotificationConfig());
  const [permission, setPermission] = useState<string>(() =>
    "Notification" in window ? Notification.permission : "unsupported",
  );
  const isDesktop = Boolean(typeof window !== "undefined" && window.quakeDesktop?.isDesktop);

  useEffect(() => () => stopDemoSound(), []);

  function persist(next: NotificationConfig) {
    setConfig(next);
    saveNotificationConfig(next);
  }

  function setEnabled(value: boolean) {
    persist({ ...config, enabled: value });
  }

  function setOnlyWhenUnfocused(value: boolean) {
    persist({ ...config, onlyWhenUnfocused: value });
  }

  function setType(type: NotificationType, value: boolean) {
    persist({ ...config, types: { ...config.types, [type]: value } });
  }

  function patchSounds(patch: Partial<NotificationConfig["sounds"]>) {
    persist({ ...config, sounds: { ...config.sounds, ...patch } });
  }

  async function requestPermission() {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }

  function testNotify() {
    // force: settings test must work while the window is focused
    notifyTaskComplete("Test bildirimi — Quake Code", { force: true });
  }

  function testError() {
    notifyError("Test hata bildirimi", { force: true });
  }

  const permissionLabel =
    permission === "granted"
      ? "Verildi"
      : permission === "denied"
        ? "Reddedildi"
        : permission === "unsupported"
          ? "Desteklenmiyor"
          : "Bekliyor";

  const typeRows: { type: NotificationType; label: string; hint: string }[] = [
    { type: "task", label: "Yanıt ve Goal tamamlandı", hint: "Ajan işi doğrulanmış olarak bitirdiğinde" },
    { type: "operation", label: "Uzun işlem tamamlandı", hint: "Terminal ve arka plan işlemleri" },
    { type: "error", label: "Hata bildirimleri", hint: "Hata ve engeller" },
  ];

  return (
    <>
      <section className={styles.card}>
        <h3>Sistem bildirimleri</h3>
        <p className={styles.cardDesc}>
          Görev tamamlandığında veya müdahale gerektiğinde sistem bildirimi gönderir.
          {isDesktop ? " Masaüstünde yerel Electron bildirimi kullanılır." : ""}
        </p>
        <div className={styles.facts}>
          <div className={styles.factRow}>
            <b>{isDesktop ? "Masaüstü" : "Tarayıcı izni"}</b>
            <span className={styles.inlineControl}>
              {isDesktop ? (
                <Pill tone="ok">Native</Pill>
              ) : (
                <>
                  <Pill tone={permission === "granted" ? "ok" : permission === "denied" ? "warn" : "muted"}>
                    {permissionLabel}
                  </Pill>
                  {permission === "default" && (
                    <button type="button" className={styles.smallBtn} onClick={requestPermission}>
                      İzin iste
                    </button>
                  )}
                </>
              )}
            </span>
          </div>
        </div>
        <div className={styles.toggleRow}>
          <span className={styles.toggleLabel}>
            Bildirimleri etkinleştir<small>OS / tarayıcı toast</small>
          </span>
          <Switch checked={config.enabled} onChange={setEnabled} label="Bildirimleri etkinleştir" />
        </div>
        <div className={styles.toggleRow}>
          <span className={styles.toggleLabel}>
            Yalnızca arka planda
            <small>
              Açıkken (önerilen): odaktayken toast/ses yok; minimize veya başka uygulamaya geçince gelir
            </small>
          </span>
          <Switch
            checked={config.onlyWhenUnfocused}
            onChange={setOnlyWhenUnfocused}
            disabled={!config.enabled}
            label="Yalnızca arka planda"
          />
        </div>
        <div className={styles.inlineControl} style={{ marginTop: 8, gap: 8 }}>
          <button type="button" className={styles.smallBtn} onClick={testNotify}>
            Test: yanıt hazır
          </button>
          <button type="button" className={styles.smallBtn} onClick={testError}>
            Test: hata
          </button>
        </div>
      </section>

      <section className={styles.card}>
        <h3>Ses efektleri</h3>
        <p className={styles.cardDesc}>Her olay için sesi ayrı seçebilir veya tamamen kapatabilirsin. Seçim yaptığında kısa önizleme çalar.</p>
        <SoundSelect
          label="Ajan yanıtı"
          description="Tur bitti / görev tamamlandı"
          enabled={config.sounds.agentEnabled}
          soundId={config.sounds.agent}
          onEnabledChange={(value) => patchSounds({ agentEnabled: value })}
          onSoundChange={(id) => patchSounds({ agent: id })}
        />
        <SoundSelect
          label="İşlem"
          description="Uzun işlem tamamlandı"
          enabled={config.sounds.operationEnabled}
          soundId={config.sounds.operation}
          onEnabledChange={(value) => patchSounds({ operationEnabled: value })}
          onSoundChange={(id) => patchSounds({ operation: id })}
        />
        <SoundSelect
          label="Hata"
          description="Hata ve engel bildirimleri"
          enabled={config.sounds.errorsEnabled}
          soundId={config.sounds.errors}
          onEnabledChange={(value) => patchSounds({ errorsEnabled: value })}
          onSoundChange={(id) => patchSounds({ errors: id })}
        />
      </section>

      <section className={`${styles.card} ${!config.enabled ? styles.cardDisabled : ""}`}>
        <h3>Bildirim türleri</h3>
        <p className={styles.cardDesc}>Yalnızca gerçekten önemli olayları açık bırak.</p>
        {typeRows.map((row) => (
          <div key={row.type} className={styles.toggleRow}>
            <span className={styles.toggleLabel}>
              {row.label}
              <small>{row.hint}</small>
            </span>
            <Switch
              checked={config.types[row.type]}
              disabled={!config.enabled}
              onChange={(value) => setType(row.type, value)}
              label={row.label}
            />
          </div>
        ))}
      </section>
    </>
  );
}

function AboutSection() {
  const config = useAppStore((state) => state.config as any);
  return <>
    <section className={styles.card}>
      <h3>Quake Code</h3>
      <p className={styles.cardDesc}>Terminal-first coding assistant — Desktop, CLI, Web ve Mobile.</p>
      <div className={styles.facts}>
        <div className={styles.factRow}><b>Sürüm</b><span>{config?.version || "—"}</span></div>
        <div className={styles.factRow}><b>Platform</b><span>{navigator.platform || "Web"}</span></div>
        <div className={styles.factRow}><b>Çalışma zamanı</b><span>{window.quakeDesktop ? "Electron Desktop" : "Web"}</span></div>
        <div className={styles.factRow}><b>Sunucu</b><span>{config?.host ? `${config.host}:${config.port}` : "—"}</span></div>
        <div className={styles.factRow}><b>Çalışma alanı</b><span>{config?.cwd || "—"}</span></div>
      </div>
    </section>
    <AutoUpdateSettingsSection />
    <section className={styles.card}>
      <h3>Yazar</h3>
      <p className={styles.cardDesc}>Mustafa Bilgin (mrquake) tarafından geliştirildi.</p>
      <p className={styles.muted}>© {new Date().getFullYear()} Quake Code</p>
    </section>
  </>;
}

/** S-PUB.2 — Otomatik güncelleme; feed yoksa kapalı + açıklama (unsigned path bozulmaz). */
function AutoUpdateSettingsSection() {
  const [status, setStatus] = useState<UpdaterStatus | null>(null);
  const [feedDraft, setFeedDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const isDesktopShell = Boolean(desktop?.updater);

  useEffect(() => {
    if (!desktop?.updater) return;
    let cancelled = false;
    void desktop.updater.getStatus().then((next) => {
      if (cancelled) return;
      setStatus(next);
      // Prefs URL is editable; fall back to effective non-env URL for convenience.
      setFeedDraft(next.prefsFeedUrl || (next.feedSource === "prefs" ? next.updateFeedUrl || "" : "") || "");
    }).catch(() => {
      if (!cancelled) {
        setStatus({
          feedConfigured: false,
          enabled: false,
          envForced: false,
          willCheck: false,
          currentVersion: "",
          feedSource: "none",
          statusMessage: "Güncelleme durumu alınamadı.",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onToggle(enabled: boolean) {
    if (!desktop?.updater || !status?.feedConfigured) return;
    setBusy(true);
    try {
      const next = await desktop.updater.setEnabled(enabled);
      setStatus(next);
    } catch {
      useAppStore.getState().showToast("Güncelleme tercihi kaydedilemedi", "error");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveFeed() {
    if (!desktop?.updater?.setFeedUrl) return;
    setBusy(true);
    try {
      const next = await desktop.updater.setFeedUrl(feedDraft.trim());
      setStatus(next);
      setFeedDraft(next.prefsFeedUrl || "");
      if (next.lastError && !next.feedConfigured && feedDraft.trim()) {
        useAppStore.getState().showToast(next.lastError, "error");
      } else if (!feedDraft.trim()) {
        useAppStore.getState().showToast("Feed URL temizlendi", "success");
      } else {
        useAppStore.getState().showToast("Feed kaydedildi", "success");
      }
    } catch {
      useAppStore.getState().showToast("Feed kaydedilemedi", "error");
    } finally {
      setBusy(false);
    }
  }

  async function onCheck() {
    if (!desktop?.updater || !status?.feedConfigured) return;
    setBusy(true);
    try {
      const next = await desktop.updater.check();
      setStatus(next);
      if (next.updateAvailable && next.updateVersion) {
        useAppStore.getState().showToast(`Yeni sürüm: ${next.updateVersion}`, "success");
      } else if (next.lastError) {
        useAppStore.getState().showToast(next.lastError, "warning");
      } else {
        useAppStore.getState().showToast("Güncel sürümdesiniz", "success");
      }
    } catch {
      useAppStore.getState().showToast("Güncelleme kontrolü başarısız", "error");
    } finally {
      setBusy(false);
    }
  }

  const feedConfigured = Boolean(status?.feedConfigured);
  const toggleOn = Boolean(status?.enabled || status?.envForced);
  const toggleDisabled = !isDesktopShell || !feedConfigured || busy || Boolean(status?.envForced);
  const feedSourceLabel =
    status?.feedSource === "env"
      ? "Ortam (QUAKE_UPDATE_FEED_URL)"
      : status?.feedSource === "prefs"
        ? "Ayarlar (kayıtlı)"
        : status?.feedSource === "embedded"
          ? "Paket (app-update.yml)"
          : "—";

  return (
    <section className={styles.card}>
      <h3>Otomatik güncelleme</h3>
      <p className={styles.cardDesc}>
        Yayın kanalı (update feed) yapılandırıldığında masaüstü uygulaması yeni sürümleri kontrol edebilir.
        Feed URL’yi burada kaydedebilir veya <code>QUAKE_UPDATE_FEED_URL</code> ile verebilirsiniz. Feed yokken uygulama normal açılır.
      </p>

      {isDesktopShell ? (
        <div className={styles.feedUrlBlock}>
          <label className={styles.feedUrlLabel} htmlFor="quake-update-feed-url">
            Güncelleme feed URL
            <small>
              Generic sağlayıcı tabanı (örn. https://releases.example.com/quake-desktop). Ortam değişkeni varsa o önceliklidir.
            </small>
          </label>
          <div className={styles.feedUrlRow}>
            <input
              id="quake-update-feed-url"
              className={styles.feedUrlInput}
              type="url"
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
              placeholder="https://releases.example.com/quake-desktop"
              value={feedDraft}
              disabled={busy || status?.feedSource === "env"}
              onChange={(event) => setFeedDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void onSaveFeed();
                }
              }}
            />
            <button
              type="button"
              className={styles.smallBtn}
              disabled={busy || status?.feedSource === "env" || !desktop?.updater?.setFeedUrl}
              onClick={() => void onSaveFeed()}
            >
              Feed kaydet
            </button>
          </div>
          {status?.feedSource === "env" ? (
            <p className={styles.muted} style={{ marginTop: 6 }}>
              Feed ortam değişkeninden geliyor; Settings kaydı devre dışı.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={styles.toggleRow}>
        <span className={styles.toggleLabel}>
          Otomatik güncelleme
          <small>
            {!isDesktopShell
              ? "Yalnızca Electron masaüstü kabuğunda kullanılabilir."
              : !feedConfigured
                ? "Feed kaydedin veya QUAKE_UPDATE_FEED_URL ayarlayın. Feed yokken kontrol yapılmaz."
                : status?.envForced
                  ? "Ortam değişkeni ile zorlandı (QUAKE_AUTO_UPDATE=1)."
                  : "Açıkken başlangıçta ve elle kontrol ile feed sorgulanır."}
          </small>
        </span>
        <Switch
          checked={toggleOn}
          disabled={toggleDisabled}
          onChange={onToggle}
          label="Otomatik güncelleme"
        />
      </div>
      <div className={styles.facts} style={{ marginTop: 12 }}>
        <div className={styles.factRow}>
          <b>Kanal</b>
          <span>
            <Pill tone={feedConfigured ? "ok" : "warn"}>
              {feedConfigured ? "Yapılandırıldı" : "Yok"}
            </Pill>
          </span>
        </div>
        <div className={styles.factRow}>
          <b>Feed</b>
          <span title={status?.updateFeedUrl || status?.feedUrlMasked || ""}>
            {status?.feedUrlMasked || (isDesktopShell ? "—" : "Web — uygulanmaz")}
          </span>
        </div>
        <div className={styles.factRow}>
          <b>Kaynak</b>
          <span>{feedSourceLabel}</span>
        </div>
        <div className={styles.factRow}>
          <b>Durum</b>
          <span>{status?.statusMessage || (isDesktopShell ? "Yükleniyor…" : "Web — uygulanmaz")}</span>
        </div>
        {status?.currentVersion ? (
          <div className={styles.factRow}>
            <b>Uygulama sürümü</b>
            <span>{status.currentVersion}</span>
          </div>
        ) : null}
      </div>
      {isDesktopShell && feedConfigured ? (
        <div className={styles.actionRow} style={{ marginTop: 12 }}>
          <div className={styles.actionText}>
            <b>Şimdi kontrol et</b>
            <span>Feed üzerinden yeni sürüm var mı bak (indirme otomatik değil).</span>
          </div>
          <button type="button" className={styles.smallBtn} disabled={busy} onClick={() => void onCheck()}>
            Kontrol et
          </button>
        </div>
      ) : null}
    </section>
  );
}

function AdvancedSection({ onCompact, onClearPromptHistory, onAutoCompaction }: { onCompact?: () => void; onClearPromptHistory?: () => void; onAutoCompaction?: (enabled: boolean) => void }) {
  // Only fields used in the UI — avoid full config/state object identity churn.
  const autoCompactionEnabled = useAppStore((s) => (s.state as any)?.autoCompactionEnabled as boolean | undefined);
  const [confirmReset, setConfirmReset] = useState(false);
  const importRef = useRef<HTMLInputElement | null>(null);

  function stamp() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function exportConversationAs(format: "markdown" | "json") {
    const store = useAppStore.getState();
    if (!store.messages.length) {
      store.showToast("Dışa aktarılacak mesaj yok", "warning");
      return;
    }
    const content = exportConversation(store.messages, store.tools, { format, includeTools: true, includeThinking: false });
    const ext = format === "markdown" ? "md" : "json";
    const mime = format === "markdown" ? "text/markdown" : "application/json";
    downloadFile(content, `quake-sohbet-${stamp()}.${ext}`, mime);
  }

  function resetUiState() {
    LOCAL_UI_STATE_KEYS.forEach(removeStorageValue);
    setConfirmReset(false);
    useAppStore.getState().showToast("Yerel arayüz durumu sıfırlandı. Sayfayı yenileyin.", "success", {
      actionLabel: "Yenile",
      action: () => window.location.reload(),
    });
  }

  function exportSettings() {
    const data: Record<string, string> = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith("quake-web:")) {
        const value = localStorage.getItem(key);
        if (value !== null) data[key] = value;
      }
    }
    const payload = JSON.stringify({ format: "quake-web-settings", version: 1, exportedAt: new Date().toISOString(), data }, null, 2);
    downloadFile(payload, `quake-ayarlar-${stamp()}.json`, "application/json");
  }

  function importSettings(file: File) {
    file.text().then((text) => {
      try {
        const parsed = JSON.parse(text);
        if (parsed?.format !== "quake-web-settings" || !parsed.data || typeof parsed.data !== "object") throw new Error("format");
        let count = 0;
        for (const [key, value] of Object.entries(parsed.data)) {
          if (key.startsWith("quake-web:") && typeof value === "string") { localStorage.setItem(key, value); count += 1; }
        }
        useAppStore.getState().showToast(`${count} ayar içe aktarıldı. Yenileniyor…`, "success");
        window.setTimeout(() => window.location.reload(), 700);
      } catch {
        useAppStore.getState().showToast("Geçersiz ayar dosyası", "error");
      }
    });
  }

  return (
    <>
      <section className={styles.card}>
        <h3>Sohbeti dışa aktar</h3>
        <div className={styles.actionRow}>
          <div className={styles.actionText}>
            <b>Mevcut sohbeti indir</b>
            <span>Konuşmayı Markdown veya JSON olarak kaydet.</span>
          </div>
          <div className={styles.actionButtons}>
            <button type="button" className={styles.smallBtn} onClick={() => exportConversationAs("markdown")}>Markdown</button>
            <button type="button" className={styles.smallBtn} onClick={() => exportConversationAs("json")}>JSON</button>
          </div>
        </div>
      </section>

      {(onCompact || onAutoCompaction || onClearPromptHistory) && (
        <section className={styles.card}>
          <h3>Oturum & bakım</h3>
          {onAutoCompaction && (
            <div className={styles.toggleRow}>
              <span className={styles.toggleLabel}>Otomatik bağlam sıkıştırma<small>Bağlam dolunca konuşmayı otomatik özetle</small></span>
              <Switch checked={autoCompactionEnabled !== false} onChange={onAutoCompaction} label="Otomatik bağlam sıkıştırma" />
            </div>
          )}
          {onCompact && (
            <div className={styles.actionRow} style={{ marginTop: "var(--space-2)" }}>
              <div className={styles.actionText}><b>Şimdi sıkıştır</b><span>Mevcut konuşmayı hemen özetle (/compact).</span></div>
              <button type="button" className={styles.smallBtn} onClick={onCompact}>Sıkıştır</button>
            </div>
          )}
          {onClearPromptHistory && (
            <div className={styles.actionRow} style={{ marginTop: "var(--space-2)" }}>
              <div className={styles.actionText}><b>Komut geçmişini temizle</b><span>Composer'daki yukarı/aşağı oklarıyla gezilen geçmişi siler.</span></div>
              <button type="button" className={styles.smallBtn} onClick={onClearPromptHistory}>Temizle</button>
            </div>
          )}
        </section>
      )}

      <section className={styles.card}>
        <h3>Ayar yedekleme</h3>
        <div className={styles.actionRow}>
          <div className={styles.actionText}><b>Arayüz tercihlerini yedekle / geri yükle</b><span>Bu cihazdaki quake-web arayüz tercihlerini JSON olarak aktarır; provider hesapları, MCP ve çalışma alanı politikaları dahil değildir.</span></div>
          <div className={styles.actionButtons}>
            <button type="button" className={styles.smallBtn} onClick={exportSettings}>Dışa aktar</button>
            <button type="button" className={styles.smallBtn} onClick={() => importRef.current?.click()}>İçe aktar</button>
            <input ref={importRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(event) => { const file = event.target.files?.[0]; if (file) importSettings(file); event.target.value = ""; }} />
          </div>
        </div>
      </section>

      <section className={`${styles.card} ${styles.danger}`}>
        <h3>Arayüzü sıfırla</h3>
        <div className={styles.actionRow}>
          <div className={styles.actionText}>
            <b>Yerel arayüz durumunu sıfırla</b>
            <span>Tema, paneller, geçmiş, sabitlenen modeller ve bildirim tercihleri silinir. Sohbet geçmişi sunucuda kalır.</span>
          </div>
          {confirmReset ? (
            <div className={styles.actionButtons}>
              <button type="button" className={styles.dangerBtn} onClick={resetUiState}>Evet, sıfırla</button>
              <button type="button" className={styles.smallBtn} onClick={() => setConfirmReset(false)}>Vazgeç</button>
            </div>
          ) : (
            <button type="button" className={styles.dangerBtn} onClick={() => setConfirmReset(true)}>Sıfırla</button>
          )}
        </div>
      </section>

    </>
  );
}
