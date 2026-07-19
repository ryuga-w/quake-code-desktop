import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const menu = readFileSync(join(root, "src/client/src/components/composer/ComposerMentionMenu.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/src/components/composer/ComposerMentionMenu.module.css"), "utf8");
const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");

describe("composer mention menu source contract", () => {
  it("opens a result menu for an at-mention and prioritizes Documents", () => {
    expect(menu).toContain('prompt.match(/(^|\\s)@([^\\s@]*)$/)');
    expect(menu).toContain('insertText: extension.kind === "documents" ? "@documents "');
    expect(menu).toContain("EXTENSION_MENTIONS");
    expect(menu).toContain("...extensionItems, ...fileItems, ...historyItems");
    expect(shell).toContain("<ComposerMentionMenu");
  });

  it("supports keyboard selection in the composer-width popup", () => {
    expect(menu).toContain('event.key === "Enter" || event.key === "Tab"');
    expect(menu).toContain('event.key === "ArrowDown" || event.key === "ArrowUp"');
    expect(styles).toContain("var(--composer-max-width, 720px)");
    expect(styles).toContain("margin: 0 auto 4px");
  });
});
