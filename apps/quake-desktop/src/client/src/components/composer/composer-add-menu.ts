import type { WebSkillInfo } from "../../../../shared/protocol";

export type ComposerAddMenuExtensionKind =
  | "documents"
  | "pdf"
  | "spreadsheets"
  | "presentations"
  | "templates"
  | "generic";

export type ComposerAddMenuExtension = {
  command: string;
  label: string;
  description: string;
  kind: ComposerAddMenuExtensionKind;
  insertText: string;
};

const BUILT_IN_EXTENSIONS: readonly ComposerAddMenuExtension[] = [
  {
    command: "docx",
    label: "Documents",
    description: "Create and edit document artifacts",
    kind: "documents",
    insertText: "/docx ",
  },
  {
    command: "pdf",
    label: "PDF",
    description: "Read, create, and verify PDF files",
    kind: "pdf",
    insertText: "/pdf ",
  },
  {
    command: "xlsx",
    label: "Spreadsheets",
    description: "Create and edit spreadsheet files",
    kind: "spreadsheets",
    insertText: "/xlsx ",
  },
  {
    command: "pptx",
    label: "Presentations",
    description: "Create and edit presentations",
    kind: "presentations",
    insertText: "/pptx ",
  },
  {
    command: "template-creator",
    label: "Template Creator",
    description: "Create or update templates for documents, spreadsheets, and presentations",
    kind: "templates",
    insertText: "Create or update a template for ",
  },
];

const BUILT_IN_ALIASES = new Set([
  "docx",
  "document",
  "documents",
  "pdf",
  "xlsx",
  "spreadsheet",
  "spreadsheets",
  "pptx",
  "presentation",
  "presentations",
  "skill-creator",
  "template-creator",
]);

export function getComposerAddMenuExtensions(skills: readonly WebSkillInfo[]): ComposerAddMenuExtension[] {
  const seen = new Set(BUILT_IN_ALIASES);
  const discovered: ComposerAddMenuExtension[] = [];

  for (const skill of skills) {
    const command = normalizeSkillCommand(skill.name);
    if (!command || seen.has(command)) continue;
    seen.add(command);
    discovered.push({
      command,
      label: formatSkillLabel(command),
      description: skill.description?.trim() || "Use this skill in the current task",
      kind: "generic",
      insertText: `/${command} `,
    });
  }

  return [...BUILT_IN_EXTENSIONS.map((extension) => ({ ...extension })), ...discovered].slice(0, 32);
}

function normalizeSkillCommand(name: string): string {
  return name.trim().replace(/^\/+/, "").toLocaleLowerCase("en-US");
}

function formatSkillLabel(command: string): string {
  return command
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toLocaleUpperCase("en-US")}${part.slice(1)}`)
    .join(" ");
}
