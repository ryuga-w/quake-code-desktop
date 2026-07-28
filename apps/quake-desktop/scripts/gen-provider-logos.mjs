/**
 * Download real brand logos for Settings → Provider’lar.
 * Primary source: @lobehub/icons-static-svg (AI/LLM brands, CC/brand assets packaged for icons)
 * Fallback: simple-icons (CC0 brand marks)
 *
 * Usage: node scripts/gen-provider-logos.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, "../src/client/public/providers");
mkdirSync(dir, { recursive: true });

const LOBE = "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons";
const SIMPLE = "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons";

/**
 * Map our provider id → ordered logo URL candidates (first success wins).
 * Prefer *-color variants when available for recognizability on light UI.
 */
const SOURCES = {
  "openai-codex": [`${LOBE}/openai.svg`, `${SIMPLE}/openai.svg`],
  openai: [`${LOBE}/openai.svg`, `${SIMPLE}/openai.svg`],
  anthropic: [`${LOBE}/claude-color.svg`, `${LOBE}/claude.svg`, `${SIMPLE}/anthropic.svg`],
  "google-antigravity": [`${LOBE}/gemini-color.svg`, `${LOBE}/gemini.svg`, `${SIMPLE}/googlegemini.svg`],
  "google-gemini-cli": [`${LOBE}/gemini-color.svg`, `${LOBE}/gemini.svg`, `${SIMPLE}/googlegemini.svg`],
  google: [`${LOBE}/gemini-color.svg`, `${LOBE}/google-color.svg`, `${SIMPLE}/google.svg`],
  "google-vertex": [`${LOBE}/vertexai-color.svg`, `${LOBE}/vertexai.svg`, `${SIMPLE}/googlecloud.svg`],
  "amazon-kiro": [`${LOBE}/aws-color.svg`, `${LOBE}/aws.svg`, `${SIMPLE}/amazonaws.svg`],
  "amazon-bedrock": [`${LOBE}/bedrock-color.svg`, `${LOBE}/bedrock.svg`, `${LOBE}/aws-color.svg`, `${SIMPLE}/amazonaws.svg`],
  "github-copilot": [`${LOBE}/copilot.svg`, `${LOBE}/githubcopilot.svg`, `${SIMPLE}/githubcopilot.svg`],
  openrouter: [`${LOBE}/openrouter.svg`],
  "azure-openai-responses": [`${LOBE}/azure-color.svg`, `${LOBE}/azure.svg`, `${SIMPLE}/microsoftazure.svg`],
  mistral: [`${LOBE}/mistral-color.svg`, `${LOBE}/mistral.svg`, `${SIMPLE}/mistralai.svg`],
  groq: [`${LOBE}/groq.svg`],
  cerebras: [`${LOBE}/cerebras-color.svg`, `${LOBE}/cerebras.svg`],
  xai: [`${LOBE}/xai.svg`, `${SIMPLE}/x.svg`],
  "vercel-ai-gateway": [`${LOBE}/vercel.svg`, `${SIMPLE}/vercel.svg`],
  zai: [`${LOBE}/zai.svg`],
  opencode: [`${LOBE}/opencode.svg`],
  "opencode-go": [`${LOBE}/opencode.svg`],
  huggingface: [`${LOBE}/huggingface-color.svg`, `${LOBE}/huggingface.svg`, `${SIMPLE}/huggingface.svg`],
  "kimi-coding": [`${LOBE}/kimi-color.svg`, `${LOBE}/kimi.svg`, `${LOBE}/moonshot.svg`],
  minimax: [`${LOBE}/minimax-color.svg`, `${LOBE}/minimax.svg`],
  "minimax-cn": [`${LOBE}/minimax-color.svg`, `${LOBE}/minimax.svg`],
  nvidia: [`${LOBE}/nvidia-color.svg`, `${LOBE}/nvidia.svg`, `${SIMPLE}/nvidia.svg`],
};

/** Soft brand tile backgrounds when wrapping monochrome marks */
const TILE = {
  "openai-codex": "#10a37f",
  openai: "#10a37f",
  anthropic: "#d4a574",
  "google-antigravity": "#ffffff",
  "google-gemini-cli": "#ffffff",
  google: "#ffffff",
  "google-vertex": "#ffffff",
  "amazon-kiro": "#232f3e",
  "amazon-bedrock": "#232f3e",
  "github-copilot": "#24292f",
  openrouter: "#6566f1",
  "azure-openai-responses": "#0078d4",
  mistral: "#ff7000",
  groq: "#f55036",
  cerebras: "#f15a29",
  xai: "#111111",
  "vercel-ai-gateway": "#111111",
  zai: "#5b5bd6",
  opencode: "#f59e0b",
  "opencode-go": "#f59e0b",
  huggingface: "#ffd21e",
  "kimi-coding": "#1783ff",
  minimax: "#e11d48",
  "minimax-cn": "#be123c",
  nvidia: "#76b900",
};

