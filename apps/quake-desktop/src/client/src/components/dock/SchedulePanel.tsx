import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Play, Trash2, Plus, RefreshCw, X, Power } from "lucide-react";
import { apiGet, apiPost, authToken } from "../../lib/api";
import { SkeletonLines } from "../common/Feedback";
import styles from "./SchedulePanel.module.css";

/**
 * Zamanlananlar (Codex "Scheduled") — dock paneli / overlay.
 * Listeler: ad, cron ifadesi, sonraki çalışma, etkin/pasif anahtarı, şimdi-çalıştır, sil.
 * "+ Yeni" formu ile yeni görev oluşturur. Tüm renkler design token'larından.
 *
 * API: GET /api/scheduled, POST /api/scheduled, PATCH /api/scheduled/:id,
 *      DELETE /api/scheduled/:id, POST /api/scheduled/:id/run.
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

/**
 * api.ts yalnızca apiGet/apiPost dışa açıyor. PATCH/DELETE için
 * aynı auth header (X-Quake-Web-Token) ile küçük bir yardımcı.
 * Entegratör api.ts'e apiPatch/apiDelete eklerse buradakiler oradan import edilebilir.
 */
async function apiSend<T>(url: string, method: "PATCH" | "DELETE", payload?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(authToken ? { "X-Quake-Web-Token": authToken } : {}),
    },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (typeof (body as any)?.error === "string" && (body as any).error.trim()) ||
      (res.status === 404 ? `Kaynak bulunamadı (${res.status})` : `İstek başarısız oldu (${res.status})`);
    throw new Error(msg);
  }
  return body as T;
}

