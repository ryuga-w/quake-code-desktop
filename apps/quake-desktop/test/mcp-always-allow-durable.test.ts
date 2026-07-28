/**
 * Durable MCP always-allow store: load / save / remove / clear across "restarts".
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAllMcpApprovals,
  clearMcpAlwaysAllows,
  clearMcpSessionApprovals,
  configureMcpAlwaysAllowStore,
  flushMcpAlwaysAllowWrites,
  isMcpToolApproved,
  listMcpAlwaysAllows,
  loadDurableMcpAlwaysAllows,
  parseMcpApprovalKey,
  rememberMcpToolApproval,
  removeMcpAlwaysAllow,
} from "../src/server/mcp/approval-cache.js";

describe("MCP always-allow durable cache", () => {
  let storePath = "";

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "quake-mcp-always-"));
    storePath = join(dir, "mcp-always-allows.json");
    configureMcpAlwaysAllowStore({ path: storePath, resetMemory: true });
    await loadDurableMcpAlwaysAllows(storePath);
  });

  afterEach(async () => {
    clearAllMcpApprovals();
    await flushMcpAlwaysAllowWrites();
    // Disable further writes to this path
    configureMcpAlwaysAllowStore({ path: join(tmpdir(), "quake-mcp-always-disabled.json"), resetMemory: true });
  });

  it("write-through remember(always) survives load (restart)", async () => {
    rememberMcpToolApproval("srv-a", "delete_file", "always");
    rememberMcpToolApproval("srv-a", "read_file", "session");
    await flushMcpAlwaysAllowWrites();

    expect(isMcpToolApproved("srv-a", "delete_file")).toBe(true);
    expect(isMcpToolApproved("srv-a", "read_file")).toBe(true);

    // Simulate process restart: new memory + load from same file
    configureMcpAlwaysAllowStore({ path: storePath, resetMemory: true });
    expect(isMcpToolApproved("srv-a", "delete_file")).toBe(false);
    expect(isMcpToolApproved("srv-a", "read_file")).toBe(false);

    await loadDurableMcpAlwaysAllows(storePath);
    expect(isMcpToolApproved("srv-a", "delete_file")).toBe(true);
    // Session allow must NOT be durable
    expect(isMcpToolApproved("srv-a", "read_file")).toBe(false);

    const onDisk = JSON.parse(await readFile(storePath, "utf8"));
    expect(onDisk.version).toBe(1);
    expect(onDisk.keys).toEqual(["srv-a::delete_file"]);
  });

  it("list / remove one / clear all update disk", async () => {
    rememberMcpToolApproval("s1", "tool_a", "always");
    rememberMcpToolApproval("s2", "tool_b", "always");
    await flushMcpAlwaysAllowWrites();

    const listed = listMcpAlwaysAllows();
    expect(listed.map((e) => e.key).sort()).toEqual(["s1::tool_a", "s2::tool_b"]);

    expect(removeMcpAlwaysAllow("s1", "tool_a")).toBe(true);
    expect(removeMcpAlwaysAllow("s1", "tool_a")).toBe(false);
    await flushMcpAlwaysAllowWrites();
    expect(isMcpToolApproved("s1", "tool_a")).toBe(false);
    expect(isMcpToolApproved("s2", "tool_b")).toBe(true);
    expect(JSON.parse(await readFile(storePath, "utf8")).keys).toEqual(["s2::tool_b"]);

    clearMcpAlwaysAllows();
    await flushMcpAlwaysAllowWrites();
    expect(listMcpAlwaysAllows()).toEqual([]);
    expect(JSON.parse(await readFile(storePath, "utf8")).keys).toEqual([]);
  });

  it("clearAllMcpApprovals empties durable always when persistence is on", async () => {
    rememberMcpToolApproval("s", "t", "always");
    rememberMcpToolApproval("s", "sess", "session");
    await flushMcpAlwaysAllowWrites();

    clearAllMcpApprovals();
    await flushMcpAlwaysAllowWrites();
    expect(isMcpToolApproved("s", "t")).toBe(false);
    expect(isMcpToolApproved("s", "sess")).toBe(false);
    expect(JSON.parse(await readFile(storePath, "utf8")).keys).toEqual([]);
  });

  it("clearMcpSessionApprovals does not touch durable always", async () => {
    rememberMcpToolApproval("s", "always_tool", "always");
    rememberMcpToolApproval("s", "session_tool", "session");
    await flushMcpAlwaysAllowWrites();

    clearMcpSessionApprovals();
    expect(isMcpToolApproved("s", "always_tool")).toBe(true);
    expect(isMcpToolApproved("s", "session_tool")).toBe(false);
    expect(JSON.parse(await readFile(storePath, "utf8")).keys).toEqual(["s::always_tool"]);
  });

  it("parseMcpApprovalKey handles serverId::toolName", () => {
    expect(parseMcpApprovalKey("abc::run")).toEqual({ serverId: "abc", toolName: "run" });
    expect(parseMcpApprovalKey("::no")).toBeNull();
    expect(parseMcpApprovalKey("no::")).toBeNull();
    expect(parseMcpApprovalKey("plain")).toBeNull();
  });

  it("memory-only mode (no load) does not write disk — safe for pure unit tests", async () => {
    configureMcpAlwaysAllowStore({ path: storePath, resetMemory: true });
    // no loadDurableMcpAlwaysAllows → persistEnabled false
    rememberMcpToolApproval("x", "y", "always");
    clearAllMcpApprovals();
    await flushMcpAlwaysAllowWrites();
    // File may not exist (never written)
    await expect(readFile(storePath, "utf8")).rejects.toThrow();
  });
});
