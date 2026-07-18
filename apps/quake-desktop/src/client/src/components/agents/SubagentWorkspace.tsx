import React from "react";
import {
  Bot,
  Clock3,
  Copy,
  GitBranch,
  X,
} from "lucide-react";
import type {
  WebSubagentAgentType,
  WebSubagentActivity,
  WebSubagentSnapshot,
  WebSubagentSummary,
} from "../../../../shared/protocol";
import { apiGet, apiPost } from "../../lib/api";
import { textFromMessage } from "../../lib/render";
import { readStorageJson, writeStorageJson } from "../../lib/storage";
import { DockConversationComposer } from "../composer/DockConversationComposer";
import { MarkdownContent } from "../markdown/MarkdownContent";
import { DockPanelTabPortal } from "../shell/DockPanelTabPortal";
import styles from "./SubagentWorkspace.module.css";

type ToastType = "info" | "success" | "warning" | "error";

type SubagentWorkspaceProps = {
  sessionId?: string;
  requestedAgentId?: string;
  requestVersion?: number;
  onOpenFiles: () => void;
  onOpenFile: (path: string) => void;
  onOpenAgents: () => void;
  onToast: (message: string, type?: ToastType) => string | void;
};

type PendingMessage = {
  id: string;
  text: string;
  timestamp: number;
};

type StoredSubagentWorkspace = {
  openAgentIds?: string[];
  activeAgentId?: string;
  drafts?: Record<string, string>;
};

const FALLBACK_AGENT_TYPES: WebSubagentAgentType[] = [
  { id: "default", label: "Default", description: "Genel amaçlı alt ajan" },
  { id: "explorer", label: "Explorer", description: "Kod tabanını hızlıca araştırır" },
  { id: "worker", label: "Worker", description: "Sınırlı bir uygulama görevini yürütür" },
];

const EMPTY_MESSAGES: any[] = [];

function sessionQuery(sessionId?: string): string {
  return sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
}

function agentUrl(id: string, action?: "message" | "abort", sessionId?: string): string {
  const suffix = action ? `/${action}` : "";
  return `/api/subagents/${encodeURIComponent(id)}${suffix}${sessionQuery(sessionId)}`;
}

function visibleMessageText(message: any): string {
  return textFromMessage(message)
    .replace(/\n*\[ISOLATION:[\s\S]*$/i, "")
    .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, "")
    .replace(/^\s*\[tool call:[^\]]+]\s*$/gim, "")
    .trim();
}

function isActiveStatus(status: string | undefined): boolean {
  return status === "running" || status === "queued";
}

function statusLabel(status: string | undefined): string {
  if (status === "running") return "çalışıyor";
  if (status === "queued") return "sırada";
  if (status === "completed" || status === "steered") return "tamamlandı";
  if (status === "error") return "hata";
  if (status === "interrupted") return "kesildi";
  if (status === "aborted" || status === "stopped" || status === "shutdown") return "durduruldu";
  return status || "bekliyor";
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds} sn`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return remaining ? `${minutes} dk ${remaining} sn` : `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder ? `${hours} sa ${minuteRemainder} dk` : `${hours} sa`;
}

