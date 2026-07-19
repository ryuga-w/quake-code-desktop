import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readArtifactTemplateCatalog,
  readArtifactTemplatePreview,
  readArtifactTemplateSkill,
  resolveArtifactTemplateSkillsDir,
} from "../src/server/artifact-templates";

const createdRoots: string[] = [];
const originalOverride = process.env.QUAKE_ARTIFACT_TEMPLATE_SKILLS_DIR;

afterEach(() => {
  if (originalOverride === undefined) delete process.env.QUAKE_ARTIFACT_TEMPLATE_SKILLS_DIR;
  else process.env.QUAKE_ARTIFACT_TEMPLATE_SKILLS_DIR = originalOverride;
  for (const root of createdRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("artifact template catalog", () => {
  it("loads OpenAI template metadata and retained preview assets", () => {
    const skillsDir = createFixture();
    process.env.QUAKE_ARTIFACT_TEMPLATE_SKILLS_DIR = skillsDir;

    expect(resolveArtifactTemplateSkillsDir()).toBe(skillsDir);
    expect(readArtifactTemplateCatalog(skillsDir, "document")).toEqual([
      expect.objectContaining({
        id: "artifact-template-design-report",
        skillName: "artifact-template-design-report",
        displayName: "Design Report",
        description: "Create documents with the Design Report template",
        defaultPrompt: "Create a new document with this template.",
        kind: "document",
        previewUrl: "/api/artifact-templates/preview?id=artifact-template-design-report",
      }),
    ]);
    expect(readArtifactTemplatePreview("artifact-template-design-report")).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(readArtifactTemplateSkill("artifact-template-design-report")).toEqual({
      path: expect.stringMatching(/^openai-templates\/.+\/skills\/artifact-template-design-report\/SKILL\.md$/),
      content: expect.stringContaining("# Design Report"),
    });
  });

  it("rejects unsafe preview identifiers", () => {
    const skillsDir = createFixture();
    process.env.QUAKE_ARTIFACT_TEMPLATE_SKILLS_DIR = skillsDir;
    expect(readArtifactTemplatePreview("../artifact-template-design-report")).toBeUndefined();
    expect(readArtifactTemplatePreview("artifact-template-design-report/../../secret")).toBeUndefined();
    expect(readArtifactTemplateSkill("../artifact-template-design-report")).toBeUndefined();
  });
});

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "quake-artifact-templates-"));
  createdRoots.push(root);
  const skillDir = join(root, "artifact-template-design-report");
  mkdirSync(join(skillDir, "agents"), { recursive: true });
  mkdirSync(join(skillDir, "assets"), { recursive: true });
  writeFileSync(join(skillDir, "artifact-template.json"), JSON.stringify({
    schemaVersion: 1,
    kind: "document",
    reference: "assets/reference.docx",
    preview: "assets/preview.png",
  }));
  writeFileSync(join(skillDir, "SKILL.md"), [
    "---",
    "name: artifact-template-design-report",
    'description: "Create a document using the Design Report template."',
    "---",
    "# Design Report",
  ].join("\n"));
  writeFileSync(join(skillDir, "agents", "openai.yaml"), [
    "interface:",
    '  display_name: "Design Report"',
    '  short_description: "Create documents with the Design Report template"',
    '  default_prompt: "Create a new document with this template."',
  ].join("\n"));
  writeFileSync(join(skillDir, "assets", "preview.png"), Buffer.from([1, 2, 3, 4]));
  writeFileSync(join(skillDir, "assets", "reference.docx"), Buffer.from([5, 6]));
  return root;
}
