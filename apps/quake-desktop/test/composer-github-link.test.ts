import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  composeGithubLinkValue,
  githubLinkWithDisplayText,
  githubLinkWithUrl,
  parseComposerGithubLink,
} from "../src/client/src/lib/composer-github-link";

const root = process.cwd();
const composer = readFileSync(join(root, "src/client/src/components/composer/ChatComposer.tsx"), "utf8");
const token = readFileSync(join(root, "src/client/src/components/composer/ComposerGithubLinkToken.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/src/components/composer/ComposerGithubLinkToken.module.css"), "utf8");

describe("composer GitHub link token", () => {
  it("recognizes GitHub URLs and keeps following text editable", () => {
    expect(parseComposerGithubLink("https://github.com/anthropics/skills/tree/main/skills/pdf devam")).toEqual({
      source: "https://github.com/anthropics/skills/tree/main/skills/pdf",
      displayText: "https://github.com/anthropics/skills/tree/main/skills/pdf",
      url: "https://github.com/anthropics/skills/tree/main/skills/pdf",
      rest: "devam",
      format: "url",
    });
  });

  it("recognizes owner/repository but avoids ordinary source files", () => {
    expect(parseComposerGithubLink("anthropics/claude-code")?.url).toBe("https://github.com/anthropics/claude-code");
    expect(parseComposerGithubLink("src/index.ts")).toBeUndefined();
  });

  it("supports editing link text and destination", () => {
    const link = parseComposerGithubLink("anthropics/claude-code")!;
    expect(githubLinkWithDisplayText(link, "Claude Code")).toBe("[Claude Code](https://github.com/anthropics/claude-code)");
    expect(githubLinkWithUrl(link, "openai/codex")).toBe("openai/codex");
    expect(composeGithubLinkValue("openai/codex", "incele")).toBe("openai/codex incele");
  });

  it("renders an inline token with the reference toolbar actions", () => {
    expect(composer).toContain("<ComposerGithubLinkToken");
    expect(composer).toContain('data-inline-content={documentModeActive || githubLink ? "true" : undefined}');
    expect(token).toContain("Open link");
    expect(token).toContain("Metni düzenle");
    expect(token).toContain("Bağlantıyı düzenle");
    expect(token).toContain("desktop.browser.openExternal(link.url)");
    expect(styles).toContain("bottom: calc(100% + 14px)");
  });
});
