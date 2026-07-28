import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBrowserAnnotationContext, mergeBrowserAnnotationDraft, projectAnnotationRect, removeAnnotation, upsertAnnotation, type BrowserAnnotation } from "../src/client/src/lib/browser-annotations";

const browserPanel = readFileSync(join(process.cwd(), "src/client/src/components/dock/BrowserPanel.tsx"), "utf8");

function annotation(id: string, number: number, comment = "yorum"): BrowserAnnotation {
  return {
    id,
    number,
    comment,
    createdAt: number,
    target: {
      selectorPath: ["#app", `#${id}`], frameUrl: "https://example.com", documentUrl: "https://example.com",
      role: "button", accessibleName: id, tag: "button", id, classes: [], text: id, selector: `#${id}`,
      xpath: `/button[${number}]`, outerHTML: `<button id="${id}">${id}</button>`,
      rect: { x: number * 10, y: number * 20, width: 100, height: 30 }, attributes: {},
      styles: { font: "", color: "", background: "", display: "", position: "", margin: "", padding: "", width: "", height: "" },
    },
  };
}

describe("browser annotations", () => {
  it("supports multiple annotations and deterministic renumbering", () => {
    const first = upsertAnnotation([], annotation("one", 1));
    const second = upsertAnnotation(first, annotation("two", 2));
    expect(second.map((item) => item.number)).toEqual([1, 2]);
    expect(removeAnnotation(second, "one").map((item) => [item.id, item.number])).toEqual([["two", 1]]);
  });

  it("updates an existing annotation without duplicating it", () => {
    const initial = [annotation("one", 1, "eski")];
    const updated = upsertAnnotation(initial, annotation("one", 1, "yeni"));
    expect(updated).toHaveLength(1);
    expect(updated[0]?.comment).toBe("yeni");
  });

  it("includes the final open picker draft in a multi-annotation bundle", () => {
    const first = annotation("one", 1, "birinci");
    const second = annotation("two", 2, "ikinci");
    const merged = mergeBrowserAnnotationDraft([first], {
      id: second.id,
      target: second.target,
      comment: second.comment,
      createdAt: second.createdAt,
    });
    expect(merged.map((item) => [item.id, item.number, item.comment])).toEqual([
      ["one", 1, "birinci"],
      ["two", 2, "ikinci"],
    ]);
  });

  it("projects browser rects to the rendered screenshot", () => {
    expect(projectAnnotationRect({ x: 100, y: 50, width: 200, height: 100 }, { width: 1000, height: 500 }, { width: 500, height: 250 }))
      .toEqual({ left: 50, top: 25, width: 100, height: 50 });
  });

  it("builds compact structured prompt context", () => {
    const text = buildBrowserAnnotationContext("https://example.com", "Example", [annotation("one", 1, "Büyüt")]);
    expect(text).toContain("[Tarayıcı Açıklamaları]");
    expect(text).toContain("1. button#one (button)");
    expect(text).toContain("Açıklama: Büyüt");
    expect(text).not.toContain("outerHTML");
  });
});

describe("browser annotation picker interaction", () => {
  it("keeps the native page live instead of replacing it with a frozen screenshot", () => {
    expect(browserPanel).not.toContain("freezeSelectedViewport");
    expect(browserPanel).not.toContain("pickSurface");
    expect(browserPanel).toContain("browser.startElementPicker()");
    expect(browserPanel).toContain('result.status === "cancelled"');
  });

  it("materializes the completed live selection bundle", () => {
    expect(browserPanel).toContain("result.annotations.map");
    expect(browserPanel).toContain("result.screenshot");
    expect(browserPanel).toContain("buildBrowserAnnotationContext(current, title, annotations)");
    expect(browserPanel).toContain("onAnnotationBundle?.({");
  });
});
