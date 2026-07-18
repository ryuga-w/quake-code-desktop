import { randomUUID } from "node:crypto";
import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
  RequestUserInputArgs,
  RequestUserInputResponse,
} from "@mrquake/quakecode-cli";
import type { WebPlanClarificationAnswer, WebPlanClarificationState } from "../shared/protocol.js";
import type { SseHub } from "./sse.js";

const WEB_THEME_FACADE = {
  fg: (_name: string, text: string) => text,
  bg: (_name: string, text: string) => text,
  bold: (text: string) => text,
  dim: (text: string) => text,
  strikethrough: (text: string) => text,
};

export type PendingExtensionResponse = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type PendingExtensionRequest = {
  id: string;
  ownerKey: string;
  method?: string;
  title?: string;
  options?: string[];
  clarification?: WebPlanClarificationState;
};

export class WebExtensionUiBridge {
  private pending = new Map<string, PendingExtensionResponse>();
  private pendingRequests = new Map<string, PendingExtensionRequest>();
  private terminalInputHandlers = new Set<(line: string) => void>();
  private editorText = "";

  constructor(
    private readonly hub: SseHub,
    private readonly onPendingRequestChange?: (ownerKey: string) => boolean | void,
  ) {}

  /** Forward terminal command lines to extension listeners (TUI onTerminalInput parity). */
  notifyTerminalInput(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    for (const handler of this.terminalInputHandlers) {
      try {
        handler(trimmed);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  createContext(ownerKey = "global"): ExtensionUIContext {
    const context: any = {
      select: (title: string, options: string[], opts?: ExtensionUIDialogOptions) =>
        this.dialog(ownerKey, opts, undefined, { method: "select", title, options, timeout: opts?.timeout }),
      confirm: (title: string, message: string, opts?: ExtensionUIDialogOptions) =>
        this.dialog(ownerKey, opts, false, { method: "confirm", title, message, timeout: opts?.timeout }),
      input: (title: string, placeholder?: string, opts?: ExtensionUIDialogOptions) =>
        this.dialog(ownerKey, opts, undefined, { method: "input", title, placeholder, timeout: opts?.timeout }),
      requestUserInput: async (request: RequestUserInputArgs): Promise<RequestUserInputResponse | undefined> => {
        const clarification = requestToClarification(request);
        const result = await this.dialog<any>(
          ownerKey,
          request.autoResolutionMs ? { timeout: request.autoResolutionMs } : undefined,
          undefined,
          {
            method: "requestUserInput",
            title: clarification.title,
            clarification,
          },
        );
        if (!result || typeof result !== "object") return undefined;
        return clarificationResultToResponse(clarification, result.answers);
      },
      planClarification: (clarification: WebPlanClarificationState) =>
        this.dialog(ownerKey, undefined, { status: "skipped" }, {
          method: "planClarification",
          title: clarification.title,
          clarification,
        }),
      notify: (message: string, type?: "info" | "warning" | "error") => {
        this.hub.send({ type: "extension_ui_request", id: randomUUID(), method: "notify", message, notifyType: type });
      },
      onTerminalInput: (handler: (line: string) => void) => {
        this.terminalInputHandlers.add(handler);
        return () => {
          this.terminalInputHandlers.delete(handler);
        };
      },
      setStatus: (key: string, text: string | undefined) => {
        this.hub.send({ type: "extension_ui_request", id: randomUUID(), method: "setStatus", statusKey: key, statusText: text });
      },
      setWorkingMessage: (message?: string) => {
        this.hub.send({ type: "extension_ui_request", id: randomUUID(), method: "setStatus", statusKey: "working", statusText: message });
      },
      setHiddenThinkingLabel: (label?: string) => {
        this.hub.send({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setStatus",
          statusKey: "hidden-thinking",
          statusText: label,
        });
      },
      setWidget: (key: string, content: string[] | undefined, options?: ExtensionWidgetOptions) => {
        if (content === undefined || Array.isArray(content)) {
          this.hub.send({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "setWidget",
            widgetKey: key,
            widgetLines: content as string[] | undefined,
            widgetPlacement: options?.placement,
          });
        }
      },
      setSidebar: (key: string, content: string[] | undefined) => {
        if (content === undefined || Array.isArray(content)) {
          this.hub.send({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "setSidebar",
            sidebarKey: key,
            sidebarLines: content as string[] | undefined,
          });
        }
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title: string) => {
        this.hub.send({ type: "extension_ui_request", id: randomUUID(), method: "setTitle", title });
      },
      custom: async () => undefined as never,
      pasteToEditor: (text: string) => {
        this.editorText = text;
        this.hub.send({ type: "extension_ui_request", id: randomUUID(), method: "set_editor_text", text });
      },
      setEditorText: (text: string) => {
        this.editorText = text;
        this.hub.send({ type: "extension_ui_request", id: randomUUID(), method: "set_editor_text", text });
      },
      getEditorText: () => this.editorText,
      editor: (title: string, prefill?: string) => this.dialog(ownerKey, undefined, undefined, { method: "editor", title, prefill }),
      setEditorComponent: () => {},
      theme: WEB_THEME_FACADE as any,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Tema değiştirme Quake Code web arayüzünde henüz desteklenmiyor" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
    return context as ExtensionUIContext;
  }

  resolveResponse(id: string, response: { value?: unknown; confirmed?: boolean; cancelled?: true }, ownerKey?: string): boolean {
    const request = this.pendingRequests.get(id);
    const pending = this.pending.get(id);
    if (!pending || (ownerKey && request?.ownerKey !== ownerKey)) return false;
    if (response.cancelled) pending.resolve(undefined);
    else if (response.value !== undefined) pending.resolve(response.value);
    else if (response.confirmed !== undefined) pending.resolve(response.confirmed);
    else pending.resolve(undefined);
    return true;
  }

  completeClarification(
    requestId: string,
    clarificationId: string,
    answers: Record<string, WebPlanClarificationAnswer>,
    ownerKey?: string,
  ): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request?.clarification || request.clarification.id !== clarificationId || (ownerKey && request.ownerKey !== ownerKey)) return false;
    const clarification = cloneClarification(request.clarification);
    for (const question of clarification.questions) {
      const answer = answers[question.id];
      if (answer) question.answer = normalizeAnswer(answer);
    }
    clarification.status = "answered";
    clarification.activeQuestionId = undefined;
    return this.resolveResponse(requestId, { value: { status: "answered", clarification, answers: collectAnswers(clarification) } }, ownerKey);
  }

  skipClarification(requestId: string, clarificationId: string, ownerKey?: string): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request?.clarification || request.clarification.id !== clarificationId || (ownerKey && request.ownerKey !== ownerKey)) return false;
    const clarification = cloneClarification(request.clarification);
    clarification.status = "skipped";
    clarification.activeQuestionId = undefined;
    return this.resolveResponse(requestId, { value: { status: "skipped", clarification, answers: collectDefaultAnswers(clarification) } }, ownerKey);
  }

