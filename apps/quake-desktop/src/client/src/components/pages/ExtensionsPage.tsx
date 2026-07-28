import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  Settings2,
  Plus,
  ChevronDown,
  SlidersHorizontal,
  MoreHorizontal,
  MonitorSmartphone,
  Globe,
  FileText,
  Puzzle,
} from "lucide-react";
import type { WebExtensionInfo, WebSkillInfo } from "../../../../shared/protocol";
import { localeForIntl, useI18n } from "../../i18n";
import { apiGet, apiPost } from "../../lib/api";
import { SkeletonLines } from "../common/Feedback";
import styles from "./ExtensionsPage.module.css";

/**
 * Eklentiler — MERKEZ tam-sayfa (Codex "Extensions" birebir).
 * Veri kaynağı: GET /api/extensions (gerçek runtime + katalog).
 */

export type ExtensionsPageProps = {
  onTryInChat?: (name: string) => void;
  onInstall?: (id: string) => void;
  onOpenSettings?: () => void;
};

type TabKey = "extensions" | "skills";
type FilterKey = "bundled" | "workspace" | "personal";

const FILTERS: { key: FilterKey; labelKey: "extensions.filter.bundled" | "extensions.filter.workspace" | "extensions.filter.personal" }[] = [
  { key: "bundled", labelKey: "extensions.filter.bundled" },
  { key: "workspace", labelKey: "extensions.filter.workspace" },
  { key: "personal", labelKey: "extensions.filter.personal" },
];

const CATEGORY_KEYS: Record<string, "extensions.category.featured" | "extensions.category.productivity" | "extensions.category.education" | "extensions.category.other"> = {
  featured: "extensions.category.featured",
  productivity: "extensions.category.productivity",
  education: "extensions.category.education",
  other: "extensions.category.other",
};

function extensionIcon(ext: WebExtensionInfo): React.ReactNode {
  if (ext.id === "quake-computer-use") {
    return <MonitorSmartphone size={20} aria-hidden="true" />;
  }
  if (ext.id === "quake-chrome") {
    return <Globe size={20} aria-hidden="true" />;
  }
  if (ext.id === "quake-latex") {
    return <FileText size={20} aria-hidden="true" />;
  }
  return <Puzzle size={20} aria-hidden="true" />;
}

