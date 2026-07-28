export function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", jsonl: "json", css: "css", scss: "scss", less: "less",
    html: "html", htm: "html", md: "markdown", mdx: "markdown",
    py: "python", pyw: "python", sh: "shell", bash: "shell", zsh: "shell",
    yaml: "yaml", yml: "yaml", xml: "html", sql: "sql",
    graphql: "graphql", gql: "graphql",
    go: "go", rs: "rust", java: "java", kt: "kotlin",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp", cc: "cpp",
    cs: "csharp", php: "php", rb: "ruby", swift: "swift",
    r: "r", dart: "dart", lua: "lua", zig: "zig",
    toml: "ini", ini: "ini", cfg: "ini",
    dockerfile: "dockerfile", makefile: "makefile",
  };
  const lower = path.toLowerCase();
  if (lower.endsWith("dockerfile")) return "dockerfile";
  if (lower.endsWith("makefile") || lower.endsWith("makefile.am")) return "makefile";
  return map[ext] || "plaintext";
}

export function isBinaryPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return ["pdf", "png", "jpg", "jpeg", "gif", "webp", "ico", "svg",
    "mp3", "mp4", "wav", "avi", "mov", "mkv", "webm",
    "zip", "tar", "gz", "bz2", "xz", "7z", "rar",
    "exe", "dll", "so", "dylib", "bin", "dat",
    "woff", "woff2", "ttf", "otf", "eot",
    "pyc", "pyo", "class", "o", "obj", "wasm"].includes(ext);
}

export function normalizeWorkspaceFileDir(path: string, workspacePath: string): string {
  const normalizedPath = normalizeClientPath(path);
  if (!workspacePath || normalizedPath === ".") return normalizedPath;
  const inputParts = normalizedPath.split("/").filter(Boolean);
  const workspaceParts = normalizeClientPath(workspacePath).split("/").filter(Boolean);
  for (let length = Math.min(inputParts.length, workspaceParts.length); length > 0; length -= 1) {
    const workspaceSuffix = workspaceParts.slice(-length).map((part) => part.toLowerCase());
    const inputPrefix = inputParts.slice(0, length).map((part) => part.toLowerCase());
    if (workspaceSuffix.every((part, index) => part === inputPrefix[index])) return inputParts.slice(length).join("/") || ".";
  }
  return normalizedPath;
}

export function normalizeClientPath(path: string): string {
  const normalized = String(path || ".")
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  return normalized || ".";
}
