import { create } from "zustand";

type AnyRecord = Record<string, any>;

export interface ToolCardImage {
  data: string;
  mimeType: string;
}

export interface ToolCardState {
  id: string;
  toolName: string;
  status: string;
  args?: unknown;
  output?: string;
  images?: ToolCardImage[];
  details?: unknown;
  turnId?: number;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  updatedAt?: number;
}

export interface ToastState {
  id: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  actionLabel?: string;
  action?: () => void;
}

/** Bottom-right corporate status chip (provider connect, etc.) — not a toast. */
export interface StatusNotice {
  id: string;
  kind: "provider_connected" | "provider_disconnected" | "provider_pending" | "provider_error" | "info";
  title: string;
  subtitle?: string;
  logoUrl?: string;
  providerId?: string;
  durationMs?: number;
}

interface AppState {
  config?: AnyRecord;
  runtimeSettings?: AnyRecord;
  state?: AnyRecord;
  streamingMessage?: AnyRecord;
  messages: AnyRecord[];
  visibleMessageCount: number;
  sessions: AnyRecord[];
  models: AnyRecord[];
  commands: AnyRecord[];
  files: AnyRecord[];
  tools: Record<string, ToolCardState>;
  widgets: Record<string, string[]>;
  sidebars: Record<string, string[]>;
  statuses: Record<string, string>;
  toasts: ToastState[];
  statusNotice?: StatusNotice;
  set: (patch: Partial<AppState>) => void;
  addMessage: (message: AnyRecord) => void;
  upsertTool: (id: string, patch: Partial<ToolCardState>) => void;
  setWidget: (key: string, lines?: string[]) => void;
  setSidebar: (key: string, lines?: string[]) => void;
  setStatus: (key: string, text?: string) => void;
  setStreamingMessage: (message?: AnyRecord) => void;
  resetSessionSurface: () => void;
  showToast: (message: string, type?: ToastState["type"], options?: Pick<ToastState, "actionLabel" | "action">) => string;
  dismissToast: (id: string) => void;
  showStatusNotice: (notice: Omit<StatusNotice, "id"> & { id?: string }) => string;
  dismissStatusNotice: (id?: string) => void;
}

const MAX_MESSAGES = 5_000;
const MAX_TOOLS = 5_000;
const DEDUPE_SCAN_LIMIT = MAX_MESSAGES * 2;
const MESSAGE_IDENTITY_TEXT_LIMIT = 1_200;
const MAX_TOOL_OUTPUT_CHARS = 120_000;
const TOOL_OUTPUT_HEAD_CHARS = 24_000;
const MAX_TOASTS = 6;
let statusNoticeTimer: number | undefined;

type MessageNormalization = { messages: AnyRecord[]; visibleMessageCount: number };

function compactIdentityText(value: string, limit = MESSAGE_IDENTITY_TEXT_LIMIT): string {
  if (value.length <= limit) return value;
  const edge = Math.floor(limit / 2);
  return `${value.slice(0, edge)}|${value.length}|${value.slice(-edge)}`;
}

function messagePartText(part: AnyRecord): string {
  if (part?.type === "thinking" || part?.type === "reasoning") return part.type;
  return String(part?.text || part?.name || part?.type || "");
}

function messageText(message: AnyRecord): string {
  if (typeof message?.content === "string") return compactIdentityText(message.content);
  if (!Array.isArray(message?.content)) return "";
  const parts: string[] = [];
  let size = 0;
  for (const part of message.content) {
    const text = messagePartText(part);
    if (!text) continue;
    parts.push(text);
    size += text.length + 1;
    if (size >= MESSAGE_IDENTITY_TEXT_LIMIT) break;
  }
  return compactIdentityText(`${parts.join("\n")}|parts:${message.content.length}`);
}

/** Plain user-visible text for optimistic↔real dedupe (no |parts:N suffix). */
function plainMessageText(message: AnyRecord): string {
  if (typeof message?.displayContent === "string") return message.displayContent.trim();
  if (typeof message?.content === "string") return message.content.trim();
  if (!Array.isArray(message?.content)) return "";
  const parts: string[] = [];
  for (const part of message.content) {
    if (part?.type === "text" && part.text) parts.push(String(part.text));
    else if (typeof part?.text === "string" && part?.type !== "thinking" && part?.type !== "reasoning") {
      parts.push(part.text);
    }
  }
  return parts.join("\n").trim();
}

function messageIdentity(message: AnyRecord): string {
  const explicit = message?.id || message?.messageId || message?.toolCallId;
  if (explicit) return `${message?.role || ""}|${String(explicit)}|${message?.timestamp || ""}`;
  return `${message?.role || ""}|${message?.timestamp || ""}|${messageText(message)}`;
}

