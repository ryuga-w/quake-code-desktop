/**
 * Collect parallel/subagent summaries from tool cards + custom messages.
 * Used by workspace context strip and AgentsPanel.
 */

import type { ToolCardState } from "../../state/app-store";

export type WorkspaceSubagentSummary = {
  id: string;
  name: string;
  status: string;
  time: number;
  isolation?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  description?: string;
  resultPreview?: string;
};

function formatWorkspaceAgentName(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const segment = raw.split("/").filter(Boolean).at(-1) || raw;
  return segment.replace(/[_-]+/g, " ").trim();
}

function normalizeToolArgs(args: unknown): Record<string, any> {
  if (!args) return {};
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, any>) : {};
    } catch {
      return {};
    }
  }
  return typeof args === "object" ? (args as Record<string, any>) : {};
}

export function collectWorkspaceSubagents(
  tools: Record<string, ToolCardState>,
  messages: any[],
  limit = 24,
): WorkspaceSubagentSummary[] {
  const agents = new Map<string, WorkspaceSubagentSummary>();
  const aliases = new Map<string, string>();

  const upsert = (
    rawId: unknown,
    rawName: unknown,
    rawStatus: unknown,
    rawTime: unknown,
    meta?: Partial<WorkspaceSubagentSummary>,
  ) => {
    const fallbackName = formatWorkspaceAgentName(rawName);
    if (!rawId && !fallbackName) return;
    const id = String(rawId || fallbackName);
    const time = Number(rawTime || 0);
    const current = agents.get(id);
    const name = current?.name || fallbackName;
    if (!name) return;
    if (current && current.time > time) {
      // Still merge newer meta fields if missing
      if (meta) {
        agents.set(id, {
          ...current,
          isolation: current.isolation || meta.isolation,
          worktreePath: current.worktreePath || meta.worktreePath,
          worktreeBranch: current.worktreeBranch || meta.worktreeBranch,
          description: current.description || meta.description,
          resultPreview: current.resultPreview || meta.resultPreview,
        });
      }
      return;
    }
    agents.set(id, {
      id,
      name,
      status: String(rawStatus || current?.status || "running").toLowerCase(),
      time,
      isolation: meta?.isolation || current?.isolation,
      worktreePath: meta?.worktreePath || current?.worktreePath,
      worktreeBranch: meta?.worktreeBranch || current?.worktreeBranch,
      description: meta?.description || current?.description,
      resultPreview: meta?.resultPreview || current?.resultPreview,
    });
  };

  for (const tool of Object.values(tools)) {
    const toolName = String(tool.toolName || "").toLowerCase();
    if (toolName !== "agent" && toolName !== "spawn_agent" && toolName !== "spawn_agents_on_csv") continue;
    const argRecord = normalizeToolArgs(tool.args);
    const detailRecord = tool.details && typeof tool.details === "object" ? (tool.details as Record<string, any>) : {};
    const id =
      detailRecord.agent_id ||
      detailRecord.agentId ||
      detailRecord.id ||
      argRecord.task_name ||
      argRecord.name ||
      tool.id;
    const name =
      detailRecord.nickname ||
      detailRecord.name ||
      argRecord.name ||
      argRecord.task_name ||
      detailRecord.task_name ||
      detailRecord.displayName ||
      argRecord.agent_type;
    const status = detailRecord.status || (tool.status === "done" ? "running" : tool.status);
    if (detailRecord.task_name) aliases.set(String(detailRecord.task_name), String(id));
    if (argRecord.task_name) aliases.set(String(argRecord.task_name), String(id));
    const isolation = String(detailRecord.isolation || argRecord.isolation || "").toLowerCase() || undefined;
    const worktreePath = detailRecord.worktree_path || detailRecord.worktreePath || undefined;
    const worktreeBranch = detailRecord.worktree_branch || detailRecord.worktreeBranch || undefined;
    const tags = Array.isArray(detailRecord.tags) ? detailRecord.tags.map(String) : [];
    const fromTags = tags.includes("worktree") ? "worktree" : undefined;
    const description = detailRecord.description || argRecord.description || argRecord.prompt || argRecord.message;
    const resultPreview =
      detailRecord.resultPreview ||
      (typeof detailRecord.result === "string" ? detailRecord.result.slice(0, 200) : undefined);
    upsert(id, name, status, tool.updatedAt || tool.endedAt || tool.startedAt, {
      isolation: isolation || fromTags,
      worktreePath: worktreePath ? String(worktreePath) : undefined,
      worktreeBranch: worktreeBranch ? String(worktreeBranch) : undefined,
      description: description ? String(description).slice(0, 160) : undefined,
      resultPreview: resultPreview ? String(resultPreview) : undefined,
    });
  }

  for (const message of messages) {
    if (message?.customType === "subagent-notification") {
      const details = message.details && typeof message.details === "object" ? message.details : {};
      const branch =
        details.worktree_branch ||
        details.worktreeBranch ||
        details.worktreeResult?.branch ||
        undefined;
      upsert(details.id, details.name, details.status || "completed", message.timestamp, {
        isolation: details.isolation,
        worktreePath: details.worktree_path || details.worktreePath,
        worktreeBranch: branch,
        description: details.description,
        resultPreview: details.resultPreview || (typeof details.result === "string" ? details.result.slice(0, 200) : undefined),
      });
      continue;
    }
    if (message?.customType === "subagent-peer-message") {
      const sender = String(message.content || "").match(/^Sender:\s*(.+)$/im)?.[1];
      if (sender) upsert(aliases.get(sender) || sender, sender, "completed", message.timestamp);
    }
  }

  return [...agents.values()]
    .sort((left, right) => right.time - left.time)
    .slice(0, limit);
}

