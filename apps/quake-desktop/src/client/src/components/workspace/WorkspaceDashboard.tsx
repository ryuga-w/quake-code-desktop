import React, { useMemo, useState } from "react";
import { ChevronRight, Folder, FolderOpen, MoreHorizontal, Pin, Plus, Search, SquarePen, X } from "lucide-react";
import { localeForIntl, type Translate, useI18n } from "../../i18n";
import { formatSessionTitle } from "../../lib/render";
import styles from "./WorkspaceDashboard.module.css";

export type WorkspaceProject = {
  name: string;
  path: string;
};

export type WorkspaceSession = {
  path: string;
  cwd?: string;
  name?: string;
  firstMessage?: string;
  modified?: number | string;
};

interface WorkspaceDashboardProps {
  projects: WorkspaceProject[];
  sessions: WorkspaceSession[];
  activePath?: string;
  /** cwd (normalized later) → last opened session path */
  lastSessionByWorkspace?: Record<string, string>;
  onOpen: (path: string) => void;
  onAdd: () => void;
  onRemove: (path: string) => void;
  onOpenSession: (path: string) => void;
  onNewChat: (path: string) => void;
}

function normalizePath(value?: string, locale = "tr-TR"): string {
  return String(value || "").replace(/[\\/]+$/, "").replace(/\//g, "\\").toLocaleLowerCase(locale);
}

function modifiedTs(value?: number | string): number {
  if (!value) return 0;
  const result = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(result) ? result : 0;
}

function relativeTime(value: number | string | undefined, t: Translate): string {
  const timestamp = modifiedTs(value);
  if (!timestamp) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return t("runtime.workspaceDashboard.justNow");
  if (minutes < 60) return t("runtime.workspaceDashboard.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("runtime.workspaceDashboard.hours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("runtime.workspaceDashboard.days", { count: days });
  return t("runtime.workspaceDashboard.months", { count: Math.floor(days / 30) });
}

export function WorkspaceDashboard({ projects, sessions, activePath, lastSessionByWorkspace, onOpen, onAdd, onRemove, onOpenSession, onNewChat }: WorkspaceDashboardProps) {
  const { locale, t } = useI18n();
  const intlLocale = localeForIntl(locale);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string>();
  const [menuPath, setMenuPath] = useState<string>();

  const rows = useMemo(() => {
    const search = query.trim().toLocaleLowerCase(intlLocale);
    return projects
      .map((project) => {
        const key = normalizePath(project.path, intlLocale);
        const projectSessions = sessions
          .filter((session) => normalizePath(session.cwd, intlLocale) === key)
          .sort((left, right) => modifiedTs(right.modified) - modifiedTs(left.modified));
        const lastSessionPath = lastSessionByWorkspace?.[key] || lastSessionByWorkspace?.[project.path.replace(/[\\/]+$/, "").toLowerCase()];
        const lastSession = lastSessionPath
          ? projectSessions.find((session) => session.path === lastSessionPath) || sessions.find((session) => session.path === lastSessionPath)
          : undefined;
        return {
          ...project,
          key,
          sessions: projectSessions,
          modified: projectSessions[0]?.modified,
          lastSessionTitle: lastSession ? formatSessionTitle(lastSession) : undefined,
          lastSessionPath: lastSession?.path || lastSessionPath,
        };
      })
      .filter((project) => !search || project.name.toLocaleLowerCase(intlLocale).includes(search) || project.path.toLocaleLowerCase(intlLocale).includes(search))
      .sort((left, right) => modifiedTs(right.modified) - modifiedTs(left.modified) || left.name.localeCompare(right.name, intlLocale));
  }, [intlLocale, lastSessionByWorkspace, projects, query, sessions]);

  return (
    <div className={styles.page} onClick={() => setMenuPath(undefined)}>
      <div className={styles.inner}>
        <div className={styles.headingRow}>
          <h1>{t("runtime.workspaceDashboard.title")}</h1>
          <button type="button" className={styles.addButton} onClick={onAdd}><Plus size={14} /> {t("runtime.workspaceDashboard.add")}</button>
        </div>
        <label className={styles.search}>
          <Search size={14} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("runtime.workspaceDashboard.search")} aria-label={t("runtime.workspaceDashboard.search")} />
        </label>
        <div className={styles.columns} aria-hidden="true"><span>{t("runtime.workspaceDashboard.name")}</span><span>{t("runtime.workspaceDashboard.resources")}</span><span>{t("runtime.workspaceDashboard.updated")}</span><span /></div>
        <div className={styles.list}>
          {rows.map((project) => {
            const isExpanded = expanded === project.key;
            const isActive = normalizePath(activePath, intlLocale) === project.key;
            return (
              <section key={project.key} className={`${styles.project} ${isActive ? styles.active : ""}`}>
                <div className={styles.projectRow}>
                  <button type="button" className={styles.projectMain} onClick={() => setExpanded(isExpanded ? undefined : project.key)} aria-expanded={isExpanded}>
                    {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
                    <span className={styles.projectLabel}>
                      <strong>{project.name}</strong>
                      {project.lastSessionTitle && (
                        <em className={styles.lastHint} title={project.lastSessionPath}>
                          {t("runtime.workspaceDashboard.last", { title: project.lastSessionTitle })}
                        </em>
                      )}
                    </span>
                    <ChevronRight size={13} className={isExpanded ? styles.chevronOpen : styles.chevron} />
                  </button>
                  <button type="button" className={styles.pathChip} title={project.path} onClick={() => onOpen(project.path)}><Folder size={11} />{project.name}</button>
                  <span className={styles.time}>{relativeTime(project.modified, t)}</span>
                  <div className={styles.actions}>
                    <button type="button" title={t("runtime.workspaceDashboard.newTask")} aria-label={t("runtime.workspaceDashboard.newTaskAria", { name: project.name })} onClick={() => onNewChat(project.path)}><SquarePen size={14} /></button>
                    <button type="button" title={t("runtime.workspaceDashboard.openProject")} aria-label={t("runtime.workspaceDashboard.openProjectAria", { name: project.name })} onClick={() => onOpen(project.path)}><Pin size={14} /></button>
                    <button type="button" title={t("runtime.workspaceDashboard.more")} aria-label={t("runtime.workspaceDashboard.options", { name: project.name })} onClick={(event) => { event.stopPropagation(); setMenuPath(menuPath === project.key ? undefined : project.key); }}><MoreHorizontal size={15} /></button>
                    {menuPath === project.key && <div className={styles.menu} onClick={(event) => event.stopPropagation()}>
                      <button type="button" onClick={() => onOpen(project.path)}>{t("runtime.workspaceDashboard.openProject")}</button>
                      <button type="button" onClick={() => onNewChat(project.path)}>{t("runtime.workspaceDashboard.startTask")}</button>
                      <button type="button" className={styles.danger} onClick={() => { onRemove(project.path); setMenuPath(undefined); }}>{t("runtime.workspaceDashboard.remove")}</button>
                    </div>}
                  </div>
                </div>
                {isExpanded && <div className={styles.sessions}>
                  {project.sessions.length ? project.sessions.map((session) => (
                    <button key={session.path} type="button" className={styles.sessionRow} onClick={() => onOpenSession(session.path)}>
                      <span>{formatSessionTitle(session)}</span><time>{relativeTime(session.modified, t)}</time><ChevronRight size={13} />
                    </button>
                  )) : <div className={styles.emptySessions}>{t("runtime.workspaceDashboard.noTasks")}</div>}
                </div>}
              </section>
            );
          })}
          {!rows.length && <div className={styles.empty}>
            <Folder size={22} />
            <p>{query ? t("runtime.workspaceDashboard.noMatchingProject") : t("runtime.workspaceDashboard.noProjects")}</p>
            {!query && <button type="button" onClick={onAdd}><Plus size={14} /> {t("runtime.workspaceDashboard.addFirst")}</button>}
          </div>}
        </div>
      </div>
    </div>
  );
}

export default WorkspaceDashboard;
