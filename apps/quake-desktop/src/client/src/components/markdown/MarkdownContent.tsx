import React from "react";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { createMermaidPlugin } from "@streamdown/mermaid";
import {
  Streamdown,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  type AnimateOptions,
  type Components,
  type UrlTransform,
} from "streamdown";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import {
  nextAdaptiveSignalTrailSample,
  signalTrailAnimationStartIndex,
  type AdaptiveSignalTrailSample,
  type AdaptiveSignalTrailSettings,
} from "./adaptive-signal-trail";

const QUAKE_FILE_ORIGIN = "https://quake.local/file/";
const FILE_PATH_RE = /(?:[A-Za-z]:[\\/][^\s`"'<>]+|(?:apps|packages|src|test|scripts|devops|\.quake-code)[/\\][^\s`"'<>]+)/g;

const mermaid = createMermaidPlugin({
  config: {
    securityLevel: "strict",
    startOnLoad: false,
    theme: "dark",
    fontFamily: "var(--font-sans)",
  },
});

const STREAMDOWN_PLUGINS = { code, math, mermaid } as const;
const STREAMDOWN_REHYPE_PLUGINS = Object.entries(defaultRehypePlugins)
  .filter(([name]) => name !== "raw")
  .map(([, plugin]) => plugin);
const STREAMDOWN_REMARK_PLUGINS = [
  ...Object.values(defaultRemarkPlugins),
  remarkQuakeFileLinks,
  remarkLiteralFootnotes,
];
const STREAMDOWN_CONTROLS = {
  code: { copy: true, download: false },
  table: { copy: false, download: false, fullscreen: false },
  mermaid: { copy: true, download: false, fullscreen: true, panZoom: true },
} as const;
const STREAMDOWN_TRANSLATIONS = {
  copied: "Kopyalandı",
  copyCode: "Kodu kopyala",
  copyTable: "Tabloyu kopyala",
  copyTableAsCsv: "CSV olarak kopyala",
  copyTableAsMarkdown: "Markdown olarak kopyala",
  copyTableAsTsv: "TSV olarak kopyala",
};

export const SIGNAL_TRAIL_STREAM_ANIMATION: AnimateOptions = {
  animation: "signalTrail",
  duration: 320,
  easing: "cubic-bezier(.16, 1, .3, 1)",
  sep: "word",
  stagger: 24,
};

const quakeUrlTransform: UrlTransform = (url) => {
  if (url.startsWith(QUAKE_FILE_ORIGIN)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:"
      ? url
      : undefined;
  } catch {
    return url.startsWith("#") || url.startsWith("/") ? url : undefined;
  }
};

export type MarkdownContentProps = {
  content: string;
  isStreaming: boolean;
  onOpenFile: (path: string) => void;
  animated?: boolean | AnimateOptions;
  adaptiveSignalTrail?: boolean;
  caret?: "block" | "circle";
};

/** Canonical Streamdown surface shared by settled and streaming assistant text. */
export function MarkdownContent({ content, isStreaming, onOpenFile, animated = false, adaptiveSignalTrail = false, caret }: MarkdownContentProps) {
  const animationBoundaryRef = React.useRef<HTMLDivElement>(null);
  const processedAnimatedWordsRef = React.useRef(new WeakSet<HTMLElement>());
  const signalTrailSettings = useAdaptiveSignalTrail(content, adaptiveSignalTrail && isStreaming);
  const signalTrailSettingsRef = React.useRef(signalTrailSettings);
  const components = React.useMemo<Components>(() => ({
    a: ({ href, children, node: _node, ...props }) => {
      if (href?.startsWith(QUAKE_FILE_ORIGIN)) {
        const path = decodeURIComponent(href.slice(QUAKE_FILE_ORIGIN.length));
        return (
          <button type="button" className="sd-file-link" onClick={() => onOpenFile(path)}>
            {children}
          </button>
        );
      }
      return <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a>;
    },
    // Drop Streamdown/Tailwind `list-inside`, but retain semantic GFM classes
    // such as `contains-task-list` / `task-list-item` for precise styling.
    ul: ({ children, node: _node, className, ...props }) => (
      <ul className={className ? `qc-md-ul ${className}` : "qc-md-ul"} data-streamdown="unordered-list" {...props}>{children}</ul>
    ),
    ol: ({ children, node: _node, className, ...props }) => (
      <ol className={className ? `qc-md-ol ${className}` : "qc-md-ol"} data-streamdown="ordered-list" {...props}>{children}</ol>
    ),
    li: ({ children, node: _node, className, ...props }) => (
      <li className={className ? `qc-md-li ${className}` : "qc-md-li"} data-streamdown="list-item" {...props}>{children}</li>
    ),
  }), [onOpenFile]);

  React.useLayoutEffect(() => {
    signalTrailSettingsRef.current = signalTrailSettings;
    if (!adaptiveSignalTrail || !isStreaming || !animationBoundaryRef.current || !signalTrailSettings) return;
    tuneSignalTrailWords(animationBoundaryRef.current, processedAnimatedWordsRef.current, signalTrailSettings);
  }, [adaptiveSignalTrail, content, isStreaming, signalTrailSettings]);

  React.useLayoutEffect(() => {
    if (!adaptiveSignalTrail || !isStreaming || !animationBoundaryRef.current || typeof MutationObserver === "undefined") {
      processedAnimatedWordsRef.current = new WeakSet<HTMLElement>();
      return;
    }
    const boundary = animationBoundaryRef.current;
    const observer = new MutationObserver(() => {
      const settings = signalTrailSettingsRef.current;
      if (settings) tuneSignalTrailWords(boundary, processedAnimatedWordsRef.current, settings);
    });
    observer.observe(boundary, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [adaptiveSignalTrail, isStreaming]);

  return (
    <div
      className="streamdown-animation-boundary"
      data-signal-trail-profile={adaptiveSignalTrail && isStreaming ? signalTrailSettings?.profile : undefined}
      ref={animationBoundaryRef}
      style={{ display: "contents" }}
    >
      <Streamdown
        animated={animated}
        caret={caret}
        className="streamdown-scope"
        components={components}
        controls={STREAMDOWN_CONTROLS}
        isAnimating={isStreaming}
        lineNumbers={false}
        mode={isStreaming ? "streaming" : "static"}
        parseIncompleteMarkdown={isStreaming}
        plugins={STREAMDOWN_PLUGINS}
        rehypePlugins={STREAMDOWN_REHYPE_PLUGINS}
        remarkPlugins={STREAMDOWN_REMARK_PLUGINS}
        translations={STREAMDOWN_TRANSLATIONS}
        urlTransform={quakeUrlTransform}
      >
        {content}
      </Streamdown>
    </div>
  );
}

function useAdaptiveSignalTrail(content: string, active: boolean): AdaptiveSignalTrailSettings | undefined {
  const previousSampleRef = React.useRef<AdaptiveSignalTrailSample | undefined>(undefined);
  const sample = React.useMemo(() => {
    if (!active) return undefined;
    const sampledAt = typeof performance === "undefined" ? Date.now() : performance.now();
    return nextAdaptiveSignalTrailSample(previousSampleRef.current, content, sampledAt);
  }, [active, content]);

  React.useLayoutEffect(() => {
    previousSampleRef.current = active ? sample : undefined;
  }, [active, sample]);

  return sample?.settings;
}

function tuneSignalTrailWords(
  boundary: HTMLElement,
  processedWords: WeakSet<HTMLElement>,
  settings: AdaptiveSignalTrailSettings,
): void {
  const newAnimatedWords = Array.from(boundary.querySelectorAll<HTMLElement>("[data-sd-animate]"))
    .filter((element) => {
      if (processedWords.has(element)) return false;
      const durationMs = Number.parseFloat(element.style.getPropertyValue("--sd-duration"));
      return Number.isFinite(durationMs) && durationMs > 0;
    });
  if (newAnimatedWords.length === 0) return;

  const animationStartIndex = signalTrailAnimationStartIndex(newAnimatedWords.length, settings.maxAnimatedWords);
  newAnimatedWords.forEach((element, index) => {
    processedWords.add(element);
    if (index < animationStartIndex) {
      element.style.setProperty("--sd-duration", "0ms");
      element.style.setProperty("--sd-delay", "0ms");
      return;
    }
    const animatedIndex = index - animationStartIndex;
    element.style.setProperty("--sd-animation", settings.animationName);
    element.style.setProperty("--sd-duration", `${settings.durationMs}ms`);
    element.style.setProperty("--sd-delay", `${animatedIndex * settings.staggerMs}ms`);
  });
}

export function remarkQuakeFileLinks() {
  return (tree: any) => transformFilePathTextNodes(tree);
}

/** Keep footnote syntax literal, matching the desktop reference surface. */
export function remarkLiteralFootnotes() {
  return (tree: any) => transformFootnoteNodes(tree);
}

function transformFootnoteNodes(node: any): void {
  if (!node || !Array.isArray(node.children)) return;
  node.children = node.children.flatMap((child: any) => {
    if (child?.type === "footnoteReference") {
      return [{ type: "text", value: `[^${child.label || child.identifier || ""}]` }];
    }
    if (child?.type === "footnoteDefinition") {
      const label = child.label || child.identifier || "";
      const definitionChildren = child.children.flatMap((block: any, index: number) => {
        const content = Array.isArray(block?.children)
          ? block.children
          : [{ type: "text", value: String(block?.value || "") }];
        return index === 0 ? content : [{ type: "text", value: " " }, ...content];
      });
      return [{
        type: "paragraph",
        children: [{ type: "text", value: `[^${label}]: ` }, ...definitionChildren],
      }];
    }
    transformFootnoteNodes(child);
    return [child];
  });
}

function transformFilePathTextNodes(node: any): void {
  if (!node || !Array.isArray(node.children) || ["link", "linkReference", "code", "inlineCode"].includes(node.type)) return;
  node.children = node.children.flatMap((child: any) => {
    if (child?.type !== "text" || typeof child.value !== "string") {
      transformFilePathTextNodes(child);
      return [child];
    }
    return filePathTextNodes(child.value);
  });
}

function filePathTextNodes(value: string): any[] {
  const nodes: any[] = [];
  let cursor = 0;
  for (const match of value.matchAll(FILE_PATH_RE)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const path = raw.replace(/[,.;:)]+$/, "");
    if (start > cursor) nodes.push({ type: "text", value: value.slice(cursor, start) });
    nodes.push({
      type: "link",
      url: `${QUAKE_FILE_ORIGIN}${encodeURIComponent(path)}`,
      children: [{ type: "text", value: path }],
    });
    const suffix = raw.slice(path.length);
    if (suffix) nodes.push({ type: "text", value: suffix });
    cursor = start + raw.length;
  }
  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes.length ? nodes : [{ type: "text", value }];
}