export function workspaceAgentStatusLabel(status: string): string {
  if (status === "completed" || status === "done" || status === "steered") return "bitti";
  if (status === "queued" || status === "pending_init") return "sırada";
  if (status === "error" || status === "aborted" || status === "stopped" || status === "shutdown") return "durdu";
  if (status === "interrupted") return "kesildi";
  return "çalışıyor";
}

export function isAgentActiveStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "running" || s === "queued" || s === "pending_init" || s === "active";
}

/** Allow only safe git branch name characters (no shell metacharacters). */
export function isSafeGitBranchName(branch: string): boolean {
  const b = String(branch || "").trim();
  // Common agent branches: quake-agent-… ; reject empty, force flags, and shell junk.
  if (!b || b.length > 200) return false;
  if (b.startsWith("-")) return false;
  return /^[A-Za-z0-9._/-]+$/.test(b);
}

/**
 * Build a non-force `git merge <branch>` command. Never adds --force / -X / --ours.
 * Returns null when the branch is missing or unsafe to pass to a shell.
 */
export function buildMergeCommand(branch: string | undefined | null): string | null {
  const b = String(branch || "").trim();
  if (!isSafeGitBranchName(b)) return null;
  return `git merge ${b}`;
}

export function mergeCommandForAgent(agent: WorkspaceSubagentSummary): string | null {
  return buildMergeCommand(agent.worktreeBranch);
}

/** Live activity / thread row for AgentsPanel (derived from tools + messages, no extra protocol). */
export type AgentThreadRole = "user" | "assistant" | "tool";

export type AgentActivityLine = {
  id: string;
  time: number;
  /** Conversation role for thread viewer (user prompt, assistant result, tool call). */
  role: AgentThreadRole;
  toolName?: string;
  status?: string;
  text: string;
};

const AGENT_TOOL_NAMES = new Set(["agent", "spawn_agent", "spawn_agents_on_csv"]);
/** Prefer longer snippets in the thread pane so assistant/tool lines stay readable. */
const ACTIVITY_TEXT_LIMIT = 280;
const ACTIVITY_OUTPUT_LINES = 4;

