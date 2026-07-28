export type ArtifactTemplateMessageMeta = {
  skillName: string;
  displayName: string;
  userText: string;
};

const TEMPLATE_PROMPT_PATTERN = /^Use \$(artifact-template-[a-z0-9-]+) to create a new document with the selected retained template\.\s*(?:\n\s*\n)?([\s\S]*)$/i;
const DEFAULT_TEMPLATE_PROMPT = "Create a new document with this template.";

export function artifactTemplateMessageMeta(message: any, visibleText: string): ArtifactTemplateMessageMeta | undefined {
  const explicitSkill = typeof message?.__artifactTemplateSkill === "string"
    ? message.__artifactTemplateSkill.trim()
    : "";
  const rawText = rawUserMessageText(message);
  const rawMatch = rawText.match(TEMPLATE_PROMPT_PATTERN);
  const skillName = explicitSkill || rawMatch?.[1] || "";
  if (!/^artifact-template-[a-z0-9-]+$/.test(skillName)) return undefined;

  const rawUserText = (rawMatch?.[2] || "").trim();
  const normalizedVisible = String(visibleText || "").trim();
  const syntheticSummary = /^Documents\s*[·•]\s*.+$/i.test(normalizedVisible);
  const visibleIsRuntimeEnvelope = TEMPLATE_PROMPT_PATTERN.test(normalizedVisible);
  const userText = syntheticSummary || visibleIsRuntimeEnvelope
    ? normalizeTemplateUserText(rawUserText)
    : normalizeTemplateUserText(normalizedVisible || rawUserText);

  return {
    skillName,
    displayName: artifactTemplateDisplayName(skillName),
    userText,
  };
}

export function artifactTemplateDisplayName(skillName: string): string {
  return String(skillName || "")
    .replace(/^artifact-template-/, "")
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function artifactTemplateSkillFromPrompt(text?: string): string | undefined {
  return String(text || "").match(TEMPLATE_PROMPT_PATTERN)?.[1];
}

export function artifactTemplateRestorePrompt(meta: ArtifactTemplateMessageMeta): string {
  return `@documents[${meta.skillName}] ${meta.userText}`;
}

function normalizeTemplateUserText(value: string): string {
  const text = String(value || "").trim();
  return text === DEFAULT_TEMPLATE_PROMPT ? "" : text;
}

function rawUserMessageText(message: any): string {
  if (typeof message?.content === "string") return message.content.trim();
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
}
