# Codex Windows sandbox vs Quake (capability matrix)

## Summary

| Layer | Codex | Quake today |
|-------|--------|-------------|
| Policy sandbox (workspace write-root, execpolicy, guardian) | Yes | **Yes** |
| OS process isolation (restricted token / elevated ACL) | Yes (native Rust helpers) | **No** — MVP helper only (`isolation: "mvp-helper"`). **Not** RestrictedToken / Job Object API |
| Transparent network proxy | Yes (`codex-network-proxy`) | **No** (host heuristics + optional cooperative loopback `HTTP_PROXY`) |

Quake **must not** claim “Windows sandbox” or RestrictedToken isolation until a native helper ships.  
Default execution is **host `child_process.spawn` + policy gates**.  
A successful helper **probe** proves discovery (+ optional capability JSON).  
A successful helper **execute** runs the command via JSON-line IPC with **MVP hardening** (env denylist, cwd/FS root checks, process-tree kill) — still **not** RestrictedToken / elevated OS isolation.

## Codex Windows levels (vendor)

From `codex-rs` protocol / core (this checkout’s `windows-sandbox-rs` crate is **missing**):

1. **Disabled** — no OS sandbox  
2. **RestrictedToken** (“unelevated”) — restricted token backend; weaker FS deny; fail-closed if policy cannot be enforced  
3. **Elevated** — elevated ACL / machine-local sandbox users; stronger FS carveouts; UAC/setup complexity  

Spawn path uses **`CreateProcessAsUserW`** and helper binaries (`codex-command-runner`, setup tools).  
Not portable to pure TypeScript / Electron main without a native helper.

## Quake spawn map

| Surface | Path | Isolation |
|---------|------|-----------|
| Agent `bash` | `packages/coding-agent/src/core/tools/bash.ts` | Host spawn after `gateToolExecution` (or experimental `OsSandboxBackend`) |
| Generic exec | `packages/coding-agent/src/core/exec.ts` | Host spawn |
| Desktop terminal one-shot | `apps/quake-desktop/src/server/terminal.ts` | Host spawn + regex **`TerminalPolicy`** (not OS sandbox) |
| Desktop PTY | `apps/quake-desktop/src/server/terminal-pty.ts` | Host `node-pty` shell — **not** OS-sandboxed; **not** `TerminalPolicy`; **not** agent worktree–scoped (may bypass worktree isolation). S-OS.3: UI/WS `notice` honesty only. |

**Honesty (S-OS.3):** Do not claim the interactive terminal is sandboxed. One-shot `/api/terminal/run` keeps `TerminalPolicy`; raw PTY keystrokes have no discrete run channel, so policy cannot gate them without breaking interactive UX.

Policy modules:

- `core/sandbox/policy.ts` — workspace write-root  
- `core/execpolicy/policy.ts` — command prefix / heuristics  
- `core/guardian/*` — approval UI + session cache + prefix/host session rules  
- `core/network-policy/*` — **host allow/deny (session + durable `network-hosts.json`)**; tool-gate pre-exec  
- `core/network-proxy/*` — **cooperative** loopback HTTP proxy (`QUAKE_AGENT_HTTP_PROXY`; desktop may auto-enable for non-full-access); audit ring; not transparent MITM

## Feature flags

| Env | Default | Meaning |
|-----|---------|---------|
| `QUAKE_OS_SANDBOX` | `off` | Host spawn (policy only). Normal product mode. |
| `QUAKE_OS_SANDBOX=experimental` | — | Fail-closed without a **probed** helper. Does **not** silently fall back to unsandboxed host spawn. |
| `QUAKE_COMMAND_RUNNER` | unset | Absolute path to helper (`quake-command-runner.mjs` MVP or future native binary). Used only when OS sandbox is experimental. |
| `QUAKE_RUNNER_STRICT_FS` | unset | When `1`/`true`, MVP helper applies a **heuristic** deny on `..`/absolute path tokens that resolve outside `workspaceRoots`. Not a real FS sandbox. |

### Resolution matrix (S-OS.1)

| Mode | Helper path | Probe | Backend `id` | `available` | `execute` |
|------|-------------|-------|--------------|-------------|-----------|
| off | any | n/a | `host` | true | Host spawn (no OS isolation) |
| experimental | missing / not a file | n/a | `experimental-unavailable` | false | Throws (fail-closed) |
| experimental | existing file | not run (sync resolve) | `external-runner` | **false** | Throws (not probed) |
| experimental | existing file | fail / timeout | `external-runner` | **false** | Throws (fail-closed) |
| experimental | existing file | exit 0 | `external-runner` | **true** | **JSON-line IPC execute** via MVP helper (not RestrictedToken) |

Probe contract:

```text
{QUAKE_COMMAND_RUNNER} --quake-sandbox-probe
→ exit 0 within ~3s
→ optional stdout JSON (MVP runner prints this):
  {
    "ok": true,
    "isolation": "mvp-helper",
    "capabilities": {
      "restrictedToken": false,
      "jobObject": false,
      "fsRoots": true
    }
  }
```

Execute protocol (S-OS.1 MVP helper — final JSON result; live streaming optional later):

```text
Parent spawns helper with stdin/stdout pipes.
stdin  → one JSON line:
  { "command", "args"?: string[], "cwd"?: string, "env"?: object,
    "timeoutMs"?: number, "workspaceRoots"?: string[] }
stdout → one JSON line:
  { "ok", "exitCode", "stdout", "stderr", "signal"?, "error"?, "timedOut"?,
    "isolation": "mvp-helper" }
```

### MVP helper hardening (what exists today)

