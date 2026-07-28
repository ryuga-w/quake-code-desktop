export const COMPOSER_IMAGE_LIMIT = 6;
export const COMPOSER_CONTEXT_LIMIT = 6;
export const COMPOSER_FILE_BATCH_LIMIT = 12;
export const COMPOSER_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const COMPOSER_TEXT_READ_BYTES = 64 * 1024;
export const COMPOSER_TEXT_CHAR_LIMIT = 12_000;

export const COMPOSER_FILE_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/*",
  ".md",
  ".mdx",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
  ".svg",
  ".css",
  ".scss",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".sh",
  ".ps1",
  ".sql",
  ".graphql",
  ".csv",
  ".tsv",
  ".log",
].join(",");

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const TEXT_EXTENSIONS = new Set([
  ".abap", ".astro", ".bash", ".bat", ".c", ".cc", ".cfg", ".cjs", ".clj", ".cljs",
  ".cmake", ".cmd", ".conf", ".cpp", ".cs", ".css", ".csv", ".cts", ".dart", ".diff",
  ".editorconfig", ".env", ".fish", ".fs", ".fsx", ".gitattributes", ".gitignore", ".go",
  ".graphql", ".gql", ".gradle", ".groovy", ".h", ".handlebars", ".hbs", ".hpp", ".htm",
  ".html", ".ini", ".java", ".js", ".json", ".jsonc", ".jsx", ".kt", ".kts", ".less",
  ".lock", ".log", ".lua", ".m", ".md", ".mdx", ".mjs", ".mm", ".mts", ".php", ".pl",
  ".properties", ".proto", ".ps1", ".py", ".pyi", ".r", ".rb", ".rs", ".sass", ".scala",
  ".scss", ".sh", ".sol", ".sql", ".svelte", ".svg", ".swift", ".toml", ".ts", ".tsv",
  ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml", ".zsh",
]);

const TEXT_FILENAMES = new Set([
  "dockerfile",
  "gemfile",
  "justfile",
  "license",
  "makefile",
  "procfile",
  "readme",
]);

const TEXT_APPLICATION_MIMES = new Set([
  "application/graphql",
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/sql",
  "application/toml",
  "application/typescript",
  "application/x-httpd-php",
  "application/x-javascript",
  "application/x-sh",
  "application/xhtml+xml",
  "application/xml",
  "application/yaml",
]);

export type ComposerFileClassification =
  | { kind: "image"; mimeType: string }
  | { kind: "text" }
  | { kind: "unsupported" };

export type ComposerTextReadResult = {
  text: string;
  truncated: boolean;
};

export function classifyComposerFile(file: Pick<File, "name" | "type">): ComposerFileClassification {
  const name = String(file.name || "").trim();
  const lowerName = name.toLowerCase();
  const extension = fileExtension(lowerName);
  const mimeType = String(file.type || "").toLowerCase().split(";", 1)[0].trim();
  const inferredImageMime = IMAGE_MIME_BY_EXTENSION[extension];

  if (mimeType === "image/jpg") return { kind: "image", mimeType: "image/jpeg" };
  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mimeType)) {
    return { kind: "image", mimeType };
  }
  if ((!mimeType || mimeType === "application/octet-stream") && inferredImageMime) {
    return { kind: "image", mimeType: inferredImageMime };
  }

  if (
    mimeType.startsWith("text/")
    || TEXT_APPLICATION_MIMES.has(mimeType)
    || TEXT_EXTENSIONS.has(extension)
    || TEXT_FILENAMES.has(lowerName)
  ) {
    return { kind: "text" };
  }

  return { kind: "unsupported" };
}

export function composerFileSourceKey(file: Pick<File, "name" | "size" | "lastModified">): string {
  return `${String(file.name || "").toLocaleLowerCase("en-US")}\u0000${Number(file.size || 0)}\u0000${Number(file.lastModified || 0)}`;
}

export async function readComposerTextFile(file: File): Promise<ComposerTextReadResult> {
  const sampledBlob = file.slice(0, COMPOSER_TEXT_READ_BYTES);
  const sampledText = await sampledBlob.text();
  if (sampledText.includes("\u0000")) {
    throw new Error("ikili dosya metin bağlamı olarak eklenemez");
  }

  const clippedText = sampledText.slice(0, COMPOSER_TEXT_CHAR_LIMIT);
  const truncated = file.size > sampledBlob.size || sampledText.length > COMPOSER_TEXT_CHAR_LIMIT;
  const text = clippedText || "(Dosya boş.)";
  return {
    text: truncated
      ? `${text}\n\n[İçerik güvenli bağlam sınırında kısaltıldı.]`
      : text,
    truncated,
  };
}

export function hasComposerPayload(prompt: string, imageCount: number, contextCount: number): boolean {
  return Boolean(prompt.trim()) || imageCount > 0 || contextCount > 0;
}

export function composerFallbackMessage(imageCount: number, contextCount: number): string {
  if (imageCount > 0 && contextCount > 0) return "Eklenen görselleri ve dosyaları incele.";
  if (imageCount > 1) return "Bu görselleri incele.";
  if (imageCount === 1) return "Bu görseli incele.";
  if (contextCount > 1) return "Eklenen dosyaları incele.";
  return "Bu dosyayı incele.";
}

function fileExtension(name: string): string {
  const slashIndex = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > slashIndex ? name.slice(dotIndex) : "";
}
