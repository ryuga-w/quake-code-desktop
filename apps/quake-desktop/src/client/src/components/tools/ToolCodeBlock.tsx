import React, { useEffect, useState } from "react";
import { highlightCodeToHtml, resolveShikiTheme } from "../../lib/shiki-highlight";
import styles from "./ToolCodeBlock.module.css";

const DEFAULT_MAX_CHARS = 12_000;

/**
 * Professional tool/code preview: Shiki (VS Code grammar) when ready,
 * plain <pre> fallback while loading or for oversized payloads.
 * Never builds thousands of React highlight nodes on the main thread.
 */
export function ToolCodeBlock({
  code,
  language,
  maxChars = DEFAULT_MAX_CHARS,
  className,
}: {
  code: string;
  language?: string;
  maxChars?: number;
  className?: string;
}) {
  const truncated = code.length > maxChars;
  const source = truncated ? `${code.slice(0, maxChars)}\n…` : code;
  const [html, setHtml] = useState<string | null>(null);
  const [theme, setTheme] = useState(() => resolveShikiTheme());

  useEffect(() => {
    const syncTheme = () => setTheme(resolveShikiTheme());
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Skip Shiki for empty / tiny placeholders.
    if (!source.trim()) {
      setHtml(null);
      return;
    }
    void highlightCodeToHtml(source, language, { theme }).then((next) => {
      if (!cancelled) setHtml(next);
    });
    return () => {
      cancelled = true;
    };
  }, [source, language, theme]);

  if (!source.trim()) return null;

  if (html) {
    return (
      <div
        className={`${styles.block} ${className || ""}`.trim()}
        data-shiki="true"
        // Shiki output is self-contained HTML from our highlighter (escaped input).
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <pre className={`${styles.plain} ${className || ""}`.trim()}>
      <code>{source}</code>
    </pre>
  );
}

export default ToolCodeBlock;
