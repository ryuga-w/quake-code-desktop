# Keyboard and Mouse Shortcuts (Interactive TUI)

## Terminal recommendation

Windows Terminal is the recommended host for full mouse support (SGR click, drag, wheel).

The VS Code integrated terminal has known limitations with mouse-heavy TUIs: Shift-select and copy/paste may fail when all-motion tracking (`1003`) is enabled.

## Mouse

| Action | Mouse | Keyboard equivalent |
|--------|-------|---------------------|
| Expand/collapse latest tool output | Click `◇` compact tool line | `Ctrl+O` |
| Welcome: new session | Click menu row | `Ctrl+W` |
| Welcome: resume session | Click menu row | `Ctrl+S` |
| Welcome: changelog | Click menu row | `Ctrl+D` |
| Welcome: quit | Click menu row | `Ctrl+Q` |
| Scroll chat history | Wheel up/down over chat area | — |
| Scroll autocomplete list | Wheel over `/` dropdown | `↑` / `↓` |
| Select autocomplete item | Click row in dropdown | `Enter` |
| Close modal overlay | Click `×` (top-right) | `Esc` |
| Select overlay list item | Click row in modal list | `↑` / `↓` + `Enter` |
| Scroll overlay list | Wheel over modal list | `↑` / `↓` |
| Native text selection | Shift+click drag (terminal bypass) | — |

Hovering a compact tool line underlines it (requires motion tracking while hovered). Hovering welcome menu rows or overlay list rows shows a pointer cursor where the terminal supports OSC 22. Wheel over the input editor does not scroll chat.

## Notes

- Mouse hit-testing uses a render-time spatial index; clicks do not trigger extra layout renders.
- Hold Shift while clicking to bypass mouse capture and use the terminal's native selection (WezTerm, Windows Terminal, Ghostty).
- Automated checks: `npm run mouse:smoke`, `npm run mouse:osc22-probe` (coding-agent package).
- Manual QA checklist: [qa.md](qa.md).