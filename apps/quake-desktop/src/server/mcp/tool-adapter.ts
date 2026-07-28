import type { ToolDefinition } from "@mrquake/quakecode-cli";
import type { McpConnectionManager } from "./manager.js";
import type { McpToolSummary } from "./types.js";
import { isMcpToolApproved, rememberMcpToolApproval } from "./approval-cache.js";

const MAX_TEXT_CHARS = 200_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CONTENT_ITEMS = 64;

export type McpToolApprovalDecision = "accept" | "acceptForSession" | "acceptAlways" | "decline" | "cancel";

export interface McpToolExecutionContext {
  mode: "plan" | "agent" | "goal";
  /**
   * Codex-style MCP tool approval. Return decision; session/always remember applied by adapter.
   * If omitted, "ask" tools are blocked.
   */
  requestApproval?: (input: {
    serverId: string;
    tool: McpToolSummary;
    params: Record<string, unknown>;
    reason: string;
    risk: "low" | "medium" | "high";
  }) => Promise<McpToolApprovalDecision>;
  onBlocked?: (reason: string) => void;
}

export function createMcpToolDefinition(
  manager: McpConnectionManager,
  serverId: string,
  tool: McpToolSummary,
  getContext: () => McpToolExecutionContext = () => ({ mode: "agent" }),
): ToolDefinition {
  return {
    name: tool.qualifiedName,
    label: tool.title || tool.name,
    description: `${tool.description || `Call ${tool.name}`} (MCP server: ${serverId}; ${tool.annotations.readOnly ? "read-only" : tool.annotations.destructive ? "potentially destructive" : "write-capable"})`,
    promptSnippet: tool.description || `Call ${tool.name} on MCP server ${serverId}`,
    parameters: normalizeInputSchema(tool.inputSchema) as any,
    async execute(_toolCallId, params, signal) {
      const startedAt = Date.now();
      try {
        const args = params as Record<string, unknown>;
        const context = getContext();
        const policyError = await enforceMcpToolPolicy(context, serverId, tool, args);
        if (policyError) return errorResult(policyError, serverId, tool.name, startedAt);
        const result = await manager.callTool(serverId, tool.name, args, signal);
        return toAgentResult(result, { serverId, toolName: tool.name, startedAt });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error), serverId, tool.name, startedAt);
      }
    },
  } as ToolDefinition;
}

/**
 * Codex-aligned MCP tool gate (exported for honest unit tests).
 * - deny → block
 * - plan mode → only readOnly
 * - goal mode → block destructive / ask
 * - session/always cache skip prompt
 * - allow + readOnly → auto
 * - allow + non-readOnly with destructive/openWorld → prompt (Codex "auto")
 * - ask → always prompt
 */
export async function enforceMcpToolPolicy(
  context: McpToolExecutionContext,
  serverId: string,
  tool: McpToolSummary,
  params: Record<string, unknown>,
): Promise<string | undefined> {
  if (tool.decision === "deny") {
    const reason = "MCP aracı politika tarafından engellendi.";
    if (context.mode === "goal") context.onBlocked?.(reason);
    return reason;
  }

  if (context.mode === "plan" && !tool.annotations.readOnly) {
    return "Plan Mode yalnızca read-only olarak işaretlenmiş MCP araçlarına izin verir.";
  }

  if (context.mode === "goal" && (tool.annotations.destructive || tool.decision === "ask")) {
    const reason = `${tool.title || tool.name} MCP aracı ${tool.annotations.destructive ? "yıkıcı/yazma etkili olabilir" : "kullanıcı onayı gerektiriyor"}.`;
    context.onBlocked?.(reason);
    return `Goal Mode güvenlik nedeniyle bloke edildi: ${reason}`;
  }

  if (isMcpToolApproved(serverId, tool.name)) {
    return undefined;
  }

  const needsPrompt = computeNeedsPrompt(tool);
  if (!needsPrompt) return undefined;

  const risk: "low" | "medium" | "high" = tool.annotations.readOnly
    ? "low"
    : tool.annotations.destructive
      ? "high"
      : "medium";
  const reason = tool.annotations.destructive
    ? "Potansiyel olarak yıkıcı veya yazma etkili MCP aracı"
    : tool.annotations.openWorld
      ? "Açık dünya / dış sistem erişimli MCP aracı"
      : "Politika onayı gerektiren MCP aracı";

  if (!context.requestApproval) {
    return reason;
  }

  const decision = await context.requestApproval({ serverId, tool, params, reason, risk });
  if (decision === "accept") return undefined;
  if (decision === "acceptForSession") {
    rememberMcpToolApproval(serverId, tool.name, "session");
    return undefined;
  }
  if (decision === "acceptAlways") {
    rememberMcpToolApproval(serverId, tool.name, "always");
    return undefined;
  }
  if (decision === "cancel") return "Kullanıcı MCP aracı çağrısını iptal etti.";
  return "Kullanıcı MCP aracı çağrısını reddetti.";
}