function thinkingLabel(level: string | undefined): string {
  if (level === "off") return "Standart";
  if (level === "minimal") return "Minimal";
  if (level === "low") return "Düşük";
  if (level === "high") return "Yüksek";
  if (level === "xhigh") return "Çok yüksek";
  if (level === "max") return "Maksimum";
  return "Orta";
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function updateSummary(rows: WebSubagentSummary[], snapshot: WebSubagentSnapshot): WebSubagentSummary[] {
  const next = rows.some((agent) => agent.id === snapshot.id)
    ? rows.map((agent) => agent.id === snapshot.id ? snapshot : agent)
    : [...rows, snapshot];
  return next.sort((left, right) => left.createdAt - right.createdAt);
}

function AgentRunMeta({ snapshot, active, durationMs }: { snapshot: WebSubagentSnapshot; active: boolean; durationMs: number }) {
  return (
    <div className={styles.runMeta} data-status={snapshot.status}>
      {active ? <i className={styles.metaSpinner} aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
      <span>{formatDuration(durationMs)} boyunca {active ? "çalışıyor" : "çalıştı"}</span>
      <b>{statusLabel(snapshot.status)}</b>
      {snapshot.worktreeBranch ? <small title={snapshot.worktreeBranch}><GitBranch aria-hidden="true" /> {snapshot.worktreeBranch}</small> : null}
    </div>
  );
}

function activityLabel(activity: WebSubagentActivity): string {
  const toolName = activity.toolName.toLowerCase();
  const running = activity.status === "running";
  if (/^(bash|shell|terminal|run_terminal_command)$/.test(toolName)) return running ? "Komut çalıştırıyor" : "Komut tamamlandı";
  if (/(read|cat|get-content)/.test(toolName)) return running ? "Dosya okuyor" : "Dosya okundu";
  if (/(grep|find|search|rg)/.test(toolName)) return running ? "Kodda arıyor" : "Arama tamamlandı";
  if (/(write|edit|patch|move|rename)/.test(toolName)) return running ? "Dosyayı güncelliyor" : "Dosya güncellendi";
  if (/(test|check|lint|typecheck)/.test(toolName)) return running ? "Kontrol çalıştırıyor" : "Kontrol tamamlandı";
  if (/(browser|web)/.test(toolName)) return running ? "Web içeriğini inceliyor" : "Web incelemesi tamamlandı";
  return running ? `${activity.toolName} çalıştırıyor` : `${activity.toolName} tamamlandı`;
}

function LiveAgentActivity({ activities }: { activities: WebSubagentActivity[] }) {
  const visible = activities.slice(-4);
  if (!visible.length) return null;
  return (
    <div className={styles.liveActivity} aria-label="Canlı subagent etkinliği">
      {visible.map((activity, index) => (
        <div className={styles.liveActivityItem} data-status={activity.status} key={activity.id}>
          <div className={styles.liveActivityHead}>
            <i aria-hidden="true" />
            <strong>{activityLabel(activity)}</strong>
            <span>{activity.toolName}</span>
          </div>
          {activity.input ? <code title={activity.input}>{activity.input}</code> : null}
          {activity.output && index === visible.length - 1 ? <pre>{activity.output}</pre> : null}
        </div>
      ))}
    </div>
  );
}

export function SubagentWorkspace({
  sessionId,
  requestedAgentId,
  requestVersion,
  onOpenFiles,
  onOpenFile,
  onOpenAgents,
  onToast,
}: SubagentWorkspaceProps) {
  const storageKey = `quake-web:subagentWorkspace:${sessionId || "active"}`;
  const storedWorkspace = React.useMemo(
    () => readStorageJson<StoredSubagentWorkspace>(storageKey, {}),
    [storageKey],
  );
  const [agents, setAgents] = React.useState<WebSubagentSummary[]>([]);
  const [agentTypes, setAgentTypes] = React.useState<WebSubagentAgentType[]>(FALLBACK_AGENT_TYPES);
  const [openAgentIds, setOpenAgentIds] = React.useState<string[]>(() =>
    Array.isArray(storedWorkspace.openAgentIds) ? storedWorkspace.openAgentIds.filter((id): id is string => typeof id === "string") : [],
  );
  const [activeAgentId, setActiveAgentId] = React.useState(requestedAgentId || storedWorkspace.activeAgentId || "");
  const [snapshots, setSnapshots] = React.useState<Record<string, WebSubagentSnapshot>>({});
  const [drafts, setDrafts] = React.useState<Record<string, string>>(() =>
    storedWorkspace.drafts && typeof storedWorkspace.drafts === "object" ? storedWorkspace.drafts : {},
  );
  const [pendingMessages, setPendingMessages] = React.useState<Record<string, PendingMessage[]>>({});
  const [loading, setLoading] = React.useState(true);
  const [available, setAvailable] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [createType, setCreateType] = React.useState("default");
  const [createTask, setCreateTask] = React.useState("");
  const [createIsolation, setCreateIsolation] = React.useState<"worktree" | "none">("worktree");
  const [createForkContext, setCreateForkContext] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const knownAgentIdsRef = React.useRef<Set<string> | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const createTaskRef = React.useRef<HTMLTextAreaElement | null>(null);
  const createWrapRef = React.useRef<HTMLDivElement | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const endRef = React.useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = React.useRef(true);
  const listFailureNotifiedRef = React.useRef(false);

  const activeSummary = agents.find((agent) => agent.id === activeAgentId);
  const activeSnapshot = activeAgentId ? snapshots[activeAgentId] : undefined;
  const draft = activeAgentId ? drafts[activeAgentId] || "" : "";
  const activePending = activeAgentId ? pendingMessages[activeAgentId] || [] : [];
  const persistedMessages = activeSnapshot?.messages || EMPTY_MESSAGES;
  const displayedMessages = React.useMemo(() => {
    if (!activePending.length) return persistedMessages;
    const unresolved = activePending.filter((pending) => !persistedMessages.some((message) =>
      message?.role === "user" && visibleMessageText(message) === pending.text,
    ));
    return [
      ...persistedMessages,
      ...unresolved.map((pending) => ({
        id: pending.id,
        role: "user",
        content: pending.text,
        timestamp: pending.timestamp,
        __subagentOptimistic: true,
      })),
    ];
  }, [activePending, persistedMessages]);
  const streamingText = activeSnapshot?.streamingText
    ? visibleMessageText({ role: "assistant", content: activeSnapshot.streamingText })
    : activeSnapshot?.streamingMessage
      ? visibleMessageText(activeSnapshot.streamingMessage)
      : "";
  const liveActivities = activeSnapshot?.activities || [];
  const liveActivityMarker = liveActivities
    .map((activity) => `${activity.id}:${activity.status}:${activity.updatedAt}:${activity.output?.length || 0}`)
    .join("|");
  const active = isActiveStatus(activeSnapshot?.status || activeSummary?.status);

  React.useEffect(() => {
    writeStorageJson(storageKey, { openAgentIds, activeAgentId, drafts } satisfies StoredSubagentWorkspace);
  }, [activeAgentId, drafts, openAgentIds, storageKey]);

  const applySnapshot = React.useCallback((snapshot: WebSubagentSnapshot) => {
    setSnapshots((current) => ({ ...current, [snapshot.id]: snapshot }));
    setAgents((current) => updateSummary(current, snapshot));
    setPendingMessages((current) => {
      const pending = current[snapshot.id];
      if (!pending?.length) return current;
      const unresolved = pending.filter((entry) => !snapshot.messages.some((message) =>
        message?.role === "user" && visibleMessageText(message) === entry.text,
      ));
      if (unresolved.length === pending.length) return current;
      return { ...current, [snapshot.id]: unresolved };
    });
  }, []);

  React.useEffect(() => {
    if (!createOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!createWrapRef.current?.contains(event.target as Node)) setCreateOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCreateOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [createOpen]);

  React.useEffect(() => {
    if (!requestedAgentId) return;
    setOpenAgentIds((current) => current.includes(requestedAgentId) ? current : [...current, requestedAgentId]);
    setActiveAgentId(requestedAgentId);
    stickToBottomRef.current = true;
  }, [requestVersion, requestedAgentId]);

  React.useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const refresh = async () => {
      try {
        const response = await apiGet<{
          agents: WebSubagentSummary[];
          agentTypes: WebSubagentAgentType[];
          available: boolean;
        }>(`/api/subagents${sessionQuery(sessionId)}`);
        if (cancelled) return;
        listFailureNotifiedRef.current = false;
        setAvailable(response.available !== false);
        setAgents(response.agents || []);
        if (response.agentTypes?.length) setAgentTypes(response.agentTypes);

        const currentIds = new Set((response.agents || []).map((agent) => agent.id));
        const previousIds = knownAgentIdsRef.current;
        knownAgentIdsRef.current = currentIds;
        setOpenAgentIds((current) => {
          if (!previousIds) return current.length ? current.filter((id) => currentIds.has(id)) : [...currentIds];
          const additions = [...currentIds].filter((id) => !previousIds.has(id));
          return [...current.filter((id) => currentIds.has(id)), ...additions.filter((id) => !current.includes(id))];
        });
        setActiveAgentId((current) => {
          if (current && currentIds.has(current)) return current;
          if (requestedAgentId && currentIds.has(requestedAgentId)) return requestedAgentId;
          return response.agents.at(-1)?.id || "";
        });
        setLoading(false);
        const hasLiveAgent = response.agents.some((agent) => isActiveStatus(agent.status));
        timer = window.setTimeout(refresh, hasLiveAgent ? 520 : 1_800);
      } catch (error: any) {
        if (cancelled) return;
        setLoading(false);
        if (!listFailureNotifiedRef.current) {
          listFailureNotifiedRef.current = true;
          onToast(`Subagent listesi alınamadı: ${error?.message || "bilinmeyen hata"}`, "error");
        }
        timer = window.setTimeout(refresh, 2_500);
      }
    };

    void refresh();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [onToast, requestedAgentId, sessionId]);

  React.useEffect(() => {
    if (!activeAgentId) return;
    let cancelled = false;
    let timer: number | undefined;

    const refresh = async () => {
      try {
        const response = await apiGet<{ agent: WebSubagentSnapshot }>(agentUrl(activeAgentId, undefined, sessionId));
        if (cancelled) return;
        applySnapshot(response.agent);
        timer = window.setTimeout(refresh, response.agent.isStreaming ? 280 : 1_250);
      } catch {
        if (cancelled) return;
        timer = window.setTimeout(refresh, 2_000);
      }
    };

    void refresh();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeAgentId, applySnapshot, sessionId]);

  React.useEffect(() => {
    if (!agents.some((agent) => isActiveStatus(agent.status))) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [agents]);

  React.useEffect(() => {
    if (!stickToBottomRef.current) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [activeAgentId, displayedMessages.length, liveActivityMarker, streamingText]);

  function activateAgent(id: string) {
    setOpenAgentIds((current) => current.includes(id) ? current : [...current, id]);
    setActiveAgentId(id);
    stickToBottomRef.current = true;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function closeAgentTab(id: string) {
    setOpenAgentIds((current) => {
      const index = current.indexOf(id);
      const next = current.filter((entry) => entry !== id);
      if (activeAgentId === id) {
        setActiveAgentId(next[Math.min(index, Math.max(0, next.length - 1))] || "");
      }
      return next;
    });
  }

  function onThreadScroll() {
    const element = scrollRef.current;
    if (!element) return;
    stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 84;
  }

  async function submitMessage() {
    if (!activeAgentId) return;
    const message = draft.trim();
    if (!message) return;
    const pending: PendingMessage = {
      id: `subagent-pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: message,
      timestamp: Date.now(),
    };
    setDrafts((current) => ({ ...current, [activeAgentId]: "" }));
    setPendingMessages((current) => ({
      ...current,
      [activeAgentId]: [...(current[activeAgentId] || []), pending],
    }));
    setAgents((current) => current.map((agent) => agent.id === activeAgentId
      ? { ...agent, status: "running", isStreaming: true, startedAt: Date.now(), completedAt: undefined }
      : agent));
    stickToBottomRef.current = true;

    try {
      const response = await apiPost<{ agent: WebSubagentSnapshot }>(agentUrl(activeAgentId, "message", sessionId), {
        message,
        interrupt: false,
        sessionId,
      });
      applySnapshot(response.agent);
    } catch (error: any) {
      setPendingMessages((current) => ({
        ...current,
        [activeAgentId]: (current[activeAgentId] || []).filter((entry) => entry.id !== pending.id),
      }));
      setDrafts((current) => ({ ...current, [activeAgentId]: message }));
      onToast(`Subagent mesajı gönderilemedi: ${error?.message || "bilinmeyen hata"}`, "error");
    }
  }

  async function abortActiveAgent() {
    if (!activeAgentId) return;
    try {
      const response = await apiPost<{ agent: WebSubagentSnapshot }>(agentUrl(activeAgentId, "abort", sessionId), { sessionId });
      applySnapshot(response.agent);
      onToast(`${response.agent.name} durduruldu`, "info");
    } catch (error: any) {
      onToast(`Subagent durdurulamadı: ${error?.message || "bilinmeyen hata"}`, "error");
    }
  }

  async function createAgent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = createTask.trim();
    if (!message || creating) return;
    setCreating(true);
    try {
      const response = await apiPost<{ agent: WebSubagentSnapshot }>("/api/subagents", {
        sessionId,
        message,
        name: createName.trim() || undefined,
        agentType: createType,
        forkContext: createForkContext,
        isolation: createIsolation,
      });
      const agent = response.agent;
      knownAgentIdsRef.current?.add(agent.id);
      applySnapshot(agent);
      setOpenAgentIds((current) => [...current.filter((id) => id !== agent.id), agent.id]);
      setActiveAgentId(agent.id);
      setCreateOpen(false);
      setCreateName("");
      setCreateTask("");
      onToast(`${agent.name} çalışmaya başladı`, "success");
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (error: any) {
      onToast(`Subagent oluşturulamadı: ${error?.message || "bilinmeyen hata"}`, "error");
    } finally {
      setCreating(false);
    }
  }

  async function copyResponse(text: string) {
    const copied = await copyText(text);
    onToast(copied ? "Subagent yanıtı kopyalandı" : "Yanıt kopyalanamadı", copied ? "success" : "error");
  }

  const effectiveSnapshot = activeSnapshot || (activeSummary ? ({ ...activeSummary, messages: [], activities: [] } as WebSubagentSnapshot) : undefined);
  const durationMs = effectiveSnapshot
    ? Math.max(0, (effectiveSnapshot.completedAt || now) - effectiveSnapshot.startedAt)
    : 0;
  const modelLabel = effectiveSnapshot?.model?.name || effectiveSnapshot?.model?.id || effectiveSnapshot?.type || "Ajan";
  const runAssistantIndex = displayedMessages.findIndex((message) =>
    message?.role === "assistant"
    && Boolean(visibleMessageText(message))
    && Number(message?.timestamp || 0) >= Number(effectiveSnapshot?.startedAt || 0) - 100,
  );
  const runMeta = effectiveSnapshot ? (
    <AgentRunMeta snapshot={effectiveSnapshot} active={active} durationMs={durationMs} />
  ) : null;

  return (
    <section className={styles.panel} data-testid="subagent-workspace" aria-label="Subagent çalışma alanı">
      <DockPanelTabPortal
        kind="subagents"
        tabs={openAgentIds.flatMap((id) => {
          const agent = agents.find((entry) => entry.id === id);
          return agent ? [{ id, label: agent.name, busy: isActiveStatus(agent.status) }] : [];
        })}
        activeId={activeAgentId}
        emptyLabel="Alt ajanlar"
        onSelect={activateAgent}
        onClose={closeAgentTab}
      />

      <div className={styles.workspace}>
        <div className={styles.workspaceActions}>
          <div className={styles.createWrap} ref={createWrapRef}>
            <button
              type="button"
              className={styles.createAgentButton}
              aria-label="Yeni subagent oluştur"
              aria-expanded={createOpen}
              onClick={() => {
                setCreateOpen((open) => !open);
                requestAnimationFrame(() => createTaskRef.current?.focus());
              }}
            >
              <Bot aria-hidden="true" /> Yeni subagent
            </button>
            {createOpen ? (
              <form className={styles.createPopover} aria-label="Yeni subagent oluştur" onSubmit={(event) => void createAgent(event)}>
                <div className={styles.createHead}>
                  <div><strong>Yeni subagent</strong><small>Ana sohbet değişmeden arka planda çalışır.</small></div>
                  <button type="button" aria-label="Oluşturma formunu kapat" onClick={() => setCreateOpen(false)}><X aria-hidden="true" /></button>
                </div>
                <label>
                  <span>Görev</span>
                  <textarea ref={createTaskRef} rows={4} value={createTask} onChange={(event) => setCreateTask(event.currentTarget.value)} placeholder="Ajanın tamamlayacağı sınırlı görevi yazın…" />
                </label>
                <div className={styles.createGrid}>
                  <label>
                    <span>Rol</span>
                    <select value={createType} onChange={(event) => setCreateType(event.currentTarget.value)}>
                      {agentTypes.map((type) => <option value={type.id} key={type.id}>{type.label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>İsim <em>isteğe bağlı</em></span>
                    <input value={createName} maxLength={48} onChange={(event) => setCreateName(event.currentTarget.value)} placeholder="Otomatik" />
                  </label>
                </div>
                <label className={styles.choiceRow}>
                  <input type="checkbox" checked={createIsolation === "worktree"} onChange={(event) => setCreateIsolation(event.currentTarget.checked ? "worktree" : "none")} />
                  <span><strong>İzole worktree</strong><small>Kod değişikliklerini ayrı branch’te tutar.</small></span>
                </label>
                <label className={styles.choiceRow}>
                  <input type="checkbox" checked={createForkContext} onChange={(event) => setCreateForkContext(event.currentTarget.checked)} />
                  <span><strong>Ana sohbet bağlamını aktar</strong><small>Mevcut konuşma yalnız arka plan bağlamı olur.</small></span>
                </label>
                <div className={styles.createActions}>
                  <button type="button" onClick={onOpenAgents}>Ajanları yönet</button>
                  <button type="submit" className={styles.createPrimary} disabled={!createTask.trim() || creating}>{creating ? "Başlatılıyor…" : "Ajanı başlat"}</button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
        {!available && !loading ? (
          <div className={styles.unavailable}>
            <Bot aria-hidden="true" />
            <strong>Subagent çalışma zamanı hazır değil</strong>
            <p>Quake Subagents eklentisinin bu sohbet için etkin olduğundan emin olun.</p>
          </div>
        ) : !effectiveSnapshot && !loading ? (
          <div className={styles.empty}>
            <span><Bot aria-hidden="true" /></span>
            <h2>Henüz subagent yok</h2>
            <p>Yeni subagent düğmesiyle bağımsız bir alt ajan başlatın.</p>
            <button type="button" onClick={() => { setCreateOpen(true); requestAnimationFrame(() => createTaskRef.current?.focus()); }}>Yeni subagent</button>
          </div>
        ) : (
          <div className={styles.scroll} ref={scrollRef} onScroll={onThreadScroll}>
            <div className={styles.thread} aria-live="polite">
              {displayedMessages.map((message, index) => {
                if (message?.role !== "user" && message?.role !== "assistant") return null;
                const text = visibleMessageText(message);
                if (!text) return null;
                const key = String(message.id || message.messageId || `${message.role}-${message.timestamp || index}-${index}`);
                if (message.role === "user") {
                  return <article className={styles.userMessage} key={key}><p>{text}</p></article>;
                }
                return (
                  <React.Fragment key={key}>
                    {index === runAssistantIndex ? runMeta : null}
                    <article className={styles.assistantMessage}>
                      <div className={styles.assistantBody}><MarkdownContent content={text} isStreaming={false} onOpenFile={onOpenFile} /></div>
                      <div className={styles.messageActions}>
                        <button type="button" aria-label="Yanıtı kopyala" title="Yanıtı kopyala" onClick={() => void copyResponse(text)}><Copy aria-hidden="true" /></button>
                      </div>
                    </article>
                  </React.Fragment>
                );
              })}

              {runAssistantIndex < 0 ? runMeta : null}

              {active ? (
                <article className={styles.assistantMessage} data-streaming="true">
                  <LiveAgentActivity activities={liveActivities} />
                  {streamingText ? (
                    <div className={styles.assistantBody}><MarkdownContent content={streamingText} isStreaming animated adaptiveSignalTrail onOpenFile={onOpenFile} /></div>
                  ) : liveActivities.length === 0 ? (
                    <div className={styles.thinking} aria-label="Subagent düşünüyor"><i /><i /><i /></div>
                  ) : null}
                </article>
              ) : null}
              {effectiveSnapshot?.error ? <div className={styles.errorNotice}>{effectiveSnapshot.error}</div> : null}
              <div ref={endRef} className={styles.endAnchor} />
            </div>
          </div>
        )}

        <div className={styles.composerFade} aria-hidden="true" />
        <DockConversationComposer
          ref={textareaRef}
          value={draft}
          ariaLabel="Subagent mesajı"
          placeholder={active ? "Çalışan subagent’a yönlendirme gönder…" : "Subagent’a yeni bir görev sor…"}
          modelLabel={modelLabel}
          modelTitle={effectiveSnapshot?.model ? `${effectiveSnapshot.model.provider}/${effectiveSnapshot.model.id}` : effectiveSnapshot?.type}
          effortLabel={thinkingLabel(effectiveSnapshot?.thinkingLevel)}
          effortLevel={effectiveSnapshot?.thinkingLevel}
          busy={active}
          disabled={!activeAgentId}
          sendLabel="Subagent mesajını gönder"
          stopLabel="Subagent’ı durdur"
          onChange={(value) => setDrafts((current) => ({ ...current, [activeAgentId]: value }))}
          onSubmit={() => submitMessage()}
          onAbort={abortActiveAgent}
          onOpenFiles={onOpenFiles}
        />
      </div>
    </section>
  );
}
