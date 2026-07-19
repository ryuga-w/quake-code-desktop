import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const server = readFileSync(join(root, "src/server/index.ts"), "utf8");
const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");
const composer = readFileSync(join(root, "src/client/src/components/composer/ChatComposer.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/src/components/composer/ChatComposer.module.css"), "utf8");

describe("artifact template skill panel source contract", () => {
  it("opens the selected template SKILL.md in the files panel", () => {
    expect(server).toContain('url.pathname === "/api/artifact-templates/skill"');
    expect(shell).toContain("openArtifactTemplateSkill");
    expect(shell).toContain("/api/artifact-templates/skill?id=");
    expect(shell).toContain("setFilePreview({ path: skill.path, content: skill.content })");
    expect(shell).toContain('openRightPanel("files")');
    expect(composer).toContain("onOpenDocumentSkill?.(selectedDocumentSkill)");
  });

  it("keeps Documents, selected template, and input on one composer row", () => {
    expect(composer).toContain("styles.documentModeLabel");
    expect(composer).toContain("styles.documentTemplateChip");
    expect(styles).toMatch(/\.inputRow\[data-inline-content="true"\] \{[\s\S]*?display: flex;[\s\S]*?align-items: center;/);
    expect(styles).toContain('.inputRow[data-inline-content="true"] textarea');
  });
});
