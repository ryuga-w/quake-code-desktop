import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  ChevronDown,
  Sparkles,
  Play,
  Trash2,
  Power,
  Bug,
  BookOpen,
  Users,
  Activity,
  Gamepad2,
  Network,
  FileText,
  BarChart3,
  CheckCircle2,
  TestTube,
} from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "../../lib/api";
import { SkeletonLines } from "../common/Feedback";
import styles from "./SchedulePage.module.css";

/**
 * Zamanlananlar — MERKEZ tam-sayfa (Codex "Scheduled" birebir).
 * Sekmeler: Tasks | Templates. Sağ üstte "Sohbetle oluştur" + caret.
 *
 * Tasks: GET /api/scheduled → {tasks:[{id,name,cron,prompt,enabled,nextRun,lastRun}]}
 * Templates: statik küratör; karta tıklayınca onUseTemplate(template).
 *
 * Tüm renkler design token'larından (dark/light otomatik).
 */

export type ScheduledTask = {
  id: string;
  name: string;
  cron: string;
  prompt?: string;
  enabled?: boolean;
  nextRun?: number | string | null;
  lastRun?: number | string | null;
};

export type ScheduleTemplate = {
  id: string;
  icon: React.ReactNode;
  description: string;
  schedule: string;
  cron: string;
  prompt: string;
  name: string;
};

export type SchedulePageProps = {
  /** Yeni görev oluştur (cron+prompt). Verilmezse sayfa kendisi POST /api/scheduled yapar. */
  onCreate?: (input: { name: string; cron: string; prompt: string }) => void | Promise<void>;
  /** Etkin/pasif anahtarı. Verilmezse sayfa PATCH /api/scheduled/:id yapar. */
  onToggle?: (task: ScheduledTask, enabled: boolean) => void | Promise<void>;
  /** Görevi sil. Verilmezse sayfa DELETE /api/scheduled/:id yapar. */
  onDelete?: (task: ScheduledTask) => void | Promise<void>;
  /** Şimdi çalıştır. Verilmezse sayfa POST /api/scheduled/:id/run yapar. */
  onRunNow?: (task: ScheduledTask) => void | Promise<void>;
  /** Bir şablon seçildiğinde (yeni görev oluşturma akışını prefill et). */
  onUseTemplate?: (template: ScheduleTemplate) => void;
  /** "Sohbetle oluştur" — komut/sohbet ile yeni görev. */
  onCreateWithChat?: () => void;
};

type TabKey = "tasks" | "templates";

/* ============================================================
   Statik şablon küratörü (Codex görselindeki ~10 sablon birebir)
   ============================================================ */
