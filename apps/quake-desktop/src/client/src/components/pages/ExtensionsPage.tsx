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

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "bundled", label: "OpenAI tarafından" },
  { key: "workspace", label: "Çalışma alanın tarafından" },
  { key: "personal", label: "Kişisel" },
];

const CATEGORY_LABELS: Record<string, string> = {
  featured: "Öne çıkanlar",
  productivity: "Üretkenlik",
  education: "Eğitim ve araştırma",
  other: "Diğer",
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

  const q = query.trim().toLocaleLowerCase("tr");
  const matchText = (name: string, description = "") =>
    !q || name.toLocaleLowerCase("tr").includes(q) || description.toLocaleLowerCase("tr").includes(q);

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
    return [...groups.entries()].map(([category, items]) => ({ label: CATEGORY_LABELS[category] || category, items }));
  }, [filteredExtensions]);

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
        <div className={styles.tabs} role="tablist" aria-label="Eklentiler görünümü">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "extensions"}
            className={`${styles.tab} ${tab === "extensions" ? styles.tabActive : ""}`}
            onClick={() => setTab("extensions")}
          >
            Eklentiler
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "skills"}
            className={`${styles.tab} ${tab === "skills" ? styles.tabActive : ""}`}
            onClick={() => setTab("skills")}
          >
            Beceriler
          </button>
        </div>
        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.topIconBtn}
            aria-label="Yenile"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.topIconBtn}
            aria-label="Eklenti ayarları"
            onClick={onOpenSettings}
          >
            <Settings2 size={15} aria-hidden="true" />
          </button>
          <div className={styles.topAddGroup}>
            <button type="button" className={styles.topAddBtn} aria-label="Eklenti ekle" onClick={onOpenSettings}>
              <Plus size={15} aria-hidden="true" />
            </button>
            <button type="button" className={styles.topCaretBtn} aria-label="Ekleme seçenekleri" aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen((open) => !open)}>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {addMenuOpen && <div className={styles.actionMenu}>
              <button type="button" onClick={() => { setFilter("workspace"); setAddMenuOpen(false); }}>Çalışma alanı eklentileri</button>
              <button type="button" onClick={() => { setFilter("personal"); setAddMenuOpen(false); }}>Kişisel eklentiler</button>
              <button type="button" onClick={() => { onOpenSettings?.(); setAddMenuOpen(false); }}>Eklenti ayarlarını aç</button>
            </div>}
          </div>
        </div>
      </header>

      <div className={styles.scroll}>
        <div className={styles.container}>
          {tab === "extensions" ? (
            <section role="tabpanel" aria-label="Eklentiler">
              <h1 className={styles.heading}>Eklentiler</h1>
              <p className={styles.subhead}>Quake Code'u favori araçlarınla genişlet</p>

              <div className={styles.searchBox}>
                <Search size={16} className={styles.searchIcon} aria-hidden="true" />
                <input
                  className={styles.searchInput}
                  type="search"
                  value={query}
                  placeholder="Eklenti ara"
                  aria-label="Eklenti ara"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>

              <div className={styles.installedHead}>
                <span className={styles.installedTitle}>Kurulu</span>
                <button
                  type="button"
                  className={styles.installedGear}
                  aria-label="Kurulu eklenti ayarları"
                  onClick={onOpenSettings}
                >
                  <Settings2 size={16} aria-hidden="true" />
                </button>
              </div>
              <div className={styles.installedRow}>
                {loading ? (
                  <span className={styles.installedEmpty}>Yükleniyor…</span>
                ) : installed.length === 0 ? (
                  <span className={styles.installedEmpty}>Henüz kurulu eklenti yok.</span>
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
                <div className={styles.filterTabs} role="tablist" aria-label="Eklenti kaynağı filtresi">
                  {FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      role="tab"
                      aria-selected={filter === f.key}
                      className={`${styles.filterTab} ${filter === f.key ? styles.filterTabActive : ""}`}
                      onClick={() => setFilter(f.key)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <button type="button" className={`${styles.filterIconBtn} ${installedOnly ? styles.filterIconActive : ""}`} aria-label="Yalnızca kurulu eklentileri göster" aria-pressed={installedOnly} title="Yalnızca kurulu" onClick={() => setInstalledOnly((value) => !value)}>
                  <SlidersHorizontal size={16} aria-hidden="true" />
                </button>
              </div>

              {loading ? (
                <div className={styles.skeletonWrap}>
                  <SkeletonLines count={4} />
                </div>
              ) : filteredExtensions.length === 0 ? (
                <div className={styles.empty}>Eklenti bulunamadı.</div>
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

              <p className={styles.footer}>{extensions.length} eklenti runtime tarafından keşfedildi</p>
            </section>
          ) : (
            <section role="tabpanel" aria-label="Beceriler">
              <h1 className={styles.heading}>Beceriler</h1>
              <p className={styles.subhead}>Ajanın kullanabildiği aktif yetenekler</p>

              <div className={styles.searchBox}>
                <Search size={16} className={styles.searchIcon} aria-hidden="true" />
                <input
                  className={styles.searchInput}
                  type="search"
                  value={query}
                  placeholder="Beceri ara"
                  aria-label="Beceri ara"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>

              <div className={styles.sectionLabel}>Yüklü beceriler</div>
              <div className={styles.divider} />
              {loading ? (
                <div className={styles.skeletonWrap}>
                  <SkeletonLines count={4} />
                </div>
              ) : filteredSkills.length === 0 ? (
                <div className={styles.empty}>Beceri bulunamadı.</div>
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
                <div className={styles.cardDesc}>{ext.description || "Eklenti"}</div>
              </div>
              <div className={styles.cardActions}>
                {needsInstall ? (
                  <button type="button" className={styles.installBtn} onClick={() => onInstall(ext)}>
                    Kur
                  </button>
                ) : active ? (
                  <>
                    <button type="button" className={styles.tryBtn} onClick={() => onTryInChat?.(ext.name)}>
                      Sohbette dene
                    </button>
                    {ext.optIn && (
                      <button
                        type="button"
                        className={styles.installBtn}
                        onClick={() => onToggle(ext, false)}
                      >
                        Devre dışı
                      </button>
                    )}
                  </>
                ) : (
                  <button type="button" className={styles.installBtn} onClick={() => onInstall(ext)}>
                    Kur
                  </button>
                )}
                <div className={styles.extensionMenuWrap}>
                  <button type="button" className={styles.menuBtn} aria-label={`${ext.name} menüsü`} aria-expanded={openMenuId === ext.id} onClick={() => onOpenMenu(openMenuId === ext.id ? undefined : ext.id)}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                  {openMenuId === ext.id && <div className={styles.extensionMenu}>
                    <button type="button" onClick={() => { onTryInChat?.(ext.name); onOpenMenu(undefined); }}>Sohbette dene</button>
                    <button type="button" onClick={() => { onToggle(ext, !active); onOpenMenu(undefined); }}>{active ? "Devre dışı bırak" : "Etkinleştir"}</button>
                    <button type="button" onClick={() => { onOpenSettings?.(); onOpenMenu(undefined); }}>Ayarları aç</button>
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