export function ExtensionsPage({ onTryInChat, onInstall, onOpenSettings }: ExtensionsPageProps) {
  const { locale, t } = useI18n();
  const [tab, setTab] = useState<TabKey>("extensions");
  const [filter, setFilter] = useState<FilterKey>("bundled");
  const [query, setQuery] = useState("");
  const [extensions, setExtensions] = useState<WebExtensionInfo[]>([]);
  const [skills, setSkills] = useState<WebSkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [installedOnly, setInstalledOnly] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [extensionMenu, setExtensionMenu] = useState<string>();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      apiGet<{ extensions?: WebExtensionInfo[] }>("/api/extensions")
        .then((d) => (Array.isArray(d?.extensions) ? d.extensions : []))
        .catch(() => []),
      apiGet<{ skills?: WebSkillInfo[] }>("/api/skills")
        .then((d) => (Array.isArray(d?.skills) ? d.skills : []))
        .catch(() => []),
    ]).then(([ext, sk]) => {
      if (!alive) return;
      setExtensions(ext);
      setSkills(sk);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  function toggleExtension(ext: WebExtensionInfo, enabled: boolean) {
    const id = ext.id;
    setExtensions((prev) => prev.map((entry) => (entry.id === id ? { ...entry, enabled } : entry)));
    apiPost("/api/extensions/toggle", { id, enabled }).then(
      () => setReloadKey((k) => k + 1),
      () => {
        setExtensions((prev) => prev.map((entry) => (entry.id === id ? { ...entry, enabled: !enabled } : entry)));
      },
    );
  }

  function installExtension(ext: WebExtensionInfo) {
    toggleExtension(ext, true);
    onInstall?.(ext.id);
  }

  const q = query.trim().toLocaleLowerCase(localeForIntl(locale));
  const matchText = (name: string, description = "") =>
    !q || name.toLocaleLowerCase(localeForIntl(locale)).includes(q) || description.toLocaleLowerCase(localeForIntl(locale)).includes(q);

  const filteredExtensions = useMemo(() => {
    return extensions.filter((ext) => {
      const source = ext.source || "bundled";
      if (source !== filter) return false;
      if (installedOnly && !ext.enabled) return false;
      return matchText(ext.name, ext.description || "");
    });
  }, [extensions, filter, installedOnly, q]);

  const extensionSections = useMemo(() => {
    const groups = new Map<string, WebExtensionInfo[]>();
    for (const extension of filteredExtensions) {
      const category = extension.category || "other";
      groups.set(category, [...(groups.get(category) || []), extension]);
    }
    return [...groups.entries()].map(([category, items]) => ({ label: t(CATEGORY_KEYS[category] || "extensions.category.other"), items }));
  }, [filteredExtensions, t]);

  const installed = useMemo(
    () => extensions.filter((ext) => ext.enabled),
    [extensions],
  );

  const filteredSkills = useMemo(
    () => skills.filter((s) => matchText(s.name, s.description || "")),
    [skills, q],
  );

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.tabs} role="tablist" aria-label={t("extensions.view")}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "extensions"}
            className={`${styles.tab} ${tab === "extensions" ? styles.tabActive : ""}`}
            onClick={() => setTab("extensions")}
          >
            {t("extensions.extensionsTab")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "skills"}
            className={`${styles.tab} ${tab === "skills" ? styles.tabActive : ""}`}
            onClick={() => setTab("skills")}
          >
            {t("extensions.skillsTab")}
          </button>
        </div>
        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.topIconBtn}
            aria-label={t("extensions.refresh")}
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.topIconBtn}
            aria-label={t("extensions.settings")}
            onClick={onOpenSettings}
          >
            <Settings2 size={15} aria-hidden="true" />
          </button>
          <div className={styles.topAddGroup}>
            <button type="button" className={styles.topAddBtn} aria-label={t("extensions.add")} onClick={onOpenSettings}>
              <Plus size={15} aria-hidden="true" />
            </button>
            <button type="button" className={styles.topCaretBtn} aria-label={t("extensions.addOptions")} aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen((open) => !open)}>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {addMenuOpen && <div className={styles.actionMenu}>
              <button type="button" onClick={() => { setFilter("workspace"); setAddMenuOpen(false); }}>{t("extensions.workspaceExtensions")}</button>
              <button type="button" onClick={() => { setFilter("personal"); setAddMenuOpen(false); }}>{t("extensions.personalExtensions")}</button>
              <button type="button" onClick={() => { onOpenSettings?.(); setAddMenuOpen(false); }}>{t("extensions.openSettings")}</button>
            </div>}
          </div>
        </div>
      </header>

      <div className={styles.scroll}>
        <div className={styles.container}>
          {tab === "extensions" ? (
            <section role="tabpanel" aria-label={t("extensions.extensionsTab")}>
              <h1 className={styles.heading}>{t("extensions.title")}</h1>
              <p className={styles.subhead}>{t("extensions.subtitle")}</p>

              <div className={styles.searchBox}>
                <Search size={16} className={styles.searchIcon} aria-hidden="true" />
                <input
                  className={styles.searchInput}
                  type="search"
                  value={query}
                  placeholder={t("extensions.searchExtension")}
                  aria-label={t("extensions.searchExtension")}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>

              <div className={styles.installedHead}>
                <span className={styles.installedTitle}>{t("extensions.installed")}</span>
                <button
                  type="button"
                  className={styles.installedGear}
                  aria-label={t("extensions.installedSettings")}
                  onClick={onOpenSettings}
                >
                  <Settings2 size={16} aria-hidden="true" />
                </button>
              </div>
              <div className={styles.installedRow}>
                {loading ? (
                  <span className={styles.installedEmpty}>{t("extensions.loading")}</span>
                ) : installed.length === 0 ? (
                  <span className={styles.installedEmpty}>{t("extensions.noneInstalled")}</span>
                ) : (
                  installed.map((ext) => (
                    <span
                      key={ext.id}
                      className={styles.installedIcon}
                      title={ext.name}
                      aria-label={ext.name}
                    >
                      {extensionIcon(ext)}
                    </span>
                  ))
                )}
              </div>

              <div className={styles.filterRow}>
                <div className={styles.filterTabs} role="tablist" aria-label={t("extensions.sourceFilter")}>
                  {FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      role="tab"
                      aria-selected={filter === f.key}
                      className={`${styles.filterTab} ${filter === f.key ? styles.filterTabActive : ""}`}
                      onClick={() => setFilter(f.key)}
                    >
                      {t(f.labelKey)}
                    </button>
                  ))}
                </div>
                <button type="button" className={`${styles.filterIconBtn} ${installedOnly ? styles.filterIconActive : ""}`} aria-label={t("extensions.installedOnly")} aria-pressed={installedOnly} title={t("extensions.installedOnlyTitle")} onClick={() => setInstalledOnly((value) => !value)}>
                  <SlidersHorizontal size={16} aria-hidden="true" />
                </button>
              </div>

              {loading ? (
                <div className={styles.skeletonWrap}>
                  <SkeletonLines count={4} />
                </div>
              ) : filteredExtensions.length === 0 ? (
                <div className={styles.empty}>{t("extensions.notFound")}</div>
              ) : (
                extensionSections.map((section) => (
                  <ExtensionSection
                    key={section.label}
                    label={section.label}
                    items={section.items}
                    openMenuId={extensionMenu}
                    onOpenMenu={setExtensionMenu}
                    onTryInChat={onTryInChat}
                    onOpenSettings={onOpenSettings}
                    onInstall={installExtension}
                    onToggle={toggleExtension}
                  />
                ))
              )}

              <p className={styles.footer}>{t("extensions.discovered", { count: extensions.length })}</p>
            </section>
          ) : (
            <section role="tabpanel" aria-label={t("extensions.skillsTab")}>
              <h1 className={styles.heading}>{t("extensions.skillsTitle")}</h1>
              <p className={styles.subhead}>{t("extensions.skillsSubtitle")}</p>

              <div className={styles.searchBox}>
                <Search size={16} className={styles.searchIcon} aria-hidden="true" />
                <input
                  className={styles.searchInput}
                  type="search"
                  value={query}
                  placeholder={t("extensions.searchSkill")}
                  aria-label={t("extensions.searchSkill")}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>

              <div className={styles.sectionLabel}>{t("extensions.installedSkills")}</div>
              <div className={styles.divider} />
              {loading ? (
                <div className={styles.skeletonWrap}>
                  <SkeletonLines count={4} />
                </div>
              ) : filteredSkills.length === 0 ? (
                <div className={styles.empty}>{t("extensions.skillsNotFound")}</div>
              ) : (
                <div className={styles.cardList}>
                  {filteredSkills.map((skill) => (
                    <div key={skill.name} className={styles.skillRow}>
                      <span className={styles.cardIcon}>
                        <Puzzle size={20} aria-hidden="true" />
                      </span>
                      <div className={styles.cardMain}>
                        <div className={styles.cardName}>{skill.name}</div>
                        {skill.description && <div className={styles.cardDesc}>{skill.description}</div>}
                      </div>
                      {skill.source && <span className={styles.skillBadge}>{skill.source}</span>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function ExtensionSection({
  label,
  items,
  openMenuId,
  onOpenMenu,
  onTryInChat,
  onOpenSettings,
  onInstall,
  onToggle,
}: {
  label: string;
  items: WebExtensionInfo[];
  openMenuId?: string;
  onOpenMenu: (id?: string) => void;
  onTryInChat?: (name: string) => void;
  onOpenSettings?: () => void;
  onInstall: (ext: WebExtensionInfo) => void;
  onToggle: (ext: WebExtensionInfo, enabled: boolean) => void;
}) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <>
      <div className={styles.sectionLabel}>{label}</div>
      <div className={styles.divider} />
      <div className={styles.cardList}>
        {items.map((ext) => {
          const active = Boolean(ext.enabled);
          const needsInstall = ext.optIn && !active;
          return (
            <div key={`${label}-${ext.id}`} className={styles.card}>
              <span className={styles.cardIcon}>{extensionIcon(ext)}</span>
              <div className={styles.cardMain}>
                <div className={styles.cardName}>{ext.name}</div>
                <div className={styles.cardDesc}>{ext.description || t("extensions.extensionFallback")}</div>
              </div>
              <div className={styles.cardActions}>
                {needsInstall ? (
                  <button type="button" className={styles.installBtn} onClick={() => onInstall(ext)}>
                    {t("extensions.install")}
                  </button>
                ) : active ? (
                  <>
                    <button type="button" className={styles.tryBtn} onClick={() => onTryInChat?.(ext.name)}>
                      {t("extensions.tryInChat")}
                    </button>
                    {ext.optIn && (
                      <button
                        type="button"
                        className={styles.installBtn}
                        onClick={() => onToggle(ext, false)}
                      >
                        {t("extensions.disable")}
                      </button>
                    )}
                  </>
                ) : (
                  <button type="button" className={styles.installBtn} onClick={() => onInstall(ext)}>
                    Kur
                  </button>
                )}
                <div className={styles.extensionMenuWrap}>
                  <button type="button" className={styles.menuBtn} aria-label={t("extensions.menu", { name: ext.name })} aria-expanded={openMenuId === ext.id} onClick={() => onOpenMenu(openMenuId === ext.id ? undefined : ext.id)}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                  {openMenuId === ext.id && <div className={styles.extensionMenu}>
                    <button type="button" onClick={() => { onTryInChat?.(ext.name); onOpenMenu(undefined); }}>{t("extensions.tryInChat")}</button>
                    <button type="button" onClick={() => { onToggle(ext, !active); onOpenMenu(undefined); }}>{active ? t("extensions.disable") : t("extensions.enable")}</button>
                    <button type="button" onClick={() => { onOpenSettings?.(); onOpenMenu(undefined); }}>{t("extensions.openSettings")}</button>
                  </div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