function truncateActivityText(value: unknown, limit = ACTIVITY_TEXT_LIMIT): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function resolveToolAgentId(tool: ToolCardState, aliases?: Map<string, string>): string | undefined {
  const argRecord = normalizeToolArgs(tool.args);
  const detailRecord = tool.details && typeof tool.details === "object" ? (tool.details as Record<string, any>) : {};
  const toolName = String(tool.toolName || "").toLowerCase();
  const isAgentTool = AGENT_TOOL_NAMES.has(toolName);

  const candidates = [
    detailRecord.agent_id,
    detailRecord.agentId,
    detailRecord.id,
    isAgentTool ? argRecord.task_name : undefined,
    isAgentTool ? argRecord.name : undefined,
    isAgentTool ? tool.id : undefined,
    argRecord.agent_id,
    argRecord.agentId,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") continue;
    const id = String(candidate);
    if (aliases?.has(id)) return aliases.get(id);
    return id;
  }
  return undefined;
}

function toolMatchesAgent(tool: ToolCardState, agentId: string, aliases: Map<string, string>): boolean {
  const resolved = resolveToolAgentId(tool, aliases);
  if (!resolved) return false;
  if (resolved === agentId) return true;
  // Alias maps task_name → agent id
  if (aliases.get(resolved) === agentId) return true;
  // Sometimes agent id is the task name itself
  for (const [alias, id] of aliases) {
    if (id === agentId && (resolved === alias || resolved === id)) return true;
  }
  return false;
}

function buildAliasMap(tools: Record<string, ToolCardState>, messages: any[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const tool of Object.values(tools)) {
    const toolName = String(tool.toolName || "").toLowerCase();
    if (!AGENT_TOOL_NAMES.has(toolName)) continue;
    const argRecord = normalizeToolArgs(tool.args);
    const detailRecord = tool.details && typeof tool.details === "object" ? (tool.details as Record<string, any>) : {};
    const id =
      detailRecord.agent_id ||
      detailRecord.agentId ||
      detailRecord.id ||
      argRecord.task_name ||
      argRecord.name ||
      tool.id;
    if (!id) continue;
    const idStr = String(id);
    if (detailRecord.task_name) aliases.set(String(detailRecord.task_name), idStr);
    if (argRecord.task_name) aliases.set(String(argRecord.task_name), idStr);
    if (argRecord.name && String(argRecord.name) !== idStr) aliases.set(String(argRecord.name), idStr);
    if (detailRecord.nickname) aliases.set(String(detailRecord.nickname), idStr);
    if (detailRecord.name && String(detailRecord.name) !== idStr) aliases.set(String(detailRecord.name), idStr);
  }
  for (const message of messages) {
    if (message?.customType !== "subagent-notification") continue;
    const details = message.details && typeof message.details === "object" ? message.details : {};
    if (details.id && details.name) aliases.set(String(details.name), String(details.id));
  }
  return aliases;
}

