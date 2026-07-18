# Quake Code Monorepo

This repository contains the Quake Code toolchain.

## Packages

- `packages/coding-agent` — Quake Code terminal CLI
- `packages/ai` — Quake Code AI/provider layer
- `packages/agent` — Quake Code agent runtime
- `packages/tui` — Quake Code terminal UI primitives
- `packages/web-ui` — Web UI components
- `packages/mom` — Auxiliary integrations
- `packages/pods` — Deployment/pod tooling

## Development

Install dependencies:

```bash
bun install
```

Build the Quake Code CLI package:

```bash
cd packages/coding-agent
bun run build
```

Run the installed CLI:

```bash
quake-code
```

## Publish target

Published package:

```bash
npm install -g @mrquake/quakecode-cli
```

## Notes

This fork is being actively reworked from the original upstream codebase into a Quake-native product. User-facing behavior, branding, package names, and local config paths should prefer Quake naming.
