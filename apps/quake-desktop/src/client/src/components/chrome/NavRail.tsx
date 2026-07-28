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
import {
  nextLeftSidebarSize,
  type LeftSidebarSize,
} from "../../lib/layout-sizing";
import { type Translate, useI18n } from "../../i18n";
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

/** A pinned task keeps the same session identity and actions as its normal rail row. */
export type NavPinned = NavSession & {
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
  sidebarSize,
  onCycleSidebarSize,
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
  onPeekEnter,
  onPeekLeave,
}: {
  leftOpen: boolean;
  onToggle: () => void;
  sidebarSize: LeftSidebarSize;
  onCycleSidebarSize: () => void;
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
  /** Keeps the temporary overlay rail open while the pointer is inside it. */
  onPeekEnter?: () => void;
  /** Schedules the temporary overlay rail to close after the pointer leaves. */
  onPeekLeave?: () => void;
}) {
  void _onOpenSessions;
  void onToggle;
  const { t } = useI18n();
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
      { id: "open", label: t("navRail.openChat"), onSelect: () => onSwitchSession(session.path) },
      { id: "rename", label: t("navRail.renameChat"), onSelect: () => setRenamingSession(session) },
      { id: "pin", label: pinnedPaths?.has(session.path) ? t("navRail.unpinChat") : t("navRail.pinChat"), onSelect: () => onPinSession?.(session.path) },
      { type: "separator" },
      { id: "archive", label: t("navRail.archive"), onSelect: () => onArchiveSession?.(session.path) },
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
  const sortedPinned = useMemo(
    () => [...(pinned || [])].sort((a, b) => modifiedTs(b.modified) - modifiedTs(a.modified)),
    [pinned],
  );
  const displayedSessions = showAllSessions ? sortedSessions : sortedSessions.slice(0, 10);
  const hasMoreSessions = sortedSessions.length > 10;
  const sidebarSizeLabel = t(sidebarSize === "quarter" ? "navRail.sidebarQuarter" : "navRail.sidebarHalf");
  const nextSidebarSizeLabel = t(nextLeftSidebarSize(sidebarSize) === "quarter" ? "navRail.sidebarQuarter" : "navRail.sidebarHalf");
  const sidebarSizeGlyph = sidebarSize === "quarter" ? "¼" : "½";

  return (
    <aside
      className={`${styles.navrail} ${leftOpen ? "" : styles.collapsed}`}
      aria-hidden={!leftOpen}
      aria-label={t("navRail.navigation")}
      onPointerEnter={onPeekEnter}
      onPointerLeave={onPeekLeave}
    >
      <div className={styles.topBar}>
        <div className={styles.brandMark} aria-label="Quake Code">
          <b>Quake Code</b>
        </div>
        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.panelSizeButton}
            onClick={onCycleSidebarSize}
            aria-label={t("navRail.sidebarSize", { current: sidebarSizeLabel, next: nextSidebarSizeLabel })}
            title={t("navRail.sidebarSizeTitle", { current: sidebarSizeLabel, next: nextSidebarSizeLabel })}
          >
            <span aria-hidden="true">{sidebarSizeGlyph}</span>
          </button>
          <button type="button" className={styles.iconBtn} onClick={onSearch} aria-label={t("navRail.searchChats")} title={t("navRail.searchChats")}>
            <Search size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={styles.primaryBlock}>
        <button type="button" className={styles.newChat} onClick={onNewChat} onContextMenu={(event) => openNavMenu(event, [{ id: "new", label: t("navRail.startNewChat"), onSelect: onNewChat }, { id: "history", label: t("navRail.openChatHistory"), onSelect: onSearch }])} title={t("navRail.newTask")}>
          <SquarePen size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>{t("navRail.newTask")}</span>
        </button>

        <nav className={styles.actions} aria-label={t("navRail.quickActions")}>
          <div className={styles.navItemRow}>
            <button type="button" className={`${styles.navItem} ${activeView === "projects" ? styles.navItemActive : ""}`} onClick={onOpenProjects} onContextMenu={(event) => openNavMenu(event, [{ id: "open", label: t("navRail.openProjects"), onSelect: onOpenProjects }, { id: "add", label: t("navRail.addProject"), onSelect: onOpenWorkspace }])} title={t("navRail.projects")}>
              <Folder size={15} strokeWidth={1.8} aria-hidden="true" />
              <span>{t("navRail.projects")}</span>
            </button>
            <button
              type="button"
              className={styles.navItemTrailing}
              onClick={onOpenWorkspace}
              aria-label={t("navRail.selectWorkspace")}
              title={t("navRail.selectWorkspace")}
            >
              <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <button type="button" className={`${styles.navItem} ${activeView === "scheduled" ? styles.navItemActive : ""}`} onClick={onScheduled} onContextMenu={(event) => openNavMenu(event, [{ id: "open", label: t("navRail.openScheduled"), onSelect: onScheduled }, { id: "new", label: t("common.titlebar.newChat"), onSelect: onNewChat }])} title={t("navRail.scheduled")}>
            <Clock size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>{t("navRail.scheduled")}</span>
          </button>
          <button type="button" className={`${styles.navItem} ${activeView === "extensions" ? styles.navItemActive : ""}`} onClick={onExtensions} onContextMenu={(event) => openNavMenu(event, [{ id: "open", label: t("navRail.openExtensions"), onSelect: onExtensions }, { id: "settings", label: t("navRail.openSettings"), onSelect: onSettings }])} title={t("navRail.extensions")}>
            <AtSign size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>{t("navRail.extensions")}</span>
          </button>
        </nav>
      </div>

      <div className={styles.scroll}>
        {sortedPinned.length > 0 && (
          <div className={`${styles.section} ${styles.pinnedSection}`}>
            <div className={`${styles.sectionHead} ${styles.pinnedSectionHead}`}>
              {t("navRail.pinnedTasks")}
            </div>
            <div className={`${styles.threads} ${styles.threadsOpen}`}>
              {sortedPinned.map((session) => (
                <ThreadItem
                  key={`pinned:${session.path}`}
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
            </div>
          </div>
        )}
        <div className={styles.section}>
          <div className={styles.sectionHead}>{t("navRail.tasks")}</div>
          <div className={`${styles.threads} ${styles.threadsOpen}`}>
            {sessions.length === 0 && <div className={styles.empty}>{t("navRail.noTasks")}</div>}
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
                <span>{showAllSessions ? t("navRail.showLess") : t("navRail.showMore")}</span>
                {!showAllSessions && <span className={styles.showMoreCount}>{sortedSessions.length - 10}</span>}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={styles.bottom}>
        <button type="button" className={styles.settingsRow} onClick={onSettings} title={t("navRail.settings")}>
          <Settings size={16} strokeWidth={1.9} aria-hidden="true" />
          <span className={styles.settingsText}>
            <span className={styles.settingsLabel}>{t("navRail.settings")}</span>
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
  const { t } = useI18n();
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
            aria-label={t("navRail.chatName")}
          />
        </form>
      ) : (
        <button type="button" className={styles.threadMain} onClick={() => onSwitchSession(session.path)} onContextMenu={(event) => { event.preventDefault(); actions.openMenu?.(event, session); }} title={formatSessionTitle(session)}>
          <span className={styles.threadName}>{formatSessionTitle(session)}</span>
        </button>
      )}
      {!renaming && <span className={styles.threadMeta}>
        {isWorking && (
          <span className={styles.generatingDots} title={t("navRail.agentGenerating")} aria-label={t("navRail.agentGenerating")}>
            <span />
            <span />
            <span />
          </span>
        )}
        {!isWorking && isUnread && <span className={styles.unreadDot} title={t("navRail.unreadReply")} aria-label={t("navRail.unreadReply")} />}
        <span className={styles.threadActions}>
          <button
            type="button"
            className={styles.threadAction}
            aria-label={isPinned ? t("navRail.unpinChat") : t("navRail.pinChat")}
            title={isPinned ? t("navRail.unpinChat") : t("navRail.pinChat")}
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
            aria-label={t("navRail.archive")}
            title={t("navRail.archive")}
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
            <span>{relativeTime(session.modified, t)}</span>
          </div>
          <div className={styles.hoverCardMeta}>
            <span><Folder size={14} strokeWidth={1.7} aria-hidden="true" />{session.cwd ? workspaceLabel(session.cwd) : t("navRail.noWorkspace")}</span>
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
function relativeTime(modified: number | string | undefined, t: Translate): string {
  if (!modified) return "";
  const ts = modifiedTs(modified);
  if (!ts) return "";
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("navRail.relative.now");
  if (min < 60) return t("navRail.relative.minute", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("navRail.relative.hour", { count: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t("navRail.relative.day", { count: day });
  const week = Math.floor(day / 7);
  if (week < 5) return t("navRail.relative.week", { count: week });
  return t("navRail.relative.month", { count: Math.floor(day / 30) });
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
  const { t } = useI18n();
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
            aria-label={t("navRail.removeProject", { name: project.name })}
            title={t("navRail.removeFromList")}
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
            <div className={styles.empty}>{t("navRail.noChats")}</div>
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
