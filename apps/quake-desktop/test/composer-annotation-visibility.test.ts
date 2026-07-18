import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { textFromMessage } from "../src/client/src/lib/render";

const appSource = readFileSync(join(process.cwd(), "src/client/src/app/App.tsx"), "utf8");
const appShellSource = readFileSync(join(process.cwd(), "src/client/src/app/AppShell.tsx"), "utf8");
const composerHelpersSource = readFileSync(join(process.cwd(), "src/client/src/components/composer/ComposerHelpers.tsx"), "utf8");
const composerDraftSource = readFileSync(join(process.cwd(), "src/client/src/app/hooks/useComposerDraft.ts"), "utf8");
const protocolSource = readFileSync(join(process.cwd(), "src/shared/protocol.ts"), "utf8");
const serverSource = readFileSync(join(process.cwd(), "src/server/index.ts"), "utf8");

describe("composer annotation visibility", () => {
  it("renders persisted display text instead of model-only annotation context", () => {
    expect(textFromMessage({
      role: "user",
      displayContent: "Google alanlarını düzenle",
      content: [{ type: "text", text: "Google alanlarını düzenle\n\n### Açıklama 1 · 5 açıklama\n[Tarayıcı Açıklamaları]\nURL: https://www.google.com/" }],
    })).toBe("Google alanlarını düzenle");
  });

  it("cleans annotation payloads persisted by older clients", () => {
    const legacy = [
      "### Açıklama 1 · 5 açıklama",
      "[Tarayıcı Açıklamaları]",
      "URL: https://www.google.com/",
      "",
      "1. input",
      "   Açıklama: 9965",
      "",
      "[Bağlam]",
      "### annotation: 5 açıklama",
    ].join("\n");
    expect(textFromMessage({ role: "user", content: legacy })).toBe("Bu görseli incele.");
    expect(textFromMessage({ role: "user", content: `Alanı büyüt\n\n${legacy}` })).toBe("Alanı büyüt");
  });

  it("sends annotation context once and carries a separate display message", () => {
    expect(appSource).toContain('contextChips.filter((chip) => chip.type !== "annotation")');
    expect(appSource).toContain("displayMessage: outgoingDisplayMessage");
    expect(protocolSource).toContain("displayMessage?: string");
    expect(serverSource).toContain("displayMessage: command.displayMessage");
  });

  it("shows browser annotations only on the composer attachment", () => {
    expect(composerHelpersSource).toContain('chips.filter((chip) => chip.type !== "annotation")');
    expect(composerHelpersSource).not.toContain("annotation-context-summary");
    expect(appShellSource).not.toContain('type: "annotation" as const');
    expect(composerDraftSource).toContain('chip.type !== "annotation" || chip.id !== id');
  });
});
