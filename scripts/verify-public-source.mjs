import { readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skippedDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "release",
  "coverage",
  "playwright-report",
  "test-results",
]);
const textExtensions = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".mts",
  ".ps1", ".ts", ".tsx", ".txt", ".xml", ".yml", ".yaml",
]);
const blockedFileNames = new Set([
  "auth.json",
  "aws-identity.json",
  "web-token",
  "account-auth.json",
]);
const blockedExtensions = new Set([".pem", ".pfx", ".p12", ".key", ".crt", ".tgz", ".asar"]);
const secretPatterns = [
  ["private key", /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["OpenAI-style secret", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  [
    "high-risk credential assignment",
    /(?:AZURE(?:_[A-Z0-9]+)*_API_KEY|API_KEY|SECRET_KEY|CLIENT_SECRET|PASSWORD)[ \t]*(?:=|:)[ \t]*(?:["'][A-Za-z0-9+/_=]{24,}["']|[A-Za-z0-9+/_=]{24,}(?=[ \t]*(?:[,;]|$)))/i,
  ],
];

const findings = [];
let scannedTextFiles = 0;

function isTestFixture(path) {
  return /(?:^|\/)(?:test|tests|fixtures)(?:\/|$)|\.test\.[^/]+$/i.test(path);
}

function inspect(file) {
  const rel = relative(root, file).replaceAll("\\", "/");
  const basename = file.split(/[\\/]/).at(-1)?.toLowerCase() || "";
  if (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example")) {
    findings.push(`${rel}: local environment file`);
    return;
  }
  if (blockedFileNames.has(basename) || blockedExtensions.has(extname(basename))) {
    findings.push(`${rel}: forbidden local credential or binary artifact`);
    return;
  }
  if (!textExtensions.has(extname(basename))) return;

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    findings.push(`${rel}: unreadable text file`);
    return;
  }
  scannedTextFiles += 1;
  // Test fixtures intentionally exercise redaction with token-shaped values.
  // Runtime source, documentation, and configuration remain fully scanned.
  if (isTestFixture(rel)) return;
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) findings.push(`${rel}: ${label}`);
  }
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) walk(resolve(directory, entry.name));
      continue;
    }
    if (entry.isFile()) inspect(resolve(directory, entry.name));
  }
}

walk(root);

if (findings.length > 0) {
  console.error("Public-source verification failed:");
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(`Public-source verification passed (${scannedTextFiles} text files scanned).`);