| Control | Behavior | Not the same as… |
|---------|----------|------------------|
| Empty command reject | `command` must be non-empty trimmed string | — |
| Env denylist | Strips `LD_PRELOAD`, `NODE_OPTIONS`, `DYLD_*`, `PYTHONSTARTUP`, etc. from child env | Full env capability drop / restricted token |
| cwd roots | `workspaceRoots` → refuse cwd outside roots (`cwd_outside_roots`) | Win32 ACL deny |
| Strict FS heuristic | `QUAKE_RUNNER_STRICT_FS=1` → refuse `..`/absolute path tokens resolving outside roots (`path_escape_outside_roots`) | Real FS sandbox / AppContainer |
| Process-tree kill | Windows `taskkill /F /T`; Unix process-group SIGKILL on timeout | Job Object assignment (`jobObject: false`) |
| `isolation` field | Always `"mvp-helper"` on helper responses for observability | RestrictedToken / Elevated |

- Implemented by `ExternalRunnerOsSandboxBackend.execute` + `probeOsSandboxHelper` / `probeOsSandboxHelperDetailed` in `packages/coding-agent/src/core/sandbox/os-backend.ts`.
- `.js` / `.mjs` / `.cjs` helpers are spawned via `process.execPath` (Node MVP runner support).
- Native helpers are spawned as argv0 (no probe arg on execute; request on stdin).
- **Probe/execute success ≠ RestrictedToken isolation.** Product copy must not claim Windows OS sandbox until a signed native runner implements RestrictedToken (or equivalent). Capability JSON is intentionally honest: `restrictedToken: false`, `jobObject: false`.

Code:

- `OsSandboxBackend`, `HostSpawnBackend`, `ExperimentalOsSandboxBackend`, `ExternalRunnerOsSandboxBackend`
- `probeOsSandboxHelper`, `probeOsSandboxHelperDetailed`, `resolveOsSandboxHelperPath`, `resolveOsSandboxBackend` (sync), `resolveOsSandboxBackendAsync` / `ensureOsSandboxBackend` (probe)
- Bash local ops use `ensureOsSandboxBackend()` so experimental mode probes once before execute
- MVP runner: `packages/coding-agent/scripts/quake-command-runner.mjs`
- Compat shim: `packages/coding-agent/scripts/quake-command-runner-stub.mjs` (re-exports the MVP runner; keep existing `QUAKE_COMMAND_RUNNER` paths working)

## Packaging hooks (desktop / CLI) — S-OS.1 documentation

No full RestrictedToken binary in this track. The Node **MVP helper** is suitable for protocol/CI only.

1. **Ship later** a signed native `quake-command-runner(.exe)` next to the app or under a known `resources/` path (RestrictedToken / Job Object — not started).  
2. **Set** `QUAKE_COMMAND_RUNNER` to that absolute path for agent child processes (Electron main / CLI launcher env).  
3. **Optional product flag** later: map Settings → `QUAKE_OS_SANDBOX=experimental` only when probe succeeds; keep default **off**.  
4. **Fail-closed**: if user/enterprise policy requires OS sandbox and probe/execute fails, refuse agent shell — do not host-spawn silently.  
5. **Do not** advertise “Windows Sandbox” / RestrictedToken OS isolation in NSIS/UI while only `isolation: "mvp-helper"` is available.  
6. **CI / local**: point `QUAKE_COMMAND_RUNNER` at `quake-command-runner.mjs` (or the `-stub.mjs` shim) to exercise probe + execute MVP + capability JSON.

Installer sketch (not implemented here):

```text
resources/bin/quake-command-runner.exe   # future native; not the .mjs MVP
  └── installer or app main sets process.env.QUAKE_COMMAND_RUNNER
  └── agent inherits env; ensureOsSandboxBackend() probes on first bash
```

## Product copy guidelines

- Settings “Erişim rejimi” = approval **policy** (Onay iste / Benim için onayla / Tam erişim), **not** OS isolation.  
- Do not label UI “Windows Sandbox” until a signed helper + Elevated/RestrictedToken path exists.  
- Network approval is **host heuristics** on shell commands; optional cooperative proxy (T2.P2) only covers tools that honor `HTTP_PROXY`. Raw sockets still bypass.
- “Helper detected” (probe OK) may be shown as **experimental readiness**, never as “sandboxed”.
- **Desktop PTY** (Settings → İzinler OS card + terminal banner): always disclose it is **excluded** from OS isolation and may bypass agent worktree isolation. Never market it as a sandboxed terminal.

## Phase roadmap (program tracks)

See also **`PROGRAM_TRACKS.md`** for T1–T4 status.

1. Research + hooks + flag (this doc) — **done**  
2. Route bash via `OsSandboxBackend.execute` (T1.P1) — **done**  
3. External `quake-command-runner` **probe scaffold** + packaging hooks docs (T1.P2) — **done**  
4. Helper execute protocol (JSON-line IPC) — **S-OS.1 done**  
5. Harden MVP helper (env strip, FS root/strict heuristic, isolation + capability JSON) — **done** (`mvp-helper`; still **not** RestrictedToken)  
6. RestrictedToken / Job Object **native** helper — **not started**  
7. Optional: elevated ACL setup (enterprise-grade; UAC/AV risk) — T1.P4  
8. Cooperative `HTTP_PROXY` inject for agent children — T2.P2 scaffold (**done**: loopback proxy + policy on CONNECT; flag off by default)  

## Fail-closed principle

If the product claims OS sandbox is **on**, and the backend cannot enforce it, **refuse to run** rather than run unsandboxed. Codex follows the same spirit for unsupported restricted-token policies.  
S-OS.1 follows the same spirit: probe failure, helper spawn/protocol errors, and cwd-outside-roots all refuse host fallback.
