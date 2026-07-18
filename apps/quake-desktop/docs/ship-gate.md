# Ship-gate (T3.C)

Local and CI preflight for Quake Desktop **unsigned** Windows builds.  
No code-signing secrets are required for this path.

## What it checks

| Step | Default | Skip / enable |
|------|---------|---------------|
| Token log regression (`web token:` in server sources) | always | — |
| Typecheck (`tsgo` server + `tsc` web) | always | — |
| Production build (`desktop:build:production`) | on | `SHIP_GATE_SKIP_BUILD=1` |
| Vitest (`npm test`) | always | — |
| Playwright **smoke** (`test:e2e:smoke`) | off | `SHIP_GATE_E2E=1` |

After checks, the script prints a residual checklist: prod audit, package, code sign, auto-update.

## Playwright smoke (S-PUB.1)

Minimal green-path UI test against the Turkish shell (NavRail + Settings modal + composer).

| Item | Detail |
|------|--------|
| Spec | `test/e2e/smoke.spec.ts` |
| npm script | `npm run test:e2e:smoke` |
| Config | `playwright.config.ts` — `QUAKE_WEB_AUTH=0`, dedicated port `3747`, prefers `dist/server` + `dist/client` |
| Full suite | `npm run test:e2e` (broader; not required for ship-gate) |

### Run smoke only

```bash
# From apps/quake-desktop (needs browsers once: npx playwright install chromium)
npm run build
npm run test:e2e:smoke
```

```powershell
# Via ship-gate
$env:SHIP_GATE_E2E = "1"; npm run ship-gate
```

When `SHIP_GATE_E2E=1` and `dist/` is missing (e.g. after `SHIP_GATE_SKIP_BUILD=1`), ship-gate runs `npm run build` automatically before smoke.

### Optional agents + settings e2e (not ship-gate)

Broader UI path beyond S-PUB.1 smoke: **Ayarlar → İzinler → Uygulamaya geri dön**, plus a soft-skip attempt to open the right dock **Ajanlar** panel when chrome is reachable.

| Item | Detail |
|------|--------|
| Spec | `test/e2e/agents-settings-smoke.spec.ts` |
| Run | `npx playwright test test/e2e/agents-settings-smoke.spec.ts` |
| Ship-gate / CI | **Not** required — Ajanlar uses `test.skip` when dock chrome is hidden (empty new-chat shell) |
| Related contracts | Vitest `test/a11y-smoke-source.test.ts` (Kalıcı izinler, Trust modal, Agents activity, PTY banner) |

Prefer `test:e2e:smoke` for merge signal; run agents-settings locally when changing dock / permissions UX.

## Run ship-gate locally

From the monorepo root:

```bash
npm --workspace @mrquake/quake-desktop run ship-gate
```

From `apps/quake-desktop`:

```bash
npm run ship-gate
```

### Environment flags

```bash
# Skip nested production build (CI runs build as a separate step)
# PowerShell:
$env:SHIP_GATE_SKIP_BUILD = "1"; npm run ship-gate

# Include Playwright smoke (needs Chromium; installs dist if missing)
$env:SHIP_GATE_E2E = "1"; npm run ship-gate
```

### Package after gate (unsigned)

```bash
# Full production build + NSIS installer + SHA256SUMS
npm run desktop:package:win

# Or dir-only unpack (faster inspect):
npm run desktop:pack:win
```

Artifacts land under `apps/quake-desktop/release/`:

- `Quake-Code-Setup-<version>-x64.exe`
- `SHA256SUMS.txt`
- `KURULUM.md`, `KUR-QUAKE-CODE.bat`
- `win-unpacked/`

Code signing is intentionally out of scope for the default ship-gate path. Windows SmartScreen may warn on unsigned installers (see `docs/windows-install.md`).

**S-PUB.2–3:** electron-updater scaffold + signing notes live in [`windows-signing.md`](./windows-signing.md). Ship-gate must not require `CSC_*`, Azure Trusted Signing, or update-feed secrets.

## CI

Workflow: [`.github/workflows/desktop-windows.yml`](../../../.github/workflows/desktop-windows.yml)

| Trigger | Steps |
|---------|--------|
| `push` / `pull_request` (paths: `apps/quake-desktop/**`, `packages/**`, lockfiles) | `npm ci` → ship-gate (`SHIP_GATE_SKIP_BUILD=1`) → `desktop:build:production` → **Playwright smoke** |
| `workflow_dispatch` (`package=true`, default) | above + `electron-builder` NSIS (unsigned) + upload artifacts |
| `workflow_dispatch` (`package_signed=true`) | optional signed NSIS when `CSC_*` secrets exist; **skips cleanly** if missing (never required) |
| `workflow_dispatch` (`run_e2e=true`) | also sets `SHIP_GATE_E2E=1` inside ship-gate (smoke); post-build smoke still runs |

Node: **22** (satisfies root `engines.node: >=20`).

Install uses monorepo root **`npm ci`** (workspaces). Production build matches local scripts:

```text
desktop:build:runtime  → packages/tui, ai, agent, jiti, coding-agent
build                  → tsgo server + vite client
desktop:build:main     → electron main (tsc + cjs marker)
```

Package step sets `CSC_IDENTITY_AUTO_DISCOVERY=false` so electron-builder does not look for signing certs.

On smoke failure, CI uploads `playwright-report/` and `test-results/` as artifacts.

## Token log regression

The gate greps `src/server/**` for raw token log patterns such as:

```ts
console.log(`Quake Code web token: ${auth.token}`);
```

Expected boot line (already in tree):

```text
Quake Code web auth: enabled (token not logged)
```

## Related

- Track status: [`PROGRAM_TRACKS.md`](./PROGRAM_TRACKS.md) (T3 Publish)
- Prod audit: [`audit.md`](./audit.md)
- Windows install: [`windows-install.md`](./windows-install.md)
- Windows signing + auto-update: [`windows-signing.md`](./windows-signing.md)
- Security: [`security.md`](./security.md)
