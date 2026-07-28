# Plan Mode Extension

Read-only exploration mode for safe code analysis.

## Features

- **Read-only tools**: Restricts available tools to `read`, `bash`, `grep`, `find`, `ls`, `questionnaire`
- **Bash allowlist**: Only read-only bash commands are allowed
- **Plan extraction**: Extracts numbered steps from `Plan:` or `Implementation Plan:` sections
- **Ready/execution UI**: Status bar shows `planning`, `ready`, and execution progress states
- **Tool restore**: Restores the user's previous active tools when execution starts or plan mode exits
- **[DONE:n] markers**: Explicit step completion tracking during execution
- **Session persistence**: State survives session resume

## Commands

- `/plan` - Toggle plan mode
- `/todos` - Show current plan progress
- `Ctrl+Alt+P` - Toggle plan mode (shortcut)

## Usage

1. Enable plan mode with `/plan` or `--plan` flag
2. Ask the agent to analyze code and create a plan
3. The agent should output a numbered plan under a `Plan:` header:

```
Plan:
1. First step description
2. Second step description
3. Third step description
```

4. Review the extracted plan in the widget / prompt UI
5. Choose "Execute now with progress tracking", "Refine the plan before execution", or stay in plan mode
6. During execution, the agent marks steps complete with `[DONE:n]` tags
7. Progress widget shows completion status and completed steps

## How It Works

### Plan Mode (Read-Only)
- Only read-only tools available
- Bash commands filtered through allowlist
- Agent creates a plan without making changes
- If the repo exposes a safe verification command, the agent may run the smallest relevant check first (for example `npm run typecheck` or `tsc --noEmit`)
- Status shows `planning` until a valid plan is extracted, then `ready (n)`

### Execution Mode
- The previously active tool set is restored
- Agent executes steps in order
- `[DONE:n]` markers track completion
- Widget shows progress with completed steps struck through

### Command Allowlist

Safe commands (allowed):
- File inspection: `cat`, `head`, `tail`, `less`, `more`
- Search: `grep`, `find`, `rg`, `fd`
- Directory: `ls`, `pwd`, `tree`
- Git read: `git status`, `git log`, `git diff`, `git branch`
- Package info: `npm list`, `npm outdated`, `yarn info`
- Safe verification: `npm run typecheck`, `npm run check`, `npm run lint`, `npm run test -- ...`, `yarn typecheck`, `pnpm check`, `tsc --noEmit`
- System info: `uname`, `whoami`, `date`, `uptime`

Blocked commands:
- File modification: `rm`, `mv`, `cp`, `mkdir`, `touch`
- Git write: `git add`, `git commit`, `git push`
- Package install: `npm install`, `yarn add`, `pip install`
- System: `sudo`, `kill`, `reboot`
- Editors: `vim`, `nano`, `code`

## Notes

- Plan mode now preserves the user's active tool selection and restores it when leaving planning mode.
- The widget uses shortened step labels for readability, while `/todos` and the ready summary show fuller step text when available.
- Plan extraction is still format-based; best results come from a numbered list under `Plan:`.
