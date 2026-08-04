# Architecture

Quake Code Desktop is a local-first Electron application built from a React renderer, an Electron desktop host, and a local Node.js agent server. The local server owns agent runtime state and tool execution; the renderer presents that state and sends explicit user actions.

## Component map

```text
┌──────────────────────── Electron application ────────────────────────┐
│                                                                      │
│  React + Vite renderer                  Electron main process         │
│  apps/quake-desktop/src/client          apps/quake-desktop/electron  │
│  ├─ conversation timeline               ├─ window and application    │
│  ├─ Monaco file views                   ├─ native menus/notifications│
│  ├─ terminal and browser panels         ├─ browser bridge            │
│  ├─ settings and approvals              └─ desktop integration       │
│  └─ subagent/scheduled-work UI                        │              │
│                  │ local HTTP + event stream          │ IPC/bridges  │
│                  ▼                                    │              │
│  Local agent server                                   │              │
│  apps/quake-desktop/src/server ◄──────────────────────┘              │
│  ├─ sessions and runtime state                                       │
│  ├─ workspace/file boundaries                                       │
│  ├─ provider and model integration                                   │
│  ├─ tool execution and approvals                                     │
│  └─ MCP and event delivery                                           │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ configured provider requests
                               ▼
                        Model providers / APIs
```

Shared request and event contracts live under `apps/quake-desktop/src/shared`. Reusable agent/runtime packages are maintained in the root `packages/` workspaces.

## Runtime flow

1. The Electron host starts the local server and renderer.
2. The user opens a workspace and starts or resumes an agent session.
3. The renderer submits an action to the local server.
4. The server calls the configured model provider and streams normalized events back to the renderer.
5. Tool requests pass through the runtime's permission and workspace controls before execution.
6. Results return to the model and remain visible in the activity timeline.

## Trust boundaries

### Renderer

The renderer should be treated as a presentation layer. Provider credentials must not be embedded in client bundles or sent to browser-only code.

### Local server

The server owns provider configuration, sessions, tool execution, workspace validation, and the event stream. It binds locally by default. Changes to server routes or tool handling must preserve authentication and path checks.

### Electron host

Native window, notification, embedded-browser, and Windows desktop capabilities cross a higher-trust boundary. Preload/IPC surfaces should expose the narrowest operation required and validate untrusted input.

### External providers

“Local-first” describes orchestration and state ownership; prompts and selected context leave the machine when sent to a configured remote model provider. Provider terms and data controls still apply.

## Repository layout

| Path | Purpose |
|---|---|
| `apps/quake-desktop/src/client` | React renderer and product UI |
| `apps/quake-desktop/src/server` | Local server, agent runtime bridge, tools, and APIs |
| `apps/quake-desktop/src/shared` | Cross-process contracts and shared types |
| `apps/quake-desktop/electron` | Electron main process, preload, browser, and desktop integration |
| `apps/quake-desktop/test` | Unit, integration, and end-to-end coverage |
| `packages/` | Shared AI, agent, coding-agent, clipboard, and terminal packages |
| `scripts/` | Repository-level verification utilities |

## Build and release

The monorepo uses npm workspaces. Production packaging builds shared runtime packages, the server and Vite renderer, and the Electron main process before creating an NSIS x64 installer. Tag pushes matching `v*` run the Windows release workflow and attach the installer plus SHA-256 checksum to GitHub Releases.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for verification commands and [SECURITY.md](../SECURITY.md) for private vulnerability reporting.
