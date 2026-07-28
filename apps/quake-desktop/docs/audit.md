# Production dependency audit (T3.B)

**Date:** 2026-07-16  
**Scope:** Quake monorepo root (`C:\quake code`) and workspace `@mrquake/quake-desktop`  
**Command used:**

```bash
# Monorepo root
npm audit --omit=dev

# Desktop workspace only
npm audit --omit=dev --workspace @mrquake/quake-desktop
# or from apps/quake-desktop:
npm run audit:prod
```

## Findings summary

### Baseline (before hygiene)

`npm audit --omit=dev` reported **6** issues:

| Package | Severity | Range flagged | Reachability (notable) |
|---------|----------|---------------|------------------------|
| `shell-quote` | **critical** | 1.1.0 – 1.8.3 | `concurrently` (dev), `@anthropic-ai/sandbox-runtime` via monorepo `mom` |
| `form-data` | **high** | 4.0.0 – 4.0.5 | `electron-builder` / `electron-publish` (dev), Slack SDK via monorepo `mom` |
| `protobufjs` | **high** | ≤7.6.2 | `@google/genai` → `@mrquake/quakecode-ai` (**prod runtime path**) |
| `undici` | **high** | 7.0.0 – 7.27.2 | Direct dep of `quakecode-ai` / `quakecode-cli` (**prod runtime path**) |
| `vite` | **high** | 7.0.0 – 7.3.3 / ≤7.3.4 | `devDependency` of desktop; also pulled as peer of `@tailwindcss/vite` |
| `esbuild` | **low** | 0.27.3 – 0.28.0 | Transitive via `vite` (build / dev tooling) |

### After hygiene

`npm audit --omit=dev` reports **1** issue:

| Package | Severity | Status | Notes |
|---------|----------|--------|-------|
| `esbuild` | **low** | **Deferred** | GHSA-g7r4-m6w7-qqqr — arbitrary file read when running the **esbuild/vite development server** on Windows. Not a shipped-runtime issue. |

**Prod audit result:** 1 low (down from 1 critical + 4 high + 1 low).

Full audit including devDependencies still surfaces **vitest** (critical when UI server listens, GHSA-5xrq-8626-4rwp). That is **dev-only** and is outside `--omit=dev`.

## Actions taken

### 1. Monorepo `overrides` (root `package.json`)

Pinned low-risk patch/minor overrides:

| Override | Version | Rationale |
|----------|---------|-----------|
| `form-data` | `4.0.6` | Patch fixes CRLF injection; no API break expected |
| `shell-quote` | `1.8.4` | Patch fixes newline quoting; critical severity |
| `protobufjs` | `7.6.5` | Stay on v7 line (`@google/genai` uses `^7.5.4`); avoids major 8.x jump |
| `undici` | `7.28.0` | Stay on v7; fixes multi-issue high advisory band through 7.27.2 |
| `vite` | `7.3.6` | Patch/minor within Vite 7; clears fs.deny / launch-editor advisories |

Existing overrides retained: `rimraf`, `fast-xml-parser`, nested `gaxios.rimraf`.

### 2. Direct dependency bumps

| Package | File | Change |
|---------|------|--------|
| `undici` | `packages/ai/package.json` | `^7.19.1` → `^7.28.0` |
| `undici` | `packages/coding-agent/package.json` | `^7.19.1` → `^7.28.0` |
| `vite` | `apps/quake-desktop/package.json` | `^7.1.3` → `^7.3.6` |

### 3. npm script

Added desktop script:

```json
"audit:prod": "npm audit --omit=dev --workspace @mrquake/quake-desktop"
```

### 4. Auth token logging (confirm)

Desktop server already avoids logging the raw web token:

```text
Quake Code web auth: enabled (token not logged)
```

Source: `apps/quake-desktop/src/server/index.ts` (no `web token:` raw log).  
No re-edit of token logging was required for this task.

## Deferred (with reason)

| Item | Severity | Reason deferred |
|------|----------|-----------------|
| `esbuild@0.27.4` | low | Advisory is **dev-server only** (Windows). Fixed floor is `0.28.1`, which is within Vite’s `^0.27.0 \|\| ^0.28.0` range, but forcing the override hit Windows `EBUSY` on `@esbuild/win32-x64/esbuild.exe` during install in this environment. Prefer not to force-break the toolchain for a low, non-shipped finding. Revisit when Vite pins a fixed esbuild or when no process holds the binary. |
| `vitest` &lt; 3.2.6 | critical (dev) | **devDependency only**; appears in full `npm audit`, not `--omit=dev`. Bump can be done in a dedicated test-tooling pass (`vitest` → ≥3.2.6). Not required for shipped desktop asar. |
| Moving `@tailwindcss/vite` / build-only packages out of `dependencies` | n/a | Would clean false “prod” audit noise but risks packaging/layout churn; left for a separate dependency-classification pass. |

## Vite as `devDependency` vs shipped asar

- **`vite` is declared under `devDependencies`** in `apps/quake-desktop/package.json` and is used for client build / HMR during development.
- It still appears under `npm audit --omit=dev` because **`@tailwindcss/vite` is a production dependency** and lists `vite` as a peer; npm therefore keeps `vite` (and `esbuild`) on the production dependency graph for the workspace install.
- **Shipped Electron package (`app.asar` / `win-unpacked`) does not ship the Vite dev server.** Production packaging runs `vite build` at package time; the runtime loads prebuilt static assets from `dist/client` plus the Node server / Electron main process.
- Treat Vite/esbuild advisories that only affect the **development server** as build-machine risk, not end-user install risk, unless packaging configuration changes to embed those tools.

## Residual risk / next steps

1. Clear remaining **low** `esbuild` finding when install environment allows `esbuild@0.28.1+` without binary locks (or when Vite upstream upgrades).
2. Optionally bump **vitest** to ≥3.2.6 for full-audit cleanliness (dev-only).
3. Re-run `npm run audit:prod` after any major monorepo dependency refresh.
4. Periodically re-check that server boot logs still do not print the raw web token.

## Verification snapshot (2026-07-16)

Installed versions after hygiene:

| Package | Version |
|---------|---------|
| `form-data` | 4.0.6 |
| `shell-quote` | 1.8.4 |
| `protobufjs` | 7.6.5 |
| `undici` | 7.28.0 |
| `vite` | 7.3.6 |
| `esbuild` | 0.27.4 (deferred) |

```text
# npm audit --omit=dev
1 low severity vulnerability (esbuild)
```
