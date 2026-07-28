# Windows Setup

Pi requires a bash shell on Windows. Checked locations (in order):

1. Custom path from `~/.quake-code/agent/settings.json`
2. Git Bash (`C:\Program Files\Git\bin\bash.exe`)
3. `bash.exe` on PATH (Cygwin, MSYS2, WSL)

For most users, [Git for Windows](https://git-scm.com/download/win) is sufficient.

## Cooperative agent HTTP proxy (T2.P2 / S-NET.2)

Optional **cooperative** loopback proxy for agent bash children.

| Env / API | Default | Meaning |
|-----------|---------|---------|
| `QUAKE_AGENT_HTTP_PROXY` | off (CLI) | Set `1` / `true` / `on` to start a loopback HTTP proxy and inject `HTTP_PROXY` / `HTTPS_PROXY` into bash spawn env |
| `shouldAutoEnableAgentHttpProxy(preset)` | on for non-full-access | Desktop first-boot may enable when terminal policy is `safe`/`disabled` and setting was never persisted |
| Durable hosts | `~/.quake-code/agent/network-hosts.json` | Cross-session allow/deny; durable allow skips ask; durable deny hard-blocks |
| Proxy audit | in-memory ring (last N) | `getProxyAuditLog()` — CONNECT/HTTP host decisions for tests/UI |

When enabled:

- Quake listens on `127.0.0.1:<ephemeral>` and injects `HTTP_PROXY` / `HTTPS_PROXY` / lowercase variants plus `NO_PROXY=localhost,127.0.0.1,::1`.
- CONNECT and absolute-form requests consult session + durable network policy (`sessionNetworkPolicy.evaluateHost`).
- **deny** and mid-flight **ask** are rejected (fail-closed). Hosts should be allowlisted at pre-exec tool-gate (T2.P1) before the child runs.
- **Not** a transparent MITM / WFP filter: raw sockets and tools that ignore proxy env bypass it. No cert MITM.

Product track docs: `apps/quake-desktop/docs/CODEX_WINDOWS_SANDBOX.md`, `PROGRAM_TRACKS.md`.

## Experimental OS sandbox helper (MVP — not RestrictedToken)

**Not RestrictedToken / Job Object isolation.** Default remains host spawn + policy gates.

| Env | Default | Meaning |
|-----|---------|---------|
| `QUAKE_OS_SANDBOX` | off | Set `experimental` to require a probed external helper (fail-closed) |
| `QUAKE_COMMAND_RUNNER` | unset | Absolute path to MVP runner `.mjs` or future native binary |
| `QUAKE_RUNNER_STRICT_FS` | unset | `1` = heuristic deny of `..`/absolute path tokens outside `workspaceRoots` |

When `QUAKE_OS_SANDBOX=experimental`:

1. Quake resolves `QUAKE_COMMAND_RUNNER` to an existing file.
2. Probes with `{helper} --quake-sandbox-probe` (must exit 0; MVP prints capability JSON with `restrictedToken: false`).
3. Backend id `external-runner` is `available: true` only after a successful probe.
4. **Execute** uses JSON-line IPC via the helper (`isolation: "mvp-helper"`): env denylist, cwd/FS root checks, process-tree kill. **Not** RestrictedToken. No silent host fallback.

MVP runner: `scripts/quake-command-runner.mjs`  
Compat shim: `scripts/quake-command-runner-stub.mjs` (re-exports the MVP runner).

See `apps/quake-desktop/docs/CODEX_WINDOWS_SANDBOX.md` for the full honesty matrix.

## Custom Shell Path

```json
{
  "shellPath": "C:\\cygwin64\\bin\\bash.exe"
}
```
