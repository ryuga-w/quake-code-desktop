# Quake Code Web

Quake Code Web is the browser-facing companion to the Quake Code TUI. The goal is runtime parity: the web app uses the same `AgentSession` runtime, model registry, session files, extensions, skills, and built-in tools as the terminal UI.

## Product target

Quake Code Web should eventually provide:

- Chat with streaming assistant messages
- Full built-in tool execution (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, OS tools)
- Extension tools and extension UI requests
- Session new/resume/fork flows
- Model and thinking controls
- Tool timeline, diff viewer, file explorer, editor, terminal/log panel
- Plan/checklist widgets and web-native panels
- Local-first security with localhost binding by default

## V1 scope in this package

This package now runs as a React + TypeScript + Vite IDE shell:

- Node HTTP server
- Server-sent events for runtime event streaming
- Direct `AgentSessionRuntimeHost` integration
- Web extension UI bridge for select/confirm/input/editor/notify/status/widget basics
- React app shell for chat, streaming timeline, composer, tool stream, file tree, Monaco preview/diff, sessions, settings, and terminal
- Concurrent multi-root workspaces: one active UI root with parked chats/agents and root-scoped settings/MCP services kept alive

This is intentionally not a TUI port and not a child-process wrapper around the CLI. The backend imports the Quake runtime directly.

## Run

```bash
npm --workspace @mrquake/quakecode-web run dev
```

Dev UI runs through Vite:

```text
http://127.0.0.1:5173
```

Optional environment:

```bash
QUAKE_WEB_HOST=127.0.0.1
QUAKE_WEB_PORT=3737
QUAKE_WEB_CWD=/path/to/workspace
```

Production build/start:

```bash
npm --workspace @mrquake/quakecode-web run build
npm --workspace @mrquake/quakecode-web run start
```

Open built server:

```text
http://127.0.0.1:3737
```

## Runtime/tool parity strategy

Quake Code Web does not reimplement built-in tools. Prompt execution uses the same `AgentSession` and tool registry as the TUI, so file tools, bash tools, browser/OS tools registered in the runtime, extension tools, hooks, skills, and command resources remain owned by the existing core.

Web-specific endpoints are intentionally limited to UI conveniences:

- `/api/files` and `/api/file` for explorer/preview
- `/api/terminal/run` for a local terminal panel
- `/api/sessions` for resume UI
- `/api/models` for model selector UI

Agent-driven tool execution still flows through `AgentSession` events and renders in the web tool stream.

## Docs

- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Roadmap](docs/roadmap.md)
- [Manual QA](docs/qa.md)
- [Keyboard Shortcuts](docs/keyboard-shortcuts.md)
- [Security Audit Notes](docs/audit.md)
- [Frontend Framework Decision](docs/frontend-decision.md)
- [Core API Seams](docs/core-api-seams.md)
- [Multi-session Concurrency Plan](docs/multi-session-concurrency.md)

## Backend layout

```text
src/server/index.ts              HTTP/SSE entrypoint
src/server/runtime.ts            AgentSessionRuntimeHost bridge
src/server/web-extension-ui.ts   Extension UI bridge
src/server/files.ts              Safe file explorer/preview
src/server/terminal.ts           Local terminal panel runner
src/server/auth.ts               Local token auth
src/shared/protocol.ts           Browser/server event and command contracts
src/client/index.html            Vite HTML shell
src/client/src/main.tsx          React app shell
src/client/src/components/*      Feature components
src/client/src/state/app-store.ts Client state/event store
src/client/styles.css            Shared dark IDE styling
```

## Security model

Defaults:

- Binds to `127.0.0.1`
- Generates a per-process local token unless `QUAKE_WEB_AUTH=0`
- Requires token on `/api/*`, including SSE and terminal endpoints
- Restricts file preview to the active root in the window's validated workspace-root set
- Limits file preview size to 1MB
- Limits terminal command duration and output size

Environment:

```bash
QUAKE_WEB_HOST=127.0.0.1
QUAKE_WEB_PORT=3737
QUAKE_WEB_CWD=/path/to/workspace
QUAKE_WEB_TOKEN=optional-fixed-token
QUAKE_WEB_TOKEN_FILE=/optional/path/to/token-file
QUAKE_WEB_AUTH=0 # disables local token auth, only for trusted local experiments
QUAKE_WEB_ALLOW_REMOTE=0 # must be 1 before binding to 0.0.0.0
QUAKE_WEB_WORKSPACE_ALLOWLIST=/path/a:/path/b # use ; on Windows shells
QUAKE_WEB_TERMINAL_POLICY=safe # safe | allow-all | disabled
```

