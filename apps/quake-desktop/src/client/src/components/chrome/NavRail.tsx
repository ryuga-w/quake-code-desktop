import React, { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  Plus,
  Clock,
  SquarePen,
  Folder,
  Settings,
  ChevronRight,
  ChevronDown,
  Pin,
  PinOff,
  Archive,
  AtSign,
  GitBranch,
  X,
} from "lucide-react";
import { formatSessionTitle } from "../../lib/render";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import styles from "./NavRail.module.css";

const MAX_SESSIONS_PER_PROJECT = 8;

export type NavSession = {
  path: string;
  id?: string;
  name?: string;
  firstMessage?: string;
  modified?: number | string;
  messageCount?: number;
  cwd?: string;
  parentSessionPath?: string;
  branch?: string;
};

export type NavProject = {
  cwd: string;
  name: string;
  sessions: NavSession[];
};

export type NavPinned = {
  id: string;
  name: string;
  modified?: number | string;
  onOpen?: () => void;
};

export type NavView = "chat" | "search" | "history" | "projects" | "scheduled" | "extensions" | "settings";

/**
 * Sol gezinme — Antigravity / Codex tarzı:
 * [Yeni sohbet] → ana yüzeyler → projeler ve projeye ait son konuşmalar → ayarlar.
 * Tüm sohbet arşivi ayrı Geçmiş ekranında tutulur; rail aynı listeyi tekrarlamaz.
 */
