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
import { localeForIntl, type Translate, useI18n } from "../../i18n";
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

const TEMPLATE_EN: Record<string, Pick<ScheduleTemplate, "name" | "description" | "schedule" | "prompt">> = {
  "commit-scan": {
    name: "Scan commits",
    description: "Scan commits since the last run or the last 24 hours for likely bugs and suggest the smallest fixes.",
    schedule: "Daily at 9:00",
    prompt: "Scan commits since the last run or the last 24 hours for likely bugs and suggest the smallest fixes.",
  },
  "pr-release-notes": {
    name: "PR release notes",
    description: "Draft release notes from workspace changes over the last week.",
    schedule: "Every Friday at 9:00",
    prompt: "Draft release notes from workspace changes over the last week.",
  },
  standup: {
    name: "Standup summary",
    description: "Summarize the previous day's workspace activity for standup.",
    schedule: "Weekdays at 9:00",
    prompt: "Summarize the previous day's workspace activity for standup.",
  },
  "ci-summary": {
    name: "End-of-day summary",
    description: "Summarize today's important changes and remaining work, then suggest the most important next steps.",
    schedule: "Daily at 21:00",
    prompt: "Summarize today's important changes and remaining work, then suggest the most important next steps.",
  },
  "build-game": {
    name: "Build a game",
    description: "Build a small, classic, tightly scoped game.",
    schedule: "Daily at 14:00",
    prompt: "Build a small, classic, tightly scoped game.",
  },
  "suggest-skills": {
    name: "Suggest skills",
    description: "Suggest the next skills to deepen based on recent PRs and reviews.",
    schedule: "Every Friday at 10:00",
    prompt: "Suggest the next skills to deepen based on recent PRs and reviews.",
  },
  "weekly-digest": {
    name: "Weekly digest",
    description: "Summarize this week's PRs, deployments, incidents, and reviews in a weekly update.",
    schedule: "Every Friday at 16:00",
    prompt: "Summarize this week's PRs, deployments, incidents, and reviews in a weekly update.",
  },
  benchmark: {
    name: "Benchmark",
    description: "Compare recent changes with benchmarks or traces and flag regressions early.",
    schedule: "Daily at 9:00",
    prompt: "Compare recent changes with benchmarks or traces and flag regressions early.",
  },
  "dependency-scan": {
    name: "Scan dependencies",
    description: "Detect dependency and SDK drift and suggest a minimal upgrade plan.",
    schedule: "Daily at 9:00",
    prompt: "Detect dependency and SDK drift and suggest a minimal upgrade plan.",
  },
  "untested-paths": {
    name: "Untested paths",
    description: "Identify untested code paths in recent changes and suggest targeted tests.",
    schedule: "Daily at 9:00",
    prompt: "Identify untested code paths in recent changes and suggest targeted tests.",
  },
};

