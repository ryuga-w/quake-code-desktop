import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const composer = readFileSync(join(root, "src/client/src/components/composer/ChatComposer.tsx"), "utf8");
const gallery = readFileSync(join(root, "src/client/src/components/composer/DocumentTemplateGallery.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/src/components/composer/DocumentTemplateGallery.module.css"), "utf8");
const app = readFileSync(join(root, "src/client/src/app/App.tsx"), "utf8");

describe("document template gallery source contract", () => {
  it("opens Documents mode from the built-in docx command or typed label", () => {
    expect(composer).toContain('prompt.match(/^(?:@documents(?:\\[([a-z0-9-]+)\\])?\\s+|\\/(?:docx|documents?)\\s*)/i)');
    expect(composer).toContain("selectedDocumentSkill");
    expect(composer).toContain('if (/^documents$/i.test(prompt.trim())) onPromptChange("/docx ")');
    expect(composer).toContain("<DocumentTemplateGallery");
    expect(composer).toContain('onPromptChange(`@documents[${template.skillName}] ${visiblePrompt}`)');
    expect(app).toContain("parseDocumentTemplateInvocation(message)");
    expect(app).toContain("`Use $${documentSkill} to create a new document with the selected retained template.`");
    expect(composer).toContain("styles.documentModeLabel");
    expect(composer).toContain("styles.documentTemplateChip");
    expect(composer).toContain("onOpenDocumentSkill?.(selectedDocumentSkill)");
    expect(composer).toContain('data-document-mode={documentModeActive ? "true" : undefined}');
  });

  it("offers a scrollable template gallery above the composer", () => {
    expect(gallery).toContain("Şablonlar");
    expect(gallery).toContain('apiGet<{ templates?: WebArtifactTemplate[] }>("/api/artifact-templates?kind=document")');
    expect(gallery).toContain("apiGetBlob(template.previewUrl)");
    expect(gallery).toContain("URL.createObjectURL(blob)");
    expect(gallery).toContain("URL.revokeObjectURL(objectUrl)");
    expect(gallery).toContain('<img src={previewUrls[template.id]}');
    expect(gallery).toContain("template.displayName");
    expect(gallery).toContain("Şablon oluştur");
    expect(gallery).toContain("scrollBy({ left: direction * 320");
    expect(styles).toContain("bottom: calc(100% + 8px)");
    expect(styles).toContain("overflow-x: auto");
  });
});