  getPendingRequests(ownerKey?: string): PendingExtensionRequest[] {
    const requests = Array.from(this.pendingRequests.values());
    return ownerKey ? requests.filter((request) => request.ownerKey === ownerKey) : requests;
  }

  clearPendingRequests(ownerKey?: string): void {
    const requestIds = new Set(this.getPendingRequests(ownerKey).map((request) => request.id));
    const pending = Array.from(requestIds).flatMap((id) => {
      const response = this.pending.get(id);
      return response ? [response] : [];
    });
    for (const id of requestIds) {
      this.pending.delete(id);
      this.pendingRequests.delete(id);
    }
    if (requestIds.size > 0) this.onPendingRequestChange?.(ownerKey || "global");
    for (const response of pending) response.resolve({ status: "cancelled", cancelled: true });
  }

  private dialog<T>(ownerKey: string, opts: ExtensionUIDialogOptions | undefined, defaultValue: T, request: Record<string, unknown>): Promise<T> {
    if (opts?.signal?.aborted) return Promise.resolve(defaultValue);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        opts?.signal?.removeEventListener("abort", onAbort);
        const removedResponse = this.pending.delete(id);
        const removedRequest = this.pendingRequests.delete(id);
        if (removedResponse || removedRequest) this.onPendingRequestChange?.(ownerKey);
      };
      const onAbort = () => {
        cleanup();
        resolve(defaultValue);
      };
      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts?.timeout) {
        timeoutId = setTimeout(() => {
          cleanup();
          resolve(defaultValue);
        }, opts.timeout);
      }
      this.pending.set(id, {
        resolve: (value) => {
          cleanup();
          resolve((value === undefined ? defaultValue : value) as T);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      const clarification = normalizeClarificationRequest(request.clarification, id);
      this.pendingRequests.set(id, {
        id,
        ownerKey,
        method: typeof request.method === "string" ? request.method : undefined,
        title: typeof request.title === "string" ? request.title : undefined,
        options: Array.isArray(request.options) ? request.options.filter((option): option is string => typeof option === "string") : undefined,
        clarification,
      });
      // The pending request is authoritative runtime state. Publish it before the
      // direct UI event so every client observes state → notification in one order.
      const ownerIsActive = this.onPendingRequestChange?.(ownerKey);
      if (ownerIsActive !== false) {
        this.hub.send({ type: "extension_ui_request", id, ownerKey, ...(request as any), ...(clarification ? { clarification } : {}) });
      }
    });
  }
}

