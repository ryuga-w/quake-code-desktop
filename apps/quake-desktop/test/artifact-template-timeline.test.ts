import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  artifactTemplateMessageMeta,
  artifactTemplateRestorePrompt,
} from "../src/client/src/lib/artifact-template-message";

const root = process.cwd();
const timeline = readFileSync(join(root, "src/client/src/components/timeline/Timeline.tsx"), "utf8");
const appShell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/styles.css"), "utf8");

describe("artifact template timeline presentation", () => {
  it("recognizes persisted hidden model instructions and hides the runtime envelope", () => {
    const meta = artifactTemplateMessageMeta({
      role: "user",
      content: [
        {
          type: "text",
          text: "Use $artifact-template-experiment-analysis to create a new document with the selected retained template.\n\nCreate a new document with this template.",
        },
      ],
      displayContent: "Documents · Experiment Analysis",
    }, "Documents · Experiment Analysis");

    expect(meta).toEqual({
      skillName: "artifact-template-experiment-analysis",
      displayName: "Experiment Analysis",
      userText: "",
    });
    expect(artifactTemplateRestorePrompt(meta!)).toBe("@documents[artifact-template-experiment-analysis] ");
  });

  it("keeps genuine user instructions beside the template chips", () => {
    expect(artifactTemplateMessageMeta({
      role: "user",
      content: "Use $artifact-template-system-design to create a new document with the selected retained template.\n\nBir ödeme sistemi tasarla.",
      displayContent: "Bir ödeme sistemi tasarla.",
    }, "Bir ödeme sistemi tasarla.")?.userText).toBe("Bir ödeme sistemi tasarla.");
  });

  it("renders Documents and the selected skill as timeline chips", () => {
    expect(timeline).toContain("artifactTemplateMessageMeta(item.message, displayText)");
    expect(timeline).toContain("<ArtifactTemplateUserMessage");
    expect(timeline).toContain("user-artifact-documents");
    expect(timeline).toContain("user-artifact-skill");
    expect(timeline).toContain("onOpenSkill?.(meta.skillName)");
    expect(appShell).toContain("onOpenArtifactTemplateSkill={(skillName) => void openArtifactTemplateSkill(skillName)}");
    expect(styles).toContain(".user-artifact-template-content");
  });
});