function letterFallback(id, letter, color) {
  const textColor = ["#d4a574", "#10a37f", "#76b900", "#f59e0b", "#ffd21e"].includes(color)
    ? "#111"
    : "#fff";
  const fs = letter.length > 2 ? 12 : letter.length > 1 ? 15 : 22;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img">
  <rect width="64" height="64" rx="14" fill="${color}"/>
  <text x="32" y="33" text-anchor="middle" dominant-baseline="central" font-family="Segoe UI, system-ui, sans-serif" font-size="${fs}" font-weight="700" fill="${textColor}">${letter}</text>
</svg>`;
}

function extractInnerSvg(raw) {
  // Strip XML prolog / comments; keep path content
  let svg = raw.replace(/<\?xml[\s\S]*?\?>/i, "").trim();
  // Some packages wrap with style tags — keep them
  return svg;
}

/**
 * Normalize any brand SVG into a 64×64 rounded tile with the mark centered.
 * Preserves original fills (color logos stay colored).
 */
function wrapBrandSvg(rawSvg, bg) {
  const svg = extractInnerSvg(rawSvg);
  // Pull viewBox if present for better scaling of the inner mark
  const vbMatch = svg.match(/viewBox=["']([^"']+)["']/i);
  const viewBox = vbMatch?.[1] || "0 0 24 24";
  // Strip outer <svg ...> and </svg> to embed paths
  const inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/i, "")
    .replace(/<\/svg>\s*$/i, "")
    .trim();

  // Dark tiles need light fill for monochrome black icons — inject currentColor only
  // when the icon is pure black monochrome without existing fill colors other than #000/#111.
  const hasBrandColor =
    /fill\s*=\s*["'](?!#000000?\b|#111111?\b|#0d0d0d\b|black|currentColor|none)[^"']+["']/i.test(inner) ||
    /fill\s*:\s*(?!#000|#111|black|currentColor|none)[^;"']+/i.test(inner);

  const iconFill = hasBrandColor ? undefined : bg === "#ffffff" || bg === "#ffd21e" ? "#111111" : "#ffffff";

  // Re-root paths in a scaled group inside 64 box with padding
  const pad = 10;
  const size = 64 - pad * 2;
  const fillAttr = iconFill ? ` fill="${iconFill}"` : "";
  // Use a nested svg so original viewBox is respected
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img">
  <rect width="64" height="64" rx="14" fill="${bg}"/>
  <svg x="${pad}" y="${pad}" width="${size}" height="${size}" viewBox="${viewBox}"${fillAttr}>
    ${inner}
  </svg>
</svg>
`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "quake-desktop-logo-gen/1.0" },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function resolveLogo(id, urls) {
  for (const url of urls) {
    try {
      const raw = await fetchText(url);
      if (!raw.includes("<svg")) throw new Error("not svg");
      const bg = TILE[id] || "#f4f4f5";
      return wrapBrandSvg(raw, bg);
    } catch (e) {
      console.warn(`  skip ${url}: ${e.message || e}`);
    }
  }
  return null;
}

const FALLBACK_LETTER = {
  "openai-codex": "C",
  openai: "O",
  anthropic: "A",
  "google-antigravity": "G",
  "google-gemini-cli": "G",
  google: "G",
  "google-vertex": "V",
  "amazon-kiro": "Q",
  "amazon-bedrock": "B",
  "github-copilot": "GH",
  openrouter: "R",
  "azure-openai-responses": "Az",
  mistral: "M",
  groq: "Gq",
  cerebras: "Cb",
  xai: "x",
  "vercel-ai-gateway": "▲",
  zai: "Z",
  opencode: "OC",
  "opencode-go": "OG",
  huggingface: "HF",
  "kimi-coding": "K",
  minimax: "Mm",
  "minimax-cn": "Mm",
  nvidia: "N",
};

let ok = 0;
let fail = 0;
for (const [id, urls] of Object.entries(SOURCES)) {
  process.stdout.write(`${id}… `);
  const svg = await resolveLogo(id, urls);
  if (svg) {
    writeFileSync(join(dir, `${id}.svg`), svg);
    console.log("OK");
    ok++;
  } else {
    const letter = FALLBACK_LETTER[id] || id.slice(0, 1).toUpperCase();
    const color = TILE[id] || "#111";
    writeFileSync(join(dir, `${id}.svg`), letterFallback(id, letter, color));
    console.log("FALLBACK letter");
    fail++;
  }
}

// Extra dark nvidia variant if something still references it
try {
  const raw = await fetchText(`${LOBE}/nvidia.svg`);
  writeFileSync(join(dir, "nvidia-dark.svg"), wrapBrandSvg(raw, "#111111"));
} catch {
  /* ignore */
}

console.log(`\nDone: ${ok} real logos, ${fail} letter fallbacks → ${dir}`);