export function NavRail({
  leftOpen,
  onToggle,
  workspaceName,
  workspacePath,
  onOpenWorkspace,
  onOpenProjects,
  onNewChat,
  onSearch,
  onScheduled,
  onExtensions,
  onSettings,
  onOpenSessions: _onOpenSessions,
  sessions,
  projects,
  activeCwd,
  activeSessionId,
  activeSessionFile,
  activeSessionStreaming,
  streamingSessionPaths,
  onSwitchSession,
  activeView,
  pinned,
  accountLabel,
  pinnedPaths,
  onPinSession,
  onArchiveSession,
  onRenameSession,
  unreadSessionPaths,
  onRemoveProject,
}: {
  leftOpen: boolean;
  onToggle: () => void;
  workspaceName: string;
  workspacePath: string;
  onOpenWorkspace: () => void;
  onOpenProjects: () => void;
  onNewChat: () => void;
  onSearch: () => void;
  onScheduled: () => void;
  onExtensions: () => void;
  onSettings: () => void;
  onOpenSessions?: () => void;
  sessions: NavSession[];
  projects?: NavProject[];
  activeCwd?: string;
  activeSessionId?: string;
  /** Active chat session file path (for streaming match). */
  activeSessionFile?: string;
  /** True while the active chat's agent is generating. */
  activeSessionStreaming?: boolean;
  /** Session file paths currently running (active + background). */
  streamingSessionPaths?: string[];
  onSwitchSession: (path: string) => void;
  activeView?: NavView;
  pinned?: NavPinned[];
  accountLabel?: string;
  pinnedPaths?: Set<string>;
  onPinSession?: (path: string) => void;
  onArchiveSession?: (path: string) => void;
  onRenameSession?: (session: NavSession, nextName: string) => void;
  unreadSessionPaths?: Set<string>;
  /** Remove workspace/folder from the Projects list (not delete files on disk). */
  onRemoveProject?: (cwd: string) => void;
}) {
  void _onOpenSessions;
  const navMenu = useContextMenu();
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [renamingSession, setRenamingSession] = useState<NavSession>();
  const openNavMenu = (event: React.MouseEvent, items: MenuItem[]) => {
    event.preventDefault();
    navMenu.open(event, items);
  };
  const streamingPaths = useMemo(() => {
    const set = new Set<string>();
    for (const p of streamingSessionPaths || []) {
      const n = normalizeSessionPath(p);
      if (n) set.add(n);
    }
    return set;
  }, [streamingSessionPaths]);
  const threadActions: ThreadActions = {
    pinnedPaths,
    unreadSessionPaths,
    openMenu: (event, session) => openNavMenu(event, [
      { id: "open", label: "Sohbeti aç", onSelect: () => onSwitchSession(session.path) },
      { id: "rename", label: "Yeniden adlandır", onSelect: () => setRenamingSession(session) },
      { id: "pin", label: pinnedPaths?.has(session.path) ? "Sabitlemeyi kaldır" : "Sohbeti sabitle", onSelect: () => onPinSession?.(session.path) },
      { type: "separator" },
      { id: "archive", label: "Arşivle", onSelect: () => onArchiveSession?.(session.path) },
    ]),
    onPinSession,
    onArchiveSession,
    streamingPaths,
    activeSessionId,
    activeSessionFile,
    activeSessionStreaming: Boolean(activeSessionStreaming),
  };
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => modifiedTs(b.modified) - modifiedTs(a.modified)),
    [sessions],
  );
  const displayedSessions = showAllSessions ? sortedSessions : sortedSessions.slice(0, 10);
  const hasMoreSessions = sortedSessions.length > 10;

  return (
    <aside className={`${styles.navrail} ${leftOpen ? "" : styles.collapsed}`} aria-hidden={!leftOpen} aria-label="Gezinme">
      <div className={styles.topBar}>
        <div className={styles.brandMark} aria-label="Quake Code">
          <b>Quake Code</b>
        </div>
        <button type="button" className={styles.iconBtn} onClick={onSearch} aria-label="Sohbetlerde ara" title="Sohbetlerde ara">
          <Search size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.primaryBlock}>
        <button type="button" className={styles.newChat} onClick={onNewChat} onContextMenu={(event) => openNavMenu(event, [{ id: "new", label: "Yeni sohbet başlat", onSelect: onNewChat }, { id: "history", label: "Sohbet geçmişini aç", onSelect: onSearch }])} title="Yeni görev">
          <SquarePen size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>Yeni görev</span>
        </button>

        <nav className={styles.actions} aria-label="Hızlı eylemler">
          <div className={styles.navItemRow}>
            <button type="button" className={`${styles.navItem} ${activeView === "projects" ? styles.navItemActive : ""}`} onClick={onOpenProjects} onContextMenu={(event) => openNavMenu(event, [{ id: "open", label: "Projeleri aç", onSelect: onOpenProjects }, { id: "add", label: "Proje ekle", onSelect: onOpenWorkspace }])} title="Projeler">
              <Folder size={15} strokeWidth={1.8} aria-hidden="true" />
              <span>Projeler</span>
            </button>
            <button
              type="button"
              className={styles.navItemTrailing}
              onClick={onOpenWorkspace}
              aria-label="Workspace seç"
              title="Workspace seç"
            >
              <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <button type="button" className={`${styles.navItem} ${activeView === "scheduled" ? styles.navItemActive : ""}`} onClick={onScheduled} onContextMenu={(event) => openNavMenu(event, [{ id: "open", label: "Zamanlananları aç", onSelect: onScheduled }, { id: "new", label: "Yeni sohbet", onSelect: onNewChat }])} title="Zamanlananlar">
            <Clock size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>Zamanlananlar</span>
          </button>
          <button type="button" className={`${styles.navItem} ${activeView === "extensions" ? styles.navItemActive : ""}`} onClick={onExtensions} onContextMenu={(event) => openNavMenu(event, [{ id: "open", label: "Eklentileri aç", onSelect: onExtensions }, { id: "settings", label: "Ayarları aç", onSelect: onSettings }])} title="Eklentiler">
            <AtSign size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>Eklentiler</span>
          </button>
        </nav>
      </div>

      <div className={styles.scroll}>
        <div className={styles.section}>
          <div className={styles.sectionHead}>Görevler</div>
          <div className={`${styles.threads} ${styles.threadsOpen}`}>
            {sessions.length === 0 && <div className={styles.empty}>Henüz görev yok</div>}
            {displayedSessions.map((session) => (
              <ThreadItem
                key={session.path}
                session={session}
                flat
                activeSessionId={activeSessionId}
                actions={threadActions}
                onSwitchSession={onSwitchSession}
                renaming={renamingSession?.path === session.path}
                onRenameCancel={() => setRenamingSession(undefined)}
                onRenameCommit={(nextName) => {
                  onRenameSession?.(session, nextName);
                  setRenamingSession(undefined);
                }}
              />
            ))}
            {hasMoreSessions && (
              <button
                type="button"
                className={styles.showMore}
                onClick={() => setShowAllSessions((current) => !current)}
                aria-expanded={showAllSessions}
              >
                <ChevronDown className={showAllSessions ? styles.showMoreOpen : ""} size={13} strokeWidth={1.8} aria-hidden="true" />
                <span>{showAllSessions ? "Daha az" : "Daha fazla"}</span>
                {!showAllSessions && <span className={styles.showMoreCount}>{sortedSessions.length - 10}</span>}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={styles.bottom}>
        <button type="button" className={styles.settingsRow} onClick={onSettings} title="Ayarlar">
          <Settings size={16} strokeWidth={1.9} aria-hidden="true" />
          <span className={styles.settingsText}>
            <span className={styles.settingsLabel}>Ayarlar</span>
          </span>
        </button>
      </div>
      {navMenu.menu}
    </aside>
  );
}

