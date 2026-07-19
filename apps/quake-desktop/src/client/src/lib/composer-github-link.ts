export type ComposerGithubLinkFormat = "markdown" | "url" | "repository";

export type ComposerGithubLink = {
  source: string;
  displayText: string;
  url: string;
  rest: string;
  format: ComposerGithubLinkFormat;
};

const GITHUB_URL_PATTERN = /^https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.~!$&'()*+,;=:@%\/-]*)?(?:\?[^\s#]*)?(?:#[^\s]*)?/i;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/;
const MARKDOWN_LINK_PATTERN = /^\[([^\]\n]+)\]\((https?:\/\/github\.com\/[^\s)]+)\)/i;

export function parseComposerGithubLink(value: string): ComposerGithubLink | undefined {
  const input = String(value || "");
  const markdown = input.match(MARKDOWN_LINK_PATTERN);
  if (markdown) {
    return {
      source: markdown[0],
      displayText: markdown[1],
      url: normalizeGithubUrl(markdown[2]) || markdown[2],
      rest: trimSingleSeparator(input.slice(markdown[0].length)),
      format: "markdown",
    };
  }

  const urlMatch = input.match(GITHUB_URL_PATTERN);
  if (urlMatch && isTokenBoundary(input, urlMatch[0].length)) {
    const url = normalizeGithubUrl(urlMatch[0]);
    if (!url) return undefined;
    return {
      source: urlMatch[0],
      displayText: urlMatch[0],
      url,
      rest: trimSingleSeparator(input.slice(urlMatch[0].length)),
      format: "url",
    };
  }

  const repositoryMatch = input.match(GITHUB_REPOSITORY_PATTERN);
  if (!repositoryMatch || !isTokenBoundary(input, repositoryMatch[0].length)) return undefined;
  const repository = trimRepositorySuffix(repositoryMatch[0]);
  if (!isGithubRepository(repository)) return undefined;
  return {
    source: repository,
    displayText: repository,
    url: `https://github.com/${repository}`,
    rest: trimSingleSeparator(input.slice(repositoryMatch[0].length)),
    format: "repository",
  };
}

export function composeGithubLinkValue(source: string, rest: string): string {
  const normalizedSource = String(source || "").trim();
  const normalizedRest = String(rest || "");
  if (!normalizedRest) return normalizedSource;
  return `${normalizedSource} ${normalizedRest}`;
}

export function githubLinkWithDisplayText(link: ComposerGithubLink, displayText: string): string {
  const label = escapeMarkdownLabel(displayText.trim() || link.displayText);
  return `[${label}](${link.url})`;
}

export function githubLinkWithUrl(link: ComposerGithubLink, input: string): string | undefined {
  const parsed = normalizeGithubLinkInput(input);
  if (!parsed) return undefined;
  if (link.format === "markdown") return `[${escapeMarkdownLabel(link.displayText)}](${parsed.url})`;
  return parsed.source;
}

export function normalizeGithubLinkInput(input: string): { source: string; url: string; format: "url" | "repository" } | undefined {
  const value = String(input || "").trim();
  const url = normalizeGithubUrl(value);
  if (url) return { source: url, url, format: "url" };
  if (!isGithubRepository(value)) return undefined;
  return { source: value, url: `https://github.com/${value}`, format: "repository" };
}

function normalizeGithubUrl(input: string): string | undefined {
  try {
    const parsed = new URL(input);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) return undefined;
    if (parsed.hostname.toLowerCase() !== "github.com") return undefined;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return undefined;
    parsed.protocol = "https:";
    parsed.hostname = "github.com";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function isGithubRepository(value: string): boolean {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) return false;
  const [owner, repository] = value.split("/");
  if (!owner || !repository || owner === "." || owner === "..") return false;
  if (repository === "." || repository === "..") return false;
  // Avoid converting common relative source paths such as src/index.ts.
  if (/\.[A-Za-z0-9]{1,8}$/.test(repository)) return false;
  return true;
}

function trimRepositorySuffix(value: string): string {
  return value.replace(/[.,;:!?]+$/, "");
}

function isTokenBoundary(input: string, end: number): boolean {
  const next = input.charAt(end);
  return !next || /\s/.test(next);
}

function trimSingleSeparator(value: string): string {
  return value.replace(/^\s/, "");
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}
