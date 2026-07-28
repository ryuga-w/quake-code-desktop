/**
 * Source contracts for first-run trust onboarding (S-TRUST.3).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WebSettingsService } from "../src/server/web-settings.js";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = process.cwd();
const modal = readFileSync(join(root, "src/client/src/components/security/TrustOnboardingModal.tsx"), "utf8");
const storage = readFileSync(join(root, "src/client/src/components/settings/settings-storage.ts"), "utf8");
const main = readFileSync(join(root, "src/client/src/app/App.tsx"), "utf8");
const trustOnboarding = readFileSync(join(root, "src/client/src/app/hooks/useTrustOnboarding.ts"), "utf8");
const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");
const webSettings = readFileSync(join(root, "src/server/web-settings.ts"), "utf8");

describe("Trust onboarding source contracts (S-TRUST.3)", () => {
  it("ships Turkish copy for workspace, access modes, worktree, OS sandbox honesty, and proxy", () => {
    expect(modal).toContain("Güven ve erişim");
    expect(modal).toContain("Anladım");
    expect(modal).toContain("İzinler'e git");
    expect(modal).toContain("Çalışma alanı sınırı");
    expect(modal).toContain("Default ve Full Access");
    expect(modal).toContain("Paralel ajanlar (worktree)");
    expect(modal).toContain("Windows Sandbox değildir");
    expect(modal).toContain("İsteğe bağlı ağ proxy");
    expect(modal).toContain("HTTP_PROXY");
    // Only deny Windows Sandbox claim — never brand as Windows Sandbox.
    expect(modal).toMatch(/Windows Sandbox.*değil/);
  });

  it("uses accessible dialog with role=dialog and focus trap", () => {
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain("aria-labelledby");
    expect(modal).toContain("getFocusable");
    expect(modal).toContain('event.key === "Escape"');
    expect(modal).toContain('event.key !== "Tab"');
  });

  it("persists trustOnboardingSeen in localStorage key and global web-settings", () => {
    expect(storage).toContain('trustOnboardingSeen: "quake-web:trustOnboardingSeen"');
    expect(storage).toContain("loadTrustOnboardingSeen");
    expect(storage).toContain("saveTrustOnboardingSeen");
    expect(webSettings).toContain("trustOnboardingSeen?: boolean");
    expect(webSettings).toContain('"trustOnboardingSeen"');
    expect(main).toContain("useTrustOnboarding");
    expect(trustOnboarding).toContain("saveTrustOnboardingSeen(true)");
    expect(trustOnboarding).toContain('apiPost("/api/web-settings", { trustOnboardingSeen: true })');
    expect(trustOnboarding).toContain("loadTrustOnboardingSeen");
  });

  it("shows after boot shell ready and opens permissions settings from secondary CTA", () => {
    expect(shell).toContain("TrustOnboardingModal");
    expect(shell).toContain("trustOnboardingOpen && !bootSplash");
    expect(shell).toContain('openSettingsPage("permissions")');
    expect(main).toContain("dismissTrustOnboarding");
    // Must not block forever when settings fail
    expect(trustOnboarding).toContain("Settings unavailable must not block");
  });

  it("persists trustOnboardingSeen in application-wide desktop settings", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "quake-trust-onboarding-"));
    const workspace = join(tmp, "workspace");
    const globalDirectory = join(tmp, "global");
    await mkdir(workspace, { recursive: true });

    const service = new WebSettingsService(workspace, globalDirectory);
    await service.patch({ trustOnboardingSeen: true, fileDir: "src" });

    const other = await new WebSettingsService(join(tmp, "other"), globalDirectory).read();
    expect(other.trustOnboardingSeen).toBe(true);
    expect(other.fileDir).toBeUndefined();
    expect(JSON.parse(await readFile(join(globalDirectory, "desktop-settings.json"), "utf8"))).toMatchObject({
      trustOnboardingSeen: true,
    });
  });
});
