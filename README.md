<p align="center">
  <img src="apps/quake-desktop/resources/quake-code-q.png" width="116" alt="Quake Code logo" />
</p>

<h1 align="center">Quake Code Desktop</h1>

<p align="center">
  <strong>A local-first command center for coding agents.</strong><br />
  Keep agents, code, terminal, browser, files, models, and recurring work in one focused Windows workspace.
</p>

<p align="center">
  <a href="https://github.com/ryuga-w/quake-code-desktop/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/ryuga-w/quake-code-desktop?display_name=tag&sort=semver" /></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/ryuga-w/quake-code-desktop" /></a>
  <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows11&logoColor=white" />
  <img alt="Node.js 22 or newer" src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white" />
</p>

<p align="center">
  <a href="#get-quake-code">Get Quake Code</a> ·
  <a href="#why-quake-code">Why Quake Code</a> ·
  <a href="#develop-locally">Develop</a> ·
  <a href="docs/ROADMAP.md">Roadmap</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

![Quake Code workspace with an agent composer, Monaco code view, and project tree](docs/media/desktop-files-en.png)

<p align="center"><sub>Real packaged Windows application — not a mockup.</sub></p>

## Why Quake Code

Coding agents are most useful when their context and actions stay visible. Quake Code brings the full working loop into one desktop surface: describe the outcome, follow the agent, inspect the code, approve tools, use the terminal or browser, and continue without rebuilding context across separate apps.

| | |
|---|---|
| **One working surface** | Chat, project files, Monaco views, terminal sessions, and an embedded browser stay alongside the agent timeline. |
| **Local-first control** | Workspaces, sessions, and settings live on your machine. Requests still go to the model providers you configure. |
| **Explicit permissions** | Choose the approval mode that fits the project and review sensitive file, command, browser, desktop, and MCP actions. |
| **Work beyond one chat** | Coordinate subagents and define scheduled work while keeping their activity connected to the project. |

## What is inside

- Agent conversations with a unified activity timeline
- Workspace-aware file navigation and Monaco-powered source views
- Integrated terminal, browser, and Windows desktop tooling
- Model, provider, reasoning-depth, permission, locale, and appearance controls
- MCP server and tool integration
- Subagent workspaces and scheduled tasks
- Turkish and English interfaces
- Reproducible Windows installer and checksum release pipeline

<table>
  <tr>
    <td width="50%"><img src="docs/media/desktop-home-en.png" alt="Quake Code home screen" /></td>
    <td width="50%"><img src="docs/media/desktop-models-en.png" alt="Quake Code model settings" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Start with the project and permission mode in view.</sub></td>
    <td align="center"><sub>Select the provider, model, and reasoning level for the task.</sub></td>
  </tr>
</table>

## Get Quake Code

Quake Code Desktop is currently a Windows-first `0.1.x` project.

1. Open the [latest release](https://github.com/ryuga-w/quake-code-desktop/releases/latest).
2. Download `Quake-Code-Setup-<version>-x64.exe` and `SHA256SUMS.txt`.
3. Verify the checksum, run the installer, and follow the first-run setup.

Release builds are currently unsigned, so Windows SmartScreen may display an unknown-publisher warning. Verify the checksum before running an installer and read the [Windows installation guide](apps/quake-desktop/docs/windows-install.md). If a release is not available yet, use the development workflow below.

## Develop locally

### Requirements

- Windows 10 or 11 (x64) for the Electron desktop host and installer
- Node.js 22+
- npm 10+

```powershell
git clone https://github.com/ryuga-w/quake-code-desktop.git
cd quake-code-desktop
npm ci
npm run desktop:dev
```

The development command starts the local agent server, Vite renderer, and Electron host together.

### Verify a change

```powershell
npm run verify:public-source
npm run typecheck
npm test
```

Build a local unsigned Windows installer with:

```powershell
npm run desktop:package:win
```

Artifacts are written to `apps/quake-desktop/release/`. Signing and update-feed setup are documented in the [Windows signing guide](apps/quake-desktop/docs/windows-signing.md).

## Trust model

Quake Code can read and modify files, run commands, control its embedded browser, and—when enabled—interact with the Windows desktop. Treat agent access like developer access:

- start with the narrowest permission mode that can complete the task;
- review commands and diffs before approving sensitive changes;
- never commit API keys, provider sessions, `.env.local`, or local `.quake-code/` data;
- use disposable branches or worktrees for risky or highly autonomous work.

For vulnerabilities, follow the private process in [SECURITY.md](SECURITY.md). For usage questions, see [SUPPORT.md](SUPPORT.md).

## Architecture at a glance

```text
Electron desktop host
        │
        ├── React + Vite renderer ── Monaco / terminal / browser / settings
        │
        └── Local agent server ───── sessions / tools / models / MCP / events
                         │
                         └────────── configured model providers
```

The renderer does not hold provider secrets or own tool execution. The local server owns runtime state and enforces workspace and tool boundaries. See [Architecture](docs/ARCHITECTURE.md) for the component map and trust boundaries.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Windows installation](apps/quake-desktop/docs/windows-install.md)
- [Localization](apps/quake-desktop/docs/localization.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)
- [Security policy](SECURITY.md)

## Project status

Quake Code is an early-stage, Windows-first project. Interfaces, configuration, and release packaging may change between `0.1.x` versions. macOS and Linux packages are not currently provided. Follow the [roadmap](docs/ROADMAP.md) for direction rather than treating exploratory items as commitments.

## License and attribution

Quake Code Desktop is available under the [MIT License](LICENSE). Upstream notices and licenses are retained in [NOTICE](NOTICE) and [LICENSES](LICENSES/).

---

<p align="center">
  If Quake Code helps your workflow, consider starring the repository and sharing a focused issue or pull request.
</p>