function normalizeMessages(messages: AnyRecord[], appended?: AnyRecord): MessageNormalization {
  const seen = new Set<string>();
  const next: AnyRecord[] = [];
  const total = messages.length + (appended ? 1 : 0);
  const sourceStart = Math.max(0, total - DEDUPE_SCAN_LIMIT);
  let visibleMessageCount = 0;
  let windowStart = 0;
  let sourceIndex = 0;
  const pushMessage = (message: AnyRecord) => {
    const key = messageIdentity(message);
    if (seen.has(key)) return;
    seen.add(key);
    next.push(message);
    if (message?.role !== "toolResult") visibleMessageCount += 1;
    if (next.length - windowStart > MAX_MESSAGES) {
      if (next[windowStart]?.role !== "toolResult") visibleMessageCount -= 1;
      windowStart += 1;
    }
  };
  for (const message of messages) {
    if (sourceIndex >= sourceStart) pushMessage(message);
    sourceIndex += 1;
  }
  if (appended && sourceIndex >= sourceStart) pushMessage(appended);
  return { messages: windowStart ? next.slice(windowStart) : next, visibleMessageCount };
}

function isActiveToolStatus(status?: string): boolean {
  return status === "queued" || status === "running" || status === "streaming";
}

function toolRecency(tool: ToolCardState): number {
  return tool.updatedAt || tool.endedAt || tool.startedAt || 0;
}

function pruneTools(tools: Record<string, ToolCardState>): Record<string, ToolCardState> {
  let total = 0;
  for (const id in tools) {
    if (!tools[id]) continue;
    total += 1;
    if (total > MAX_TOOLS) break;
  }
  if (total <= MAX_TOOLS) return tools;
  const active: ToolCardState[] = [];
  const settled: ToolCardState[] = [];
  for (const id in tools) {
    const tool = tools[id];
    if (isActiveToolStatus(tool.status)) pushPrunedToolBounded(active, tool, MAX_TOOLS);
    else pushPrunedToolBounded(settled, tool, MAX_TOOLS);
  }
  const keep = active.length >= MAX_TOOLS ? active : [...active, ...settled.slice(0, MAX_TOOLS - active.length)];
  const next: Record<string, ToolCardState> = {};
  for (let index = keep.length - 1; index >= 0; index -= 1) next[keep[index].id] = keep[index];
  return next;
}

function pushPrunedToolBounded(target: ToolCardState[], tool: ToolCardState, limit: number) {
  if (limit <= 0) return;
  const time = toolRecency(tool);
  if (target.length < limit) {
    const index = target.findIndex((entry) => time > toolRecency(entry));
    target.splice(index < 0 ? target.length : index, 0, tool);
    return;
  }
  if (time <= toolRecency(target[target.length - 1])) return;
  const index = target.findIndex((entry) => time > toolRecency(entry));
  target.splice(index < 0 ? target.length : index, 0, tool);
  target.length = limit;
}

function compactToolOutput(value: string): string {
  if (value.length <= MAX_TOOL_OUTPUT_CHARS) return value;
  const markerFor = (removed: number) => `\n… çıktı tarayıcıda kısaltıldı: ${removed.toLocaleString("tr-TR")} karakter gizlendi; son bölüm korunuyor …\n`;
  const initialMarker = markerFor(value.length - TOOL_OUTPUT_HEAD_CHARS);
  let tailLength = Math.max(0, MAX_TOOL_OUTPUT_CHARS - TOOL_OUTPUT_HEAD_CHARS - initialMarker.length);
  let removed = Math.max(0, value.length - TOOL_OUTPUT_HEAD_CHARS - tailLength);
  let marker = markerFor(removed);
  tailLength = Math.max(0, MAX_TOOL_OUTPUT_CHARS - TOOL_OUTPUT_HEAD_CHARS - marker.length);
  removed = Math.max(0, value.length - TOOL_OUTPUT_HEAD_CHARS - tailLength);
  marker = markerFor(removed);
  const next = `${value.slice(0, TOOL_OUTPUT_HEAD_CHARS)}${marker}${value.slice(-tailLength)}`;
  return next.length > MAX_TOOL_OUTPUT_CHARS ? next.slice(0, MAX_TOOL_OUTPUT_CHARS) : next;
}

