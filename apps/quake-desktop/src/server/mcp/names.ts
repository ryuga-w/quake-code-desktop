import { createHash } from "node:crypto";

export function mcpToolName(serverName: string, toolName: string): string {
  const server = slug(serverName);
  const tool = slug(toolName);
  const base = `mcp__${server || "server"}__${tool || "tool"}`;
  if (base.length <= 64) return base;
  const hash = createHash("sha256").update(`${serverName}\0${toolName}`).digest("hex").slice(0, 8);
  return `${base.slice(0, 55)}_${hash}`;
}

function slug(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}
