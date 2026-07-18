import React, { useMemo, useState } from "react";
import { ChevronRight, Folder, FolderOpen, MoreHorizontal, Pin, Plus, Search, SquarePen, X } from "lucide-react";
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

function normalizePath(value?: string): string {
  return String(value || "").replace(/[\\/]+$/, "").replace(/\//g, "\\").toLocaleLowerCase("tr");
}

function modifiedTs(value?: number | string): number {
  if (!value) return 0;
  const result = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(result) ? result : 0;
}

function relativeTime(value?: number | string): string {
  const timestamp = modifiedTs(value);
  if (!timestamp) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "şimdi";
  if (minutes < 60) return `${minutes} dk.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa.`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} gün`;
  return `${Math.floor(days / 30)} ay`;
}

export function WorkspaceDashboard({ projects, sessions, activePath, lastSessionByWorkspace, onOpen, onAdd, onRemove, onOpenSession, onNewChat }: WorkspaceDashboardProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string>();
  const [menuPath, setMenuPath] = useState<string>();

  const rows = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("tr");
    return projects
      .map((project) => {
        const key = normalizePath(project.path);
        const projectSessions = sessions
          .filter((session) => normalizePath(session.cwd) === key)
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
      .filter((project) => !search || project.name.toLocaleLowerCase("tr").includes(search) || project.path.toLocaleLowerCase("tr").includes(search))
      .sort((left, right) => modifiedTs(right.modified) - modifiedTs(left.modified) || left.name.localeCompare(right.name, "tr"));
  }, [lastSessionByWorkspace, projects, query, sessions]);

  return (
    <div className={styles.page} onClick={() => setMenuPath(undefined)}>
      <div className={styles.inner}>
        <div className={styles.headingRow}>
          <h1>Projeler</h1>
          <button type="button" className={styles.addButton} onClick={onAdd}><Plus size={14} /> Proje ekle</button>
        </div>
        <label className={styles.search}>
          <Search size={14} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Projelerde ara" aria-label="Projelerde ara" />
        </label>
        <div className={styles.columns} aria-hidden="true"><span>Ad</span><span>Kaynaklar</span><span>Güncellendi</span><span /></div>
        <div className={styles.list}>
          {rows.map((project) => {
            const isExpanded = expanded === project.key;
            const isActive = normalizePath(activePath) === project.key;
            return (
              <section key={project.key} className={`${styles.project} ${isActive ? styles.active : ""}`}>
                <div className={styles.projectRow}>
                  <button type="button" className={styles.projectMain} onClick={() => setExpanded(isExpanded ? undefined : project.key)} aria-expanded={isExpanded}>
                    {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
                    <span className={styles.projectLabel}>
                      <strong>{project.name}</strong>
                      {project.lastSessionTitle && (
                        <em className={styles.lastHint} title={project.lastSessionPath}>
                          Son: {project.lastSessionTitle}
                        </em>
                      )}
                    </span>
                    <ChevronRight size={13} className={isExpanded ? styles.chevronOpen : styles.chevron} />
                  </button>
                  <button type="button" className={styles.pathChip} title={project.path} onClick={() => onOpen(project.path)}><Folder size={11} />{project.name}</button>
                  <span className={styles.time}>{relativeTime(project.modified)}</span>
                  <div className={styles.actions}>
                    <button type="button" title="Yeni görev" aria-label={`${project.name} içinde yeni görev`} onClick={() => onNewChat(project.path)}><SquarePen size={14} /></button>
                    <button type="button" title="Projeyi aç" aria-label={`${project.name} projesini aç`} onClick={() => onOpen(project.path)}><Pin size={14} /></button>
                    <button type="button" title="Diğer" aria-label={`${project.name} seçenekleri`} onClick={(event) => { event.stopPropagation(); setMenuPath(menuPath === project.key ? undefined : project.key); }}><MoreHorizontal size={15} /></button>
                    {menuPath === project.key && <div className={styles.menu} onClick={(event) => event.stopPropagation()}>
                      <button type="button" onClick={() => onOpen(project.path)}>Projeyi aç</button>
                      <button type="button" onClick={() => onNewChat(project.path)}>Yeni görev başlat</button>
                      <button type="button" className={styles.danger} onClick={() => { onRemove(project.path); setMenuPath(undefined); }}>Listeden kaldır</button>
                    </div>}
                  </div>
                </div>
                {isExpanded && <div className={styles.sessions}>
                  {project.sessions.length ? project.sessions.map((session) => (
                    <button key={session.path} type="button" className={styles.sessionRow} onClick={() => onOpenSession(session.path)}>
                      <span>{formatSessionTitle(session)}</span><time>{relativeTime(session.modified)}</time><ChevronRight size={13} />
                    </button>
                  )) : <div className={styles.emptySessions}>Bu projede henüz görev yok.</div>}
                </div>}
              </section>
            );
          })}
          {!rows.length && <div className={styles.empty}>
            <Folder size={22} />
            <p>{query ? "Aramayla eşleşen proje yok." : "Henüz proje eklenmedi."}</p>
            {!query && <button type="button" onClick={onAdd}><Plus size={14} /> İlk projeyi ekle</button>}
          </div>}
        </div>
      </div>
    </div>
  );
}

export default WorkspaceDashboard;
