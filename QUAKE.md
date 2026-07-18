# QUAKE.md — Quake Code Project Instructions

This file provides persistent context for Quake Code. Edit it to document project conventions, architecture, and workflows.

## Project

- **Name:** Quake Code
- **Version:** 1.0.8
- **Type:** Terminal-first coding assistant (CLI + TUI + Web + Mobile)

## Build Commands

- `npm run build` — Build all packages
- `npm run dev` — Start development mode (all packages)
- `npm run check` — Lint and type check

## Coding Standards

- TypeScript with strict mode
- Use `import type` for type-only imports
- Use `node:fs`, `node:path` etc. for Node builtins
- Prefer async/await over callbacks
- 2-space indentation
- Descriptive variable names (no one-letter names)

## Architecture

- Monorepo with npm workspaces
- `packages/coding-agent` — Main CLI entry point
- `packages/ai` — AI provider abstraction
- `packages/agent` — Agent core
- `packages/tui` — Terminal UI components
- `apps/quake-desktop` — Web + Electron IDE (`@mrquake/quake-desktop`)
- `apps/quake-mobile` — React Native mobile app

## Memory Mode

Quake Code includes a persistent memory system:
- **QUAKE.md** — Human-written instructions (this file)
- **Auto Memory** — Files in `.quake-code/agent-memory/` — Agent writes learnings automatically
- **Rules** — Path-scoped rules in `.quake-code/rules/`
- **@import** — Use @path/to/file.md to import files into this document