export function SchedulePage({
  onCreate,
  onToggle,
  onDelete,
  onRunNow,
  onUseTemplate,
  onCreateWithChat,
}: SchedulePageProps) {
  const { locale, t } = useI18n();
  const [tab, setTab] = useState<TabKey>("tasks");
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [taskQuery, setTaskQuery] = useState("");
  const [tplQuery, setTplQuery] = useState("");
  const templates = useMemo(
    () => TEMPLATES.map((template) => locale === "en" ? { ...template, ...TEMPLATE_EN[template.id] } : template),
    [locale],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ tasks?: ScheduledTask[] }>("/api/scheduled");
      setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
    } catch (err: any) {
      setError(err?.message || t("schedule.taskNone"));
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

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
    const intlLocale = localeForIntl(locale);
    const q = taskQuery.trim().toLocaleLowerCase(intlLocale);
    const base = q
      ? tasks.filter(
          (t) =>
            (t.name || "").toLocaleLowerCase(intlLocale).includes(q) ||
            (t.cron || "").toLocaleLowerCase(intlLocale).includes(q) ||
            (t.prompt || "").toLocaleLowerCase(intlLocale).includes(q),
        )
      : tasks;
    return [...base].sort((a, b) => {
      const ea = a.enabled === false ? 1 : 0;
      const eb = b.enabled === false ? 1 : 0;
      if (ea !== eb) return ea - eb;
      return (a.name || "").localeCompare(b.name || "", intlLocale);
    });
  }, [tasks, taskQuery, locale]);

  const filteredTemplates = useMemo(() => {
    const intlLocale = localeForIntl(locale);
    const q = tplQuery.trim().toLocaleLowerCase(intlLocale);
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.name.toLocaleLowerCase(intlLocale).includes(q) ||
        t.description.toLocaleLowerCase(intlLocale).includes(q) ||
        t.schedule.toLocaleLowerCase(intlLocale).includes(q),
    );
  }, [tplQuery, templates, locale]);

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.tabs} role="tablist" aria-label={t("schedule.view")}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "tasks"}
            className={`${styles.tab} ${tab === "tasks" ? styles.tabActive : ""}`}
            onClick={() => setTab("tasks")}
          >
            {t("schedule.tasks")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "templates"}
            className={`${styles.tab} ${tab === "templates" ? styles.tabActive : ""}`}
            onClick={() => setTab("templates")}
          >
            {t("schedule.templates")}
          </button>
        </div>
        <div className={styles.createGroup}>
          <button type="button" className={styles.createBtn} onClick={onCreateWithChat}>
            <Sparkles size={14} aria-hidden="true" />
            <span>{t("schedule.createWithChat")}</span>
          </button>
          <button
            type="button"
            className={styles.caretBtn}
            onClick={onCreateWithChat}
            aria-label={t("schedule.createOptions")}
          >
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={styles.scroll}>
        <div className={styles.container}>
          {tab === "tasks" ? (
            <section role="tabpanel" aria-label={t("schedule.tasks")}>
              <h1 className={styles.heading}>{t("schedule.title")}</h1>
              <p className={styles.subhead}>{t("schedule.subtitle")}</p>

              <div className={styles.searchBox}>
                <Search size={16} aria-hidden="true" className={styles.searchIcon} />
                <input
                  className={styles.searchInput}
                  value={taskQuery}
                  onChange={(e) => setTaskQuery(e.target.value)}
                  placeholder={t("schedule.searchTasks")}
                  type="search"
                  aria-label={t("schedule.searchTasks")}
                />
              </div>

              <div className={styles.sectionLabel}>{t("schedule.current")}</div>
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
                    ? t("schedule.taskMatchNone")
                    : t("schedule.taskNone")}
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
                          aria-label={off ? t("schedule.enable") : t("schedule.disable")}
                          title={off ? t("schedule.enable") : t("schedule.disable")}
                        >
                          <span className={styles.radioDot} />
                        </button>
                        <div className={styles.taskMain}>
                          <div className={styles.taskTopline}>
                            <span className={styles.taskName} title={task.name}>
                              {task.name || t("schedule.unnamedTask")}
                            </span>
                            <span className={styles.taskSep} aria-hidden="true">
                              ·
                            </span>
                          </div>
                          <div className={styles.taskMeta}>
                            {t("schedule.nextRun", { value: formatNextRun(task.nextRun, t) })} · {cronSummary(task.cron, t)}
                          </div>
                        </div>
                        <div className={styles.taskActions}>
                          <button
                            type="button"
                            className={styles.rowIconBtn}
                            onClick={() => runNow(task)}
                            disabled={!!busy}
                            aria-label={t("schedule.runNow")}
                            title={t("schedule.runNow")}
                          >
                            <Play size={14} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className={`${styles.rowIconBtn} ${off ? "" : styles.rowIconActive}`}
                            onClick={() => toggleEnabled(task)}
                            disabled={!!busy}
                            aria-label={off ? t("schedule.enable") : t("schedule.disable")}
                            title={off ? t("schedule.enable") : t("schedule.disable")}
                          >
                            <Power size={14} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className={`${styles.rowIconBtn} ${styles.rowIconDanger}`}
                            onClick={() => remove(task)}
                            disabled={!!busy}
                            aria-label={t("schedule.delete")}
                            title={t("schedule.delete")}
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
            <section role="tabpanel" aria-label={t("schedule.templates")}>
              <h1 className={styles.heading}>{t("schedule.templateTitle")}</h1>
              <p className={styles.subhead}>{t("schedule.templateSubtitle")}</p>

              <div className={styles.searchBox}>
                <Search size={16} aria-hidden="true" className={styles.searchIcon} />
                <input
                  className={styles.searchInput}
                  value={tplQuery}
                  onChange={(e) => setTplQuery(e.target.value)}
                  placeholder={t("schedule.searchTemplates")}
                  type="search"
                  aria-label={t("schedule.searchTemplates")}
                />
              </div>

              <div className={styles.sectionLabel}>{t("schedule.system")}</div>

              {filteredTemplates.length === 0 ? (
                <div className={styles.empty}>{t("schedule.templateMatchNone")}</div>
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
function formatNextRun(value: number | string | null | undefined, t: Translate): string {
  if (value == null || value === "") return t("schedule.nextRunNotScheduled");
  let ms: number;
  if (typeof value === "number") {
    ms = value < 1e12 ? value * 1000 : value;
  } else {
    const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return String(value);
    ms = parsed;
  }
  const diff = ms - Date.now();
  if (diff <= 0) return t("schedule.nextRunSoon");
  const sec = Math.round(diff / 1000);
  if (sec < 60) return t("schedule.nextRunSoon");
  if (sec < 3600) return t("schedule.nextRunMinutes", { count: Math.round(sec / 60) });
  if (sec < 86400) return t("schedule.nextRunHours", { count: Math.round(sec / 3600) });
  return t("schedule.nextRunDays", { count: Math.round(sec / 86400) });
}

/* ---- cron ifadesini okunaklı TR özete çevir ---- */
function cronSummary(cron: string | undefined, t: Translate): string {
  const raw = (cron || "").trim();
  if (!raw) return "—";
  const parts = raw.split(/\s+/);
  if (parts.length < 5) return raw;
  const [min, hour, dom, , dow] = parts;
  const h = Number(hour);
  const m = Number(min);
  const hasTime = !Number.isNaN(h) && !Number.isNaN(m) && hour !== "*" && min !== "*";
  const time = hasTime ? t("schedule.cronAt", { time: `${pad(h)}:${pad(m)}` }) : "";

  const days: Record<string, string> = {
    "0": t("schedule.sunday"),
    "1": t("schedule.monday"),
    "2": t("schedule.tuesday"),
    "3": t("schedule.wednesday"),
    "4": t("schedule.thursday"),
    "5": t("schedule.friday"),
    "6": t("schedule.saturday"),
    "7": t("schedule.sunday"),
  };

  if (dow === "1-5") return joinTime(t("schedule.cronWeekday"), time);
  if (dow === "0,6" || dow === "6,0") return joinTime(t("schedule.cronWeekend"), time);
  if (dow && dow !== "*") {
    const name = days[dow];
    if (name) return joinTime(t("schedule.cronEvery", { day: name }), time);
  }
  if (dom && dom !== "*") return joinTime(t("schedule.cronMonthDay", { day: dom }), time);
  return joinTime(t("schedule.cronDaily"), time);
}

function joinTime(label: string, time: string): string {
  return time ? `${label} ${time}` : label;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export default SchedulePage;
