export type ToolNoticeHeadline = {
  kind: "thinking" | "read" | "search" | "edit" | "command" | "browser" | "summary" | "error";
  verb: string;
  subject: string;
  meta?: string;
  live?: boolean;
};

export type SemanticFlowPhase = "settled" | "leaving" | "entering";
