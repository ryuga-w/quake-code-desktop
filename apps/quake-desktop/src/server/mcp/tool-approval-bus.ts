/**
 * Pending MCP tool approval UI (Codex-style accept / session / always / decline).
 */

import type { McpToolApprovalDecision } from "./tool-adapter.js";
import type { McpToolSummary } from "./types.js";

export interface McpToolApprovalRequestUi {
  id: string;
  serverId: string;
  tool: McpToolSummary;
  summary: string;
  reason: string;
  risk: "low" | "medium" | "high";
  paramsPreview?: string;
  createdAt: number;
}

type Pending = {
  request: McpToolApprovalRequestUi;
  resolve: (decision: McpToolApprovalDecision) => void;
  timer?: ReturnType<typeof setTimeout>;
};

let seq = 0;
const pending = new Map<string, Pending>();
let emitter: { emit: (req: McpToolApprovalRequestUi) => void } | undefined;

export function setMcpToolApprovalEmitter(next: { emit: (req: McpToolApprovalRequestUi) => void } | undefined): void {
  emitter = next;
}

export function respondMcpToolApproval(id: string, decision: McpToolApprovalDecision): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  if (entry.timer) clearTimeout(entry.timer);
  entry.resolve(decision);
  return true;
}

export function listPendingMcpToolApprovals(): McpToolApprovalRequestUi[] {
  return [...pending.values()].map((p) => p.request);
}

/** Test/reset helper */
export function clearPendingMcpToolApprovals(): void {
  const entries = [...pending.values()];
  pending.clear();
  for (const entry of entries) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve("cancel");
  }
}

export async function requestMcpToolApprovalUi(input: {
  serverId: string;
  tool: McpToolSummary;
  params: Record<string, unknown>;
  reason: string;
  risk: "low" | "medium" | "high";
  timeoutMs?: number;
}): Promise<McpToolApprovalDecision> {
  const id = `mcp_apr_${Date.now()}_${++seq}`;
  const request: McpToolApprovalRequestUi = {
    id,
    serverId: input.serverId,
    tool: input.tool,
    summary: input.tool.qualifiedName || input.tool.name,
    reason: input.reason,
    risk: input.risk,
    paramsPreview: safePreview(input.params),
    createdAt: Date.now(),
  };

  return new Promise((resolve) => {
    const timeoutMs = Math.max(20, Number(input.timeoutMs) || 120_000);
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      resolve("decline");
    }, timeoutMs);

    pending.set(id, {
      request,
      resolve: (d) => {
        clearTimeout(timer);
        resolve(d);
      },
      timer,
    });

    try {
      emitter?.emit(request);
    } catch {
      pending.delete(id);
      clearTimeout(timer);
      resolve("decline");
    }
  });
}

function safePreview(params: Record<string, unknown>): string | undefined {
  try {
    const s = JSON.stringify(params);
    return s.length > 800 ? `${s.slice(0, 800)}…` : s;
  } catch {
    return undefined;
  }
}
