import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const turnChanges = readFileSync(
  join(root, "src/client/src/components/tools/TurnFileChangesCard.tsx"),
  "utf8",
);
const providers = readFileSync(
  join(root, "src/client/src/components/settings/ProvidersSection.tsx"),
  "utf8",
);

describe("shared confirmation flows", () => {
  it("guards whole-turn undo with the themed async confirmation dialog", () => {
    expect(turnChanges).toContain('import { useConfirmAction } from "../common/ConfirmContext"');
    expect(turnChanges).toContain("const { confirm } = useConfirmAction()");
    expect(turnChanges).toContain('title: "Tur değişikliklerini geri al"');
    expect(turnChanges).toContain('confirmLabel: "Geri al"');
    expect(turnChanges).toContain("confirmed = await confirm({");
    expect(turnChanges).toContain("if (!confirmed) return");
    expect(turnChanges).toContain("setBusy(true)");
    expect(turnChanges.indexOf("if (!confirmed) return")).toBeLessThan(turnChanges.indexOf("setBusy(true)"));
    expect(turnChanges).not.toContain("window.confirm");
  });

  it("guards provider-wide and single-account removal with shared confirmations", () => {
    expect(providers).toContain('import { useConfirmAction } from "../common/ConfirmContext"');
    expect(providers).toContain("const { confirm } = useConfirmAction()");
    expect(providers).toContain('confirmLabel: "Tüm hesapları kaldır"');
    expect(providers).toContain('confirmLabel: "Hesabı kaldır"');
    expect(providers.match(/const accepted = await confirm\(\{/g)).toHaveLength(2);
    expect(providers.match(/if \(!accepted\) return/g)).toHaveLength(2);
    expect(providers).not.toContain("window.confirm");
  });
});