function outputSnippetLines(output: unknown, maxLines = ACTIVITY_OUTPUT_LINES): string[] {
  const raw = String(output ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const picked = lines.length <= maxLines ? lines : lines.slice(-maxLines);
  return picked.map((line) => truncateActivityText(line, ACTIVITY_TEXT_LIMIT));
}

/**
 * Derive a scrollable live activity log for one agent id from store tools + messages.
 * Pure client derivation (MVP) — no extra SSE protocol required.
 */
export function collectAgentActivity(
  tools: Record<string, ToolCardState>,
  messages: any[],
  agentId: string,
  limit = 50,
): AgentActivityLine[] {
  const target = String(agentId || "").trim();
  if (!target) return [];

  const aliases = buildAliasMap(tools, messages);
  const lines: AgentActivityLine[] = [];
  const push = (line: Omit<AgentActivityLine, "id"> & { id?: string }) => {
    const id = line.id || `${line.toolName || "act"}-${line.time}-${lines.length}`;
    lines.push({
      id,
      time: line.time,
      role: line.role,
      toolName: line.toolName,
      status: line.status,
      text: truncateActivityText(line.text, ACTIVITY_TEXT_LIMIT) || "—",
    });
  };

  for (const tool of Object.values(tools)) {
    if (!toolMatchesAgent(tool, target, aliases)) continue;

    const toolName = String(tool.toolName || "tool");
    const argRecord = normalizeToolArgs(tool.args);
    const detailRecord = tool.details && typeof tool.details === "object" ? (tool.details as Record<string, any>) : {};
    const startedAt = Number(tool.startedAt || tool.updatedAt || 0);
    const updatedAt = Number(tool.updatedAt || tool.endedAt || tool.startedAt || 0);
    const detailStatus = firstNonEmptyString(detailRecord.status, tool.status) || tool.status;
    const prompt = firstNonEmptyString(
      argRecord.message,
      argRecord.prompt,
      argRecord.description,
      detailRecord.description,
    );
    const summary = firstNonEmptyString(
      detailRecord.summary,
      detailRecord.resultPreview,
      typeof detailRecord.result === "string" ? detailRecord.result : "",
    );

    // Spawn / lifecycle: user prompt first, then tool meta, then assistant summary
    if (AGENT_TOOL_NAMES.has(toolName.toLowerCase())) {
      if (prompt) {
        push({
          id: `${tool.id}-user`,
          time: startedAt || updatedAt,
          role: "user",
          toolName,
          status: detailStatus,
          text: prompt,
        });
      }
      const isolation = firstNonEmptyString(detailRecord.isolation, argRecord.isolation);
      const branch = firstNonEmptyString(detailRecord.worktree_branch, detailRecord.worktreeBranch);
      const path = firstNonEmptyString(detailRecord.worktree_path, detailRecord.worktreePath);
      push({
        id: `${tool.id}-spawn`,
        time: startedAt || updatedAt,
        role: "tool",
        toolName,
        status: detailStatus,
        text: `${toolName} · ${detailStatus}`,
      });
      if (isolation || branch || path) {
        const meta = [isolation && `isolation=${isolation}`, branch && `branch=${branch}`, path && `path=${path}`]
          .filter(Boolean)
          .join(" · ");
        push({
          id: `${tool.id}-worktree`,
          time: updatedAt || startedAt,
          role: "tool",
          toolName,
          status: detailStatus,
          text: meta,
        });
      }
      if (summary && summary !== prompt) {
        push({
          id: `${tool.id}-summary`,
          time: updatedAt || startedAt,
          role: "assistant",
          toolName,
          status: detailStatus,
          text: summary,
        });
      }
    } else {
      // Nested / tagged tool call attributed to this agent
      const subject = firstNonEmptyString(
        argRecord.command,
        argRecord.CommandLine,
        argRecord.path,
        argRecord.file_path,
        argRecord.filePath,
        argRecord.target_file,
        argRecord.query,
        argRecord.pattern,
        prompt,
        toolName,
      );
      push({
        id: `${tool.id}-tool`,
        time: updatedAt || startedAt,
        role: "tool",
        toolName,
        status: tool.status,
        text: `${toolName} · ${tool.status}${subject && subject !== toolName ? ` · ${subject}` : ""}`,
      });
    }

    for (const [index, snippet] of outputSnippetLines(tool.output).entries()) {
      push({
        id: `${tool.id}-out-${index}`,
        time: updatedAt || startedAt,
        role: "tool",
        toolName,
        status: tool.status,
        text: snippet,
      });
    }

    // Short detail-only output snippets (e.g. partial progress strings)
    if (typeof detailRecord.output === "string") {
      for (const [index, snippet] of outputSnippetLines(detailRecord.output, 2).entries()) {
        push({
          id: `${tool.id}-detail-out-${index}`,
          time: updatedAt || startedAt,
          role: "tool",
          toolName,
          status: detailStatus,
          text: snippet,
        });
      }
    }
  }

  for (const message of messages) {
    const time = Number(message?.timestamp || 0);
    if (message?.customType === "subagent-notification") {
      const details = message.details && typeof message.details === "object" ? message.details : {};
      const id = firstNonEmptyString(details.id, details.agent_id, details.agentId);
      const name = firstNonEmptyString(details.name, details.nickname);
      const matches =
        id === target ||
        aliases.get(name) === target ||
        name === target ||
        (id && aliases.get(id) === target);
      if (!matches) continue;
      const status = firstNonEmptyString(details.status, "completed") || "completed";
      // Prefer full result text for thread readability; fall back to preview / content.
      const resultText = firstNonEmptyString(
        typeof details.result === "string" ? details.result : "",
        details.resultPreview,
        typeof message.content === "string" ? message.content : "",
        details.description,
      );
      push({
        id: `msg-notify-${message.id || time}-${id || name}`,
        time,
        role: "assistant",
        toolName: "subagent",
        status,
        text: resultText
          ? resultText
          : `bildirim · ${status}`,
      });
      continue;
    }

    if (message?.customType === "subagent-peer-message") {
      const content = String(message.content || "");
      const sender = content.match(/^Sender:\s*(.+)$/im)?.[1]?.trim();
      const matches =
        sender === target ||
        aliases.get(String(sender || "")) === target ||
        content.includes(target);
      if (!matches) continue;
      const body = content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !/^Sender:/i.test(l))
        .join(" ");
      push({
        id: `msg-peer-${message.id || time}`,
        time,
        role: "assistant",
        toolName: "peer",
        status: "completed",
        text: truncateActivityText(body || content) || "peer mesajı",
      });
    }
  }

  return lines
    .sort((left, right) => left.time - right.time || left.id.localeCompare(right.id))
    .slice(-Math.max(1, limit));
}

