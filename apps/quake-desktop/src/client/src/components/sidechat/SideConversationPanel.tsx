import React from "react";
import {
  Check,
  CirclePlus,
  FolderCode,
  GitFork,
  ListFilter,
  Plus,
} from "lucide-react";
import type {
  WebSideConversationSnapshot,
  WebSideConversationSummary,
} from "../../../../shared/protocol";
import { apiGet, apiPost } from "../../lib/api";
import { formatComposerModelLabel } from "../../lib/format-utils";
import { textFromMessage } from "../../lib/render";
import { DockConversationComposer, type DockConversationModel } from "../composer/DockConversationComposer";
import { DockPanelTabPortal } from "../shell/DockPanelTabPortal";
import { ConversationTimeline } from "../timeline/Timeline";
import styles from "./SideConversationPanel.module.css";

type ToastType = "info" | "success" | "warning" | "error";

type SideConversationPanelProps = {
  parentSessionPath?: string;
  workspaceName: string;
  currentModelValue: string;
  currentModelLabel: string;
  currentThinking: string;
  models: DockConversationModel[];
  onOpenFiles: () => void;
  onOpenFile: (path: string) => void;
  onToast: (message: string, type?: ToastType) => string | void;
};

type PendingMessage = {
  id: string;
  text: string;
  timestamp: number;
};

const EMPTY_MESSAGES: any[] = [];
const NEW_CONVERSATION_DRAFT = "__new-side-conversation__";

function conversationUrl(id: string, action?: "prompt" | "abort" | "preferences"): string {
  const base = `/api/side-conversations/${encodeURIComponent(id)}`;
  return action ? `${base}/${action}` : base;
}

function visibleMessageText(message: any): string {
  return textFromMessage(message)
    .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, "")
    .replace(/^\s*\[tool call:[^\]]+]\s*$/gim, "")
    .trim();
}

function titleFromPrompt(prompt: string): string {
  const line = prompt.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) || "Yeni yan sohbet";
  return line.length > 42 ? `${line.slice(0, 39).trimEnd()}…` : line;
}

function thinkingLabel(level: string): string {
  if (level === "off") return "Standart";
  if (level === "minimal") return "Minimal";
  if (level === "low") return "Düşük";
  if (level === "high") return "Yüksek";
  if (level === "xhigh") return "Çok yüksek";
  if (level === "max") return "Maksimum";
  return "Orta";
}