/** Exported for unit tests — Codex auto vs ask decision for a tool. */
export function mcpToolNeedsApprovalPrompt(tool: McpToolSummary): boolean {
  if (tool.decision === "ask") return true;
  if (tool.decision === "allow") {
    // Codex "auto": read-only auto-allow; destructive / open-world need prompt
    if (tool.annotations.readOnly) return false;
    return tool.annotations.destructive || tool.annotations.openWorld;
  }
  return true;
}

function computeNeedsPrompt(tool: McpToolSummary): boolean {
  return mcpToolNeedsApprovalPrompt(tool);
}

function normalizeInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties: {}, additionalProperties: true, ...schema };
}

function toAgentResult(result: any, meta: { serverId: string; toolName: string; startedAt: number }) {
  const rawContent = Array.isArray(result?.content) ? result.content.slice(0, MAX_CONTENT_ITEMS) : [];
  const content = rawContent.flatMap((item: any) => {
    if (item?.type === "text") return [{ type: "text", text: truncateText(String(item.text || "")) }];
    if (item?.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
      const estimatedBytes = Math.ceil(item.data.length * 0.75);
      return estimatedBytes <= MAX_IMAGE_BYTES
        ? [{ type: "image", source: { type: "base64", mediaType: item.mimeType, data: item.data } }]
        : [{ type: "text", text: `[MCP image omitted: ${estimatedBytes} bytes exceeds ${MAX_IMAGE_BYTES} byte limit]` }];
    }
    if (item?.type === "resource") return [{ type: "text", text: truncateText(formatResource(item.resource)) }];
    return [{ type: "text", text: truncateText(safeJson(item)) }];
  });
  if (!content.length) content.push({ type: "text", text: result?.structuredContent ? truncateText(safeJson(result.structuredContent, true)) : "MCP aracı sonuç döndürmedi." });
  if (Array.isArray(result?.content) && result.content.length > MAX_CONTENT_ITEMS) content.push({ type: "text", text: `[${result.content.length - MAX_CONTENT_ITEMS} additional MCP content items omitted]` });
  return {
    content,
    details: {
      serverId: meta.serverId,
      toolName: meta.toolName,
      durationMs: Date.now() - meta.startedAt,
      structuredContent: boundedStructuredContent(result?.structuredContent),
    },
    isError: Boolean(result?.isError),
  };
}

function errorResult(message: string, serverId: string, toolName: string, startedAt: number) {
  return { content: [{ type: "text", text: truncateText(message) }], details: { serverId, toolName, durationMs: Date.now() - startedAt }, isError: true };
}

function boundedStructuredContent(value: unknown): unknown {
  if (value === undefined) return undefined;
  const serialized = safeJson(value);
  return serialized.length <= MAX_TEXT_CHARS ? value : { truncated: true, preview: truncateText(serialized) };
}

function truncateText(value: string): string {
  return value.length <= MAX_TEXT_CHARS ? value : `${value.slice(0, MAX_TEXT_CHARS)}\n[MCP output truncated: ${value.length - MAX_TEXT_CHARS} characters omitted]`;
}

function safeJson(value: unknown, pretty = false): string {
  try { return JSON.stringify(value, null, pretty ? 2 : undefined); } catch { return String(value); }
}

function formatResource(resource: any): string {
  if (!resource) return "MCP resource: empty";
  if (typeof resource.text === "string") return resource.text;
  if (typeof resource.blob === "string") return `[MCP binary resource ${resource.uri || ""}: ${Math.ceil(resource.blob.length * 0.75)} bytes]`;
  return `MCP resource ${resource.uri || ""} (${resource.mimeType || "unknown"})`;
}
