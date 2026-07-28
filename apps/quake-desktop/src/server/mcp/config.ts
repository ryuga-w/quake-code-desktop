import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { isSecretReferenceValue } from "./secrets.js";
import { MCP_CONFIG_VERSION, type McpServerConfig, type McpToolDecision } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const VALID_TOOL_DECISIONS = new Set<McpToolDecision>(["allow", "ask", "deny"]);

export function normalizeMcpServers(input: unknown, workspaceCwd: string): McpServerConfig[] {
  if (!Array.isArray(input)) return [];
  const names = new Set<string>();
  const ids = new Set<string>();
  return input.map((entry, index) => normalizeMcpServer(entry, workspaceCwd, index)).filter((server) => {
    const name = server.name.toLocaleLowerCase("en-US");
    if (names.has(name) || ids.has(server.id)) return false;
    names.add(name);
    ids.add(server.id);
    return true;
  });
}

export function normalizeMcpServer(input: unknown, workspaceCwd: string, index = 0): McpServerConfig {
  const raw = asRecord(input);
  const name = requiredText(raw.name, `MCP ${index + 1}`);
  const id = safeId(raw.id, name);
  const transport = raw.transport === "streamable-http" || raw.transport === "sse" ? raw.transport : "stdio";
  const common = {
    version: MCP_CONFIG_VERSION,
    id,
    name,
    enabled: raw.enabled !== false,
    autoStart: raw.autoStart !== false,
    timeoutMs: boundedInteger(raw.timeoutMs, 1_000, 300_000, DEFAULT_TIMEOUT_MS),
    toolPolicy: normalizeToolPolicy(raw.toolPolicy),
    reconnect: normalizeReconnect(raw.reconnect),
  } as const;

  if (transport === "stdio") {
    const command = requiredText(raw.command, "");
    if (!command) throw new Error(`${name}: stdio komutu gerekli`);
    const cwdText = optionalText(raw.cwd);
    return {
      ...common,
      transport,
      command,
      args: stringArray(raw.args),
      cwd: cwdText ? (isAbsolute(cwdText) ? cwdText : resolve(workspaceCwd, cwdText)) : undefined,
      env: secureStringRecord(raw.env),
    };
  }

  const url = requiredText(raw.url, "");
  validateRemoteUrl(url);
  return { ...common, transport, url, headers: secureStringRecord(raw.headers) };
}

export function validateRemoteUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Geçerli MCP URL'si gerekli"); }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Uzak MCP sunucuları HTTPS kullanmalı; HTTP yalnızca localhost için desteklenir");
  }
  return url;
}

function normalizeToolPolicy(input: unknown): McpServerConfig["toolPolicy"] {
  const raw = asRecord(input);
  const decision = VALID_TOOL_DECISIONS.has(raw.default as McpToolDecision) ? raw.default as McpToolDecision : "allow";
  const overrides = Object.fromEntries(Object.entries(asRecord(raw.overrides)).filter(([, value]) => VALID_TOOL_DECISIONS.has(value as McpToolDecision))) as Record<string, McpToolDecision>;
  return { default: decision, overrides: Object.keys(overrides).length ? overrides : undefined };
}

function normalizeReconnect(input: unknown): McpServerConfig["reconnect"] {
  const raw = asRecord(input);
  return {
    enabled: raw.enabled !== false,
    maxAttempts: boundedInteger(raw.maxAttempts, 0, 10, 5),
    baseDelayMs: boundedInteger(raw.baseDelayMs, 250, 30_000, 1_000),
  };
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function requiredText(input: unknown, fallback: string): string {
  return typeof input === "string" && input.trim() ? input.trim() : fallback;
}

function optionalText(input: unknown): string | undefined {
  return typeof input === "string" && input.trim() ? input.trim() : undefined;
}

function stringArray(input: unknown): string[] {
  return Array.isArray(input) ? input.filter((value): value is string => typeof value === "string") : [];
}

export function assertMcpNoPlaintextSecrets(input: unknown): void {
  const raw = asRecord(input);
  const values = { ...asRecord(raw.env), ...asRecord(raw.headers) };
  const sensitiveKeys = /^(authorization|cookie|.*(?:token|secret|password|api[-_]?key).*)$/i;
  for (const [key, value] of Object.entries(values)) {
    if (sensitiveKeys.test(key) && typeof value === "string" && !isSecretReferenceValue(value)) {
      throw new Error(
        `${key}: secret değerini düz metin yerine \${env:NAME}, \${vault:NAME} veya Bearer \${vault:NAME} referansı olarak girin`,
      );
    }
  }
}

function secureStringRecord(input: unknown): Record<string, string> | undefined {
  const entries = Object.entries(asRecord(input)).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function safeId(input: unknown, name: string): string {
  if (typeof input === "string" && /^[a-zA-Z0-9._-]{1,100}$/.test(input)) return input;
  const slug = name.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return slug || randomUUID();
}

function boundedInteger(input: unknown, min: number, max: number, fallback: number): number {
  const value = Number(input);
  return Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
