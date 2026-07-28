# Windows code signing + auto-update (S-PUB.2–3)

This document covers **optional** Authenticode signing and the electron-updater path for Quake Desktop.  
**Ship-gate and default CI stay unsigned** — no certificate is required for local package or `desktop-windows.yml` package jobs.

Related:

- Install / SmartScreen: [`windows-install.md`](./windows-install.md)
- Ship-gate (unsigned preflight): [`ship-gate.md`](./ship-gate.md)
- Builder config: [`../electron-builder.yml`](../electron-builder.yml)
- Runtime scaffold: `electron/auto-update.ts`

---

## Principles

| Path | Signing | Update feed | Required secrets |
|------|---------|-------------|------------------|
| Local `desktop:package:win` | No | No | None |
| CI ship-gate / PR build | No | No | None |
| CI package (dispatch, default) | No (`CSC_IDENTITY_AUTO_DISCOVERY=false`) | No | None |
| CI package_signed (dispatch, opt-in) | Yes **if** secrets present; otherwise skip | No | Optional `CSC_*` |
| Signed release (manual / future) | Yes | Optional | Signing (+ optional publish) |

Unsigned installers may show Windows SmartScreen (“Bilinmeyen yayıncı”). That is expected until a real cert is used.

---

## Step-by-step: self-signed cert for **dev** only

Self-signed certificates do **not** clear SmartScreen for end users. Use them only to exercise the electron-builder signing path locally.

### 1. Generate a self-signed code-signing cert (PowerShell, elevated optional)

```powershell
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Quake Code Dev" `
  -KeyExportPolicy Exportable `
  -KeySpec Signature `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(2)

$pwd = ConvertTo-SecureString -String "dev-only-change-me" -Force -AsPlainText
$pfxPath = "$env:USERPROFILE\quake-code-dev-codesign.pfx"
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pwd
Write-Host "Thumbprint: $($cert.Thumbprint)"
Write-Host "PFX: $pfxPath"
```

### 2. Point electron-builder at the PFX

```powershell
$env:CSC_LINK = "$env:USERPROFILE\quake-code-dev-codesign.pfx"
$env:CSC_KEY_PASSWORD = "dev-only-change-me"
Remove-Item Env:CSC_IDENTITY_AUTO_DISCOVERY -ErrorAction SilentlyContinue

cd apps\quake-desktop
npm run desktop:package:win
```

### 3. Verify signature (optional)

```powershell
Get-AuthenticodeSignature .\release\Quake-Code-Setup-*-x64.exe | Format-List *
# Status may be UnknownError / NotTrusted for self-signed — expected.
```

**Do not** commit the PFX or password. Prefer a secrets store even for dev machines.

---

## electron-builder env vars (classic PFX / CSC)

electron-builder discovers Windows certs automatically unless disabled.

| Variable | Purpose |
|----------|---------|
| `CSC_IDENTITY_AUTO_DISCOVERY` | Set `false` for unsigned builds (CI default). Set `true` or omit when signing. |
| `CSC_LINK` | Path or URL to `.pfx` / `.p12` (or certificate file). |
| `CSC_KEY_PASSWORD` | Password for `CSC_LINK` material. |
| `WIN_CSC_LINK` | Windows-only override of `CSC_LINK`. |
| `WIN_CSC_KEY_PASSWORD` | Windows-only override of `CSC_KEY_PASSWORD`. |
| `CSC_NAME` | Optional subject name when selecting from store. |

### Local signed package (production-like PFX)

```powershell
# Do NOT commit the PFX. Prefer a secrets store / CI OIDC.
$env:CSC_LINK = "C:\secure\quake-code-codesign.pfx"
$env:CSC_KEY_PASSWORD = "<from-secret-store>"
# Optional: clear the unsigned CI default
Remove-Item Env:CSC_IDENTITY_AUTO_DISCOVERY -ErrorAction SilentlyContinue

