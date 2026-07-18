import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(root, "src/client/src/shimmer-lab.tsx"), "utf8");
const markdownContent = readFileSync(resolve(root, "src/client/src/components/markdown/MarkdownContent.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/client/shimmer-lab.css"), "utf8");
const viteConfig = readFileSync(resolve(root, "vite.config.ts"), "utf8");

describe("shimmer lab live streaming showcase", () => {
  it("uses the same Markdown streaming renderer as the application", () => {
    expect(source).toContain('import { MarkdownContent, SIGNAL_TRAIL_STREAM_ANIMATION } from "./components/markdown/MarkdownContent"');
    expect(source).toContain("animated={responseStyle.animated}");
    expect(source).toContain('adaptiveSignalTrail={responseStyle.id === "R06"}');
    expect(source).toContain("caret={responseStyle.caret}");
    expect(source).toContain('type StreamingPhase = "thinking" | "streaming" | "complete"');
  });

  it("shows the selected shimmer before streaming the response in chunks", () => {
    expect(source).toContain("LIVE_RESPONSE_CHUNKS");
    expect(source).toContain("LIVE_RESPONSE_SETTLE_MS = 900");
    expect(source).toContain("<ShimmerText className={variant.className}");
    expect(source).toContain("setPhase(\"streaming\")");
    expect(source).toContain("setPhase(\"complete\")");
    expect(source).toContain("Ortak yanıt akışı bekleniyor");
  });

  it("offers six independently selectable production-rendered response styles", () => {
    expect(source).toContain('id: "R01"');
    expect(source).toContain('id: "R06"');
    expect(source).toContain('animation: "fadeIn"');
    expect(source).toContain('animation: "blurIn"');
    expect(source).toContain('animation: "slideUp"');
    expect(source).toContain("animated: SIGNAL_TRAIL_STREAM_ANIMATION");
    expect(source).toContain('rhythm: "Akışa göre · ≤10 kelime"');
    expect(markdownContent).toContain('animation: "signalTrail"');
    expect(source).toContain("<ResponseFlowCard");
  });

  it("ships the responsive showcase through the Vite lab entry", () => {
    expect(styles).toContain(".streamingShowcase");
    expect(styles).toContain(".liveResponse .streamdown-scope");
    expect(styles).toContain(".responseStyleGrid");
    expect(styles).toContain("@keyframes sd-signalTrail");
    expect(viteConfig).toContain('shimmerLab: resolve(import.meta.dirname, "src/client/shimmer-lab.html")');
  });
});
