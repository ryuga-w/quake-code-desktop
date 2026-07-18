export const MCP_CONFIG_VERSION = 1 as const;

export type McpTransport = "stdio" | "streamable-http" | "sse";
export type McpServerStatus = "disabled" | "disconnected" | "connecting" | "connected" | "degraded" | "auth_required" | "error" | "stopping";
export type McpToolDecision = "allow" | "ask" | "deny";

interface McpServerBase {
  version: typeof MCP_CONFIG_VERSION;
  id: string;
  name: string;
  enabled: boolean;
  autoStart: boolean;
  timeoutMs: number;
  toolPolicy: {
    default: McpToolDecision;
    overrides?: Record<string, McpToolDecision>;
  };
  reconnect?: {
    enabled: boolean;
    maxAttempts: number;
    baseDelayMs: number;
  };
}

export interface McpStdioServerConfig extends McpServerBase {
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface McpRemoteServerConfig extends McpServerBase {
  transport: "streamable-http" | "sse";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpRemoteServerConfig;

export interface McpToolSummary {
  name: string;
  qualifiedName: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  decision: McpToolDecision;
  annotations: {
    readOnly: boolean;
    destructive: boolean;
    idempotent: boolean;
    openWorld: boolean;
  };
}

export interface McpPromptSummary {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpResourceSummary {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface McpServerRuntimeSnapshot {
  config: McpServerConfig;
  status: McpServerStatus;
  serverInfo?: { name: string; version: string };
  tools: McpToolSummary[];
  prompts: McpPromptSummary[];
  resources: McpResourceSummary[];
  connectedAt?: number;
  lastError?: string;
}

export interface McpLogEntry {
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
}
