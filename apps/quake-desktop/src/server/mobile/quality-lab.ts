import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { MobileSemanticSnapshot, MobileRuntimeLog } from "./types.js";

export function accessibilityAudit(snapshot: MobileSemanticSnapshot) {
  const issues = snapshot.nodes.flatMap((node) => {
    const result: Array<{ ref: string; rule: string; message: string }> = [];
    if (node.clickable && !node.text && !node.contentDescription) result.push({ ref: node.ref, rule: "clickable-name", message: "Tıklanabilir elementin erişilebilir adı yok" });
    if (node.bounds && (node.bounds.right - node.bounds.left < 44 || node.bounds.bottom - node.bounds.top < 44) && node.clickable) result.push({ ref: node.ref, rule: "touch-target", message: "Dokunma hedefi 44px'den küçük" });
    return result;
  });
  return { passed: !issues.length, issues };
}

export function runtimeQuality(logs: MobileRuntimeLog[]) { return { crashes: logs.filter((log) => log.event === "crash"), anrs: logs.filter((log) => log.event === "anr") }; }

export class ScreenshotBaselines {
  constructor(private workspace: string) {}
  setWorkspace(workspace: string) { this.workspace = workspace; }
  private path(name: string) { if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error("Geçersiz baseline adı"); return join(this.workspace, ".quake-code", "mobile-baselines", `${name}.png`); }
  update(name: string, image: Buffer, confirmed: boolean) { if (!confirmed) throw new Error("Baseline güncelleme açık onay gerektirir"); const path = this.path(name); mkdirSync(join(this.workspace, ".quake-code", "mobile-baselines"), { recursive: true }); writeFileSync(path, image); return { name, hash: createHash("sha256").update(image).digest("hex") }; }
  compare(name: string, image: Buffer) { const path = this.path(name); if (!existsSync(path)) return { exists: false, equal: false }; const baseline = readFileSync(path); return { exists: true, equal: baseline.equals(image), baselineHash: createHash("sha256").update(baseline).digest("hex"), actualHash: createHash("sha256").update(image).digest("hex"), sizeDelta: image.length - baseline.length }; }
  remove(name: string, confirmed: boolean) { if (!confirmed) throw new Error("Baseline silme açık onay gerektirir"); rmSync(this.path(name), { force: true }); }
}
