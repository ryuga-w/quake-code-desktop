import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Filter, MessageSquare } from "lucide-react";
import { formatSessionTitle } from "../../lib/render";
import styles from "./ConversationHistoryPage.module.css";

export type HistorySession = {
  path: string;
  id?: string;
  name?: string;
  firstMessage?: string;
  modified?: number | string;
  messageCount?: number;
  cwd?: string;
  parentSessionPath?: string;
};

type ProjectFilter = "all" | "outside" | string;

const PAGE_SIZE = 20;

function modifiedTs(modified?: number | string): number {
  if (!modified) return 0;
  const ts = typeof modified === "number" ? modified : Date.parse(String(modified));
  return Number.isFinite(ts) ? ts : 0;
}

function relativeTime(modified?: number | string): string {
  if (!modified) return "";
  const ts = modifiedTs(modified);
  if (!ts) return "";
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "şimdi";
  if (min < 60) return `${min}dk`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}sa`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}g`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week}h`;
  return `${Math.floor(day / 30)}ay`;
}

function projectLabel(cwd: string | undefined, workspaceName: string): string {
  if (!cwd || !String(cwd).trim()) return "Proje dışı";
  const name = String(cwd).split(/[\\/]/).filter(Boolean).pop() || workspaceName;
  return name || "Proje dışı";
}

/**
 * Antigravity-style Conversation History: full main panel with search + list.
 * Not a modal — centerView page.
 */
export function ConversationHistoryPage({
  sessions,
  activeSessionId,
  workspaceName,
  onOpenSession,
}: {
  sessions: HistorySession[];
  activeSessionId?: string;
  workspaceName: string;
  onOpenSession: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [page, setPage] = useState(1);

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      const cwd = String(s.cwd || "").trim();
      if (!cwd) continue;
      const label = projectLabel(cwd, workspaceName);
      map.set(cwd, label);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "tr"));
  }, [sessions, workspaceName]);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return [...sessions]
      .sort((a, b) => modifiedTs(b.modified) - modifiedTs(a.modified))
      .filter((s) => {
        const cwd = String(s.cwd || "").trim();
        if (projectFilter === "outside" && cwd) return false;
        if (projectFilter !== "all" && projectFilter !== "outside" && cwd !== projectFilter) return false;
        if (!q) return true;
        const title = formatSessionTitle(s).toLocaleLowerCase("tr");
        const proj = projectLabel(s.cwd, workspaceName).toLocaleLowerCase("tr");
        const first = String(s.firstMessage || "").toLocaleLowerCase("tr");
        return title.includes(q) || proj.includes(q) || first.includes(q);
      });
  }, [sessions, query, projectFilter, workspaceName]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paginatedRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const selectProjectFilter = (nextFilter: ProjectFilter) => {
    setProjectFilter(nextFilter);
    setPage(1);
    setFilterOpen(false);
  };

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>Sohbet geçmişi</h1>

        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Search size={15} strokeWidth={2} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="Sohbetlerde ara…"
              aria-label="Sohbetlerde ara"
            />
          </label>
          <div className={styles.filterWrap}>
            <button
              type="button"
              className={`${styles.filterBtn} ${projectFilter !== "all" ? styles.filterActive : ""}`}
              onClick={() => setFilterOpen((v) => !v)}
              aria-expanded={filterOpen}
            >
              <Filter size={14} strokeWidth={2} aria-hidden="true" />
              <span>Filtre</span>
            </button>
            {filterOpen && (
              <div className={styles.filterMenu} role="menu">
                <button type="button" role="menuitem" className={projectFilter === "all" ? styles.menuActive : ""} onClick={() => selectProjectFilter("all")}>
                  Tümü
                </button>
                <button type="button" role="menuitem" className={projectFilter === "outside" ? styles.menuActive : ""} onClick={() => selectProjectFilter("outside")}>
                  Proje dışı
                </button>
                {projects.map(([cwd, label]) => (
                  <button
                    key={cwd}
                    type="button"
                    role="menuitem"
                    className={projectFilter === cwd ? styles.menuActive : ""}
                    onClick={() => selectProjectFilter(cwd)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.list} role="list">
          {rows.length === 0 ? (
            <div className={styles.empty}>
              <MessageSquare size={22} strokeWidth={1.6} aria-hidden="true" />
              <p>{query.trim() || projectFilter !== "all" ? "Eşleşen sohbet yok" : "Henüz sohbet yok"}</p>
            </div>
          ) : (
            paginatedRows.map((s) => {
              const active = !!s.id && s.id === activeSessionId;
              const title = formatSessionTitle(s);
              const proj = projectLabel(s.cwd, workspaceName);
              return (
                <button
                  key={s.path}
                  type="button"
                  role="listitem"
                  className={`${styles.row} ${active ? styles.rowActive : ""}`}
                  onClick={() => onOpenSession(s.path)}
                >
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>{title}</span>
                    <span className={styles.rowSub}>{proj}</span>
                  </span>
                  <span className={styles.rowMeta}>
                    <span className={styles.rowTime}>{relativeTime(s.modified)}</span>
                    {active && <span className={styles.dot} aria-label="Aktif" />}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {rows.length > PAGE_SIZE && (
          <nav className={styles.pagination} aria-label="Sohbet geçmişi sayfaları">
            <button
              type="button"
              className={styles.pageButton}
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage === 1}
              aria-label="Önceki sayfa"
            >
              <ChevronLeft size={15} aria-hidden="true" />
              <span>Önceki</span>
            </button>
            <span className={styles.pageStatus} aria-live="polite">
              {currentPage} / {pageCount}
              <small>{rows.length} sohbet</small>
            </span>
            <button
              type="button"
              className={styles.pageButton}
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage === pageCount}
              aria-label="Sonraki sayfa"
            >
              <span>Sonraki</span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}

export default ConversationHistoryPage;
