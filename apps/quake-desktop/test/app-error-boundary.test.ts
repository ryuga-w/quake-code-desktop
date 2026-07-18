import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppErrorBoundary, buildAppErrorDiagnostic } from "../src/client/src/components/common/AppErrorBoundary";

const root = join(import.meta.dirname, "..");

describe("AppErrorBoundary", () => {
  it("renders without relying on a global React variable", () => {
    const boundary = new AppErrorBoundary({ children: "Quake Code" });

    expect(() => boundary.render()).not.toThrow();
  });

  it("wraps the entire lazy application surface", () => {
    const main = readFileSync(join(root, "src/client/src/main.tsx"), "utf8");
    const boundaryStart = main.indexOf("<AppErrorBoundary>");
    const suspenseStart = main.indexOf("<React.Suspense");
    const app = main.indexOf("<App />");

    expect(boundaryStart).toBeGreaterThan(-1);
    expect(suspenseStart).toBeGreaterThan(boundaryStart);
    expect(app).toBeGreaterThan(suspenseStart);
  });

  it("builds a copyable diagnostic without hiding the original error", () => {
    const error = new Error("render failed");
    const diagnostic = buildAppErrorDiagnostic({
      error,
      componentStack: "\n  at BrokenPanel",
      capturedAt: "2026-07-17T09:00:00.000Z",
      url: "http://localhost/",
      userAgent: "Vitest",
    });

    expect(diagnostic).toContain("render failed");
    expect(diagnostic).toContain("BrokenPanel");
    expect(diagnostic).toContain("2026-07-17T09:00:00.000Z");
  });
});
