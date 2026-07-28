/**
 * Source contracts for durable guardian always-allows (S-TRUST.1–2).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const index = readFileSync(join(root, "src/server/index.ts"), "utf8");
const settings = readFileSync(join(root, "src/client/src/components/settings/SettingsPanels.tsx"), "utf8");
const composerApproval = readFileSync(
  join(root, "src/client/src/components/security/ComposerApproval.tsx"),
  "utf8",
);
const protocol = readFileSync(join(root, "src/shared/protocol.ts"), "utf8");

describe("Guardian durable always-allow source contracts (S-TRUST.1–2)", () => {
  it("loads durable guardian allows on boot before tools and keeps MCP path separate", () => {
    expect(index).toContain("loadDurableGuardianAllows");
    expect(index).toContain("loadDurableMcpAlwaysAllows");
    // Boot load call sites (not imports): MCP then guardian, both before mcp reconcile
    const mcpBoot = index.indexOf("await loadDurableMcpAlwaysAllows()");
    const guardianBoot = index.indexOf("await loadDurableGuardianAllows()");
    const reconcile = index.indexOf("mcpManager.reconcile");
    expect(mcpBoot).toBeGreaterThan(-1);
    expect(guardianBoot).toBeGreaterThan(-1);
    expect(mcpBoot).toBeLessThan(guardianBoot);
    expect(guardianBoot).toBeLessThan(reconcile);
  });

  it("exposes list / remove / clear API without logging tokens", () => {
    expect(index).toContain("/api/security/guardian-allows");
    expect(index).toContain("listDurableGuardianAllows");
    expect(index).toContain("removeGuardianAlwaysCommandKey");
    expect(index).toContain("removeGuardianAlwaysPrefix");
    expect(index).toContain("removeGuardianAlwaysHost");
    expect(index).toContain("clearDurableGuardianAllows");
    expect(index).toContain("/api/security/guardian-allows/clear");
    // Auth token must not be logged
    expect(index).toContain("token not logged");
    expect(index).not.toMatch(/console\.log\([^)]*auth\.token/);
  });

  it("acceptAlways is durable write-through for guardian (not remapped to session-only)", () => {
    expect(index).toContain("acceptAlways is durable write-through");
    expect(index).not.toMatch(
      /Map acceptAlways → acceptForSession for guardian|acceptAlways" \? "acceptForSession"/,
    );
    expect(index).toContain('scope: (command as any).scope === "always" ? "always" : "session"');
    expect(protocol).toContain('scope?: "session" | "always"');
  });

  it("Settings İzinler section has Kalıcı izinler card in Turkish", () => {
    expect(settings).toContain("Kalıcı izinler");
    expect(settings).toContain("/api/security/guardian-allows");
    expect(settings).toContain("yeniden başlatmadan");
    expect(settings).toContain("Tümünü temizle");
    expect(settings).toContain("Kaldır");
    expect(settings).toContain("GuardianDurableAllowsSection");
    // MCP card remains separate
    expect(settings).toContain("Her zaman izin verilen MCP araçları");
  });

  it("Composer offers durable always for guardian, prefix, and host", () => {
    expect(composerApproval).toContain('t("runtime.approval.always")');
    expect(composerApproval).toContain('t("runtime.approval.alwaysDescription")');
    expect(composerApproval).toContain('t("runtime.approval.allowPrefixAlways"');
    expect(composerApproval).toContain('t("runtime.approval.allowHostAlways"');
    expect(composerApproval).toContain('scope: "always"');
    expect(composerApproval).toContain("acceptAlways");
  });

  it("documents that session clear does not wipe durable", () => {
    expect(index).toContain("session clear does NOT wipe");
  });
});
