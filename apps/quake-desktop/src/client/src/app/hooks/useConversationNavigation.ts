import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatSessionTitle } from "../../lib/render";
import { groupSessionsByWorkspace, projectNameFromCwd } from "../../lib/session-projects";
import { readStorageArray, writeStorageJson } from "../../lib/storage";
import {
  normalizeSessionMetadataPath,
  normalizeWorkspaceNavigationKey,
} from "../conversation-navigation";

export type ConversationNavigationOptions = {
  sessions: any[];
  currentWorkspace: string;
  workspaceRoots: string[];
  noProject: boolean;
  streamingSessionPaths: string[];
  sessionFile?: string;
  pinnedPaths: Set<string>;
  archivedPaths: Set<string>;
  sessionAliases: Record<string, string>;
  hiddenWorkspaces: Set<string>;
  recentWorkspacesTick: number;
  onOpenSession: (sessionPath: string) => void | Promise<void>;
};

const MAX_SESSIONS_PER_PROJECT = 10;

/** Builds all navigation projections from raw sessions and persisted metadata. */
export function useConversationNavigation(options: ConversationNavigationOptions) {
  const {
    sessions,
    currentWorkspace,
    workspaceRoots,
    noProject,
    streamingSessionPaths,
    sessionFile,
    pinnedPaths,
    archivedPaths,
    sessionAliases,
    hiddenWorkspaces,
    recentWorkspacesTick,
    onOpenSession,
  } = options;
  const [unreadSessionPaths, setUnreadSessionPaths] = useState<Set<string>>(
    () => new Set(readStorageArray<string>("quake-web:unreadSessions").map((path) => path.replace(/\//g, "\\").toLowerCase())),
  );
  const previousStreamingSessionsRef = useRef<Set<string>>(new Set());

  const markSessionRead = useCallback((path: string) => {
    const key = String(path || "").replace(/\//g, "\\").toLowerCase();
    if (!key) return;
    setUnreadSessionPaths((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      writeStorageJson("quake-web:unreadSessions", [...next]);
      return next;
    });
  }, []);

  const visibleSessions = useMemo(() => sessions
    .filter((session) => Number(session?.messageCount) > 0 && String(session?.firstMessage || "").trim() !== "(no messages)")
    .filter((session) => !archivedPaths.has(normalizeSessionMetadataPath(String(session?.path || ""))))
    .map((session) => {
      const alias = sessionAliases[normalizeSessionMetadataPath(session.path)];
      return alias ? { ...session, name: alias } : session;
    }), [archivedPaths, sessionAliases, sessions]);

  const projectSessions = useMemo(
    () => visibleSessions.filter((session) => !pinnedPaths.has(normalizeSessionMetadataPath(String(session?.path || "")))),
    [pinnedPaths, visibleSessions],
  );

  const sessionProjects = useMemo(() => groupSessionsByWorkspace(projectSessions, currentWorkspace).map((project: any) => ({
    ...project,
    sessions: [...project.sessions]
      .sort((left: any, right: any) => {
        const leftTime = typeof left.modified === "number" ? left.modified : Date.parse(String(left.modified || 0));
        const rightTime = typeof right.modified === "number" ? right.modified : Date.parse(String(right.modified || 0));
        return (rightTime || 0) - (leftTime || 0);
      })
      .slice(0, MAX_SESSIONS_PER_PROJECT),
  })), [currentWorkspace, projectSessions]);

  const navProjects = useMemo(
    () => (sessionProjects as Array<{ cwd?: string }>).filter((project) => {
      const key = normalizeWorkspaceNavigationKey(String(project.cwd || ""));
      return key && !hiddenWorkspaces.has(key);
    }),
    [hiddenWorkspaces, sessionProjects],
  );

  useEffect(() => {
    const normalize = (value: string) => value.replace(/\//g, "\\").toLowerCase();
    const current = new Set(streamingSessionPaths.map(normalize));
    const active = normalize(sessionFile || "");
    for (const previous of previousStreamingSessionsRef.current) {
      if (!current.has(previous) && previous !== active) {
        setUnreadSessionPaths((existing) => {
          if (existing.has(previous)) return existing;
          const next = new Set(existing).add(previous);
          writeStorageJson("quake-web:unreadSessions", [...next]);
          return next;
        });
      }
    }
    if (active) markSessionRead(active);
    previousStreamingSessionsRef.current = current;
  }, [markSessionRead, sessionFile, streamingSessionPaths]);

  const projectPickerItems = useMemo(() => {
    const map = new Map<string, { name: string; path: string; open: boolean }>();
    for (const path of workspaceRoots) {
      const trimmed = String(path || "").trim();
      if (!trimmed) continue;
      const key = normalizeWorkspaceNavigationKey(trimmed);
      if (key.includes("no-project") || hiddenWorkspaces.has(key)) continue;
      map.set(key, { name: projectNameFromCwd(trimmed), path: trimmed, open: true });
    }
    for (const project of sessionProjects as Array<{ name?: string; cwd?: string }>) {
      const path = String(project.cwd || "").trim();
      if (!path) continue;
      const key = normalizeWorkspaceNavigationKey(path);
      if (key.includes("no-project") || hiddenWorkspaces.has(key)) continue;
      const existing = map.get(key);
      map.set(key, { name: String(project.name || path.split(/[\\/]/).pop() || path), path, open: existing?.open || false });
    }
    for (const path of readStorageArray<string>("quake-web:recentWorkspaces")) {
      const trimmed = String(path || "").trim();
      if (!trimmed) continue;
      const key = normalizeWorkspaceNavigationKey(trimmed);
      if (key.includes("no-project") || hiddenWorkspaces.has(key) || map.has(key)) continue;
      map.set(key, { name: trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed, path: trimmed, open: false });
    }
    if (currentWorkspace && !noProject) {
      const key = normalizeWorkspaceNavigationKey(currentWorkspace);
      if (!key.includes("no-project") && !map.has(key) && !hiddenWorkspaces.has(key)) {
        map.set(key, {
          name: currentWorkspace.split(/[\\/]/).filter(Boolean).pop() || currentWorkspace,
          path: currentWorkspace,
          open: true,
        });
      }
    }
    return Array.from(map.values()).slice(0, 16);
  }, [currentWorkspace, hiddenWorkspaces, noProject, recentWorkspacesTick, sessionProjects, workspaceRoots]);

  const navPinned = useMemo(() => {
    const byPath = new Map(visibleSessions.map((session) => [normalizeSessionMetadataPath(String(session?.path || "")), session]));
    return Array.from(pinnedPaths).flatMap((path) => {
      const session: any = byPath.get(path);
      if (!session) return [];
      return [{
        ...session,
        path: String(session.path || path),
        id: String(session.id || path),
        name: formatSessionTitle(session),
        onOpen: () => { void onOpenSession(path); },
      }];
    });
  }, [onOpenSession, pinnedPaths, visibleSessions]);

  const paletteRecentSessions = useMemo(() => sessions
    .slice()
    .sort((left, right) => {
      const leftTime = typeof left?.modified === "number" ? left.modified : Date.parse(left?.modified || "") || 0;
      const rightTime = typeof right?.modified === "number" ? right.modified : Date.parse(right?.modified || "") || 0;
      return rightTime - leftTime;
    })
    .map((session) => ({
      path: String(session?.path || ""),
      name: formatSessionTitle(session),
      project: session?.cwd ? projectNameFromCwd(String(session.cwd)) : undefined,
    }))
    .filter((item) => item.path), [sessions]);

  return {
    unreadSessionPaths,
    markSessionRead,
    visibleSessions,
    projectSessions,
    sessionProjects,
    navProjects,
    projectPickerItems,
    navPinned,
    paletteRecentSessions,
  };
}

export type UseConversationNavigationReturn = ReturnType<typeof useConversationNavigation>;
