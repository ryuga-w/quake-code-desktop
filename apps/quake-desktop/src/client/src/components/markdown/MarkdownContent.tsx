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
const QUAKE_STATUS_ORIGIN = "https://quake.local/status/";
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
  remarkStatusDots,
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
  duration: 110,
  easing: "cubic-bezier(0, 0, 0.2, 1)",
  sep: "word",
  stagger: 18,
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
      if (href?.startsWith(QUAKE_STATUS_ORIGIN)) {
        const color = href.slice(QUAKE_STATUS_ORIGIN.length).replace(/[^a-z]/gi, "").toLowerCase();
        return (
          <span
            className="qc-status-dot"
            data-qc-status-dot={color}
            role="img"
            aria-label={`${color} durum`}
          />
        );
      }
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
    blockquote: ({ children, node: _node, className, ...props }) => (
      renderQuakeBlockquote({ children, className })
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

/* ── Renkli durum noktalari (status dots) ──────────────────────────────────
   Metindeki renkli daire emojileri (or. green/red/amber circle) ve
   `:dot-green:` gibi token'lar, CSS ile parlak 3D gradyan nokta olarak
   render edilen ozel span node'una donusturulur. */
const STATUS_DOT_EMOJI: Record<string, string> = {
  "\u{1F7E2}": "green",
  "\u{1F534}": "red",
  "\u{1F7E1}": "amber",
  "\u{1F535}": "blue",
  "\u{1F7E3}": "purple",
  "\u{1F7E0}": "orange",
  "\u26AA": "gray",
  "\u26AB": "black",
  "\u{1F7E4}": "brown",
};
const STATUS_DOT_COLORS = new Set([
  "green", "red", "amber", "yellow", "blue", "purple", "orange", "gray", "grey", "black", "brown", "teal", "pink",
]);
// Yakalanan gruplar: emoji  |  :dot-color:  |  {status:color}
const STATUS_DOT_RE = new RegExp(
  "([\\u{1F7E2}\\u{1F534}\\u{1F7E1}\\u{1F535}\\u{1F7E3}\\u{1F7E0}\\u26AA\\u26AB\\u{1F7E4}])" +
    "|:dot-([a-z]+):" +
    "|\\{status:([a-z]+)\\}",
  "gu",
);

export function remarkStatusDots() {
  return (tree: any) => transformStatusDotTextNodes(tree);
}

function transformStatusDotTextNodes(node: any): void {
  if (!node || !Array.isArray(node.children) || ["link", "linkReference", "code", "inlineCode"].includes(node.type)) return;
  node.children = node.children.flatMap((child: any) => {
    if (child?.type !== "text" || typeof child.value !== "string") {
      transformStatusDotTextNodes(child);
      return [child];
    }
    return statusDotNodes(child.value);
  });
}

function statusDotNodes(value: string): any[] {
  if (!STATUS_DOT_RE.test(value)) return [{ type: "text", value }];
  STATUS_DOT_RE.lastIndex = 0;
  const nodes: any[] = [];
  let cursor = 0;
  for (const match of value.matchAll(STATUS_DOT_RE)) {
    const start = match.index ?? 0;
    const raw = match[0];
    let color = match[1] ? STATUS_DOT_EMOJI[match[1]] : (match[2] || match[3] || "").toLowerCase();
    if (!color || !STATUS_DOT_COLORS.has(color)) continue;
    if (color === "grey") color = "gray";
    if (color === "yellow") color = "amber";
    if (start > cursor) nodes.push({ type: "text", value: value.slice(cursor, start) });
    nodes.push({
      // Streamdown'un kesin render ettigi `link` node'unu kullaniyoruz; ozel
      // href scheme'i (quake.local/status/<color>) `a` component override'inda
      // yakalanip renkli nokta span'ine cevrilir.
      type: "link",
      url: `${QUAKE_STATUS_ORIGIN}${color}`,
      children: [{ type: "text", value: "\u200B" }],
    });
    cursor = start + raw.length;
  }
  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes.length ? nodes : [{ type: "text", value }];
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

type AlertType = "note" | "tip" | "warning" | "important" | "caution";

const ALERT_CONFIGS: Record<AlertType, { label: string; color: string }> = {
  note: { label: "NOTE", color: "#2563eb" },
  tip: { label: "TIP", color: "#16a34a" },
  warning: { label: "WARNING", color: "#d97706" },
  important: { label: "IMPORTANT", color: "#9333ea" },
  caution: { label: "CAUTION", color: "#dc2626" },
};

function renderQuakeBlockquote(props: { children?: React.ReactNode; className?: string }) {
  const { children, className } = props;
  const alertInfo = extractAlertFromChildren(children);

  if (alertInfo) {
    const config = ALERT_CONFIGS[alertInfo.type];
    return (
      <blockquote
        className={`qc-md-blockquote markdown-alert markdown-alert-${alertInfo.type} ${className || ""}`}
        data-github-alert={alertInfo.type}
        style={{ borderLeftColor: config.color }}
      >
        <div className="markdown-alert-title" style={{ color: config.color }}>
          {config.label}
        </div>
        <div className="markdown-alert-body">
          {alertInfo.cleanedChildren}
        </div>
      </blockquote>
    );
  }

  return (
    <blockquote className={className ? `qc-md-blockquote ${className}` : "qc-md-blockquote"}>
      {children}
    </blockquote>
  );
}

const ALERT_MARKER_RE = /^\s*\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*/i;

/**
 * Return the leading plain-text string of a React node subtree, descending into
 * the first element child when Streamdown wraps text in <span>/animation nodes.
 */
function leadingText(node: React.ReactNode): string | null {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    for (const child of node) {
      const text = leadingText(child);
      if (text !== null) return text;
    }
    return null;
  }
  if (React.isValidElement(node)) {
    const kids = (node as React.ReactElement<any>).props?.children;
    if (kids === undefined || kids === null) return null;
    return leadingText(React.Children.toArray(kids));
  }
  return null;
}

/**
 * Clone `node`, stripping the alert marker (e.g. `[!NOTE]`) from the first plain
 * text leaf it contains. Descends into wrapper elements so streaming/animated
 * spans are handled the same as raw strings.
 */
function stripMarkerFromNode(node: React.ReactNode, done: { stripped: boolean }): React.ReactNode {
  if (done.stripped) return node;
  if (typeof node === "string") {
    const next = node.replace(ALERT_MARKER_RE, "");
    done.stripped = true;
    return next;
  }
  if (typeof node === "number") return node;
  if (Array.isArray(node)) {
    return node.map((child) => stripMarkerFromNode(child, done));
  }
  if (React.isValidElement(node)) {
    const el = node as React.ReactElement<any>;
    const kids = el.props?.children;
    if (kids === undefined || kids === null) return node;
    const nextKids = React.Children.map(kids, (child) => stripMarkerFromNode(child, done));
    return React.cloneElement(el, {}, nextKids);
  }
  return node;
}

function extractAlertFromChildren(children: React.ReactNode): { type: AlertType; cleanedChildren: React.ReactNode } | null {
  if (!children) return null;
  const childArray = React.Children.toArray(children);
  if (childArray.length === 0) return null;

  // Skip leading whitespace-only text nodes (Streamdown often emits "\n"
  // between the blockquote tag and its first paragraph).
  const firstIndex = childArray.findIndex(
    (child) => React.isValidElement(child) || (typeof child === "string" && child.trim().length > 0),
  );
  if (firstIndex === -1) return null;
  const firstChild = childArray[firstIndex];
  if (!React.isValidElement(firstChild)) return null;

  const pProps = (firstChild as React.ReactElement<any>).props;
  if (!pProps || pProps.children === undefined || pProps.children === null) return null;

  const lead = leadingText(pProps.children);
  if (lead === null) return null;

  const match = lead.match(ALERT_MARKER_RE);
  if (!match) return null;

  const type = match[1].toLowerCase() as AlertType;

  const done = { stripped: false };
  const nextFirstP = stripMarkerFromNode(firstChild, done);
  const cleanedChildren = [
    ...childArray.slice(0, firstIndex),
    nextFirstP,
    ...childArray.slice(firstIndex + 1),
  ];

  return { type, cleanedChildren };
}
