import type { ToolCardState } from "./state/app-store";
import type { TimelineVisibleSelection } from "./types";

export const THINKING_OPTIONS = [
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Sınırlı" },
  { value: "medium", label: "Orta" },
  { value: "high", label: "Yüksek" },
  { value: "xhigh", label: "Çok Yüksek" },
  { value: "max", label: "Maksimum" },
] as const;

export const TIMELINE_INITIAL_WINDOW = 120;
export const TIMELINE_WINDOW_STEP = 160;
export const TIMELINE_CANDIDATE_OVERSCAN = 160;
export const TIMELINE_HISTORY_SCAN_LIMIT = 1_400;
export const TIMELINE_HISTORY_CONTEXT_AFTER = 120;
export const MESSAGE_KEY_TEXT_LIMIT = 640;
export const TERMINAL_BUFFER_LIMIT = 200_000;
export const TERMINAL_BUFFER_HEAD = 32_000;
export const TOOL_PANEL_INITIAL_WINDOW = 220;
export const TOOL_PANEL_WINDOW_STEP = 180;
export const CHANGE_TOOL_SCAN_LIMIT = 720;
export const TOOL_SEARCH_TEXT_LIMIT = 4_000;
export const TOOL_SCAN_TEXT_LIMIT = 16_000;
// Akici ama dogal gorunen yazma hizi. ~60fps'de:
//   MIN 3  -> en yavas ~180 char/sn (kisa cevaplarda okunabilir akis)
//   MAX 48 -> en hizli ~2880 char/sn (uzun cevaplarda geri kalmamak icin tavan)
// CATCHUP dusuk tutulursa model hizli chunk atinca yumusakca yetisir.
export const TYPEWRITER_MIN_CHARS_PER_FRAME = 3;
export const TYPEWRITER_MAX_CHARS_PER_FRAME = 48;
export const TYPEWRITER_CATCHUP_FRAMES = 6;
export const EMPTY_TOOL_STATE: Record<string, ToolCardState> = {};
export const EMPTY_TIMELINE_VISIBLE_SELECTION: TimelineVisibleSelection = { messages: [], total: 0, startIndex: 0, firstSourceIndex: -1, lastSourceIndex: -1 };
