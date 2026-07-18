# Manual QA — Interactive TUI

## Terminal matrix

| Terminal | Mouse click | Drag (1002) | Wheel scroll | Shift+select bypass | Notes |
|----------|-------------|-------------|--------------|---------------------|-------|
| Windows Terminal | Yes | Yes | Yes | Yes | Recommended |
| WezTerm | Yes | Yes | Yes | Yes | Shift bypasses capture |
| Ghostty | Yes | Yes | Yes | Yes | `mouse-shift-capture` config |
| VS Code integrated | Partial | Partial | Partial | Unreliable | See limitations below |

## Mouse smoke (automated)

After build:

```bash
npm run build
npm run mouse:smoke
```

Checks SGR parse, spatial hit-test, sidebar boundary, 500-region lookup performance, and OSC 22 sequence format.

OSC 22 pointer probe (visual, Windows Terminal):

```bash
npm run mouse:osc22-probe -- --interactive
```

Observe whether the cursor changes to hand/I-beam over the terminal. Windows Terminal may treat OSC 22 as no-op — document result in your terminal matrix notes.

## Manual checklist (Windows Terminal)

- [ ] Click `◇` tool line → expand/collapse (same as `Ctrl+O`)
- [ ] Hover tool line → underline appears; move away → clears
- [ ] Wheel up → chat scrolls up; wheel down → returns toward bottom
- [ ] Wheel over input editor → chat does **not** scroll
- [ ] `/` autocomplete open → wheel scrolls list, not chat
- [ ] Modal overlay open → wheel scrolls overlay list; `×` closes
- [ ] New message while pinned → viewport stays at bottom
- [ ] Shift+drag → native terminal selection (not captured by app)
- [ ] Welcome board menu rows clickable when hero visible
- [ ] Welcome board body text → default arrow cursor (no text I-beam over card)
- [ ] Welcome board menu row hover → pointer cursor (where terminal supports OSC 22)
- [ ] Chat input visible below welcome board; fake caret only in editor box
- [ ] Sidebar visible → clicks on sidebar column ignored for chat tools
- [ ] Resize terminal → click targets still align

## VS Code terminal — known limitations

- `terminal.integrated.rightClickBehavior` may intercept right-click before the app sees it.
- With SGR + all-motion (`1003`+`1006`), Shift/Option selection can clear on subsequent pointer motion ([vscode#194554](https://github.com/microsoft/vscode/issues/194554)).
- Textual-style apps may not support Shift-select copy while simpler programs (`htop`, `tmux`) sometimes do ([textual#2190](https://github.com/Textualize/textual/discussions/2190)).

Quake Code enables `1003` only while hovering tool lines and throttles motion to ~80ms.

## Accessibility

Mouse affordances mirror keyboard paths — see [keyboard-shortcuts.md](keyboard-shortcuts.md). Long-term accessible mode (non-TUI fallback) is not yet implemented; see [accessible-mode.md](accessible-mode.md) for the `huh` / `WithAccessible` roadmap.