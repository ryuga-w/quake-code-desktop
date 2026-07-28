import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { WebArtifactTemplate } from "../shared/protocol.js";

export type ArtifactTemplateKind = "document" | "spreadsheet" | "presentation";

export type ArtifactTemplateSummary = WebArtifactTemplate;

export type ArtifactTemplateSkillDocument = {
  path: string;
  content: string;
};

type ArtifactTemplateManifest = {
  schemaVersion?: number;
  kind?: ArtifactTemplateKind;
  preview?: string;
};

const TEMPLATE_DIRECTORY_PREFIX = "artifact-template-";
const TEMPLATE_MANIFEST = "artifact-template.json";
const TEMPLATE_PLUGIN_PATH = [".codex", "plugins", "cache", "openai-curated-remote", "openai-templates"];

export function resolveArtifactTemplateSkillsDir(): string | undefined {
  const override = process.env.QUAKE_ARTIFACT_TEMPLATE_SKILLS_DIR?.trim();
  if (override) {
    const resolved = resolve(override);
    return existsSync(resolved) ? resolved : undefined;
  }

  const pluginRoot = join(homedir(), ...TEMPLATE_PLUGIN_PATH);
  if (!existsSync(pluginRoot)) return undefined;

  const versions = readdirSync(pluginRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionNamesDescending);

  for (const version of versions) {
    const skillsDir = join(pluginRoot, version, "skills");
    if (existsSync(skillsDir)) return skillsDir;
  }
  return undefined;
}

export function artifactTemplateSkillPaths(): string[] {
  const skillsDir = resolveArtifactTemplateSkillsDir();
  return skillsDir ? [skillsDir] : [];
}

export function readArtifactTemplateCatalog(
  skillsDir = resolveArtifactTemplateSkillsDir(),
  kind?: ArtifactTemplateKind,
): ArtifactTemplateSummary[] {
  if (!skillsDir || !existsSync(skillsDir)) return [];

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(TEMPLATE_DIRECTORY_PREFIX))
    .map((entry) => readTemplateSummary(skillsDir, entry.name))
    .filter((entry): entry is ArtifactTemplateSummary => Boolean(entry))
    .filter((entry) => !kind || entry.kind === kind)
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "en"));
}

export function readArtifactTemplatePreview(id: string): Buffer | undefined {
  if (!isSafeTemplateId(id)) return undefined;
  const skillsDir = resolveArtifactTemplateSkillsDir();
  if (!skillsDir) return undefined;
  const summary = readTemplateSummary(skillsDir, id);
  if (!summary) return undefined;

  const manifest = readManifest(join(skillsDir, id, TEMPLATE_MANIFEST));
  const previewPath = manifest?.preview;
  if (!previewPath) return undefined;
  const fullPath = resolve(join(skillsDir, id), previewPath);
  if (!isPathInside(fullPath, join(skillsDir, id)) || !existsSync(fullPath)) return undefined;
  return readFileSync(fullPath);
}

export function readArtifactTemplateSkill(id: string): ArtifactTemplateSkillDocument | undefined {
  if (!isSafeTemplateId(id)) return undefined;
  const skillsDir = resolveArtifactTemplateSkillsDir();
  if (!skillsDir || !readTemplateSummary(skillsDir, id)) return undefined;
  const skillPath = resolve(skillsDir, id, "SKILL.md");
  if (!isPathInside(skillPath, join(skillsDir, id)) || !existsSync(skillPath)) return undefined;
  const version = basename(dirname(skillsDir));
  return {
    path: `openai-templates/${version}/skills/${id}/SKILL.md`,
    content: readFileSync(skillPath, "utf8"),
  };
}

function readTemplateSummary(skillsDir: string, id: string): ArtifactTemplateSummary | undefined {
  if (!isSafeTemplateId(id)) return undefined;
  const skillDir = join(skillsDir, id);
  const manifest = readManifest(join(skillDir, TEMPLATE_MANIFEST));
  if (!manifest || manifest.schemaVersion !== 1 || !isTemplateKind(manifest.kind) || !manifest.preview) return undefined;

  const previewPath = resolve(skillDir, manifest.preview);
  if (!isPathInside(previewPath, skillDir) || !existsSync(previewPath)) return undefined;

  const skillText = readText(join(skillDir, "SKILL.md"));
  const agentText = readText(join(skillDir, "agents", "openai.yaml"));
  const skillName = readFrontmatterValue(skillText, "name") || id;
  const skillDescription = readFrontmatterValue(skillText, "description");
  const displayName = readYamlValue(agentText, "display_name") || titleFromId(id);
  const description = readYamlValue(agentText, "short_description") || skillDescription || `Create an artifact with ${displayName}`;
  const defaultPrompt = readYamlValue(agentText, "default_prompt") || "Create a new artifact with this template.";

  return {
    id,
    skillName,
    displayName,
    description,
    defaultPrompt,
    kind: manifest.kind,
    previewUrl: `/api/artifact-templates/preview?id=${encodeURIComponent(id)}`,
  };
}

function readManifest(path: string): ArtifactTemplateManifest | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ArtifactTemplateManifest;
  } catch {
    return undefined;
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function readFrontmatterValue(content: string, key: string): string {
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] || "";
  return cleanScalar(frontmatter.match(new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, "m"))?.[1] || "");
}

function readYamlValue(content: string, key: string): string {
  return cleanScalar(content.match(new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(.+)$`, "m"))?.[1] || "");
}

function cleanScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function titleFromId(id: string): string {
  return id
    .replace(TEMPLATE_DIRECTORY_PREFIX, "")
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isSafeTemplateId(value: string): boolean {
  return /^artifact-template-[a-z0-9-]+$/.test(value) && basename(value) === value;
}

function isTemplateKind(value: unknown): value is ArtifactTemplateKind {
  return value === "document" || value === "spreadsheet" || value === "presentation";
}

function isPathInside(candidate: string, parent: string): boolean {
  const normalizedParent = `${resolve(parent)}${process.platform === "win32" ? "\\" : "/"}`.toLowerCase();
  return candidate.toLowerCase().startsWith(normalizedParent);
}

function compareVersionNamesDescending(left: string, right: string): number {
  return right.localeCompare(left, "en", { numeric: true, sensitivity: "base" });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