npm run desktop:package:win
```

### Unsigned (default / ship-gate)

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npm run desktop:package:win
```

No real cert is required for development or the residual ship checklist package step.

---

## Azure Trusted Signing checklist

Microsoft **Trusted Signing** (formerly Azure Code Signing) is the preferred cloud path for EV-like reputation without shipping a long-lived PFX on disk.

Use this checklist when wiring a **separate** signed-release job (not ship-gate):

1. **Azure resources**
   - [ ] Create a Trusted Signing **account** in a supported region.
   - [ ] Create a **certificate profile** (public trust / private as appropriate).
   - [ ] Note: endpoint URL, account name, certificate profile name.
2. **Identity**
   - [ ] App registration or managed identity for the build agent.
   - [ ] Prefer **federated OIDC** over long-lived client secrets.
   - [ ] Grant **Trusted Signing Certificate Profile Signer** on the account/profile.
3. **Build agent tooling**
   - [ ] Install Microsoft Trusted Signing client tools / Action that invokes `Invoke-TrustedSigning` (or current Microsoft-recommended electron-builder integration).
   - [ ] Confirm `signtool` can reach the regional endpoint from the runner.
4. **CI secrets** (names are suggestions — not required by default workflow)
   - [ ] `AZURE_TENANT_ID`
   - [ ] `AZURE_CLIENT_ID`
   - [ ] `AZURE_CLIENT_SECRET` (only if not using OIDC)
   - [ ] `AZURE_TRUSTED_SIGNING_ENDPOINT`
   - [ ] `AZURE_TRUSTED_SIGNING_ACCOUNT`
   - [ ] `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE`
5. **Workflow policy**
   - [ ] Signed job is opt-in (`package_signed` or a dedicated workflow).
   - [ ] Missing secrets → **skip or soft-fail**, never break PR/ship-gate.
   - [ ] Artifacts from signed vs unsigned jobs are clearly named.

### Suggested secret names (comment-only until wired)

| Secret | Notes |
|--------|--------|
| `AZURE_TENANT_ID` | Entra tenant |
| `AZURE_CLIENT_ID` | App registration (prefer federated OIDC over client secret) |
| `AZURE_CLIENT_SECRET` | Only if not using OIDC |
| `AZURE_TRUSTED_SIGNING_ENDPOINT` | Regional endpoint URL |
| `AZURE_TRUSTED_SIGNING_ACCOUNT` | Account name |
| `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE` | Certificate profile name |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Alternative classic PFX path |

Ship-gate **must not** fail when these secrets are absent.

---

## Auto-update path (electron-updater)

Scaffold lives in `electron/auto-update.ts` and Settings → **Hakkında** → **Otomatik güncelleme**.

### Feed resolution order

1. **`QUAKE_UPDATE_FEED_URL`** — process env (highest priority)
2. **User prefs** — `%APPDATA%\Quake Code\auto-update.json` → `updateFeedUrl` (Settings → Feed kaydet)
3. **Embedded** — packaged `resources/app-update.yml` when `publish` was set in `electron-builder.yml` at build time

If none are present, the app boots normally and the toggle stays disabled until a feed is set.

### When checks run

A check runs only if **both**:

1. **Feed configured** (any of the three sources above)
2. **Enabled**
   - `QUAKE_AUTO_UPDATE=1` (or `true` / `yes` / `on`), or
   - User toggle in Settings (stored under the same `auto-update.json` as `enabled`)

### How to set `QUAKE_UPDATE_FEED_URL`

**Option A — environment (session / shortcut)**

```powershell
# Current PowerShell session
$env:QUAKE_UPDATE_FEED_URL = "https://releases.example.com/quake-desktop"
$env:QUAKE_AUTO_UPDATE = "1"
# Then launch the desktop app from this shell
npm run desktop:dev
# or start the installed QuakeCode.exe
```

**Option B — Settings UI (no env required)**

