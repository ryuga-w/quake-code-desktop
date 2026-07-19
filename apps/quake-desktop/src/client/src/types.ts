import type { ToolCardState } from "./state/app-store";

export type ModalRequest = any;
export type FileTab = { mode: "editor"; path: string; content: string; dirty?: boolean } | { mode: "diff"; path: string; original: string; modified: string; dirty?: boolean };
export type MonacoModal = { mode: "editor"; title: string; path?: string; content: string } | { mode: "diff"; title: string; original: string; modified: string };
export type MainView = { mode: "chat" } | { mode: "editor"; title: string; path?: string; content: string } | { mode: "diff"; title: string; original: string; modified: string };
export type ComposerImage = { id: string; name: string; mimeType: string; data: string; previewUrl: string; sourceKey?: string; annotation?: string; annotationTarget?: string; annotationBundleId?: string; annotationCount?: number };
export type TurnReviewFile = {
  path: string;
  kind: "create" | "modify" | "delete";
  diff?: string;
  added?: number;
  removed?: number;
  previousPath?: string;
};
export type TurnReviewLiveSource = {
  toolId: string;
  path: string;
  kind: TurnReviewFile["kind"];
};
export type TurnReviewView = {
  label?: string;
  turnId?: number;
  diff?: string;
  files?: TurnReviewFile[];
  totalAdded?: number;
  totalRemoved?: number;
  /** Keeps a filename-scoped review attached to its streaming tool payload. */
  liveSource?: TurnReviewLiveSource;
};
export type DockTab = "files" | "browser" | "mobile" | "plan" | "sidechat" | "subagents" | "agents" | "review";
export type RightTab = DockTab | "preview" | "terminal" | "computer" | "launcher";
export type WorkspaceChangeSummary = { files: number; added: number; removed: number; paths?: string[] };
export type QueuedMessages = { steering: string[]; followUp: string[] };
export type QueuedUserMessage = { id: string; message: string; modelMessage?: string; artifactTemplateSkill?: string; images: ComposerImage[] };
export type TimelineVisibleSelection = { messages: any[]; total: number; startIndex: number; firstSourceIndex: number; lastSourceIndex: number };
export type TimelineToolsView = { tools: ToolCardState[]; total: number };
