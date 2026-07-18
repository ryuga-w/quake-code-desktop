import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";

const MARKDOWN_CORE_PACKAGES = new Set([
  "streamdown",
  "marked",
  "remend",
  "unified",
]);
const MARKDOWN_CORE_PACKAGE_PREFIXES = [
  "hast-util-",
  "mdast-util-",
  "micromark",
  "rehype-",
  "remark-",
  "unist-util-",
  "vfile",
];
const MARKDOWN_MATH_PACKAGES = new Set([
  "@streamdown/math",
  "katex",
  "mdast-util-math",
  "micromark-extension-math",
  "rehype-katex",
  "remark-math",
]);

function bridgeHoistedVitePlugins(plugins: readonly unknown[]): Plugin[] {
  // @tailwindcss/vite is hoisted, so its declarations bind to the root's
  // physical Vite install while this config binds to the app-local copy of
  // the same Vite version. Validate the runtime plugin shape, then contain the
  // unavoidable type-identity assertion at this single workspace boundary.
  return plugins.map((plugin, index) => {
    if (!plugin || typeof plugin !== "object" || typeof (plugin as { name?: unknown }).name !== "string") {
      throw new TypeError(`Invalid hoisted Vite plugin at index ${index}`);
    }
    return plugin as Plugin;
  });
}

function packageNameFromModuleId(id: string): string | undefined {
  const normalizedId = id.replaceAll("\\", "/");
  const nodeModulesMarker = "/node_modules/";
  const packageStart = normalizedId.lastIndexOf(nodeModulesMarker);
  if (packageStart < 0) return undefined;

  const packagePath = normalizedId.slice(packageStart + nodeModulesMarker.length);
  const [firstSegment, secondSegment] = packagePath.split("/");
  if (!firstSegment) return undefined;
  return firstSegment.startsWith("@") && secondSegment
    ? `${firstSegment}/${secondSegment}`
    : firstSegment;
}

export function quakeManualChunk(id: string): string | undefined {
  const packageName = packageNameFromModuleId(id);
  if (!packageName) return undefined;

  if (packageName === "monaco-editor" || packageName === "@monaco-editor/react") return "monaco";
  if (packageName === "react" || packageName === "react-dom" || packageName === "scheduler") return "react-vendor";
  if (packageName === "@streamdown/code") return "markdown-code";
  if (MARKDOWN_MATH_PACKAGES.has(packageName)) return "markdown-math";
  if (packageName === "@streamdown/mermaid") return "markdown-diagrams";
  if (
    MARKDOWN_CORE_PACKAGES.has(packageName)
    || MARKDOWN_CORE_PACKAGE_PREFIXES.some((prefix) => packageName.startsWith(prefix))
  ) {
    return "markdown-core";
  }
  return undefined;
}

function quakeWebTokenPlugin(): Plugin {
  return {
    name: "quake-web-token-dev-inject",
    transformIndexHtml(html) {
      if (process.env.QUAKE_WEB_AUTH === "0") return html;
      const cwd = resolve(process.env.QUAKE_WEB_CWD ?? process.cwd());
      const tokenPath = process.env.QUAKE_WEB_TOKEN_FILE || join(cwd, ".quake-code", "web-token");
      const token = process.env.QUAKE_WEB_TOKEN || (existsSync(tokenPath) ? readFileSync(tokenPath, "utf8").trim() : "");
      if (!token) return html;
      const script = `<script>window.__QUAKE_WEB_TOKEN__=${JSON.stringify(token)}</script>`;
      return html.includes("</head>") ? html.replace("</head>", `${script}\n  </head>`) : `${script}\n${html}`;
    },
  };
}

export default defineConfig({
  plugins: [...bridgeHoistedVitePlugins(tailwindcss()), quakeWebTokenPlugin()],
  root: resolve(import.meta.dirname, "src/client"),
  css: {
    // Keep Quake Web isolated from machine-level PostCSS/Tailwind configs.
    postcss: { plugins: [] },
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist/client"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "src/client/index.html"),
        landing: resolve(import.meta.dirname, "src/client/landing.html"),
        auth: resolve(import.meta.dirname, "src/client/auth.html"),
        shimmerLab: resolve(import.meta.dirname, "src/client/shimmer-lab.html"),
        streamingLab: resolve(import.meta.dirname, "src/client/streaming-lab.html"),
      },
      output: {
        // Do not let Rollup absorb transitive lazy Shiki/Mermaid modules into
        // an explicit rich-render chunk; that preserves their on-demand graph
        // and avoids order-dependent cross-chunk cycles.
        onlyExplicitManualChunks: true,
        manualChunks: quakeManualChunk,
      },
    },
  },
  server: {
    proxy: {
      // ws:true -> /api/terminal WebSocket'i de proxy'le (gercek terminal).
      "/api": { target: "http://127.0.0.1:3737", ws: true },
    },
  },
});
