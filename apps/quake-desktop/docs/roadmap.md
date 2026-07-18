# Quake Code Web Roadmap

## MVP status

MVP is established as a local web shell for the core TUI chat loop:

- runtime-backed chat
- SSE event stream
- prompt/abort/follow-up
- session new/resume/switch
- model/thinking/status
- extension UI bridge basics
- collapsible tool cards and basic diff rendering
- checklist panel
- file explorer preview
- terminal panel with safe policy
- local token auth
- smoke script
- concurrent multi-root registry with persistent native folder selection and root-scoped runtime services

## Next implementation package

1. Server-side web settings persistence.
2. Better error/toast UX.
3. Structured plan/checklist state events instead of parsing widget text.
4. Session tree/fork UI.
5. SettingsManager-backed settings UI.
6. Rich tool renderers for read/bash/edit/write.
7. WebSocket only if SSE/HTTP becomes a real blocker.

## Phase 2

- React + Vite decision point.
- Monaco editor and Monaco diff are available as read-only CDN-backed viewers in V1; Phase 2 should replace this with bundled Monaco and safe write flows.
- Metadata-driven command palette with argument forms.
- Streaming/cancellable terminal.
- Multi-session registry with per-session locks.
- Full extension web UI bridge.

## Phase 3

- Remote mode with real auth provider.
- E2E browser suite.
- Plugin web panels.
- Share/export/import flows.