1. Open **Ayarlar → Hakkında → Otomatik güncelleme**
2. Paste the generic feed base URL (HTTPS recommended)
3. Click **Feed kaydet** (stored in userData prefs)
4. Enable the **Otomatik güncelleme** toggle (now active because feed is set)
5. Optional: **Kontrol et** to query the feed without downloading

Clear the URL field and click **Feed kaydet** again to remove the prefs feed.

**Option C — package-time publish config**

Uncomment a `publish:` block in `electron-builder.yml` so `app-update.yml` is embedded. See below.

### Host layout (generic provider)

Serve at least:

```text
https://releases.example.com/quake-desktop/latest.yml
https://releases.example.com/quake-desktop/Quake-Code-Setup-<version>-x64.exe
https://releases.example.com/quake-desktop/Quake-Code-Setup-<version>-x64.exe.blockmap
```

`QUAKE_UPDATE_FEED_URL` / Settings feed should be the **directory** URL (`…/quake-desktop`), not the path to `latest.yml`.

### Configure publish (optional)

See commented blocks in `electron-builder.yml`:

- **generic** — static HTTPS host serving `latest.yml` + installers  
- **github** — GitHub Releases (`GH_TOKEN` for private / upload; optional, never required for ship-gate)

```powershell
# Package and publish (only when publish + credentials are real)
$env:GH_TOKEN = "<pat>"   # github provider only
npx electron-builder --config electron-builder.yml --win nsis --x64 --publish always
```

### Runtime env summary

| Env | Effect |
|-----|--------|
| `QUAKE_UPDATE_FEED_URL` | Generic feed base URL; wins over Settings prefs |
| `QUAKE_AUTO_UPDATE=1` | Force enable checks when feed exists |
| `CSC_IDENTITY_AUTO_DISCOVERY=false` | Unsigned package (CI) |

Download-on-check is **off** in the scaffold (`autoDownload: false`). Wire UX + signing before enabling silent install.

---

## CI notes (`desktop-windows.yml`)

| Input | Default | Effect |
|-------|---------|--------|
| `package` | `true` | Unsigned NSIS + artifacts (`CSC_IDENTITY_AUTO_DISCOVERY=false`) |
| `package_signed` | `false` | Opt-in signed package step; uses `CSC_LINK` / `CSC_KEY_PASSWORD` **if** present; **skips cleanly** when secrets are empty |
| `run_e2e` | `false` | `SHIP_GATE_E2E=1` inside ship-gate |

PR/push never require signing or publish secrets.

---

## Ship-gate note

`npm run ship-gate` validates typecheck, tests, optional smoke — **not** signing or publish.

Residual checklist after a green gate:

1. `npm run audit:prod`
2. `npm run desktop:package:win` (unsigned OK)
3. Code signing (this doc) when releasing publicly
4. Auto-update feed via Settings **Feed kaydet** and/or `QUAKE_UPDATE_FEED_URL` + optional enable / `QUAKE_AUTO_UPDATE`

Do not block merge or ship-gate on `CSC_*` or Azure Trusted Signing secrets.

---

## Verification checklist

- [ ] App starts with no feed and no `QUAKE_AUTO_UPDATE` (dev + packaged unsigned)
- [ ] Settings shows **Otomatik güncelleme** disabled when feed missing
- [ ] Settings: paste feed → **Feed kaydet** → toggle becomes enabled; masked feed shown
- [ ] Empty feed + **Feed kaydet** clears prefs; app still boots
- [ ] With `QUAKE_UPDATE_FEED_URL` + `QUAKE_AUTO_UPDATE=1`, check logs `[auto-update]` without crashing if host is unreachable
- [ ] Env feed takes priority over Settings prefs (input disabled with note)
- [ ] CI package job still sets `CSC_IDENTITY_AUTO_DISCOVERY=false`
- [ ] CI `package_signed=true` without secrets exits 0 (skip), does not fail the workflow
- [ ] Signed release path documents secrets but stays separate from ship-gate
