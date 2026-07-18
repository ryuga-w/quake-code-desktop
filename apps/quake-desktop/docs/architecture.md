# Quake Code Web Architecture

Quake Code Web is a React/Vite shell over the same Quake `AgentSession` runtime used by the TUI.

## Runtime rule

The browser never drives a separate agent implementation. The server owns:

- `AgentSessionRuntimeHost`
- active `AgentSession`
- extension binding
- model/session/settings/runtime state
- tool execution through the existing agent tool registry

## Server modules

```text
src/server/index.ts              HTTP/SSE entrypoint and API routing
src/server/runtime.ts            AgentSessionRuntimeHost bridge
src/server/goal/runtime.ts       Persistent Goal Runtime v2 lifecycle
src/server/goal/store.ts         Session custom-entry goal persistence
src/server/goal/state-machine.ts Validated goal state transitions
src/server/goal/types.ts         Goal domain and persistence types
src/server/web-extension-ui.ts   Extension UI bridge
src/server/files.ts              Workspace-safe file preview
src/server/terminal.ts           Terminal command runner
src/server/terminal-policy.ts    Terminal command policy
src/server/auth.ts               Local token auth
src/server/security.ts           Host/workspace security guards
src/server/locks.ts              Runtime/terminal locking helpers
src/server/sse.ts                SSE event hub
```

## Client modules

```text
src/client/index.html            Vite HTML shell
src/client/src/main.tsx          React app shell, routing state, timeline orchestration
src/client/src/state/app-store.ts Zustand app/event store
src/client/src/lib/api.ts        HTTP/SSE client helpers
src/client/src/lib/render.ts     Event normalization and compact rendering helpers
src/client/src/components/*      Feature components for composer, command palette, files, terminal, settings, sessions, markdown
src/client/styles.css            Shared dark IDE tokens, layout, composer, panels, and responsive polish
```

## Transport decision

V1 uses SSE for server-to-browser events plus HTTP POST endpoints for commands. Terminal output streaming also uses SSE. WebSocket is deferred until Phase 2 if terminal cancellation, richer extension dialogs, or multi-session interactivity require bidirectional realtime transport.