export function SideConversationPanel({
  parentSessionPath,
  workspaceName,
  currentModelValue,
  currentModelLabel,
  currentThinking,
  models,
  onOpenFiles,
  onOpenFile,
  onToast,
}: SideConversationPanelProps) {
  const [conversations, setConversations] = React.useState<WebSideConversationSummary[]>([]);
  const [openConversationIds, setOpenConversationIds] = React.useState<string[]>([]);
  const [activeConversationId, setActiveConversationId] = React.useState("");
  const [snapshots, setSnapshots] = React.useState<Record<string, WebSideConversationSnapshot>>({});
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [pendingMessages, setPendingMessages] = React.useState<Record<string, PendingMessage[]>>({});
  const [initializing, setInitializing] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [preferencesPending, setPreferencesPending] = React.useState(false);
  const creationPromiseRef = React.useRef<Promise<WebSideConversationSnapshot | undefined> | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const activeSnapshot = activeConversationId ? snapshots[activeConversationId] : undefined;
  const draftKey = activeConversationId || NEW_CONVERSATION_DRAFT;
  const draft = drafts[draftKey] || "";
  const activePendingMessages = activeConversationId ? pendingMessages[activeConversationId] || [] : [];
  const persistedMessages = activeSnapshot?.messages || EMPTY_MESSAGES;
  const displayedMessages = React.useMemo(() => {
    if (!activePendingMessages.length) return persistedMessages;
    const unresolved = activePendingMessages.filter((pending) => !persistedMessages.some((message) =>
      message?.role === "user" && visibleMessageText(message) === pending.text,
    ));
    return [
      ...persistedMessages,
      ...unresolved.map((pending) => ({
        id: pending.id,
        role: "user",
        content: pending.text,
        timestamp: pending.timestamp,
        __sideChatOptimistic: true,
      })),
    ];
  }, [activePendingMessages, persistedMessages]);
  const timelineStreamingMessage = activeSnapshot?.streamingMessage
    || (activeSnapshot?.isStreaming
      ? {
          role: "assistant",
          content: [{ type: "thinking", thinking: "Düşünüyor" }],
          timestamp: activeSnapshot.updatedAt,
        }
      : undefined);

  const updateConversationSummary = React.useCallback((snapshot: WebSideConversationSnapshot) => {
    setSnapshots((current) => ({ ...current, [snapshot.id]: snapshot }));
    setConversations((current) => {
      const summary: WebSideConversationSummary = snapshot;
      const next = current.some((entry) => entry.id === snapshot.id)
        ? current.map((entry) => entry.id === snapshot.id ? summary : entry)
        : [summary, ...current];
      return next.sort((left, right) => right.updatedAt - left.updatedAt);
    });
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

  const moveStagedDraft = React.useCallback((conversationId: string) => {
    setDrafts((current) => {
      const staged = current[NEW_CONVERSATION_DRAFT];
      if (!staged) return current;
      const next = { ...current, [conversationId]: current[conversationId] || staged };
      delete next[NEW_CONVERSATION_DRAFT];
      return next;
    });
  }, []);

  const createConversation = React.useCallback(() => {
    if (creationPromiseRef.current) return creationPromiseRef.current;
    setCreating(true);
    const request = (async () => {
      try {
        const response = await apiPost<{ conversation: WebSideConversationSnapshot }>(
          "/api/side-conversations",
          { parentSessionPath },
        );
        const conversation = response.conversation;
        updateConversationSummary(conversation);
        setOpenConversationIds((current) => [...current.filter((id) => id !== conversation.id), conversation.id]);
        setActiveConversationId(conversation.id);
        moveStagedDraft(conversation.id);
        requestAnimationFrame(() => textareaRef.current?.focus());
        return conversation;
      } catch (error: any) {
        onToast(`Yan sohbet açılamadı: ${error?.message || "bilinmeyen hata"}`, "error");
        return undefined;
      } finally {
        creationPromiseRef.current = null;
        setCreating(false);
        setInitializing(false);
      }
    })();
    creationPromiseRef.current = request;
    return request;
  }, [moveStagedDraft, onToast, parentSessionPath, updateConversationSummary]);

  React.useEffect(() => {
    let cancelled = false;
    const query = parentSessionPath ? `?parentSession=${encodeURIComponent(parentSessionPath)}` : "";
    void apiGet<{ conversations: WebSideConversationSummary[] }>(`/api/side-conversations${query}`)
      .then(async ({ conversations: rows }) => {
        if (cancelled) return;
        setConversations(rows);
        const initial = rows.find((conversation) => conversation.contextInherited || conversation.messageCount > 0);
        if (initial) {
          setOpenConversationIds([initial.id]);
          setActiveConversationId(initial.id);
          moveStagedDraft(initial.id);
        }
        setInitializing(false);
      })
      .catch((error: any) => {
        if (cancelled) return;
        setInitializing(false);
        onToast(`Yan sohbetler yüklenemedi: ${error?.message || "bilinmeyen hata"}`, "error");
      });
    return () => {
      cancelled = true;
    };
  }, [moveStagedDraft, onToast, parentSessionPath]);

  React.useEffect(() => {
    if (!activeConversationId) return;
    let cancelled = false;
    let errorNotified = false;
    let timer: number | undefined;

    const refresh = async () => {
      try {
        const response = await apiGet<{ conversation: WebSideConversationSnapshot }>(
          conversationUrl(activeConversationId),
        );
        if (cancelled) return;
        errorNotified = false;
        updateConversationSummary(response.conversation);
        timer = window.setTimeout(refresh, response.conversation.isStreaming ? 420 : 1_600);
      } catch (error: any) {
        if (cancelled) return;
        timer = window.setTimeout(refresh, 2_500);
        if (!errorNotified) {
          errorNotified = true;
          onToast(`Yan sohbet yüklenemedi: ${error?.message || "bilinmeyen hata"}`, "error");
        }
      }
    };

    void refresh();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeConversationId, onToast, updateConversationSummary]);

  function activateConversation(conversation: WebSideConversationSummary) {
    setOpenConversationIds((current) => current.includes(conversation.id) ? current : [...current, conversation.id]);
    setActiveConversationId(conversation.id);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function closeConversationTab(id: string) {
    setOpenConversationIds((current) => {
      const index = current.indexOf(id);
      const next = current.filter((entry) => entry !== id);
      if (activeConversationId === id) {
        const replacement = next[Math.min(index, Math.max(0, next.length - 1))] || "";
        setActiveConversationId(replacement);
      }
      return next;
    });
  }

  async function submitMessage() {
    const message = draft.trim();
    if (!message) return;
    let conversationId = activeConversationId;
    if (!conversationId) {
      const created = await createConversation();
      conversationId = created?.id || "";
    }
    if (!conversationId) return;

    const pending: PendingMessage = {
      id: `side-pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: message,
      timestamp: Date.now(),
    };
    setDrafts((current) => {
      const next = { ...current, [conversationId]: "" };
      delete next[NEW_CONVERSATION_DRAFT];
      return next;
    });
    setPendingMessages((current) => ({
      ...current,
      [conversationId]: [...(current[conversationId] || []), pending],
    }));
    setSnapshots((current) => current[conversationId]
      ? { ...current, [conversationId]: { ...current[conversationId], isStreaming: true } }
      : current);
    setConversations((current) => current.map((entry) => entry.id === conversationId
      ? { ...entry, title: entry.messageCount ? entry.title : titleFromPrompt(message), isStreaming: true, updatedAt: Date.now() }
      : entry));
    try {
      await apiPost(conversationUrl(conversationId, "prompt"), { message });
    } catch (error: any) {
      setPendingMessages((current) => ({
        ...current,
        [conversationId]: (current[conversationId] || []).filter((entry) => entry.id !== pending.id),
      }));
      setDrafts((current) => ({ ...current, [conversationId]: message }));
      onToast(`Mesaj gönderilemedi: ${error?.message || "bilinmeyen hata"}`, "error");
    }
  }

  async function updatePreferences(preferences: { provider?: string; modelId?: string; thinkingLevel?: string }) {
    if (preferencesPending) return;
    let conversationId = activeConversationId;
    if (!conversationId) {
      const created = await createConversation();
      conversationId = created?.id || "";
    }
    if (!conversationId) return;

    setPreferencesPending(true);
    try {
      const response = await apiPost<{ conversation: WebSideConversationSnapshot }>(
        conversationUrl(conversationId, "preferences"),
        preferences,
      );
      updateConversationSummary(response.conversation);
    } catch (error: any) {
      onToast(`Yan görev tercihleri değiştirilemedi: ${error?.message || "bilinmeyen hata"}`, "error");
    } finally {
      setPreferencesPending(false);
    }
  }

  async function abortConversation() {
    if (!activeConversationId) return;
    try {
      await apiPost(conversationUrl(activeConversationId, "abort"), {});
      onToast("Yan sohbet görevi durduruldu", "info");
    } catch (error: any) {
      onToast(`Yan sohbet durdurulamadı: ${error?.message || "bilinmeyen hata"}`, "error");
    }
  }

  const sideModelValue = activeSnapshot?.model
    ? `${activeSnapshot.model.provider}/${activeSnapshot.model.id}`
    : currentModelValue;
  const selectedModel = models.find((model) => `${model.provider}/${model.id}` === sideModelValue);
  const modelLabel = activeSnapshot?.model?.name
    || selectedModel?.name
    || (sideModelValue ? formatComposerModelLabel(sideModelValue) : currentModelLabel || "Model");
  const sideThinking = String(activeSnapshot?.thinkingLevel || currentThinking || "medium");
  const effortLabel = selectedModel?.reasoning === false ? "Standart" : thinkingLabel(sideThinking);
  const hasConversationContent = displayedMessages.some((message) =>
    message?.role === "user" || (message?.role === "assistant" && visibleMessageText(message)),
  );

  return (
    <section className={styles.panel} data-testid="side-conversation-panel" aria-label="Yan sohbet çalışma alanı">
      <DockPanelTabPortal
        kind="sidechat"
        tabs={openConversationIds.flatMap((id) => {
          const conversation = conversations.find((entry) => entry.id === id);
          return conversation ? [{ id, label: conversation.title, busy: conversation.isStreaming }] : [];
        })}
        activeId={activeConversationId}
        emptyLabel="Yan görev"
        onSelect={(id) => {
          const conversation = conversations.find((entry) => entry.id === id);
          if (conversation) activateConversation(conversation);
        }}
        onClose={closeConversationTab}
      />

      <div className={styles.workspace}>
        <div className={styles.workspaceActions}>
          <details className={styles.historyMenu}>
            <summary aria-label="Yan sohbet geçmişini aç" title="Yan sohbet geçmişi">
              <ListFilter aria-hidden="true" />
            </summary>
            <div className={styles.historyPopover} role="menu" aria-label="Yan sohbet geçmişi">
              <div className={styles.historyHeading}>
                <span>Yan sohbetler</span>
                <button type="button" onClick={() => void createConversation()} disabled={creating}>
                  <Plus aria-hidden="true" /> Yeni
                </button>
              </div>
              {conversations.length ? conversations.map((conversation) => (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.historyItem}
                  data-active={conversation.id === activeConversationId}
                  key={conversation.id}
                  onClick={(event) => {
                    activateConversation(conversation);
                    event.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                >
                  <span className={styles.historyIcon}><CirclePlus aria-hidden="true" /></span>
                  <span>
                    <strong>{conversation.title}</strong>
                    <small>{conversation.isStreaming ? "Çalışıyor" : `${conversation.messageCount} mesaj`}</small>
                  </span>
                  {conversation.id === activeConversationId ? <Check aria-hidden="true" /> : null}
                </button>
              )) : <p className={styles.historyEmpty}>Henüz yan sohbet yok.</p>}
            </div>
          </details>
          <button type="button" className={styles.newConversationButton} disabled={creating} onClick={() => void createConversation()}>
            <CirclePlus aria-hidden="true" /> Yeni yan görev
          </button>
        </div>
        <div className={styles.timelineHost}>
          {!hasConversationContent && !activeSnapshot?.isStreaming && !initializing ? (
              <div className={styles.emptyState}>
                <span><CirclePlus aria-hidden="true" /></span>
                <h2>Yan sohbet</h2>
                <p>Ana konuşmayı bölmeden hızlı bir soru sorun veya farklı bir yaklaşımı deneyin.</p>
                <small><FolderCode aria-hidden="true" /> {workspaceName} bağlamına erişebilir</small>
                <small className={styles.contextStatus} data-inherited={activeSnapshot?.contextInherited ? "true" : "false"}>
                  <GitFork aria-hidden="true" />
                  {!activeSnapshot
                    ? "İlk mesajda ana konuşmanın güncel bağlamı aktarılır"
                    : activeSnapshot.contextInherited
                      ? `Oluşturma anındaki ${activeSnapshot.inheritedMessageCount} ana konuşma mesajı bağlamda`
                      : "Bu eski Yan görev ana konuşma geçmişi olmadan oluşturuldu"}
                </small>
              </div>
            ) : (
              <ConversationTimeline
                messages={displayedMessages}
                streamingMessage={timelineStreamingMessage}
                isStreaming={Boolean(activeSnapshot?.isStreaming)}
                conversationKey={`sidechat:${activeConversationId || "new"}`}
                onOpenFile={onOpenFile}
                onToast={onToast}
              />
            )}
        </div>

        <div className={styles.composerFade} aria-hidden="true" />
        <DockConversationComposer
          ref={textareaRef}
          value={draft}
          ariaLabel="Yan sohbet mesajı"
          placeholder={initializing ? "Yan görev hazırlanıyor; yazmaya başlayabilirsiniz…" : "Yan görevde sor…"}
          modelLabel={modelLabel}
          modelTitle={sideModelValue || "Aktif model"}
          currentModelValue={sideModelValue}
          models={models}
          effortLabel={effortLabel}
          effortLevel={sideThinking}
          preferencesPending={preferencesPending}
          busy={Boolean(activeSnapshot?.isStreaming)}
          sendLabel="Yan görev mesajını gönder"
          stopLabel="Yan görev çalışmasını durdur"
          onChange={(value) => setDrafts((current) => ({ ...current, [draftKey]: value }))}
          onSubmit={submitMessage}
          onAbort={abortConversation}
          onOpenFiles={onOpenFiles}
          onSelectModel={(provider, modelId) => updatePreferences({ provider, modelId })}
          onSetThinking={(thinkingLevel) => updatePreferences({ thinkingLevel })}
          formatModelLabel={formatComposerModelLabel}
        />
      </div>
    </section>
  );
}
