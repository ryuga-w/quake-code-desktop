/**
 * Source contracts for durable MCP always-allow (T4.C1).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const approvalCache = readFileSync(join(root, "src/server/mcp/approval-cache.ts"), "utf8");
const index = readFileSync(join(root, "src/server/index.ts"), "utf8");
const settings = readFileSync(join(root, "src/client/src/components/settings/SettingsPanels.tsx"), "utf8");
const composerApproval = readFileSync(join(root, "src/client/src/components/security/ComposerApproval.tsx"), "utf8");
const toolAdapter = readFileSync(join(root, "src/server/mcp/tool-adapter.ts"), "utf8");

describe("MCP durable always-allow source contracts (T4.C1)", () => {
  it("persists always allows under quake-code desktop store and loads on boot", () => {
    expect(approvalCache).toContain("mcp-always-allows.json");
    expect(approvalCache).toContain("loadDurableMcpAlwaysAllows");
    expect(approvalCache).toContain("schedulePersist");
    expect(approvalCache).toContain('scope === "always"');
    expect(index).toContain("loadDurableMcpAlwaysAllows");
    // Boot load before reconcile / tool use
    expect(index.indexOf("loadDurableMcpAlwaysAllows")).toBeLessThan(index.indexOf("mcpManager.reconcile"));
  });

  it("exposes list / remove / clear API without logging tokens", () => {
    expect(index).toContain("/api/mcp/always-allows");
    expect(index).toContain("listMcpAlwaysAllows");
    expect(index).toContain("removeMcpAlwaysAllow");
    expect(index).toContain("clearMcpAlwaysAllows");
    expect(index).toContain("/api/mcp/always-allows/clear");
    // Auth token must not be logged (existing boot message)
    expect(index).toContain("token not logged");
    expect(index).not.toMatch(/console\.log\([^)]*auth\.token/);
  });

  it("Settings MCP section manages durable always-allow list in Turkish", () => {
    expect(settings).toContain("Her zaman izin verilen MCP araçları");
    expect(settings).toContain("/api/mcp/always-allows");
    expect(settings).toContain("yeniden başlatmadan sonra da geçerli");
    expect(settings).toContain("Tümünü temizle");
    expect(settings).toContain("Kaldır");
  });

  it("Composer always-allow is durable (not session-only copy) and adapter remembers always", () => {
    expect(composerApproval).toContain("Her zaman izin ver");
    expect(composerApproval).toContain("yeniden başlatmada da geçerli");
    expect(toolAdapter).toContain('rememberMcpToolApproval(serverId, tool.name, "always")');
    expect(toolAdapter).toContain('rememberMcpToolApproval(serverId, tool.name, "session")');
  });

  it("session allows stay separate from durable always", () => {
    expect(approvalCache).toContain("sessionAllows");
    expect(approvalCache).toContain("clearMcpSessionApprovals");
    expect(approvalCache).toMatch(/scope === "always"[\s\S]*schedulePersist|alwaysAllows\.add[\s\S]*schedulePersist/);
    // session branch must not schedule persist
    const sessionBlock = approvalCache.slice(
      approvalCache.indexOf('scope: "session" | "always"'),
      approvalCache.indexOf("export function removeMcpAlwaysAllow"),
    );
    expect(sessionBlock).toContain("sessionAllows.add");
    expect(sessionBlock).not.toMatch(/sessionAllows\.add[\s\S]*schedulePersist/);
  });
});
