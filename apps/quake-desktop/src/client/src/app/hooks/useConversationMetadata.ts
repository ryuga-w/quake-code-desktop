import { useCallback, useState } from "react";
import { apiPatch } from "../../lib/api";
import { formatSessionTitle } from "../../lib/render";
import { readStorageArray, readStorageValue, writeStorageJson } from "../../lib/storage";
import type { ToastState } from "../../state/app-store";
import {
  normalizeSessionMetadataPath,
  normalizeWorkspaceNavigationKey,
} from "../conversation-navigation";

export type ConversationMetadataSnapshot = {
  archivedSessionPaths?: string[];
  pinnedSessionPaths?: string[];
  sessionAliases?: Record<string, string>;
};

export type ConversationMetadataOptions = {
  showToast: (
    message: string,
    type?: ToastState["type"],
    options?: Pick<ToastState, "actionLabel" | "action">,
  ) => string;
};

function readStoredAliases(): Record<string, string> {
  try {
    const parsed = JSON.parse(readStorageValue("quake-web:sessionAliases", "{}")) as Record<string, string>;
    return Object.fromEntries(
      Object.entries(parsed).map(([path, alias]) => [normalizeSessionMetadataPath(path), alias]),
    );
  } catch {
    return {};
  }
}

/** Owns persisted conversation labels, pin/archive state, and hidden workspaces. */
export function useConversationMetadata({ showToast }: ConversationMetadataOptions) {
  const [pinnedPaths, setPinnedPaths] = useState<Set<string>>(
    () => new Set(readStorageArray<string>("quake-web:pinnedSessions").map(normalizeSessionMetadataPath)),
  );
  const [archivedPaths, setArchivedPaths] = useState<Set<string>>(
    () => new Set(readStorageArray<string>("quake-web:archivedSessions").map(normalizeSessionMetadataPath)),
  );
  const [sessionAliases, setSessionAliases] = useState<Record<string, string>>(readStoredAliases);
  const [hiddenWorkspaces, setHiddenWorkspaces] = useState<Set<string>>(
    () => new Set(readStorageArray<string>("quake-web:hiddenWorkspaces").map(normalizeWorkspaceNavigationKey)),
  );
  const [recentWorkspacesTick, setRecentWorkspacesTick] = useState(0);

  const persistConversationMetadata = useCallback((patch: Record<string, unknown>) => {
    void apiPatch("/api/conversation-metadata", patch).catch((error: any) => {
      showToast(`Sohbet bilgisi kaydedilemedi: ${error?.message || "bilinmeyen hata"}`, "error");
    });
  }, [showToast]);

  const togglePinSession = useCallback((path: string) => {
    setPinnedPaths((current) => {
      const key = normalizeSessionMetadataPath(path);
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeStorageJson("quake-web:pinnedSessions", [...next]);
      persistConversationMetadata({ pinnedSessionPaths: [...next] });
      return next;
    });
  }, [persistConversationMetadata]);

  const renameNavSession = useCallback((session: any, nextName: string) => {
    const key = normalizeSessionMetadataPath(session.path);
    const currentName = sessionAliases[key] || formatSessionTitle(session);
    const value = nextName.trim();
    if (!value || value === currentName) return;
    setSessionAliases((aliases) => {
      const next = { ...aliases, [key]: value };
      writeStorageJson("quake-web:sessionAliases", next);
      persistConversationMetadata({ sessionAliases: next });
      return next;
    });
    showToast("Sohbet yeniden adlandırıldı", "success");
  }, [persistConversationMetadata, sessionAliases, showToast]);

  const archiveSession = useCallback((path: string) => {
    const key = normalizeSessionMetadataPath(path);
    setArchivedPaths((current) => {
      const next = new Set(current).add(key);
      writeStorageJson("quake-web:archivedSessions", [...next]);
      persistConversationMetadata({ archivedSessionPaths: [...next] });
      return next;
    });
    setPinnedPaths((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      writeStorageJson("quake-web:pinnedSessions", [...next]);
      persistConversationMetadata({ pinnedSessionPaths: [...next] });
      return next;
    });
    showToast("Sohbet arşivlendi", "info");
  }, [persistConversationMetadata, showToast]);

  const removeWorkspaceFromNav = useCallback((cwd: string) => {
    const raw = String(cwd || "").trim();
    if (!raw) return;
    const key = normalizeWorkspaceNavigationKey(raw);
    setHiddenWorkspaces((current) => {
      const next = new Set(current).add(key);
      writeStorageJson("quake-web:hiddenWorkspaces", [...next]);
      return next;
    });
    const recent = readStorageArray<string>("quake-web:recentWorkspaces");
    writeStorageJson(
      "quake-web:recentWorkspaces",
      recent.filter((item) => normalizeWorkspaceNavigationKey(item) !== key),
    );
    setRecentWorkspacesTick((value) => value + 1);
    showToast("Proje listeden kaldırıldı", "info");
  }, [showToast]);

  const unhideWorkspace = useCallback((cwd: string) => {
    const key = normalizeWorkspaceNavigationKey(String(cwd || "").trim());
    if (!key) return;
    setHiddenWorkspaces((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      writeStorageJson("quake-web:hiddenWorkspaces", [...next]);
      return next;
    });
  }, []);

  const hydrateConversationMetadata = useCallback((metadata: ConversationMetadataSnapshot) => {
    const storedArchived = readStorageArray<string>("quake-web:archivedSessions").map(normalizeSessionMetadataPath);
    const storedPinned = readStorageArray<string>("quake-web:pinnedSessions").map(normalizeSessionMetadataPath);
    const storedAliases = readStoredAliases();
    const serverEmpty = (metadata.archivedSessionPaths || []).length === 0
      && (metadata.pinnedSessionPaths || []).length === 0
      && Object.keys(metadata.sessionAliases || {}).length === 0;
    const legacyExists = storedArchived.length > 0
      || storedPinned.length > 0
      || Object.keys(storedAliases).length > 0;
    const source = serverEmpty && legacyExists
      ? {
          archivedSessionPaths: storedArchived,
          pinnedSessionPaths: storedPinned,
          sessionAliases: storedAliases,
        }
      : metadata;
    if (serverEmpty && legacyExists) persistConversationMetadata(source);

    const archived = new Set<string>((source.archivedSessionPaths || []).map(normalizeSessionMetadataPath));
    const pinned = new Set<string>((source.pinnedSessionPaths || []).map(normalizeSessionMetadataPath));
    const aliases = Object.fromEntries(
      Object.entries(source.sessionAliases || {}).map(([path, alias]) => [normalizeSessionMetadataPath(path), alias]),
    );
    setArchivedPaths(archived);
    setPinnedPaths(pinned);
    setSessionAliases(aliases);
    writeStorageJson("quake-web:archivedSessions", [...archived]);
    writeStorageJson("quake-web:pinnedSessions", [...pinned]);
    writeStorageJson("quake-web:sessionAliases", aliases);
  }, [persistConversationMetadata]);

  return {
    pinnedPaths,
    archivedPaths,
    sessionAliases,
    hiddenWorkspaces,
    recentWorkspacesTick,
    setRecentWorkspacesTick,
    togglePinSession,
    renameNavSession,
    archiveSession,
    removeWorkspaceFromNav,
    unhideWorkspace,
    hydrateConversationMetadata,
  };
}

export type UseConversationMetadataReturn = ReturnType<typeof useConversationMetadata>;
