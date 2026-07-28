#!/usr/bin/env node
/**
 * T3.C ship-gate — local + CI preflight for Quake Desktop (unsigned path).
 *
 * Steps:
 *   1. Token log regression (fail if raw `web token:` appears in server sources)
 *   2. Typecheck (server + web)
 *   3. Optional production build (skip with SHIP_GATE_SKIP_BUILD=1 when CI builds separately)
 *   4. Vitest unit/source tests
 *   5. Optional Playwright smoke e2e when SHIP_GATE_E2E=1 (`npm run test:e2e:smoke`)
 *   6. Print residual checklist (audit / package / sign / update)
 *
 * Usage (from apps/quake-desktop):
 *   npm run ship-gate
 *   SHIP_GATE_E2E=1 npm run ship-gate
 *   SHIP_GATE_SKIP_BUILD=1 npm run ship-gate
 *
 * Smoke needs built client+server (`dist/client` + `dist/server`). When E2E is on
 * and build was skipped, ship-gate runs `npm run build` if dist is missing.
 * Full suite: `npm run test:e2e` (not gated here — prefer smoke for CI signal).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const npmCmd = isWin ? "npm.cmd" : "npm";

const SKIP_BUILD = truthy(process.env.SHIP_GATE_SKIP_BUILD);
const RUN_E2E = truthy(process.env.SHIP_GATE_E2E);

/** Patterns that indicate the raw web token is being logged (regression). */
const TOKEN_LOG_PATTERNS = [
  /web token:\s*\$\{/,
  /web token:\s*['"`]/,
  /console\.log\([^)]*web token:\s*\$\{auth\.token/,
  /console\.log\([^)]*`[^`]*web token:\s*\$\{/,
];

let failed = 0;
const results = [];

function truthy(value) {
  if (value == null || value === "") return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function banner(title) {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (ok) {
    console.log(`[ship-gate] PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`[ship-gate] FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function runNpm(script, extraEnv = {}) {
  const result = spawnSync(npmCmd, ["run", script], {
    cwd: projectRoot,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    shell: isWin,
  });
  if (result.error) {
    return { ok: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, detail: `exit ${result.status ?? "unknown"}` };
  }
  return { ok: true, detail: "" };
}

function collectTsFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "release") continue;
      collectTsFiles(full, out);
    } else if (entry.isFile() && /\.(ts|js|mjs|cjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ── 1. Token log regression ──────────────────────────────────────────────
banner("1/5 Token log regression");

const serverDir = join(projectRoot, "src", "server");
const serverFiles = collectTsFiles(serverDir);
const hits = [];

for (const file of serverFiles) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Ignore comments that only document the forbidden pattern.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      continue;
    }
    for (const pattern of TOKEN_LOG_PATTERNS) {
      if (pattern.test(line)) {
        hits.push(`${relative(projectRoot, file)}:${i + 1}: ${trimmed}`);
        break;
      }
    }
  }
}

// Also reject the classic exact string used before the fix.
for (const file of serverFiles) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("web token:") && /console\.(log|info|debug|warn)\(/.test(text)) {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      if (line.includes("web token:") && /console\.(log|info|debug|warn)\(/.test(line)) {
        const key = `${relative(projectRoot, file)}:${i + 1}`;
        if (!hits.some((h) => h.startsWith(key))) {
          hits.push(`${key}: ${trimmed}`);
        }
      }
    }
  }
}

if (hits.length === 0) {
  record("token-log-regression", true, `${serverFiles.length} server files scanned; no raw web token log`);
} else {
  for (const hit of hits) console.error(`  ${hit}`);
  record(
    "token-log-regression",
    false,
    `found ${hits.length} raw token log pattern(s); expected "token not logged" only`,
  );
}

// ── 2. Typecheck ─────────────────────────────────────────────────────────
banner("2/5 Typecheck");

{
  const r = runNpm("typecheck");
  record("typecheck", r.ok, r.detail || "tsgo server + tsc web");
}

// ── 3. Build (optional) ──────────────────────────────────────────────────
banner("3/5 Production build");

if (SKIP_BUILD) {
  record("desktop:build:production", true, "skipped (SHIP_GATE_SKIP_BUILD=1)");
} else {
  const r = runNpm("desktop:build:production");
  record("desktop:build:production", r.ok, r.detail || "runtime packages + client/server + electron main");
}

// ── 4. Vitest ────────────────────────────────────────────────────────────
banner("4/5 Vitest");

{
  const r = runNpm("test");
  record("vitest", r.ok, r.detail || "unit + source contract tests");
}

// ── 5. Playwright smoke (optional) ───────────────────────────────────────
banner("5/5 Playwright smoke (optional)");

if (!RUN_E2E) {
  record("e2e-smoke", true, "skipped (set SHIP_GATE_E2E=1 to run Playwright smoke)");
} else {
  const distClient = join(projectRoot, "dist", "client", "index.html");
  const distServer = join(projectRoot, "dist", "server", "index.js");
  const hasDist = existsSync(distClient) && existsSync(distServer);

  // Auth-off SPA serve needs built assets; dist may be missing when SKIP_BUILD=1.
  if (!hasDist) {
    console.log("[ship-gate] dist/client or dist/server missing — running `npm run build` for e2e smoke");
    const br = runNpm("build");
    if (!br.ok) {
      record("e2e-smoke", false, `build required for smoke failed: ${br.detail}`);
    } else if (!existsSync(distClient) || !existsSync(distServer)) {
      record("e2e-smoke", false, "build finished but dist/client or dist/server still missing");
    } else {
      const r = runNpm("test:e2e:smoke");
      record("e2e-smoke", r.ok, r.detail || "playwright smoke (test/e2e/smoke.spec.ts)");
    }
  } else {
    const r = runNpm("test:e2e:smoke");
    record("e2e-smoke", r.ok, r.detail || "playwright smoke (test/e2e/smoke.spec.ts)");
  }
}

// ── Summary + residual checklist ─────────────────────────────────────────
banner("Summary");

for (const r of results) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}

console.log("");
console.log("Residual ship checklist (manual / next gates):");
console.log("  [ ] npm run audit:prod          — prod dependency audit (see docs/audit.md)");
console.log("  [ ] npm run desktop:package:win — unsigned NSIS installer + SHA256SUMS");
console.log("  [ ] Code signing (optional)     — CSC_* / Azure Trusted Signing; see docs/windows-signing.md");
console.log("  [ ] Auto-update feed (optional) — QUAKE_UPDATE_FEED_URL + publish; Settings → Otomatik güncelleme");
console.log("  [ ] docs/windows-install.md     — keep in sync with installer artifact names");
console.log("");
console.log("Commands (from monorepo root):");
console.log("  npm --workspace @mrquake/quake-desktop run ship-gate");
console.log("  npm --workspace @mrquake/quake-desktop run desktop:build:production");
console.log("  npm --workspace @mrquake/quake-desktop run desktop:package:win");
console.log("");
console.log("CI: .github/workflows/desktop-windows.yml");
console.log("  push/PR  → ship-gate (skip build) + production build + Playwright smoke");
console.log("  dispatch → + package (unsigned) + upload artifacts; run_e2e forces smoke in ship-gate");
console.log("Local smoke: SHIP_GATE_E2E=1 npm run ship-gate  OR  npm run test:e2e:smoke");
console.log("");
console.log(`Docs: ${join("docs", "ship-gate.md")}`);

if (failed > 0) {
  console.error(`[ship-gate] ${failed} check(s) failed`);
  process.exit(1);
}

console.log("[ship-gate] all required checks passed");
process.exit(0);
