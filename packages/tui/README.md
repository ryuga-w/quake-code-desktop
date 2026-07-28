# @mrquake/quakecode-tui

Quake Code TUI is the terminal UI toolkit used by Quake Code.

It powers:
- input components
- overlays
- selectors
- markdown rendering
- terminal rendering primitives
- SGR mouse protocol parsing and spatial hit-testing

## Mouse support

Interactive apps should use **Windows Terminal** (or WezTerm / Ghostty) for reliable SGR mouse reporting (`1000` click, `1002` drag, `1006` encoding). Opt-in hover uses `1003` with throttling.

```typescript
import { parseSgrMouse, SpatialIndex, isMouseTarget, enableMouseModes } from "@mrquake/quakecode-tui";
```

Implement `MouseTarget.collectMouseRegions()` on clickable components and rebuild a `SpatialIndex` during each render pass — not on every click.

## Install

```bash
npm install @mrquake/quakecode-tui
```