const TEMPLATES: ScheduleTemplate[] = [
  {
    id: "commit-scan",
    icon: <Bug size={20} aria-hidden="true" />,
    name: "Commit tarama",
    description:
      "Son commit'leri (son çalıştırmadan beri veya son 24 saatte) olası hatalar için tara ve en küçük düzeltmeleri öner.",
    schedule: "Günlük olarak saat 9:00",
    cron: "0 9 * * *",
    prompt:
      "Son commit'leri (son çalıştırmadan beri veya son 24 saatte) olası hatalar için tara ve en küçük düzeltmeleri öner.",
  },
  {
    id: "pr-release-notes",
    icon: <BookOpen size={20} aria-hidden="true" />,
    name: "PR sürüm notları",
    description: "Son haftanın çalışma alanı değişikliklerinden sürüm notları taslağı oluştur.",
    schedule: "Her Cuma saat 9:00",
    cron: "0 9 * * 5",
    prompt: "Son haftanın çalışma alanı değişikliklerinden sürüm notları taslağı oluştur.",
  },
  {
    id: "standup",
    icon: <Users size={20} aria-hidden="true" />,
    name: "Standup özeti",
    description: "Bir önceki günün çalışma alanı etkinliğini standup için özetle.",
    schedule: "Hafta içi saat 9:00",
    cron: "0 9 * * 1-5",
    prompt: "Bir önceki günün çalışma alanı etkinliğini standup için özetle.",
  },
  {
    id: "ci-summary",
    icon: <Activity size={20} aria-hidden="true" />,
    name: "Gün sonu özeti",
    description:
      "Bugünün önemli değişikliklerini ve kalan işleri özetle; en önemli sonraki adımları öner.",
    schedule: "Günlük olarak saat 21:00",
    cron: "0 21 * * *",
    prompt: "Bugünün önemli değişikliklerini ve kalan işleri özetle; en önemli sonraki adımları öner.",
  },
  {
    id: "build-game",
    icon: <Gamepad2 size={20} aria-hidden="true" />,
    name: "Oyun oluştur",
    description: "Küçük, klasik ve dar kapsamlı bir oyun oluştur.",
    schedule: "Günlük olarak saat 14:00",
    cron: "0 14 * * *",
    prompt: "Küçük, klasik ve dar kapsamlı bir oyun oluştur.",
  },
  {
    id: "suggest-skills",
    icon: <Network size={20} aria-hidden="true" />,
    name: "Beceri öner",
    description: "Son PR'lerden ve incelemelerden yola çıkarak sıradaki derinleştirilecek becerileri öner.",
    schedule: "Her Cuma saat 10:00",
    cron: "0 10 * * 5",
    prompt: "Son PR'lerden ve incelemelerden yola çıkarak sıradaki derinleştirilecek becerileri öner.",
  },
  {
    id: "weekly-digest",
    icon: <FileText size={20} aria-hidden="true" />,
    name: "Haftalık özet",
    description: "Bu haftanın PR'lerini, dağıtımlarını, olaylarını ve incelemelerini haftalık bir güncellemede özetle.",
    schedule: "Her Cuma saat 16:00",
    cron: "0 16 * * 5",
    prompt: "Bu haftanın PR'lerini, dağıtımlarını, olaylarını ve incelemelerini haftalık bir güncellemede özetle.",
  },
  {
    id: "benchmark",
    icon: <BarChart3 size={20} aria-hidden="true" />,
    name: "Benchmark",
    description: "Son değişiklikleri benchmark'lar veya izlerle karşılaştır ve gerilemeleri erkenden işaretle.",
    schedule: "Günlük olarak saat 9:00",
    cron: "0 9 * * *",
    prompt: "Son değişiklikleri benchmark'lar veya izlerle karşılaştır ve gerilemeleri erkenden işaretle.",
  },
  {
    id: "dependency-scan",
    icon: <CheckCircle2 size={20} aria-hidden="true" />,
    name: "Bağımlılık tara",
    description: "Bağımlılık ve SDK sapmalarını tespit et ve asgari bir yükseltme planı öner.",
    schedule: "Günlük olarak saat 9:00",
    cron: "0 9 * * *",
    prompt: "Bağımlılık ve SDK sapmalarını tespit et ve asgari bir yükseltme planı öner.",
  },
  {
    id: "untested-paths",
    icon: <TestTube size={20} aria-hidden="true" />,
    name: "Test edilmemiş yollar",
    description: "Son değişikliklerdeki test edilmemiş kod yollarını belirle ve hedefli testler öner.",
    schedule: "Günlük olarak saat 9:00",
    cron: "0 9 * * *",
    prompt: "Son değişikliklerdeki test edilmemiş kod yollarını belirle ve hedefli testler öner.",
  },
];

