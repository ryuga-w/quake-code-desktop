import { describe, expect, it } from "vitest";
import {
  EXTENSION_CATALOG,
  extensionIdFromPath,
  resolveExtensionEnabled,
} from "../src/server/extension-catalog";

describe("extension catalog", () => {
  it("lists computer-use as opt-in catalog entry", () => {
    const entry = EXTENSION_CATALOG.find((item) => item.id === "quake-computer-use");
    expect(entry?.name).toBe("Computer Use");
  });

  it("lists chrome and latex in catalog", () => {
    expect(EXTENSION_CATALOG.some((item) => item.id === "quake-chrome")).toBe(true);
    expect(EXTENSION_CATALOG.some((item) => item.id === "quake-latex")).toBe(true);
  });

  it("requires explicit enable for opt-in extensions", () => {
    expect(resolveExtensionEnabled("quake-computer-use", {})).toBe(false);
    expect(resolveExtensionEnabled("quake-computer-use", { "quake-computer-use": true })).toBe(true);
    expect(resolveExtensionEnabled("quake-computer-use", { "quake-computer-use": false })).toBe(false);
  });

  it("defaults non opt-in extensions to enabled", () => {
    expect(resolveExtensionEnabled("quake-browser-tools", {})).toBe(true);
    expect(resolveExtensionEnabled("quake-browser-tools", { "quake-browser-tools": false })).toBe(false);
  });

  it("derives extension id from index path", () => {
    expect(extensionIdFromPath("C:/pkg/extensions/quake-computer-use/index.ts")).toBe("quake-computer-use");
  });
});