export function SchedulePanel({ onClose }: { onClose?: () => void }) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", cron: "", prompt: "" });

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
    setNotice(null);
    try {
      await fn();
    } catch (err: any) {
      setNotice({ kind: "error", text: err?.message || "İşlem başarısız oldu" });
    } finally {
      setBusy(null);
    }
  }

  function toggleEnabled(task: ScheduledTask) {
    void runAction(`toggle:${task.id}`, async () => {
      await apiSend(`/api/scheduled/${encodeURIComponent(task.id)}`, "PATCH", { enabled: !task.enabled });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, enabled: !task.enabled } : t)));
    });
  }

  function runNow(task: ScheduledTask) {
    void runAction(`run:${task.id}`, async () => {
      await apiPost(`/api/scheduled/${encodeURIComponent(task.id)}/run`, {});
      setNotice({ kind: "ok", text: `“${task.name}” çalıştırıldı` });
      await refresh();
    });
  }

  function remove(task: ScheduledTask) {
    void runAction(`delete:${task.id}`, async () => {
      await apiSend(`/api/scheduled/${encodeURIComponent(task.id)}`, "DELETE");
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      setNotice({ kind: "ok", text: `“${task.name}” silindi` });
    });
  }

  function submitNew(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    const cron = form.cron.trim();
    const prompt = form.prompt.trim();
    if (!name || !cron || !prompt) {
      setNotice({ kind: "error", text: "Ad, cron ve istem zorunludur" });
      return;
    }
    void runAction("create", async () => {
      const res = await apiPost<{ task?: ScheduledTask }>("/api/scheduled", { name, cron, prompt });
      if (res?.task) {
        setTasks((prev) => [res.task as ScheduledTask, ...prev]);
      } else {
        await refresh();
      }
      setForm({ name: "", cron: "", prompt: "" });
      setCreating(false);
      setNotice({ kind: "ok", text: `“${name}” oluşturuldu` });
    });
  }

  const sorted = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        const ea = a.enabled === false ? 1 : 0;
        const eb = b.enabled === false ? 1 : 0;
        if (ea !== eb) return ea - eb;
        return (a.name || "").localeCompare(b.name || "", "tr");
      }),
    [tasks],
  );

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <div className={styles.title}>
          <Clock size={15} aria-hidden="true" />
          <span>Zamanlananlar</span>
        </div>
        <div className={styles.headActions}>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.primaryBtn}`}
            onClick={() => {
              setNotice(null);
              setCreating((v) => !v);
            }}
            disabled={!!busy}
          >
            <Plus size={14} aria-hidden="true" />
            {creating ? "Vazgeç" : "Yeni"}
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Yenile"
            title="Yenile"
          >
            <RefreshCw size={14} className={loading ? styles.spin : undefined} aria-hidden="true" />
          </button>
          {onClose && (
            <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Kapat" title="Kapat">
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className={`${styles.notice} ${notice.kind === "error" ? styles.noticeError : styles.noticeOk}`}>
          {notice.text}
        </div>
      )}

      {creating && (
        <form className={styles.form} onSubmit={submitNew}>
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Ad</span>
              <input
                className={styles.input}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Günlük özet"
                autoFocus
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Cron</span>
              <input
                className={`${styles.input} ${styles.mono}`}
                value={form.cron}
                onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
                placeholder="0 9 * * 1-5"
              />
            </label>
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>İstem (prompt)</span>
            <textarea
              className={styles.textarea}
              value={form.prompt}
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              placeholder="Bu görev çalıştığında ne yapılsın…"
              rows={3}
            />
          </label>
          <div className={styles.formActions}>
            <span className={styles.cronHint}>Biçim: dakika saat gün ay haftagünü</span>
            <button type="submit" className={`${styles.actionBtn} ${styles.primaryBtn}`} disabled={busy === "create"}>
              <Plus size={14} aria-hidden="true" />
              {busy === "create" ? "Oluşturuluyor…" : "Oluştur"}
            </button>
          </div>
        </form>
      )}

      <div className={styles.body}>
        {loading && tasks.length === 0 ? (
          <SkeletonLines count={5} />
        ) : error ? (
          <div className={styles.empty}>{error}</div>
        ) : sorted.length === 0 ? (
          <div className={styles.empty}>
            Henüz zamanlanan görev yok.
            <br />
            Bir tane oluşturmak için “Yeni”ye dokunun.
          </div>
        ) : (
          <ul className={styles.list}>
            {sorted.map((task) => {
              const disabled = task.enabled === false;
              return (
                <li key={task.id} className={`${styles.row} ${disabled ? styles.rowOff : ""}`}>
                  <div className={styles.rowMain}>
                    <div className={styles.rowTop}>
                      <span className={styles.name} title={task.name}>
                        {task.name || "Adsız görev"}
                      </span>
                      <span className={styles.cron} title="Cron ifadesi">
                        {task.cron || "—"}
                      </span>
                    </div>
                    <div className={styles.rowMeta}>
                      <span className={styles.metaItem} title="Sonraki çalışma">
                        <Clock size={12} aria-hidden="true" />
                        {formatWhen(task.nextRun, true)}
                      </span>
                      {task.lastRun != null && task.lastRun !== "" && (
                        <span className={styles.metaItemMuted} title="Son çalışma">
                          Son: {formatWhen(task.lastRun, false)}
                        </span>
                      )}
                      <span className={`${styles.badge} ${disabled ? styles.badgeOff : styles.badgeOn}`}>
                        {disabled ? "Pasif" : "Etkin"}
                      </span>
                    </div>
                  </div>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${disabled ? "" : styles.iconBtnActive}`}
                      onClick={() => toggleEnabled(task)}
                      disabled={!!busy}
                      aria-pressed={!disabled}
                      aria-label={disabled ? "Etkinleştir" : "Pasifleştir"}
                      title={disabled ? "Etkinleştir" : "Pasifleştir"}
                    >
                      <Power size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => runNow(task)}
                      disabled={!!busy}
                      aria-label="Şimdi çalıştır"
                      title="Şimdi çalıştır"
                    >
                      <Play size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
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
      </div>
    </div>
  );
}

/** nextRun/lastRun değerini (ms epoch | ISO string | sn epoch) okunaklı TR metnine çevir. */
function formatWhen(value: number | string | null | undefined, future: boolean): string {
  if (value == null || value === "") return future ? "Planlanmadı" : "—";
  let ms: number;
  if (typeof value === "number") {
    ms = value < 1e12 ? value * 1000 : value; // saniye epoch'unu ms'e yükselt
  } else {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return String(value);
    ms = parsed;
  }
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return future ? "Planlanmadı" : "—";

  const now = Date.now();
  const diff = ms - now;
  const absSec = Math.round(Math.abs(diff) / 1000);
  const rel = relativeTr(absSec, diff >= 0);

  const sameDay = date.toDateString() === new Date(now).toDateString();
  const time = date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const stamp = sameDay
    ? time
    : date.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }) + " " + time;

  return `${stamp} · ${rel}`;
}

function relativeTr(absSec: number, isFuture: boolean): string {
  let unit: string;
  let n: number;
  if (absSec < 60) {
    return isFuture ? "az sonra" : "az önce";
  } else if (absSec < 3600) {
    n = Math.round(absSec / 60);
    unit = "dk";
  } else if (absSec < 86400) {
    n = Math.round(absSec / 3600);
    unit = "sa";
  } else {
    n = Math.round(absSec / 86400);
    unit = "gün";
  }
  return isFuture ? `${n} ${unit} sonra` : `${n} ${unit} önce`;
}

export default SchedulePanel;
