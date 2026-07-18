import { describe, expect, it } from "vitest";
import viteConfig, { quakeManualChunk } from "../vite.config";

describe("Vite workspace configuration", () => {
  it("bridges hoisted Tailwind plugins into one flat local Vite plugin list", () => {
    const plugins = viteConfig.plugins ?? [];

    expect(plugins.length).toBeGreaterThan(1);
    expect(plugins.every((plugin) => !Array.isArray(plugin))).toBe(true);
    expect(plugins.map((plugin) => typeof plugin === "object" && plugin ? plugin.name : undefined)).toEqual(
      expect.arrayContaining([
        "@tailwindcss/vite:scan",
        "@tailwindcss/vite:generate:build",
        "quake-web-token-dev-inject",
      ]),
    );
  });

  it("assigns stable chunks for editor, React, and rich Markdown runtimes", () => {
    expect(quakeManualChunk("C:/repo/node_modules/monaco-editor/esm/vs/editor/editor.api.js")).toBe("monaco");
    expect(quakeManualChunk("C:/repo/node_modules/@monaco-editor/react/dist/index.js")).toBe("monaco");
    expect(quakeManualChunk(String.raw`C:\repo\node_modules\react-dom\client.js`)).toBe("react-vendor");
    expect(quakeManualChunk("C:/repo/node_modules/streamdown/dist/index.js")).toBe("markdown-core");
    expect(quakeManualChunk("C:/repo/node_modules/remark-gfm/index.js")).toBe("markdown-core");
    expect(quakeManualChunk("C:/repo/node_modules/micromark-extension-gfm/index.js")).toBe("markdown-core");
    expect(quakeManualChunk("C:/repo/node_modules/@streamdown/code/dist/index.js")).toBe("markdown-code");
    expect(quakeManualChunk("C:/repo/node_modules/@streamdown/math/dist/index.js")).toBe("markdown-math");
    expect(quakeManualChunk("C:/repo/node_modules/rehype-katex/index.js")).toBe("markdown-math");
    expect(quakeManualChunk("C:/repo/node_modules/@streamdown/mermaid/dist/index.js")).toBe("markdown-diagrams");
  });

  it("includes the landing and account portal as independent page entries", () => {
    const input = viteConfig.build?.rollupOptions?.input as Record<string, string> | undefined;

    expect(input).toBeDefined();
    expect(Object.keys(input ?? {})).toEqual(expect.arrayContaining(["main", "landing", "auth"]));
    expect(input?.auth.replaceAll("\\", "/")).toMatch(/src\/client\/auth\.html$/);
  });

  it("preserves Shiki and Mermaid lazy module boundaries", () => {
    const output = viteConfig.build?.rollupOptions?.output;

    expect(Array.isArray(output)).toBe(false);
    expect((output as { onlyExplicitManualChunks?: boolean } | undefined)?.onlyExplicitManualChunks).toBe(true);
    expect(quakeManualChunk("C:/repo/node_modules/shiki/dist/langs/typescript.mjs")).toBeUndefined();
    expect(
      quakeManualChunk("C:/repo/node_modules/mermaid/dist/chunks/mermaid.core/flowDiagram-ABC.mjs"),
    ).toBeUndefined();
    expect(quakeManualChunk("C:/repo/src/client/src/main.tsx")).toBeUndefined();
  });
});
