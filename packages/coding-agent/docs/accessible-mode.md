# Accessible Mode (Future)

Quake Code interactive mode is a full-screen TUI. Mouse affordances mirror keyboard paths, but screen-reader and high-contrast users may need a non-TUI fallback.

## Reference pattern: Charm `huh` + `WithAccessible`

The [Charm `huh`](https://github.com/charmbracelet/huh) form library (Go / Bubble Tea) ships a first-class accessible mode:

```go
accessibleMode := os.Getenv("ACCESSIBLE") != ""
form.WithAccessible(accessibleMode)
```

When enabled, `huh` **drops the fullscreen TUI** and uses sequential stdin/stdout prompts instead. Screen readers get plain questions and answers without box-drawing, colors, or mouse hit regions.

Key design choices from `huh`:

| Principle | Application to Quake Code |
|-----------|---------------------------|
| Opt-in via env or setting | `QUAKE_CODE_ACCESSIBLE=1` or Settings toggle |
| Same data model, different renderer | Reuse `AgentSession`; swap `InteractiveMode` UI for prompt loop |
| Keyboard-only paths already exist | Slash commands, settings, model picker have keyboard equivalents |
| No mouse required | Accessible mode must not depend on SGR / OSC 22 |

## Proposed Quake Code architecture

```
InteractiveMode
├── TUI path (default)     → current implementation
└── Accessible path        → new AccessibleSessionLoop
         ├── readline-style prompts for chat input
         ├── numbered menus for selectors (/model, /settings, welcome board)
         └── plain-text status lines (no ANSI layout)
```

### Phase 1 (minimal viable)

- Env flag `QUAKE_CODE_ACCESSIBLE=1` exits early to **print mode** or a thin readline wrapper around `AgentSession.prompt()`.
- Document keyboard equivalents in [keyboard-shortcuts.md](keyboard-shortcuts.md).

### Phase 2 (selector parity)

- Replace modal overlays (`showModalOverlay`) with numbered option lists on stdout.
- Settings: export current `SettingsSelector` items as a text menu.

### Phase 3 (screen reader polish)

- Suppress ANSI color when accessible.
- Announce tool results as plain text blocks.
- Optional speech-friendly timestamps and message headers.

## Current status

Accessible mode is **not implemented**. Track as future work. For now:

- Use keyboard paths documented in [keyboard-shortcuts.md](keyboard-shortcuts.md).
- Prefer Windows Terminal or a dedicated terminal with good screen-reader support.
- Enable `showHardwareCursor` in Settings if IME candidate window placement is wrong.

## Related

- [qa.md](qa.md) — manual terminal matrix
- [terminal-setup.md](terminal-setup.md) — host recommendations