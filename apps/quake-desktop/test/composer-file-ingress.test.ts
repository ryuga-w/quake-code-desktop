import { File } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyComposerFile,
  composerFallbackMessage,
  hasComposerPayload,
  readComposerTextFile,
} from "../src/client/src/lib/composer-files";

const root = process.cwd();
const composerSource = readFileSync(join(root, "src/client/src/components/composer/ChatComposer.tsx"), "utf8");
const composerStyles = readFileSync(join(root, "src/client/src/components/composer/ChatComposer.module.css"), "utf8");
const draftSource = readFileSync(join(root, "src/client/src/app/hooks/useComposerDraft.ts"), "utf8");
const dropZoneSource = readFileSync(join(root, "src/client/src/components/files/DropZone.tsx"), "utf8");
const appSource = readFileSync(join(root, "src/client/src/app/App.tsx"), "utf8");

describe("composer file ingress", () => {
  it("classifies supported images and text/code without treating binary files as text", () => {
    expect(classifyComposerFile({ name: "screen.png", type: "image/png" } as File)).toEqual({
      kind: "image",
      mimeType: "image/png",
    });
    expect(classifyComposerFile({ name: "photo.jpg", type: "" } as File)).toEqual({
      kind: "image",
      mimeType: "image/jpeg",
    });
    expect(classifyComposerFile({ name: "export.webp", type: "application/octet-stream" } as File)).toEqual({
      kind: "image",
      mimeType: "image/webp",
    });
    expect(classifyComposerFile({ name: "component.tsx", type: "" } as File)).toEqual({ kind: "text" });
    expect(classifyComposerFile({ name: "diagram.svg", type: "image/svg+xml" } as File)).toEqual({ kind: "text" });
    expect(classifyComposerFile({ name: "manual.pdf", type: "application/pdf" } as File)).toEqual({ kind: "unsupported" });
  });

  it("bounds large text context and rejects binary-looking input", async () => {
    const large = new File(["a".repeat(20_000)], "large.log", { type: "text/plain" });
    const result = await readComposerTextFile(large as unknown as globalThis.File);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("İçerik güvenli bağlam sınırında kısaltıldı");
    expect(result.text.length).toBeLessThan(13_000);

    const binary = new File([new Uint8Array([1, 0, 2, 3])], "binary.txt", { type: "text/plain" });
    await expect(readComposerTextFile(binary as unknown as globalThis.File)).rejects.toThrow("ikili dosya");
  });

  it("allows a context-only submission with a truthful fallback message", () => {
    expect(hasComposerPayload("", 0, 1)).toBe(true);
    expect(hasComposerPayload("", 0, 0)).toBe(false);
    expect(composerFallbackMessage(0, 1)).toBe("Bu dosyayı incele.");
    expect(composerFallbackMessage(2, 1)).toBe("Eklenen görselleri ve dosyaları incele.");
    expect(appSource).toContain("hasComposerPayload(message, images.length, nonAnnotationContextChips.length)");
  });

  it("wires drop, picker, and paste through one bounded ingestion path", () => {
    expect(composerSource).toContain('data-composer-drop-zone="true"');
    expect(composerSource).toContain("onDragEnter={handleFileDragEnter}");
    expect(composerSource).toContain("onDrop={handleFileDrop}");
    expect(composerSource).toContain("accept={COMPOSER_FILE_ACCEPT}");
    expect(composerSource).toContain("<b>Bilgisayardan dosya</b>");
    expect(composerStyles).toContain('.composer[data-file-drag-active="true"]');
    expect(composerStyles).toContain(".fileDropOverlay");
    expect(draftSource).toContain("await addComposerFiles(files)");
    expect(draftSource).toContain("COMPOSER_IMAGE_MAX_BYTES");
  });

  it("prevents the outer workspace drop zone from uploading composer attachments twice", () => {
    expect(dropZoneSource).toContain("if (isComposerDropTarget(e.target)) return");
    expect(dropZoneSource).toContain("target.closest('[data-composer-drop-zone=\"true\"]')");
  });
});