type ThreadActions = {
  pinnedPaths?: Set<string>;
  onPinSession?: (path: string) => void;
  onArchiveSession?: (path: string) => void;
  streamingPaths?: Set<string>;
  activeSessionId?: string;
  activeSessionFile?: string;
  activeSessionStreaming?: boolean;
  unreadSessionPaths?: Set<string>;
  openMenu?: (event: React.MouseEvent, session: NavSession) => void;
};

function isSessionAgentWorking(session: NavSession, actions: ThreadActions): boolean {
  const pathKey = normalizeSessionPath(session.path);
  if (pathKey && actions.streamingPaths?.has(pathKey)) return true;
  const isActive =
    (!!session.id && session.id === actions.activeSessionId) ||
    (!!pathKey && pathKey === normalizeSessionPath(actions.activeSessionFile));
  return Boolean(isActive && actions.activeSessionStreaming);
}

function normalizeSessionPath(path?: string): string {
  return String(path || "")
    .trim()
    .replace(/\//g, "\\")
    .toLowerCase();
}

function ThreadItem({
  session,
  depth = 0,
  activeSessionId,
  actions,
  onSwitchSession,
  flat = false,
  renaming = false,
  onRenameCancel,
  onRenameCommit,
}: {
  session: NavSession;
  depth?: number;
  activeSessionId?: string;
  actions: ThreadActions;
  onSwitchSession: (path: string) => void;
  flat?: boolean;
  renaming?: boolean;
  onRenameCancel?: () => void;
  onRenameCommit?: (nextName: string) => void;
}) {
  const isActive = !!session.id && session.id === activeSessionId;
  const isWorking = isSessionAgentWorking(session, actions);
  const isPinned = actions.pinnedPaths?.has(session.path) ?? false;
  const isUnread = actions.unreadSessionPaths?.has(normalizeSessionPath(session.path)) ?? false;
  const [hoverCard, setHoverCard] = useState<{ top: number; left: number }>();
  const [renameValue, setRenameValue] = useState(() => formatSessionTitle(session));
  const hoverDelayRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (renaming) setRenameValue(formatSessionTitle(session));
  }, [renaming, session]);
  const showHoverCard = (event: React.MouseEvent<HTMLDivElement>) => {
    window.clearTimeout(hoverDelayRef.current);
    const rect = event.currentTarget.getBoundingClientRect();
    hoverDelayRef.current = window.setTimeout(() => {
      setHoverCard({ top: Math.max(8, Math.min(rect.top, window.innerHeight - 116)), left: rect.right + 6 });
    }, 180);
  };
  const hideHoverCard = () => {
    window.clearTimeout(hoverDelayRef.current);
    setHoverCard(undefined);
  };
  return (
    <div
      className={`${styles.thread} ${isActive ? styles.threadActive : ""} ${flat ? styles.threadFlat : ""}`}
      style={!flat && depth ? { paddingLeft: 10 + depth * 12 } : undefined}
      onMouseEnter={renaming ? undefined : showHoverCard}
      onMouseLeave={hideHoverCard}
    >
      {renaming ? (
        <form
          className={styles.renameForm}
          onSubmit={(event) => {
            event.preventDefault();
            const value = renameValue.trim();
            if (value) onRenameCommit?.(value);
          }}
        >
          <input
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={() => {
              const value = renameValue.trim();
              if (value) onRenameCommit?.(value);
              else onRenameCancel?.();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onRenameCancel?.();
              }
            }}
            aria-label="Sohbet adı"
          />
        </form>
      ) : (
        <button type="button" className={styles.threadMain} onClick={() => onSwitchSession(session.path)} onContextMenu={(event) => { event.preventDefault(); actions.openMenu?.(event, session); }} title={formatSessionTitle(session)}>
          <span className={styles.threadName}>{formatSessionTitle(session)}</span>
        </button>
      )}
      {!renaming && <span className={styles.threadMeta}>
        {isWorking && (
          <span className={styles.generatingDots} title="Ajan yanıt üretiyor" aria-label="Ajan yanıt üretiyor">
            <span />
            <span />
            <span />
          </span>
        )}
        {!isWorking && isUnread && <span className={styles.unreadDot} title="Okunmamış yanıt" aria-label="Okunmamış yanıt" />}
        <span className={styles.threadActions}>
          <button
            type="button"
            className={styles.threadAction}
            aria-label={isPinned ? "Sabitlemeyi kaldır" : "Sohbeti sabitle"}
            title={isPinned ? "Sabitlemeyi kaldır" : "Sohbeti sabitle"}
            onClick={(e) => {
              e.stopPropagation();
              actions.onPinSession?.(session.path);
            }}
          >
            {isPinned ? <PinOff size={13} strokeWidth={2} aria-hidden="true" /> : <Pin size={13} strokeWidth={2} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className={styles.threadAction}
            aria-label="Arşivle"
            title="Arşivle"
            onClick={(e) => {
              e.stopPropagation();
              actions.onArchiveSession?.(session.path);
            }}
          >
            <Archive size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        </span>
      </span>}
      {!renaming && hoverCard && createPortal(
        <div
          className={styles.threadHoverCard}
          style={{ top: hoverCard.top, left: hoverCard.left }}
          role="tooltip"
        >
          <div className={styles.hoverCardHead}>
            <strong>{formatSessionTitle(session)}</strong>
            <span>{relativeTime(session.modified)}</span>
          </div>
          <div className={styles.hoverCardMeta}>
            <span><Folder size={14} strokeWidth={1.7} aria-hidden="true" />{session.cwd ? workspaceLabel(session.cwd) : "Çalışma alanı yok"}</span>
            <span><GitBranch size={14} strokeWidth={1.7} aria-hidden="true" />{session.branch || "master"}</span>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

type SessionNode = NavSession & { children: SessionNode[] };

function buildSessionTree(sessions: NavSession[]): SessionNode[] {
  const byPath = new Map<string, SessionNode>();
  for (const s of sessions) byPath.set(s.path, { ...s, children: [] });
  const roots: SessionNode[] = [];
  for (const node of byPath.values()) {
    const parent = node.parentSessionPath ? byPath.get(node.parentSessionPath) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function workspaceLabel(cwd: string): string {
  const normalized = cwd.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || cwd;
}

function modifiedTs(modified?: number | string): number {
  if (!modified) return 0;
  const ts = typeof modified === "number" ? modified : Date.parse(modified);
  return Number.isFinite(ts) ? ts : 0;
}

/** Kısa relative zaman: şimdi · 3g · 4g · 2h (Antigravity tarzı kompakt) */
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

function SessionTreeItem({ node, depth, activeSessionId, actions, onSwitchSession }: { node: SessionNode; depth: number; activeSessionId?: string; actions: ThreadActions; onSwitchSession: (path: string) => void }) {
  return (
    <>
      <ThreadItem session={node} depth={depth} activeSessionId={activeSessionId} actions={actions} onSwitchSession={onSwitchSession} />
      {node.children.map((child) => (
        <SessionTreeItem key={child.path} node={child} depth={depth + 1} activeSessionId={activeSessionId} actions={actions} onSwitchSession={onSwitchSession} />
      ))}
    </>
  );
}

function ProjectGroup({
  project,
  expandedDefault,
  activeSessionId,
  actions,
  onSwitchSession,
  onRemoveProject,
  isActive,
}: {
  project: NavProject;
  expandedDefault: boolean;
  activeSessionId?: string;
  actions: ThreadActions;
  onSwitchSession: (path: string) => void;
  onRemoveProject?: (cwd: string) => void;
  isActive: boolean;
}) {
  const [open, setOpen] = useState(expandedDefault);
  const groupRef = useRef<HTMLDivElement>(null);
  const sorted = [...(project.sessions || [])].sort((a, b) => modifiedTs(b.modified) - modifiedTs(a.modified));
  const tree = buildSessionTree(sorted.slice(0, MAX_SESSIONS_PER_PROJECT));

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && groupRef.current) {
      requestAnimationFrame(() => {
        groupRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  };

  return (
    <div ref={groupRef} className={styles.projectGroup}>
      <div className={styles.projectRow}>
        <button
          type="button"
          className={`${styles.project} ${isActive ? styles.projectActive : ""}`}
          title={project.cwd}
          aria-expanded={open}
          onClick={toggle}
        >
          <span className={styles.projectChevron} aria-hidden="true">
            {open ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronRight size={13} strokeWidth={2} />}
          </span>
          <Folder size={15} strokeWidth={1.9} aria-hidden="true" />
          <span className={styles.projectName}>{project.name}</span>
        </button>
        {onRemoveProject && (
          <button
            type="button"
            className={styles.projectRemove}
            aria-label={`${project.name} listeden kaldır`}
            title="Listeden kaldır"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveProject(project.cwd);
            }}
          >
            <X size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className={`${styles.threads} ${open ? styles.threadsOpen : ""}`}>
        {open &&
          (tree.length === 0 ? (
            <div className={styles.empty}>Henüz sohbet yok</div>
          ) : (
            tree.map((node) => (
              <SessionTreeItem key={node.path} node={node} depth={0} activeSessionId={activeSessionId} actions={actions} onSwitchSession={onSwitchSession} />
            ))
          ))}
      </div>
    </div>
  );
}

function ProjectTree({
  projects,
  activeCwd,
  activeSessionId,
  actions,
  onSwitchSession,
  onRemoveProject,
}: {
  projects: NavProject[];
  activeCwd?: string;
  activeSessionId?: string;
  actions: ThreadActions;
  onSwitchSession: (path: string) => void;
  onRemoveProject?: (cwd: string) => void;
}) {
  const activeKey = (activeCwd || "").toLowerCase();
  return (
    <div className={styles.projectTree}>
      {projects.map((project) => {
        const isActive = project.cwd.toLowerCase() === activeKey;
        return (
          <ProjectGroup
            key={project.cwd || project.name}
            project={project}
            expandedDefault={isActive}
            isActive={isActive}
            activeSessionId={activeSessionId}
            actions={actions}
            onSwitchSession={onSwitchSession}
            onRemoveProject={onRemoveProject}
          />
        );
      })}
    </div>
  );
}
