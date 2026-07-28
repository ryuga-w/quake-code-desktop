import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { McpLogBuffer } from "./log-buffer.js";
import { mcpToolName } from "./names.js";
import { requestMcpElicitation } from "./elicitation-bus.js";
import { redactSecrets, resolveSecretReferences } from "./secrets.js";
import type { McpPromptSummary, McpResourceSummary, McpServerConfig, McpServerRuntimeSnapshot, McpToolSummary } from "./types.js";

export class McpConnection {
  private client?: Client;
  private transport?: Transport;
  private snapshotValue: McpServerRuntimeSnapshot;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  readonly logs = new McpLogBuffer();

  constructor(readonly config: McpServerConfig, private readonly onChanged: () => void) {
    this.snapshotValue = { config, status: config.enabled ? "disconnected" : "disabled", tools: [], prompts: [], resources: [] };
  }

  get snapshot(): McpServerRuntimeSnapshot {
    return structuredClone(this.snapshotValue);
  }

  async connect(): Promise<McpServerRuntimeSnapshot> {
    if (!this.config.enabled) return this.snapshot;
    if (this.snapshotValue.status === "connected") return this.snapshot;
    if (this.client || this.transport) {
      this.intentionalClose = true;
      await this.closeTransport();
    }
    this.intentionalClose = false;
    this.clearReconnectTimer();
    this.setState({ status: "connecting", lastError: undefined });
    let sensitive: Record<string, string> | undefined;
    try {
      const client = new Client({ name: "quake-code", version: "1.0.0" }, {
        // Advertise elicitation so MCP servers can request form/URL user input (Codex parity).
        capabilities: {
          // Empty elicitation object = form support (SDK default). URL mode still handled if server sends mode:"url".
          elicitation: {},
        },
        listChanged: {
          tools: { onChanged: () => void this.refreshDiscovery() },
          prompts: { onChanged: () => void this.refreshDiscovery() },
          resources: { onChanged: () => void this.refreshDiscovery() },
        },
      });
      // Server → client: elicitation/create
      client.setRequestHandler(ElicitRequestSchema, async (request) => {
        this.logs.push("info", `Elicitation: ${String((request as any)?.params?.message || "bilgi istendi").slice(0, 200)}`);
        const result = await requestMcpElicitation({
          serverId: this.config.id,
          serverName: this.config.name,
          params: (request as any).params || {},
          timeoutMs: this.config.timeoutMs,
        });
        if (result.action === "accept") {
          return { action: "accept" as const, content: result.content || {} };
        }
        if (result.action === "decline") {
          return { action: "decline" as const };
        }
        return { action: "cancel" as const };
      });
      const transport = this.createTransport();
      client.onclose = () => this.handleUnexpectedClose();
      sensitive = this.config.transport === "stdio" ? resolveSecretReferences(this.config.env) : resolveSecretReferences(this.config.headers);
      this.client = client;
      this.transport = transport;
      await withTimeout(client.connect(transport), this.config.timeoutMs, "MCP bağlantısı zaman aşımına uğradı");
      await this.refreshDiscovery();
      const info = client.getServerVersion();
      this.setState({ status: "connected", connectedAt: Date.now(), serverInfo: info ? { name: info.name, version: info.version } : undefined });
      this.logs.push("info", `Bağlandı: ${this.config.name}`);
      return this.snapshot;
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error), sensitive);
      this.logs.push("error", message);
      this.intentionalClose = true;
      await this.closeTransport();
      this.intentionalClose = false;
      const authRequired = /401|403|unauthorized/i.test(message);
      this.setState({ status: authRequired ? "auth_required" : "error", lastError: message });
      if (!authRequired) this.scheduleReconnect();
      throw new Error(message);
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    if (!this.client && !this.transport) {
      this.setState({ status: this.config.enabled ? "disconnected" : "disabled", tools: [], prompts: [], resources: [] });
      return;
    }
    this.setState({ status: "stopping" });
    await this.closeTransport();
    this.setState({ status: this.config.enabled ? "disconnected" : "disabled", tools: [], prompts: [], resources: [] });
    this.logs.push("info", "Bağlantı kapatıldı");
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const client = this.client;
    if (!client || this.snapshotValue.status !== "connected") throw new Error(`${this.config.name} bağlı değil`);
    return client.callTool({ name, arguments: args }, undefined, { signal, timeout: this.config.timeoutMs });
  }

  async readResource(uri: string, signal?: AbortSignal): Promise<unknown> {
    const client = this.client;
    if (!client || this.snapshotValue.status !== "connected") throw new Error(`${this.config.name} bağlı değil`);
    return client.readResource({ uri }, { signal, timeout: this.config.timeoutMs });
  }

  async getPrompt(name: string, args?: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const client = this.client;
    if (!client || this.snapshotValue.status !== "connected") throw new Error(`${this.config.name} bağlı değil`);
    return client.getPrompt({ name, arguments: args }, { signal, timeout: this.config.timeoutMs });
  }

  async refreshDiscovery(): Promise<void> {
    const client = this.client;
    if (!client) return;
    const [toolsResult, promptsResult, resourcesResult] = await Promise.all([
      client.listTools(undefined, { timeout: this.config.timeoutMs }).catch(() => ({ tools: [] })),
      client.listPrompts(undefined, { timeout: this.config.timeoutMs }).catch(() => ({ prompts: [] })),
      client.listResources(undefined, { timeout: this.config.timeoutMs }).catch(() => ({ resources: [] })),
    ]);
    const tools: McpToolSummary[] = toolsResult.tools.map((tool) => ({
      name: tool.name,
      qualifiedName: mcpToolName(this.config.name, tool.name),
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      decision: this.config.toolPolicy.overrides?.[tool.name] || this.config.toolPolicy.default,
      annotations: {
        readOnly: tool.annotations?.readOnlyHint === true,
        destructive: tool.annotations?.destructiveHint !== false && tool.annotations?.readOnlyHint !== true,
        idempotent: tool.annotations?.idempotentHint === true,
        openWorld: tool.annotations?.openWorldHint !== false,
      },
    }));
    const prompts: McpPromptSummary[] = promptsResult.prompts.map((prompt) => ({ name: prompt.name, title: prompt.title, description: prompt.description, arguments: prompt.arguments }));
    const resources: McpResourceSummary[] = resourcesResult.resources.map((resource) => ({ uri: resource.uri, name: resource.name, title: resource.title, description: resource.description, mimeType: resource.mimeType }));
    this.setState({ tools, prompts, resources });
  }

  private createTransport(): Transport {
    if (this.config.transport === "stdio") {
      const env = resolveSecretReferences(this.config.env);
      const transport = new StdioClientTransport({ command: this.config.command, args: this.config.args, cwd: this.config.cwd, env: env ? { ...process.env, ...env } as Record<string, string> : undefined, stderr: "pipe" });
      transport.stderr?.on("data", (chunk) => this.logs.push("warn", redactSecrets(String(chunk), env)));
      return transport;
    }
    const headers = resolveSecretReferences(this.config.headers);
    const requestInit = headers ? { headers } : undefined;
    return this.config.transport === "sse"
      ? new SSEClientTransport(new URL(this.config.url), { requestInit })
      : new StreamableHTTPClientTransport(new URL(this.config.url), { requestInit });
  }

  private handleUnexpectedClose(): void {
    if (this.intentionalClose || this.snapshotValue.status === "stopping" || this.snapshotValue.status === "disabled") return;
    if (this.snapshotValue.connectedAt && Date.now() - this.snapshotValue.connectedAt >= 30_000) this.reconnectAttempts = 0;
    this.client = undefined;
    this.transport = undefined;
    this.setState({ status: "disconnected", tools: [], prompts: [], resources: [], lastError: "MCP bağlantısı beklenmedik şekilde kapandı" });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const reconnect = this.config.reconnect || { enabled: true, maxAttempts: 5, baseDelayMs: 1_000 };
    if (!this.config.enabled || !reconnect.enabled || this.reconnectAttempts >= reconnect.maxAttempts || this.reconnectTimer) {
      if (this.reconnectAttempts >= reconnect.maxAttempts) this.setState({ status: "error", lastError: "MCP yeniden bağlanma sınırına ulaştı" });
      return;
    }
    const attempt = ++this.reconnectAttempts;
    const delay = Math.min(30_000, reconnect.baseDelayMs * 2 ** (attempt - 1));
    this.logs.push("warn", `Bağlantı kesildi; ${delay} ms sonra yeniden denenecek (${attempt}/${reconnect.maxAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch(() => this.scheduleReconnect());
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private async closeTransport(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = undefined;
    this.transport = undefined;
    try {
      if (client) await withTimeout(client.close(), 2_000, "MCP kapanışı zaman aşımına uğradı");
      else if (transport) await withTimeout(transport.close(), 2_000, "MCP transport kapanışı zaman aşımına uğradı");
    } catch { /* best effort; stdio transport close terminates its child process */ }
  }

  private setState(patch: Partial<McpServerRuntimeSnapshot>): void {
    this.snapshotValue = { ...this.snapshotValue, ...patch };
    this.onChanged();
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
