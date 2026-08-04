# Changelog

Notable user-facing changes to Quake Code Desktop are documented here. The project follows semantic versioning while the public interfaces are still evolving through `0.x` releases.

## [Unreleased]

## [0.1.1] — 2026-08-04

### Added

- Local-first Electron workspace for coding-agent sessions on Windows.
- Integrated project files, Monaco source views, terminal, and embedded browser.
- Provider, model, reasoning-depth, permission, locale, and appearance controls.
- MCP integration, subagent workspaces, and scheduled tasks.
- Turkish and English product interfaces.
- NSIS x64 packaging with SHA-256 checksums and a tag-driven GitHub Release workflow.

### Security

- Local agent server with workspace boundaries and approval-aware tool execution.
- Public-source verification for common credential and private-artifact patterns.
- Private vulnerability reporting policy and trust-boundary documentation.

### Known limitations

- Windows 10/11 x64 is the only packaged target.
- Community installers are currently unsigned and may trigger Windows SmartScreen.
- As an early `0.1.x` release, configuration and interfaces may change.

[Unreleased]: https://github.com/ryuga-w/quake-code-desktop/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/ryuga-w/quake-code-desktop/releases/tag/v0.1.1
