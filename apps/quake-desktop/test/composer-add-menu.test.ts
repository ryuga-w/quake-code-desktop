import { describe, expect, it } from "vitest";
import { getComposerAddMenuExtensions } from "../src/client/src/components/composer/composer-add-menu";

describe("composer add menu extensions", () => {
  it("keeps the reference artifact extensions first", () => {
    const extensions = getComposerAddMenuExtensions([]);

    expect(extensions.slice(0, 5).map((extension) => extension.label)).toEqual([
      "Documents",
      "PDF",
      "Spreadsheets",
      "Presentations",
      "Template Creator",
    ]);
    expect(extensions[1]).toMatchObject({ command: "pdf", kind: "pdf", insertText: "/pdf " });
  });

  it("appends runtime skills without duplicating built-ins", () => {
    const extensions = getComposerAddMenuExtensions([
      { name: "/docx", description: "Runtime document skill", source: "skill" },
      { name: "/quake-fix", description: "Debug failures", source: "skill" },
      { name: "quake-fix", description: "Duplicate", source: "skill" },
    ]);

    expect(extensions.filter((extension) => extension.kind === "documents")).toHaveLength(1);
    expect(extensions.filter((extension) => extension.command === "quake-fix")).toHaveLength(1);
    expect(extensions.at(-1)).toMatchObject({
      command: "quake-fix",
      label: "Quake Fix",
      description: "Debug failures",
      insertText: "/quake-fix ",
    });
  });
});
