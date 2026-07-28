import React, { useEffect, useMemo, useState } from "react";
import { formatDate, formatSessionTitle } from "../../lib/render";
import { apiPatch } from "../../lib/api";
import { useModalFocusTrap } from "../../lib/modal-focus";
import { readStorageArray, readStorageRecord, writeStorageJson } from "../../lib/storage";
import { useAppStore } from "../../state/app-store";
import { SkeletonLines } from "../common/Feedback";
import {
  buildSessionTree,
  isSessionTreeNodeExpanded,
  measureSessionTreeDepth,
  type SessionNode,
} from "./session-tree";

export type { SessionNode } from "./session-tree";
export {
  buildSessionTree,
  isSessionTreeNodeExpanded,
  measureSessionTreeDepth,
  shouldDefaultExpandSessionNode,
} from "./session-tree";

const SESSION_INITIAL_WINDOW = 260;
const SESSION_WINDOW_STEP = 180;
const SESSION_TREE_EXPANDED_KEY = "quake-web:sessionTreeExpanded";
const SESSION_TREE_HIDE_BRANCHES_KEY = "quake-web:sessionTreeHideBranches";

type SessionPanelView = { sessions: any[]; filtered: number; total: number };

export function SessionsPanel({ loading, onSwitch }: { loading?: boolean; onSwitch: (path: string) => void | Promise<void> }) {
  const sessions = useAppStore((s) => s.sessions);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [pinned, setPinned] = useState<string[]>(() => readStorageArray<string>("quake-web:pinnedSessions"));
  const [archived, setArchived] = useState<string[]>(() => readStorageArray<string>("quake-web:archivedSessions"));
  const [aliases, setAliases] = useState<Record<string, string>>(() => readStorageRecord<string>("quake-web:sessionAliases"));
  const [compare, setCompare] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ path: string; value: string } | undefined>();
  const [sessionWindowSize, setSessionWindowSize] = useState(SESSION_INITIAL_WINDOW);
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>(() => readSessionStorageRecord(SESSION_TREE_EXPANDED_KEY));
  const [hideBranches, setHideBranches] = useState(() => readSessionStorageValue(SESSION_TREE_HIDE_BRANCHES_KEY) === "1");
  const compareDialogRef = useModalFocusTrap<HTMLDivElement>(compareOpen);
  const q = query.trim().toLowerCase();
  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);
  const archivedSet = useMemo(() => new Set(archived), [archived]);
  const view = useMemo(
    () => selectSessionPanelView(sessions, q, aliases, archivedSet, pinnedSet, showArchived, sessionWindowSize),
    [aliases, archivedSet, pinnedSet, q, sessions, sessionWindowSize, showArchived],
  );
  const hiddenSessionCount = Math.max(0, view.filtered - view.sessions.length);
  const tree = useMemo(() => buildSessionTree(view.sessions), [view.sessions]);
  const maxTreeDepth = useMemo(() => measureSessionTreeDepth(tree.roots), [tree.roots]);
  const groups = useMemo(() => groupSessionsByDate(tree.roots), [tree.roots]);
  const hasAnyBranches = useMemo(() => tree.roots.some((node) => node.children.length > 0), [tree.roots]);

  useEffect(() => {
    setSessionWindowSize(SESSION_INITIAL_WINDOW);
  }, [q, showArchived]);

  useEffect(() => {
    if (!compareOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setCompareOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [compareOpen]);

  function persistPinned(next: string[]) {
    setPinned(next);
    writeStorageJson("quake-web:pinnedSessions", next);
    void apiPatch("/api/conversation-metadata", { pinnedSessionPaths: next }).catch(() => {});
  }
  function persistArchived(next: string[]) {
    setArchived(next);
    writeStorageJson("quake-web:archivedSessions", next);
    void apiPatch("/api/conversation-metadata", { archivedSessionPaths: next }).catch(() => {});
  }
  function persistAliases(next: Record<string, string>) {
    setAliases(next);
    writeStorageJson("quake-web:sessionAliases", next);
    void apiPatch("/api/conversation-metadata", { sessionAliases: next }).catch(() => {});
  }
  function persistExpandedState(next: Record<string, boolean>) {
    setExpandedState(next);
    writeSessionStorageJson(SESSION_TREE_EXPANDED_KEY, next);
  }
  function persistHideBranches(next: boolean) {
    setHideBranches(next);
    writeSessionStorageValue(SESSION_TREE_HIDE_BRANCHES_KEY, next ? "1" : "0");
  }
  function setNodeExpanded(path: string, expanded: boolean) {
    persistExpandedState({ ...expandedState, [path]: expanded });
  }
  function startRename(session: any) {
    const currentTitle = formatSessionTitle(session, aliases[session.path]);
    setRenaming({ path: session.path, value: currentTitle });
  }
  function commitRename(session: any) {
    const current = formatSessionTitle(session, aliases[session.path]);
    const value = renaming && renaming.path === session.path ? renaming.value.trim() : "";
    persistAliases({ ...aliases, [session.path]: value || current });
    setRenaming(undefined);
  }
  function toggleCompare(path: string) {
    setCompare((items) => (items.includes(path) ? items.filter((item) => item !== path) : [...items, path].slice(-2)));
  }

  if (loading) {
    return (
      <div className="panel">
        <div className="panel-title">Sohbetler</div>
        <SkeletonLines count={5} />
      </div>
    );
  }

  const comparedSessions = compare.map((path) => sessions.find((session: any) => session.path === path)).filter(Boolean);

  return (
    <div className="panel sessions-panel">
      <div className="panel-title-row">
        <div className="panel-title">Sohbetler</div>
        <span>
          {view.filtered}/{view.total}
        </span>
      </div>
      <input className="panel-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sohbet ara…" />
      <div className="session-toolbar">
        <button type="button" className={showArchived ? "active" : ""} onClick={() => setShowArchived(!showArchived)}>
          Arşiv
        </button>
        {hasAnyBranches && (
          <button
            type="button"
            className={hideBranches ? "active" : ""}
            onClick={() => persistHideBranches(!hideBranches)}
            aria-pressed={hideBranches}
            title={hideBranches ? "Yan sohbet dallarını göster" : "Yan sohbet dallarını gizle"}
          >
            {hideBranches ? "Dalları göster" : "Dalları gizle"}
          </button>
        )}
        {compare.length === 2 && (
          <button type="button" onClick={() => setCompareOpen(true)}>
            2 sohbeti karşılaştır
          </button>
        )}
      </div>
      <div id="sessions" className="session-groups muted">
        {groups.map((group) => (
          <section className="session-date-group" key={group.label}>
            <div className="session-date-head">
              {group.label}
              <span>{group.items.length}</span>
            </div>
            {group.items.map((node) => (
              <SessionTreeNode
                key={node.session.path}
                node={node}
                aliases={aliases}
                pinned={pinned}
                archived={archived}
                compare={compare}
                renaming={renaming}
                expandedState={expandedState}
                hideBranches={hideBranches}
                maxTreeDepth={maxTreeDepth}
                onSwitch={onSwitch}
                onStartRename={startRename}
                onRenameValue={(value) => setRenaming((current) => (current ? { ...current, value } : current))}
                onRenameCommit={commitRename}
                onRenameCancel={() => setRenaming(undefined)}
                onPin={(path) => persistPinned(pinnedSet.has(path) ? pinned.filter((item) => item !== path) : [path, ...pinned])}
                onArchive={(path) => persistArchived(archivedSet.has(path) ? archived.filter((item) => item !== path) : [path, ...archived])}
                onCompare={toggleCompare}
                onSetExpanded={setNodeExpanded}
              />
            ))}
          </section>
        ))}
        {hiddenSessionCount > 0 && (
          <button type="button" className="tree-load-more session-load-more" onClick={() => setSessionWindowSize((value) => value + SESSION_WINDOW_STEP)}>
            Sonraki {Math.min(hiddenSessionCount, SESSION_WINDOW_STEP)} sohbeti göster <span>{hiddenSessionCount} gizli</span>
          </button>
        )}
      </div>
      {compareOpen && (
        <div className="session-compare-backdrop" onMouseDown={() => setCompareOpen(false)}>
          <div
            ref={compareDialogRef}
            className="session-compare-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Sohbet karşılaştırması"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <b>Sohbet karşılaştırması</b>
                <span>İki sohbetin bağlam ve sonuç özeti</span>
              </div>
              <button type="button" aria-label="Karşılaştırmayı kapat" onClick={() => setCompareOpen(false)}>
                ×
              </button>
            </header>
            <div className="session-compare-grid">
              {comparedSessions.map((session: any) => (
                <article key={session.path}>
                  <h3>{formatSessionTitle(session, aliases[session.path])}</h3>
                  <dl>
                    <div>
                      <dt>Proje</dt>
                      <dd>{session.cwd || "Proje dışı"}</dd>
                    </div>
                    <div>
                      <dt>Mesaj</dt>
                      <dd>{session.messageCount || 0}</dd>
                    </div>
                    <div>
                      <dt>Güncellendi</dt>
                      <dd>{formatDate(session.modified)}</dd>
                    </div>
                  </dl>
                  <section>
                    <b>İlk istek</b>
                    <p>{session.firstMessage || "—"}</p>
                  </section>
                  <section>
                    <b>Son kullanıcı mesajı</b>
                    <p>{session.lastUserMessage || "—"}</p>
                  </section>
                  <section>
                    <b>Son yanıt</b>
                    <p>{session.lastAssistantMessage || "—"}</p>
                  </section>
                  <button
                    type="button"
                    onClick={() => {
                      setCompareOpen(false);
                      void onSwitch(session.path);
                    }}
                  >
                    Sohbeti aç
                  </button>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function selectSessionPanelView(
  sessions: any[],
  query: string,
  aliases: Record<string, string>,
  archived: Set<string>,
  pinned: Set<string>,
  showArchived: boolean,
  limit: number,
): SessionPanelView {
  const selected: Array<{ session: any; index: number }> = [];
  let filtered = 0;
  sessions.forEach((session, index) => {
    if (!showArchived && archived.has(session.path)) return;
    if (query && !sessionSearchText(session, aliases).includes(query)) return;
    filtered += 1;
    pushSessionPanelItem(selected, { session, index }, pinned, limit);
  });
  return { sessions: selected.map((entry) => entry.session), filtered, total: sessions.length };
}

function sessionSearchText(session: any, aliases: Record<string, string>): string {
  const title = aliases[session.path] || session.name || session.firstMessage || session.id || "";
  return `${title} ${session.firstMessage || ""} ${session.lastUserMessage || ""} ${session.id || ""}`.toLowerCase();
}

function pushSessionPanelItem(
  selected: Array<{ session: any; index: number }>,
  entry: { session: any; index: number },
  pinned: Set<string>,
  limit: number,
) {
  if (limit <= 0) return;
  const betterThan = (candidate: typeof entry, current: typeof entry) => compareSessionPanelItem(candidate, current, pinned) < 0;
  if (selected.length < limit) {
    const index = selected.findIndex((item) => betterThan(entry, item));
    selected.splice(index < 0 ? selected.length : index, 0, entry);
    return;
  }
  if (!betterThan(entry, selected[selected.length - 1])) return;
  const index = selected.findIndex((item) => betterThan(entry, item));
  selected.splice(index < 0 ? selected.length : index, 0, entry);
  selected.length = limit;
}

function compareSessionPanelItem(a: { session: any; index: number }, b: { session: any; index: number }, pinned: Set<string>): number {
  const pinnedDiff = Number(pinned.has(b.session.path)) - Number(pinned.has(a.session.path));
  if (pinnedDiff) return pinnedDiff;
  const modifiedDiff = new Date(b.session.modified).getTime() - new Date(a.session.modified).getTime();
  return modifiedDiff || a.index - b.index;
}

function groupSessionsByDate(nodes: SessionNode[]): Array<{ label: string; items: SessionNode[] }> {
  const groups = new Map<string, SessionNode[]>();
  for (const node of nodes) {
    const date = new Date(node.session.modified);
    const label = date.toDateString() === new Date().toDateString() ? "Bugün" : date.toLocaleDateString();
    groups.set(label, [...(groups.get(label) || []), node]);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

function SessionTreeNode({
  node,
  aliases,
  pinned,
  archived,
  compare,
  renaming,
  expandedState,
  hideBranches,
  maxTreeDepth,
  onSwitch,
  onStartRename,
  onRenameValue,
  onRenameCommit,
  onRenameCancel,
  onPin,
  onArchive,
  onCompare,
  onSetExpanded,
  depth = 0,
}: {
  node: SessionNode;
  aliases: Record<string, string>;
  pinned: string[];
  archived: string[];
  compare: string[];
  renaming?: { path: string; value: string };
  expandedState: Record<string, boolean>;
  hideBranches: boolean;
  maxTreeDepth: number;
  onSwitch: (path: string) => void | Promise<void>;
  onStartRename: (session: any) => void;
  onRenameValue: (value: string) => void;
  onRenameCommit: (session: any) => void;
  onRenameCancel: () => void;
  onPin: (path: string) => void;
  onArchive: (path: string) => void;
  onCompare: (path: string) => void;
  onSetExpanded: (path: string, expanded: boolean) => void;
  depth?: number;
}) {
  const session = node.session;
  const title = formatSessionTitle(session, aliases[session.path]);
  const isRenaming = renaming?.path === session.path;
  const renameValue = isRenaming ? renaming?.value || "" : "";
  const childCount = node.children.length;
  const hasChildren = childCount > 0;
  const expanded = isSessionTreeNodeExpanded(session.path, hasChildren, expandedState, hideBranches, depth, maxTreeDepth);
  const openSession = () => {
    if (!isRenaming) void onSwitch(session.path);
  };
  const handleSessionKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isRenaming) return;
    if (hasChildren && event.key === "ArrowRight") {
      event.preventDefault();
      if (!expanded) onSetExpanded(session.path, true);
      return;
    }
    if (hasChildren && event.key === "ArrowLeft") {
      event.preventDefault();
      if (expanded) onSetExpanded(session.path, false);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void onSwitch(session.path);
  };
  const isPinned = pinned.includes(session.path);
  const branchLabel = session.parentSessionPath ? "Yan sohbet" : "Ana sohbet";
  const itemClass = [
    "session-item",
    isPinned ? "pinned" : "",
    archived.includes(session.path) ? "archived" : "",
    compare.includes(session.path) ? "comparing" : "",
    isRenaming ? "renaming" : "",
    hasChildren ? "has-children" : "",
    hasChildren && expanded ? "expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="session-node" style={{ ["--depth" as string]: String(depth) } as React.CSSProperties} data-depth={depth}>
      <div
        className={itemClass}
        role={isRenaming ? undefined : "treeitem"}
        tabIndex={isRenaming ? -1 : 0}
        aria-label={isRenaming ? undefined : `${title} sohbetini aç`}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-level={depth + 1}
        onClick={openSession}
        onKeyDown={handleSessionKeyDown}
      >
        <div className="session-item-main">
          {hasChildren ? (
            <button
              type="button"
              className={`session-expand ${expanded ? "is-open" : ""}`}
              aria-expanded={expanded}
              aria-label={expanded ? `${title} dallarını daralt` : `${title} dallarını genişlet`}
              onClick={(event) => {
                event.stopPropagation();
                onSetExpanded(session.path, !expanded);
              }}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
                <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <span className="session-expand-spacer" aria-hidden="true" />
          )}
          <div className="session-item-body">
            {isRenaming ? (
              <form
                className="session-rename"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                  event.preventDefault();
                  onRenameCommit(session);
                }}
              >
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(event) => onRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onRenameCancel();
                    }
                  }}
                  aria-label="Sohbet adı"
                />
                <button type="submit">Kaydet</button>
                <button type="button" onClick={onRenameCancel}>
                  Vazgeç
                </button>
              </form>
            ) : (
              <div className="title">
                <span>{title}</span>
                {isPinned && <span className="session-pin">Sabit</span>}
                {hasChildren && <span className="session-branch-count">{childCount} dal</span>}
              </div>
            )}
            <div className="sub">
              {branchLabel} · {formatDate(session.modified)} · {session.messageCount} mesaj
            </div>
          </div>
        </div>
        <div className="session-actions" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => onPin(session.path)}>
            {isPinned ? "Sabiti kaldır" : "Sabitle"}
          </button>
          <button type="button" onClick={() => onStartRename(session)}>
            Adlandır
          </button>
          <button type="button" onClick={() => onCompare(session.path)}>
            {compare.includes(session.path) ? "Çıkar" : "Karşılaştır"}
          </button>
          <button type="button" onClick={() => onArchive(session.path)}>
            {archived.includes(session.path) ? "Geri al" : "Arşivle"}
          </button>
        </div>
      </div>
      {hasChildren && expanded && (
        <div className="session-children" role="group">
          {node.children.map((child) => (
            <SessionTreeNode
              key={child.session.path}
              node={child}
              aliases={aliases}
              pinned={pinned}
              archived={archived}
              compare={compare}
              renaming={renaming}
              expandedState={expandedState}
              hideBranches={hideBranches}
              maxTreeDepth={maxTreeDepth}
              onSwitch={onSwitch}
              onStartRename={onStartRename}
              onRenameValue={onRenameValue}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
              onPin={onPin}
              onArchive={onArchive}
              onCompare={onCompare}
              onSetExpanded={onSetExpanded}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function readSessionStorageValue(key: string, fallback = ""): string {
  try {
    return sessionStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeSessionStorageValue(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // sessionStorage may be unavailable
  }
}

function writeSessionStorageJson(key: string, value: unknown): void {
  writeSessionStorageValue(key, JSON.stringify(value));
}

function readSessionStorageRecord(key: string): Record<string, boolean> {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, boolean> = {};
    for (const [path, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") result[path] = value;
    }
    return result;
  } catch {
    return {};
  }
}
