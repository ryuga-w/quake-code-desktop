import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { createQueuedUserMessage, toPromptImages } from "../../lib/client-ids";
import { useAppStore, type ToastState } from "../../state/app-store";
import type { ComposerImage, QueuedUserMessage } from "../../types";

/**
 * Dependencies App must pass so queue/send actions can run without closing
 * over App internals. Live flags (planEnabled) are current-render values;
 * turn/streaming helpers and setters are injected.
 */
export interface ComposerQueueDeps {
  sendCommand: (command: any) => Promise<any>;
  showToast: (
    message: string,
    type?: ToastState["type"],
    options?: Pick<ToastState, "actionLabel" | "action">,
  ) => string;
  ensureAgentTurn: () => number;
  clearLocalStreamingState: () => void;
  scheduleRefreshSessions: (delayMs?: number) => void;
  patchSessionState: (patch: Record<string, unknown>) => void;
  addStoreMessage: (message: any) => void;
  setStreamingStoreMessage: (message: any) => void;
  setStore: (partial: any) => void;

  /** Live conversation mode flag (current render). */
  planEnabled: boolean;

  currentTurnRef: MutableRefObject<number>;
  promptRef: RefObject<HTMLTextAreaElement | null>;

  setUserMessageQueue: Dispatch<SetStateAction<QueuedUserMessage[]>>;
  setTimelineScrollRequest: Dispatch<SetStateAction<number>>;
  setSentImagePreviews: Dispatch<SetStateAction<Record<string, ComposerImage[]>>>;
  /** Optional draft helpers used by editQueuedUserMessage. */
  setPromptDraft: (next: SetStateAction<string>) => void;
  setComposerImagesDraft: (next: SetStateAction<ComposerImage[]>) => void;
}

/**
 * Local composer follow-up queue (not Codex default).
 * Mid-turn input is always steer; queue rows are only for UI "Bekliyor" items.
 */
export function useComposerQueue(deps: ComposerQueueDeps) {
  const {
    sendCommand,
    showToast,
    ensureAgentTurn,
    clearLocalStreamingState,
    scheduleRefreshSessions,
    patchSessionState,
    addStoreMessage,
    setStreamingStoreMessage,
    setStore,
    planEnabled,
    currentTurnRef,
    promptRef,
    setUserMessageQueue,
    setTimelineScrollRequest,
    setSentImagePreviews,
    setPromptDraft,
    setComposerImagesDraft,
  } = deps;

  function queueUserPrompt(message: string, images: ComposerImage[]) {
    const item = createQueuedUserMessage(message, images);
    let nextCount = 1;
    setUserMessageQueue((prev) => {
      const next = [...prev, item];
      nextCount = next.length;
      return next;
    });
    setTimelineScrollRequest((value) => value + 1);
    showToast(
      nextCount === 1
        ? "Bekliyor (follow-up) — tur bitince gider"
        : `Bekliyor (${nextCount}) — tur bitince sırayla`,
      "info",
      {
        actionLabel: "Steer (hemen)",
        action: () => {
          void routeQueuedUserMessage(item);
        },
      },
    );
  }

  function clearQueuedUserMessages() {
    setUserMessageQueue([]);
  }

  function removeQueuedUserMessage(id: string) {
    setUserMessageQueue((prev) => prev.filter((item) => item.id !== id));
  }

  /** Put queued text back into the composer for editing (does not send). */
  function editQueuedUserMessage(item: QueuedUserMessage) {
    removeQueuedUserMessage(item.id);
    setPromptDraft(item.message);
    setComposerImagesDraft(item.images);
    requestAnimationFrame(() => promptRef.current?.focus());
  }

  /**
   * Send a queued message to the agent immediately.
   * If a turn is active → steer (interrupt/redirect now), not "paste into chat".
   */
  async function routeQueuedUserMessage(item: QueuedUserMessage) {
    // Capture before optimistic lock — otherwise we always look "busy".
    const wasBusy = Boolean(
      useAppStore.getState().state?.isStreaming || useAppStore.getState().streamingMessage,
    );
    removeQueuedUserMessage(item.id);
    setTimelineScrollRequest((value) => value + 1);
    patchSessionState({ isStreaming: true });
    const turnId = wasBusy ? (currentTurnRef.current || 1) : ensureAgentTurn();
    if (!wasBusy) {
      setStreamingStoreMessage({
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        turnId,
        __localOptimistic: true,
      });
    }
    if (item.images.length) {
      setSentImagePreviews((current) => ({ ...current, [item.message]: item.images }));
    }
    addStoreMessage({
      role: "user",
      content: item.message,
      timestamp: Date.now(),
      turnId,
      __localOptimistic: true,
    });
    try {
      await sendCommand({
        type: "prompt",
        message: item.message,
        images: toPromptImages(item.images),
        conversationMode: planEnabled ? "plan" : "execute",
        // "Yönlendir" = deliver to agent now (steer), not dump into the draft box.
        ...(wasBusy ? { streamingBehavior: "steer" as const } : {}),
      });
      scheduleRefreshSessions(400);
    } catch (error: any) {
      clearLocalStreamingState();
      const store = useAppStore.getState();
      const kept = store.messages.filter((m: any) => !(m?.__localOptimistic && m?.role === "user"));
      if (kept.length !== store.messages.length) setStore({ messages: kept });
      // Put back in queue so the user can retry.
      setUserMessageQueue((prev) => [item, ...prev.filter((q) => q.id !== item.id)]);
      showToast(`Yönlendirme başarısız: ${error?.message || "bilinmeyen hata"}`, "error");
    }
  }

  function sendQueuedUserMessage(item: QueuedUserMessage) {
    const wasBusy = Boolean(
      useAppStore.getState().state?.isStreaming || useAppStore.getState().streamingMessage,
    );
    const turnId = wasBusy ? (currentTurnRef.current || 1) : ensureAgentTurn();
    if (item.images.length) {
      setSentImagePreviews((current) => ({ ...current, [item.message]: item.images }));
    }
    addStoreMessage({
      role: "user",
      content: item.message,
      timestamp: Date.now(),
      turnId,
      __localOptimistic: true,
    });
    patchSessionState({ isStreaming: true });
    return sendCommand({
      type: "prompt",
      message: item.message,
      images: toPromptImages(item.images),
      conversationMode: planEnabled ? "plan" : "execute",
      // Auto-flush after a turn ends → follow-up only if still mid-turn (rare race).
      ...(wasBusy ? { streamingBehavior: "followUp" as const } : {}),
    });
  }

  return {
    queueUserPrompt,
    clearQueuedUserMessages,
    removeQueuedUserMessage,
    editQueuedUserMessage,
    routeQueuedUserMessage,
    sendQueuedUserMessage,
  };
}

export type UseComposerQueueReturn = ReturnType<typeof useComposerQueue>;
