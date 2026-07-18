import {
  isActiveTool,
  isBrowserTool,
  isCommandTool,
  isEditTool,
  isReadTool,
  isSearchTool,
  isSubagentTool,
  isWriteTool,
  toolSortTime,
} from "../../lib/tool-activity";
import type { ToolCardState } from "../../state/app-store";
import type { WebContextUsage } from "../../../../shared/protocol";
import { collectWorkspaceSubagents, isAgentActiveStatus } from "../agents/collect-subagents";

export type ComposerPetToolKind = "read" | "search" | "shell" | "write" | "browser" | "generic";
export type ComposerPetFileKind = "image" | "pdf" | "code" | "text" | "mixed";
export type ComposerPetContextLoad = "carrying" | "heavy" | "critical";
export type ComposerPetToolOutcome = { key: string; status: "done" | "error" };
export type ComposerPetSubagentPhase = "active" | "completed" | "failed";
export type ComposerPetSubagentSignal = { key: string; phase: ComposerPetSubagentPhase };
export type ComposerPetNetworkSignal = { key: string; status: "offline" | "online" | "error" };

export type ComposerPetRuntimeSignals = {
  activeToolKind?: ComposerPetToolKind;
  toolOutcome?: ComposerPetToolOutcome;
  subagent?: ComposerPetSubagentSignal;
  subagentActive: boolean;
};

function canonicalToolName(name: string): string {
  return name.toLowerCase().split(/[.:/]/).filter(Boolean).at(-1) || name.toLowerCase();
}

const CODE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?|css|scss|less|html?|py|rs|go|java|kt|swift|rb|php|sh|bash|ps1|sql|vue|svelte|json|ya?ml|toml|xml)$/i;

export function composerPetFileKind(
  files: ReadonlyArray<{ name: string; type?: string }>,
): ComposerPetFileKind {
  if (files.length === 0) return "text";
  const kinds = new Set<Exclude<ComposerPetFileKind, "mixed">>();
  for (const file of files) {
    const name = String(file.name || "");
    const mime = String(file.type || "").toLowerCase();
    if (mime.startsWith("image/")) kinds.add("image");
    else if (mime === "application/pdf" || /\.pdf$/i.test(name)) kinds.add("pdf");
    else if (CODE_FILE_PATTERN.test(name)) kinds.add("code");
    else kinds.add("text");
  }
  if (kinds.size !== 1) return "mixed";
  return [...kinds][0];
}

export function composerPetContextUsage(usage?: WebContextUsage): {
  percent?: number;
  load?: ComposerPetContextLoad;
} {
  const reported = usage?.percent;
  const tokens = usage?.tokens;
  const contextWindow = usage?.contextWindow;
  const rawPercent = typeof reported === "number" && Number.isFinite(reported)
    ? reported
    : typeof tokens === "number" && Number.isFinite(tokens) && typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
      ? (tokens / contextWindow) * 100
      : undefined;
  if (rawPercent === undefined) return {};
  const percent = Math.max(0, rawPercent);
  const load = percent >= 90 ? "critical" : percent >= 75 ? "heavy" : percent >= 50 ? "carrying" : undefined;
  return { percent, load };
}

export function composerPetToolKind(name: string): ComposerPetToolKind | "subagent" {
  const canonical = canonicalToolName(name);
  if (isSubagentTool(canonical)) return "subagent";
  if (isReadTool(canonical)) return "read";
  if (isBrowserTool(canonical)) return "browser";
  if (isSearchTool(canonical)) return "search";
  if (isCommandTool(canonical)) return "shell";
  if (isWriteTool(canonical) || isEditTool(canonical)) return "write";
  return "generic";
}

function newestTool(tools: ToolCardState[]): ToolCardState | undefined {
  let newest: ToolCardState | undefined;
  for (const tool of tools) {
    if (!newest || toolSortTime(tool) > toolSortTime(newest)) newest = tool;
  }
  return newest;
}

function subagentPhase(status: string): ComposerPetSubagentPhase | undefined {
  const normalized = status.toLowerCase();
  if (isAgentActiveStatus(normalized)) return "active";
  if (normalized === "completed" || normalized === "done" || normalized === "steered") return "completed";
  if (["error", "aborted", "stopped", "shutdown", "interrupted"].includes(normalized)) return "failed";
  return undefined;
}

/** Derives animation inputs exclusively from authoritative tool and subagent state. */
export function deriveComposerPetRuntimeSignals(
  toolMap: Record<string, ToolCardState>,
  messages: any[],
): ComposerPetRuntimeSignals {
  const tools = Object.values(toolMap).filter(Boolean);
  const activeTool = newestTool(tools.filter(isActiveTool));
  const settledTool = newestTool(tools.filter((tool) => tool.status === "done" || tool.status === "error"));
  const activeKind = activeTool ? composerPetToolKind(activeTool.toolName) : undefined;

  const subagents = collectWorkspaceSubagents(toolMap, messages, 24);
  const latestSubagent = subagents[0];
  const phase = latestSubagent ? subagentPhase(latestSubagent.status) : undefined;

  return {
    activeToolKind: activeKind && activeKind !== "subagent" ? activeKind : undefined,
    toolOutcome: settledTool
      ? { key: `${settledTool.id}:${settledTool.status}`, status: settledTool.status as "done" | "error" }
      : undefined,
    subagent: latestSubagent && phase
      ? { key: `${latestSubagent.id}:${phase}`, phase }
      : undefined,
    subagentActive: subagents.some((agent) => isAgentActiveStatus(agent.status)),
  };
}