Do not bind Quake Code Web to a public interface until remote auth, workspace allowlists, CORS hardening, and stronger command policy controls are complete. By default the server refuses wildcard remote binds such as `0.0.0.0` unless `QUAKE_WEB_ALLOW_REMOTE=1` is explicitly set.

## Current risks / next hardening

- Terminal panel is powerful by design. V1 now has a `safe` command policy, but remote use still needs stricter project-specific policy and confirmation UX.
- File explorer supports read preview plus explicit save via `/api/file/write` in the Monaco editor (EditableMonaco); diff tabs remain read-only.
- Extension custom components are bridged as basic requests, not full custom component rendering yet.
- Slash command parity is partial for TUI-only commands; extension/prompt/skill commands flow through `AgentSession.prompt`.
- SSE remains the V1 event transport. Terminal output streaming now uses SSE events. WebSocket is deferred to Phase 2 when richer bidirectional interactions justify the extra protocol surface.

## Delivery phases

### MVP

MVP means Quake Code Web can be used as a local browser equivalent of the core TUI chat loop:

- Runtime-backed chat and streaming events
- Prompt/abort/follow-up
- Session new/resume/switch
- Model/thinking/status controls
- Extension UI bridge basics
- Tool stream cards with collapsible output and basic diff rendering
- Plan/checklist panel
- File explorer with preview and manual editor save (agent tools still preferred for bulk edits)
- Local terminal panel with multi-tab runs, stop/restart, history, and ask-to-fix
- Local token auth and workspace-root file safety
- Native multi-folder selection and persistent multi-root workspace switching without closing background chats or agents
- IDE-style nested file tree with hidden/generated toggles, global search, keyboard navigation, Monaco tabs, diff tabs, and file context actions
- Command palette keyboard navigation, fuzzy scoring, group headers, `>` command mode, and `@` file mode
- Tool turn grouping, changed-files panel, context chips, stronger markdown rendering, security banner, settings modal, and persistent toast/error UX

### Phase 2: full Quake Code Web IDE

- Monaco editor for file preview/editing
- Monaco diff viewer for edit/write tools
- Rich command palette with command metadata and args forms
- Full settings UI backed by SettingsManager
- Session tree/fork UI
- Extension custom component bridge beyond basic dialogs/widgets
- WebSocket bridge if terminal cancellation, extension dialogs, or multi-session interaction outgrow SSE
- Tool-specific renderers for every built-in and extension tool
- Workspace allowlist and command policy UI

### Phase 3: advanced features

- Multiple concurrent agent sessions with per-session locks
- Share/export/import flows from web
- Browser notifications and background task monitoring
- Optional remote access mode with real auth provider
- E2E browser test suite and visual regression tests
- Plugin/extension web panels

## Existing code likely touched next

Keep changes small. Prefer adding web package code first; only touch core when a stable reusable seam is missing.

Likely future core touchpoints:

```text
packages/coding-agent/src/core/agent-session.ts          command metadata/runtime APIs
packages/coding-agent/src/core/extensions/types.ts       richer web UI bridge contracts
packages/coding-agent/src/core/session-manager.ts        session tree/list metadata
packages/coding-agent/src/core/settings-manager.ts       settings read/write API for web
packages/coding-agent/src/core/tools/*                   optional structured render metadata
packages/coding-agent/src/modes/rpc/*                    protocol ideas/reference only
```

Avoid coupling web to `packages/coding-agent/src/modes/interactive/*`; web should remain runtime-native, not TUI-driven.

## Recommended implementation order

1. Keep `AgentSessionRuntimeHost` as the only execution backend.
2. Harden local auth, workspace allowlist, and command policy before any remote binding.
3. Replace SSE with or complement it by WebSocket only when bidirectional UI interactions require it.
4. Add rich tool renderers incrementally, starting with `edit`, `write`, `bash`, `read`.
5. Add Monaco editor/diff once structured file operations are stable.
6. Add complete settings UI through `SettingsManager` rather than duplicating config parsing.
7. Add E2E smoke tests before expanding to multi-session/multi-workspace mode.

## Clear recommendation

The best path is to keep Quake Code Web as a web-native shell over the same agent runtime, not a separate product and not a TUI wrapper. The runtime should remain the source of truth for tools, sessions, model selection, skills, extensions, and safety behavior. Web-specific code should focus on presentation, local auth, event bridging, and browser ergonomics.

## Validation

Current focused checks:

```bash
npm --workspace @mrquake/quakecode-web run typecheck
npm --workspace @mrquake/quakecode-web run build
npm --workspace @mrquake/quakecode-web run smoke
npm --workspace @mrquake/quakecode-web run e2e
```