function requestToClarification(request: RequestUserInputArgs): WebPlanClarificationState {
  return {
    id: `request-user-input-${randomUUID()}`,
    title: request.questions[0]?.header || "Questions",
    status: "pending",
    activeQuestionId: request.questions[0]?.id,
    questions: request.questions.map((question) => ({
      id: question.id,
      label: question.question,
      options: question.options.map((option, index) => ({
        id: `option-${index}`,
        label: option.label,
        description: option.description,
      })),
      recommendedOptionId: question.options.length > 0 ? "option-0" : undefined,
      required: true,
    })),
  };
}

function clarificationResultToResponse(
  clarification: WebPlanClarificationState,
  value: unknown,
): RequestUserInputResponse {
  const answers = value && typeof value === "object"
    ? value as Record<string, WebPlanClarificationAnswer>
    : {};
  return {
    answers: Object.fromEntries(clarification.questions.map((question) => {
      const answer = answers[question.id];
      const option = question.options?.find((candidate) => candidate.id === answer?.optionId);
      const text = answer?.text?.trim() || option?.label || "";
      return [question.id, { answers: text ? [text] : [] }];
    })),
  };
}

function normalizeClarificationRequest(value: unknown, requestId: string): WebPlanClarificationState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<WebPlanClarificationState>;
  if (typeof raw.id !== "string" || !Array.isArray(raw.questions)) return undefined;
  const clarification: WebPlanClarificationState = {
    id: raw.id,
    requestId,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : "Planı netleştirelim",
    status: raw.status === "answered" || raw.status === "skipped" ? raw.status : "pending",
    activeQuestionId: typeof raw.activeQuestionId === "string" ? raw.activeQuestionId : undefined,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    questions: raw.questions
      .filter((question) => question && typeof question === "object" && typeof question.id === "string")
      .map((question) => ({
        id: String(question.id),
        label: String(question.label || "Soru"),
        detail: typeof question.detail === "string" ? question.detail : undefined,
        options: Array.isArray(question.options)
          ? question.options
              .filter((option) => option && typeof option === "object")
              .map((option) => ({
                id: String(option.id || option.label || ""),
                label: String(option.label || option.id || ""),
                description: typeof option.description === "string" ? option.description : undefined,
              }))
              .filter((option) => option.id && option.label)
          : undefined,
        recommendedOptionId: typeof question.recommendedOptionId === "string" ? question.recommendedOptionId : undefined,
        required: question.required !== false,
        answer: question.answer ? normalizeAnswer(question.answer) : undefined,
      })),
  };
  clarification.activeQuestionId = clarification.activeQuestionId || nextActiveQuestionId(clarification);
  return clarification;
}

function cloneClarification(clarification: WebPlanClarificationState): WebPlanClarificationState {
  return JSON.parse(JSON.stringify(clarification)) as WebPlanClarificationState;
}

function normalizeAnswer(answer: WebPlanClarificationAnswer): WebPlanClarificationAnswer {
  return {
    optionId: typeof answer.optionId === "string" && answer.optionId.trim() ? answer.optionId : undefined,
    text: typeof answer.text === "string" && answer.text.trim() ? answer.text.trim() : undefined,
    skipped: answer.skipped === true,
  };
}

function nextActiveQuestionId(clarification: WebPlanClarificationState): string | undefined {
  return clarification.questions.find((question) => question.required !== false && !question.answer)?.id ??
    clarification.questions.find((question) => !question.answer)?.id;
}

function collectAnswers(clarification: WebPlanClarificationState): Record<string, WebPlanClarificationAnswer> {
  return Object.fromEntries(clarification.questions.filter((question) => question.answer).map((question) => [question.id, question.answer!]));
}

function collectDefaultAnswers(clarification: WebPlanClarificationState): Record<string, WebPlanClarificationAnswer> {
  return Object.fromEntries(clarification.questions.map((question) => [
    question.id,
    { optionId: question.recommendedOptionId, skipped: true } satisfies WebPlanClarificationAnswer,
  ]));
}
