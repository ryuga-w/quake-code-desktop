import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const root = resolve(import.meta.dirname);
const hasBuiltClient = existsSync(resolve(root, "dist/client/index.html"));
const hasBuiltServer = existsSync(resolve(root, "dist/server/index.js"));

// Dedicated port so Playwright never reuses a dev server that still has auth on.
const e2ePort = process.env.QUAKE_WEB_E2E_PORT || "3747";
const baseURL = `http://127.0.0.1:${e2ePort}`;

/**
 * S-PUB.1 / ship-gate smoke:
 * - Always force QUAKE_WEB_AUTH=0 (webServer.env + command) so local tokens never block UI.
 * - Prefer production-like dist serve so E2E hits built client assets.
 * - `src/server` also prefers `dist/client` when present; bare `src/client`
 *   index.html is not a Vite-dev entry and will not load the SPA correctly.
 *
 * Dual approach:
 * - With dist: `cross-env QUAKE_WEB_AUTH=0 node dist/server/index.js`
 * - Without dist: build first (`npm run build` / ship-gate auto-build), then re-run;
 *   fallback is `dev:server` with auth off (still needs a prior client build for assets).
 *
 * Run: `npm run test:e2e:smoke`  or  `SHIP_GATE_E2E=1 npm run ship-gate`
 */
const webServerCommand =
  hasBuiltServer && hasBuiltClient
    ? "cross-env QUAKE_WEB_AUTH=0 node dist/server/index.js"
    : "cross-env QUAKE_WEB_AUTH=0 npm run dev:server";

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: baseURL,
    // Always start our auth-off server on the e2e port (do not reuse a random dev server).
    reuseExistingServer: !process.env.CI && process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 120_000,
    env: {
      ...process.env,
      QUAKE_WEB_AUTH: "0",
      QUAKE_WEB_HOST: "127.0.0.1",
      QUAKE_WEB_PORT: e2ePort,
    },
  },
});