export function SchedulePage({
  onCreate,
  onToggle,
  onDelete,
  onRunNow,
  onUseTemplate,
  onCreateWithChat,
}: SchedulePageProps) {
  const [tab, setTab] = useState<TabKey>("tasks");
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [taskQuery, setTaskQuery] = useState("");
  const [tplQuery, setTplQuery] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ tasks?: ScheduledTask[] }>("/api/scheduled");
      setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
    } catch (err: any) {
      setError(err?.message || "Zamanlanan görevler okunamadı");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runAction(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch {
      // sessizce yut — satır kendi durumunu korur; ileride toast eklenebilir
    } finally {
      setBusy(null);
    }
  }

  function toggleEnabled(task: ScheduledTask) {
    const next = !(task.enabled !== false);
    void runAction(`toggle:${task.id}`, async () => {
      if (onToggle) {
        await onToggle(task, next);
      } else {
        await apiPatch(`/api/scheduled/${encodeURIComponent(task.id)}`, { enabled: next });
      }
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, enabled: next } : t)));
    });
  }

  function runNow(task: ScheduledTask) {
    void runAction(`run:${task.id}`, async () => {
      if (onRunNow) {
        await onRunNow(task);
      } else {
        await apiPost(`/api/scheduled/${encodeURIComponent(task.id)}/run`, {});
      }
      await refresh();
    });
  }

  function remove(task: ScheduledTask) {
    void runAction(`delete:${task.id}`, async () => {
      if (onDelete) {
        await onDelete(task);
      } else {
        await apiDelete(`/api/scheduled/${encodeURIComponent(task.id)}`);
      }
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    });
  }

  function useTemplate(template: ScheduleTemplate) {
    if (onUseTemplate) {
      onUseTemplate(template);
      return;
    }
    void runAction(`tpl:${template.id}`, async () => {
      const input = { name: template.name, cron: template.cron, prompt: template.prompt };
      if (onCreate) {
        await onCreate(input);
      } else {
        await apiPost("/api/scheduled", input);
      }
      setTab("tasks");
      await refresh();
    });
  }

  const filteredTasks = useMemo(() => {
    const q = taskQuery.trim().toLocaleLowerCase("tr");
    const base = q
      ? tasks.filter(
          (t) =>
            (t.name || "").toLocaleLowerCase("tr").includes(q) ||
            (t.cron || "").toLocaleLowerCase("tr").includes(q) ||
            (t.prompt || "").toLocaleLowerCase("tr").includes(q),
        )
      : tasks;
    return [...base].sort((a, b) => {
      const ea = a.enabled === false ? 1 : 0;
      const eb = b.enabled === false ? 1 : 0;
      if (ea !== eb) return ea - eb;
      return (a.name || "").localeCompare(b.name || "", "tr");
    });
  }, [tasks, taskQuery]);

  const filteredTemplates = useMemo(() => {
    const q = tplQuery.trim().toLocaleLowerCase("tr");
    if (!q) return TEMPLATES;
    return TEMPLATES.filter(
      (t) =>
        t.name.toLocaleLowerCase("tr").includes(q) ||
        t.description.toLocaleLowerCase("tr").includes(q) ||
        t.schedule.toLocaleLowerCase("tr").includes(q),
    );
  }, [tplQuery]);

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.tabs} role="tablist" aria-label="Zamanlananlar görünümü">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "tasks"}
            className={`${styles.tab} ${tab === "tasks" ? styles.tabActive : ""}`}
            onClick={() => setTab("tasks")}
          >
            Tasks
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "templates"}
            className={`${styles.tab} ${tab === "templates" ? styles.tabActive : ""}`}
            onClick={() => setTab("templates")}
          >
            Şablonlar
          </button>
        </div>
        <div className={styles.createGroup}>
          <button type="button" className={styles.createBtn} onClick={onCreateWithChat}>
            <Sparkles size={14} aria-hidden="true" />
            <span>Sohbetle oluştur</span>
          </button>
          <button
            type="button"
            className={styles.caretBtn}
            onClick={onCreateWithChat}
            aria-label="Oluşturma seçenekleri"
          >
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={styles.scroll}>
        <div className={styles.container}>
          {tab === "tasks" ? (
            <section role="tabpanel" aria-label="Tasks">
              <h1 className={styles.heading}>Zamanlandı</h1>
              <p className={styles.subhead}>Yinelenen görevleri, hatırlatıcıları ve izleyicileri yönet</p>

              <div className={styles.searchBox}>
                <Search size={16} aria-hidden="true" className={styles.searchIcon} />
                <input
                  className={styles.searchInput}
                  value={taskQuery}
                  onChange={(e) => setTaskQuery(e.target.value)}
                  placeholder="Zamanlanmış görev ara"
                  type="search"
                  aria-label="Zamanlanmış görev ara"
                />
              </div>

              <div className={styles.sectionLabel}>Geçerli</div>
              <div className={styles.divider} />

              {loading && tasks.length === 0 ? (
                <div className={styles.skeletonWrap}>
                  <SkeletonLines count={4} />
                </div>
              ) : error ? (
                <div className={styles.empty}>{error}</div>
              ) : filteredTasks.length === 0 ? (
                <div className={styles.empty}>
                  {taskQuery.trim()
                    ? "Aramanızla eşleşen zamanlanmış görev yok."
                    : "Henüz zamanlanmış görev yok. Bir şablonla başlayın veya sohbetle oluşturun."}
                </div>
              ) : (
                <ul className={styles.taskList}>
                  {filteredTasks.map((task) => {
                    const off = task.enabled === false;
                    return (
                      <li key={task.id} className={`${styles.taskRow} ${off ? styles.taskRowOff : ""}`}>
                        <button
                          type="button"
                          className={`${styles.radio} ${off ? "" : styles.radioOn}`}
                          onClick={() => toggleEnabled(task)}
                          disabled={!!busy}
                          aria-pressed={!off}
                          aria-label={off ? "Etkinleştir" : "Pasifleştir"}
                          title={off ? "Etkinleştir" : "Pasifleştir"}
                        >
                          <span className={styles.radioDot} />
                        </button>
                        <div className={styles.taskMain}>
                          <div className={styles.taskTopline}>
                            <span className={styles.taskName} title={task.name}>
                              {task.name || "Adsız görev"}
                            </span>
                            <span className={styles.taskSep} aria-hidden="true">
                              ·
                            </span>
                          </div>
                          <div className={styles.taskMeta}>
                            Next run {formatNextRun(task.nextRun)} · {cronSummary(task.cron)}
                          </div>
                        </div>
                        <div className={styles.taskActions}>
                          <button
                            type="button"
                            className={styles.rowIconBtn}
                            onClick={() => runNow(task)}
                            disabled={!!busy}
                            aria-label="Şimdi çalıştır"
                            title="Şimdi çalıştır"
                          >
                            <Play size={14} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className={`${styles.rowIconBtn} ${off ? "" : styles.rowIconActive}`}
                            onClick={() => toggleEnabled(task)}
                            disabled={!!busy}
                            aria-label={off ? "Etkinleştir" : "Pasifleştir"}
                            title={off ? "Etkinleştir" : "Pasifleştir"}
                          >
                            <Power size={14} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className={`${styles.rowIconBtn} ${styles.rowIconDanger}`}
                            onClick={() => remove(task)}
                            disabled={!!busy}
                            aria-label="Sil"
                            title="Sil"
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : (
            <section role="tabpanel" aria-label="Şablonlar">
              <h1 className={styles.heading}>Şablonlar</h1>
              <p className={styles.subhead}>Zamanlanmış görev şablonlarından biriyle başla</p>

              <div className={styles.searchBox}>
                <Search size={16} aria-hidden="true" className={styles.searchIcon} />
                <input
                  className={styles.searchInput}
                  value={tplQuery}
                  onChange={(e) => setTplQuery(e.target.value)}
                  placeholder="Şablonlarda ara"
                  type="search"
                  aria-label="Şablonlarda ara"
                />
              </div>

              <div className={styles.sectionLabel}>Sistem</div>

              {filteredTemplates.length === 0 ? (
                <div className={styles.empty}>Aramanızla eşleşen şablon yok.</div>
              ) : (
                <div className={styles.templateGrid}>
                  {filteredTemplates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      className={styles.templateCard}
                      onClick={() => useTemplate(tpl)}
                      disabled={busy === `tpl:${tpl.id}`}
                    >
                      <span className={styles.templateIcon}>{tpl.icon}</span>
                      <span className={styles.templateDesc}>{tpl.description}</span>
                      <span className={styles.templateSchedule}>{tpl.schedule}</span>
                    </button>
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

/* ---- nextRun → "18 saat sonra" gibi göreli TR metin ---- */
function formatNextRun(value: number | string | null | undefined): string {
  if (value == null || value === "") return "planlanmadı";
  let ms: number;
  if (typeof value === "number") {
    ms = value < 1e12 ? value * 1000 : value;
  } else {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return String(value);
    ms = parsed;
  }
  const diff = ms - Date.now();
  if (diff <= 0) return "az sonra";
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "az sonra";
  if (sec < 3600) return `${Math.round(sec / 60)} dakika sonra`;
  if (sec < 86400) return `${Math.round(sec / 3600)} saat sonra`;
  return `${Math.round(sec / 86400)} gün sonra`;
}

/* ---- cron ifadesini okunaklı TR özete çevir ---- */
function cronSummary(cron: string | undefined): string {
  const raw = (cron || "").trim();
  if (!raw) return "—";
  const parts = raw.split(/\s+/);
  if (parts.length < 5) return raw;
  const [min, hour, dom, , dow] = parts;
  const h = Number(hour);
  const m = Number(min);
  const hasTime = !Number.isNaN(h) && !Number.isNaN(m) && hour !== "*" && min !== "*";
  const time = hasTime ? `saat ${pad(h)}:${pad(m)}` : "";

  const days: Record<string, string> = {
    "0": "Pazar",
    "1": "Pazartesi",
    "2": "Salı",
    "3": "Çarşamba",
    "4": "Perşembe",
    "5": "Cuma",
    "6": "Cumartesi",
    "7": "Pazar",
  };

  if (dow === "1-5") return joinTime("Hafta içi", time);
  if (dow === "0,6" || dow === "6,0") return joinTime("Hafta sonu", time);
  if (dow && dow !== "*") {
    const name = days[dow];
    if (name) return joinTime(`Her ${name}`, time);
  }
  if (dom && dom !== "*") return joinTime(`Her ayın ${dom}. günü`, time);
  return joinTime("Günlük olarak", time);
}

function joinTime(label: string, time: string): string {
  return time ? `${label} ${time}` : label;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export default SchedulePage;
