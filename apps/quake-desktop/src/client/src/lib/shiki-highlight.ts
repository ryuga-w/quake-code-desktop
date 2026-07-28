/**
 * Shared Shiki highlighter for tool previews (2026 stack).
 * Async singleton — never block the main thread with per-token React spans.
 */

type HighlighterLike = {
  codeToHtml: (code: string, options: { lang: string; theme: string }) => string;
  getLoadedLanguages: () => string[];
  loadLanguage: (lang: string | string[]) => Promise<void>;
};

const TOOL_LANGS = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "json",
  "bash",
  "shellscript",
  "diff",
  "css",
  "html",
  "python",
  "markdown",
  "yaml",
  "toml",
  "rust",
  "go",
  "sql",
  "xml",
] as const;

const THEME_DARK = "github-dark-default";
const THEME_LIGHT = "github-light-default";

let highlighterPromise: Promise<HighlighterLike | null> | undefined;
const htmlCache = new Map<string, string>();
const HTML_CACHE_MAX = 80;

function cacheKey(code: string, lang: string, theme: string): string {
  // Bound key size — large bodies already truncated before highlight.
  return `${theme}|${lang}|${code.length}|${code.slice(0, 120)}|${code.slice(-80)}`;
}

function remember(key: string, html: string): string {
  if (htmlCache.size >= HTML_CACHE_MAX) {
    const first = htmlCache.keys().next().value;
    if (first !== undefined) htmlCache.delete(first);
  }
  htmlCache.set(key, html);
  return html;
}

export function resolveShikiTheme(isLight?: boolean): string {
  if (typeof isLight === "boolean") return isLight ? THEME_LIGHT : THEME_DARK;
  if (typeof document === "undefined") return THEME_DARK;
  const root = document.documentElement;
  const theme = root.getAttribute("data-theme") || "";
  if (theme === "light" || root.classList.contains("light")) return THEME_LIGHT;
  return THEME_DARK;
}

export function normalizeShikiLang(language?: string): string {
  const raw = String(language || "").trim().toLowerCase();
  if (!raw) return "text";
  if (raw === "ts" || raw === "typescript") return "typescript";
  if (raw === "js" || raw === "javascript") return "javascript";
  if (raw === "tsx") return "tsx";
  if (raw === "jsx") return "jsx";
  if (raw === "sh" || raw === "bash" || raw === "shell" || raw === "zsh") return "bash";
  if (raw === "yml") return "yaml";
  if (raw === "md") return "markdown";
  if (raw === "py") return "python";
  if (raw === "plaintext" || raw === "text" || raw === "plain") return "text";
  return raw;
}

async function getHighlighter(): Promise<HighlighterLike | null> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      try {
        const { createHighlighter } = await import("shiki");
        const highlighter = await createHighlighter({
          themes: [THEME_DARK, THEME_LIGHT],
          langs: [...TOOL_LANGS],
        });
        return highlighter as HighlighterLike;
      } catch (error) {
        console.warn("[shiki] highlighter init failed; using plain text", error);
        return null;
      }
    })();
  }
  return highlighterPromise;
}

/**
 * Highlight code to HTML. Safe for large bodies: caller should truncate first.
 * Falls back to escaped plain <pre><code> when Shiki is unavailable.
 */
export async function highlightCodeToHtml(
  code: string,
  language?: string,
  options?: { theme?: string },
): Promise<string> {
  const theme = options?.theme || resolveShikiTheme();
  const lang = normalizeShikiLang(language);
  const key = cacheKey(code, lang, theme);
  const cached = htmlCache.get(key);
  if (cached) return cached;

  const highlighter = await getHighlighter();
  if (!highlighter) return escapeAsPre(code);

  try {
    let useLang = lang;
    const loaded = highlighter.getLoadedLanguages?.() || [];
    if (useLang !== "text" && !loaded.includes(useLang)) {
      try {
        await highlighter.loadLanguage(useLang);
      } catch {
        useLang = "text";
      }
    }
    // `text` may not be a loaded grammar — bash is fine for plain shells.
    if (useLang === "text") useLang = "markdown";
    const html = highlighter.codeToHtml(code, { lang: useLang, theme });
    return remember(key, html);
  } catch {
    return remember(key, escapeAsPre(code));
  }
}

function escapeAsPre(code: string): string {
  const escaped = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre class="shiki"><code>${escaped}</code></pre>`;
}

/** Warm the highlighter in idle time so first tool expand is snappy. */
export function warmShikiHighlighter(): void {
  if (typeof window === "undefined") return;
  const run = () => {
    void getHighlighter();
  };
  if ("requestIdleCallback" in window) {
    (window as Window & { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(run);
  } else {
    globalThis.setTimeout(run, 1200);
  }
}
