import type { McpLogEntry } from "./types.js";

export class McpLogBuffer {
  private entries: McpLogEntry[] = [];
  constructor(private readonly limit = 300) {}

  push(level: McpLogEntry["level"], message: string): void {
    this.entries.push({ timestamp: Date.now(), level, message: message.slice(0, 8_000) });
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
  }

  snapshot(): McpLogEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }
}
