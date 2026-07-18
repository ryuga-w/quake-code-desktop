import { describe, expect, it } from "vitest";
import { buildPickerScript, buildResolveNodeParams, validateSelectorPath } from "../electron/browser-inspector";

describe("browser inspector target validation", () => {
  it("resolves a location result that only contains a backend node id", () => {
    expect(buildResolveNodeParams({ backendNodeId: 88 })).toEqual({ backendNodeId: 88 });
  });

  it("falls back to a frontend node id and rejects missing ids", () => {
    expect(buildResolveNodeParams({ nodeId: 67 })).toEqual({ nodeId: 67 });
    expect(buildResolveNodeParams({})).toBeNull();
  });

  it("accepts a bounded shadow selector path", () => {
    expect(validateSelectorPath(["#app", "button[data-testid=save]"], "")).toEqual([
      "#app",
      "button[data-testid=save]",
    ]);
  });

  it("uses the legacy selector as a fallback", () => {
    expect(validateSelectorPath(undefined, "#submit")).toEqual(["#submit"]);
  });

  it("rejects empty and oversized selectors", () => {
    expect(() => validateSelectorPath([], "")).toThrow("Geçersiz element hedefi");
    expect(() => validateSelectorPath(["x".repeat(2_001)], "")).toThrow("Geçersiz element hedefi");
  });

  it("limits untrusted selector path depth", () => {
    const selectors = Array.from({ length: 20 }, (_, index) => `div:nth-child(${index + 1})`);
    expect(validateSelectorPath(selectors, "")).toHaveLength(12);
  });

  it("builds a persistent live multi-selection runtime", () => {
    const script = buildPickerScript();
    expect(() => new Function(`return ${script}`)).not.toThrow();
    expect(script).toContain("Canlı element seçimi");
    expect(script).toContain("addSelection(element");
    expect(script).toContain("status: 'completed'");
    expect(script).not.toContain("status: 'selected'");
  });

  it("uses the reference blue overlay instead of the old yellow selector", () => {
    const script = buildPickerScript();
    expect(script).toContain("border:2px solid #1683ff");
    expect(script).toContain("background:rgba(22,131,255,.20)");
    expect(script).not.toContain("border:2px solid #f4d35e");
    expect(script).not.toContain("background:rgba(244,211,94,.14)");
  });
});