export type MergeRunOutcome = "success" | "conflict" | "error";

export function interpretMergeResult(result: {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  error?: string;
}): MergeRunOutcome {
  if (result.error) return "error";
  if (result.timedOut) return "error";
  if (result.exitCode === 0) return "success";
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (
    /\bCONFLICT\b/i.test(text) ||
    /Automatic merge failed/i.test(text) ||
    /fix ile birleştirme başarısız/i.test(text) ||
    /fix merge failed/i.test(text) ||
    /unmerged paths/i.test(text)
  ) {
    return "conflict";
  }
  return "error";
}

/**
 * Extract conflict file paths from git merge output.
 * Matches lines like:
 *   CONFLICT (content): Merge conflict in src/a.ts
 *   CONFLICT (add/add): Merge conflict in path/with spaces/file.ts
 */
export function parseMergeConflictPaths(text: string): string[] {
  const raw = String(text || "");
  if (!raw.trim()) return [];

  const found: string[] = [];
  const seen = new Set<string>();

  const pushPath = (path: string) => {
    const cleaned = path
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.,;:]+$/g, "")
      .trim();
    if (!cleaned || cleaned.length > 500) return;
    if (/\s{2,}/.test(cleaned)) return;
    if (seen.has(cleaned)) return;
    seen.add(cleaned);
    found.push(cleaned);
  };

  // Primary: CONFLICT (…): Merge conflict in <path>
  // Also: CONFLICT (…): … in <path>
  const conflictInRe =
    /^\s*CONFLICT\s*\([^)]*\)\s*:\s*(?:Merge conflict in |.*\bin\s+)(.+?)\s*$/gim;
  for (const match of raw.matchAll(conflictInRe)) {
    const path = String(match[1] || "").trim();
    // rename/delete sometimes: "foo.ts deleted in HEAD and modified in …"
    if (!path || /\s+and\s+/i.test(path)) {
      const trailing = path.match(/([^\s]+?\.[A-Za-z0-9_]+)\s*$/);
      if (trailing?.[1]) pushPath(trailing[1]);
      continue;
    }
    pushPath(path);
  }

  // Fallback: "Merge conflict in <path>" without CONFLICT prefix
  const plainInRe = /^\s*Merge conflict in\s+(.+?)\s*$/gim;
  for (const match of raw.matchAll(plainInRe)) {
    pushPath(String(match[1] || "").trim());
  }

  // Unmerged paths section (git status style)
  const unmergedRe =
    /^\s*(?:both modified|both added|added by us|added by them|deleted by us|deleted by them):\s+(.+?)\s*$/gim;
  for (const match of raw.matchAll(unmergedRe)) {
    pushPath(String(match[1] || "").trim());
  }

  return found;
}

/** Clipboard helper for listing unmerged paths after a conflict. */
export const MERGE_CONFLICT_DIFF_CMD = "git diff --name-only --diff-filter=U";

export function mergeConflictOutputText(result: {
  stdout?: string;
  stderr?: string;
}): string {
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}
