import { McpConnection } from "./connection.js";
import type { McpLogEntry, McpServerConfig, McpServerRuntimeSnapshot } from "./types.js";

export class McpConnectionManager {
  private readonly connections = new Map<string, McpConnection>();
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(private readonly onChanged: () => void = () => {}) {}

  list(): McpServerRuntimeSnapshot[] {
    return [...this.connections.values()].map((connection) => connection.snapshot);
  }

  get(id: string): McpConnection | undefined {
    return this.connections.get(id);
  }

  async reconcile(configs: McpServerConfig[]): Promise<void> {
    const wanted = new Map(configs.map((config) => [config.id, config]));
    for (const [id, connection] of this.connections) {
      const next = wanted.get(id);
      if (!next || JSON.stringify(next) !== JSON.stringify(connection.config)) {
        await connection.disconnect();
        this.connections.delete(id);
      }
    }
    for (const config of configs) {
      if (!this.connections.has(config.id)) this.connections.set(config.id, new McpConnection(config, this.onChanged));
    }
    this.onChanged();
    await Promise.allSettled(configs.filter((config) => config.enabled && config.autoStart).map((config) => this.connect(config.id)));
  }

  connect(id: string): Promise<McpServerRuntimeSnapshot> {
    return this.singleFlight(id, async () => this.require(id).connect());
  }

  async disconnect(id: string): Promise<void> {
    await this.singleFlight(id, async () => this.require(id).disconnect());
  }

  async restart(id: string): Promise<McpServerRuntimeSnapshot> {
    return this.singleFlight(id, async () => {
      const connection = this.require(id);
      await connection.disconnect();
      return connection.connect();
    });
  }

  async callTool(id: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.require(id).callTool(name, args, signal);
  }

  async readResource(id: string, uri: string, signal?: AbortSignal): Promise<unknown> {
    return this.require(id).readResource(uri, signal);
  }

  async getPrompt(id: string, name: string, args?: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    return this.require(id).getPrompt(name, args, signal);
  }

  logs(id: string): McpLogEntry[] {
    return this.require(id).logs.snapshot();
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.connections.values()].map((connection) => connection.disconnect()));
    this.connections.clear();
  }

  private require(id: string): McpConnection {
    const connection = this.connections.get(id);
    if (!connection) throw new Error("MCP sunucusu bulunamadı");
    return connection;
  }

  private singleFlight<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const current = this.pending.get(id);
    if (current) return current as Promise<T>;
    const promise = operation().finally(() => this.pending.delete(id));
    this.pending.set(id, promise);
    return promise;
  }
}
