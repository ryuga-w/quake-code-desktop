# Quake Code

Quake Code is a terminal-first coding assistant for reading files, editing code, running shell commands, managing sessions, and working across multiple model providers from one CLI.

## Terminal recommendation

Use **Windows Terminal** for the best interactive experience (mouse click/drag/wheel, Shift+native selection bypass). The VS Code integrated terminal has known limitations for mouse-heavy TUIs (selection and copy/paste under motion tracking). See [docs/keyboard-shortcuts.md](docs/keyboard-shortcuts.md) and [docs/terminal-setup.md](docs/terminal-setup.md).

## Why Quake Code

- Built for terminal-native coding workflows
- Fast interactive UI with sessions, resume, and export
- Built-in file and shell tools for real repo work
- Supports themes, extensions, prompts, and skills
- Uses its own config directory: `~/.quake-code/agent`

## Install

```bash
npm install -g @mrquake/quakecode-cli
```

Start it with either command:

```bash
quake
```

or:

```bash
quake-code
```

## Update

```bash
quake update
```

## OpenRouter: use any model you want

Set your OpenRouter API key:

```bash
export OPENROUTER_API_KEY=...
```

PowerShell:

```powershell
$env:OPENROUTER_API_KEY="..."
```

Then launch Quake Code with any OpenRouter model ID:

```bash
quake --provider openrouter --model qwen/qwen3.6-plus:free
```

Other examples:

```bash
quake --provider openrouter --model qwen/qwen3-coder:free
quake --provider openrouter --model anthropic/claude-sonnet-4
quake --provider openrouter --model openai/gpt-4o
```

If a model exists on OpenRouter but is not yet bundled in Quake's known model list, Quake can still fall back to that custom model ID.

## First Run

Inside Quake Code, common starting commands are:

- `/login` — authenticate with a provider
- `/model` — choose a model
- `/settings` — open settings
- `/resume` — resume a previous session
- `/plan` — toggle built-in read-only planning mode
- `/init` — generate an `AGENTS.md` template for the current project

## Core Features

- Interactive terminal UI
- Session save, resume, fork, compact, and export
- Built-in file tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`; default text inspection uses Codex-style shell commands, while `read` remains available for images and precise paging
- Bundled browser automation tools and bundled `web_search`
- Bundled Quake skills and subagents
- Codex-compatible planning: `/plan` or `Shift+Tab`, `request_user_input`, streamed `<proposed_plan>` items, and Default-mode `update_plan` checklists
- Skills, prompts, themes, and extensions
- Project instructions via `AGENTS.md`
- Multiple providers and model switching

## Quick Examples

```bash
quake
quake "Review the current project"
quake -p "Summarize this repository"
quake --tools read,grep,find,ls -p "Review this codebase"
```

## Codex-Compatible Subagents

Quake Code defaults to Codex's stable V1 lifecycle:

- `spawn_agent`
- `send_input`
- `wait_agent`
- `close_agent`
- `resume_agent`

Completed agents remain open and count toward the six-thread default until `close_agent` is called. Child rollouts are persisted under `~/.quake-code/agent/subagents/` so closed agents can be resumed.

Optional compatibility flags:

- `QUAKE_CODE_MULTI_AGENT_VERSION=v2` — enable the task-path V2 surface.
- `QUAKE_CODE_AGENT_MAX_THREADS=<n>` — override the V1 open-thread limit.
- `QUAKE_CODE_AGENT_MAX_DEPTH=<n>` — override the V1 spawn depth.
- `QUAKE_CODE_LEGACY_SUBAGENT_TOOLS=1` — re-enable legacy `Agent`, `get_subagent_result`, and `steer_subagent`.
- `QUAKE_CODE_SPAWN_CSV=1` — expose CSV agent-job tools.

## Config Paths

Quake Code uses its own runtime state and configuration paths:

- Config root: `~/.quake-code/agent`
- Settings: `~/.quake-code/agent/settings.json`
- Auth: `~/.quake-code/agent/auth.json`
- Sessions: `~/.quake-code/agent/sessions`
- Extensions: `~/.quake-code/agent/extensions`
- Skills: `~/.quake-code/agent/skills`
- Prompts: `~/.quake-code/agent/prompts`
- Themes: `~/.quake-code/agent/themes`

## Environment Variables

- `QUAKE_CODE_CODING_AGENT_DIR`
- `QUAKE_CODE_PACKAGE_DIR`
- `QUAKE_CODE_OFFLINE`
- `QUAKE_CODE_SHARE_VIEWER_URL`
- `QUAKE_CODE_AI_ANTIGRAVITY_VERSION`

Provider-specific environment variables still apply, for example:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- `AWS_PROFILE`

## Packaging Notes

For local package testing:

```bash
bun run build
npm pack
npm install -g ./mrquake-quakecode-cli-0.64.23.tgz
quake --help
```

## License

MIT