export const useAppStore = create<AppState>((set) => ({
  streamingMessage: undefined,
  messages: [],
  visibleMessageCount: 0,
  sessions: [],
  models: [],
  commands: [],
  files: [],
  tools: {},
  widgets: {},
  sidebars: {},
  statuses: {},
  toasts: [],
  statusNotice: undefined,
  set: (patch) => set((state) => {
    const normalized = patch.messages ? normalizeMessages(patch.messages) : undefined;
    return { ...patch, messages: normalized?.messages ?? state.messages, visibleMessageCount: normalized?.visibleMessageCount ?? state.visibleMessageCount };
  }),
  addMessage: (message) =>
    set((state) => {
      let base = state.messages;
      // Replace local optimistic user bubble when the real user message arrives (avoid duplicates).
      // Match on plain text — messageText() appends "|parts:N" for array content and never equaled string optimistics.
      if (message?.role === "user" && !message.__localOptimistic) {
        const incoming = plainMessageText(message);
        if (incoming) {
          base = base.filter((m) => {
            if (!(m?.__localOptimistic && m?.role === "user")) return true;
            const local = plainMessageText(m);
            return local !== incoming && !incoming.startsWith(local) && !local.startsWith(incoming);
          });
        } else {
          // No text (image-only etc.) — drop trailing optimistic user bubbles.
          base = base.filter((m) => !(m?.__localOptimistic && m?.role === "user"));
        }
      }
      const normalized = normalizeMessages(base, message);
      return { messages: normalized.messages, visibleMessageCount: normalized.visibleMessageCount };
    }),
  upsertTool: (id, patch) =>
    set((state) => {
      const now = Date.now();
      const current = state.tools[id] || { id, toolName: patch.toolName || "tool", status: "queued" };
      const startedAt = patch.startedAt ?? current.startedAt ?? (patch.status === "running" ? now : undefined);
      const endedAt = patch.endedAt ?? current.endedAt ?? (["done", "error"].includes(String(patch.status)) ? now : undefined);
      const durationMs = patch.durationMs ?? (startedAt && endedAt ? Math.max(0, endedAt - startedAt) : current.durationMs);
      const next = { ...current, ...patch, startedAt, endedAt, durationMs, updatedAt: now };
      if (next.output) next.output = compactToolOutput(next.output);
      return { tools: pruneTools({ ...state.tools, [id]: next }) };
    }),
  setWidget: (key, lines) =>
    set((state) => {
      const widgets = { ...state.widgets };
      if (Array.isArray(lines) && lines.length > 0) widgets[key] = lines;
      else delete widgets[key];
      return { widgets };
    }),
  setSidebar: (key, lines) =>
    set((state) => {
      const sidebars = { ...state.sidebars };
      if (Array.isArray(lines) && lines.length > 0) sidebars[key] = lines;
      else delete sidebars[key];
      return { sidebars };
    }),
  setStatus: (key, text) =>
    set((state) => {
      const statuses = { ...state.statuses };
      if (text) statuses[key] = text;
      else delete statuses[key];
      return { statuses };
    }),
  setStreamingMessage: (message) => set({ streamingMessage: message }),
  resetSessionSurface: () => set({
    state: undefined,
    streamingMessage: undefined,
    messages: [],
    visibleMessageCount: 0,
    tools: {},
    widgets: {},
    sidebars: {},
    statuses: {},
  }),
  // Top-right toast UI removed — keep API as no-op so call sites stay safe.
  showToast: (_message, _type = "info", _options) => {
    return `${Date.now()}-noop`;
  },
  dismissToast: (_id) => {},
  showStatusNotice: (notice) => {
    const id = notice.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const duration = notice.durationMs ?? (notice.kind === "provider_error" ? 7000 : 4200);
    if (statusNoticeTimer !== undefined) {
      window.clearTimeout(statusNoticeTimer);
      statusNoticeTimer = undefined;
    }
    set({
      statusNotice: {
        id,
        kind: notice.kind,
        title: notice.title,
        subtitle: notice.subtitle,
        logoUrl: notice.logoUrl,
        providerId: notice.providerId,
        durationMs: duration,
      },
    });
    if (duration > 0) {
      statusNoticeTimer = window.setTimeout(() => {
        set((state) => (state.statusNotice?.id === id ? { statusNotice: undefined } : state));
        statusNoticeTimer = undefined;
      }, duration);
    }
    return id;
  },
  dismissStatusNotice: (id) =>
    set((state) => {
      if (!state.statusNotice) return state;
      if (id && state.statusNotice.id !== id) return state;
      if (statusNoticeTimer !== undefined) {
        window.clearTimeout(statusNoticeTimer);
        statusNoticeTimer = undefined;
      }
      return { statusNotice: undefined };
    }),
}));
