/**
 * Terminal glyph capability + safe symbol set.
 *
 * Some terminals (notably the legacy Windows Console Host, conhost.exe) render
 * with fonts that lack many decorative Unicode glyphs (◆ ✦ ↻ ⏻ …) and draw an
 * empty box (▯/?) instead. Rich terminals (Windows Terminal, VS Code, iTerm,
 * most *nix terminals) render them fine.
 *
 * To look correct everywhere we detect capability once and expose a single
 * `glyphs` object. Components must use these instead of hard-coding symbols so
 * a single switch controls the whole UI.
 *
 * Detection (no native deps, just env):
 *   - QUAKE_ASCII=1 / QUAKE_UNICODE=1 force the mode (escape hatch).
 *   - Non-Windows terminals are assumed rich (UTF-8 fonts are the norm).
 *   - On Windows we treat it as rich only when a modern host is detected
 *     (Windows Terminal via WT_SESSION, or a known TERM_PROGRAM / ConEmu),
 *     otherwise we fall back to the safe set for plain conhost.
 */

import { supportsRichGlyphs } from "@mrquake/quakecode-tui";

// Single source of truth lives in the TUI package so the renderer and the CLI
// agree on capability. This re-exposes it under the interactive glyph helper.
const rich = supportsRichGlyphs();

/** True when the terminal can render decorative Unicode glyphs. */
export const richGlyphsEnabled = rich;

/**
 * Pick the rich glyph when supported, otherwise the safe fallback.
 * Use for any one-off symbol not covered by `glyphs` below.
 */
export function glyph(richGlyph: string, safeGlyph: string): string {
	return rich ? richGlyph : safeGlyph;
}

/**
 * Named UI glyphs. Each is `rich` value on capable terminals and a widely
 * supported fallback (ASCII or BMP box-drawing/bullets that conhost fonts
 * include) everywhere else.
 */
export const glyphs = {
	// Branding / welcome board.
	brandMark: glyph("\u25c8", "#"), // ◈ -> #
	// Welcome menu icons.
	menuNew: glyph("\u2726", "+"), // ✦ -> +
	menuResume: glyph("\u21ba", "~"), // ↺ -> ~
	menuChangelog: glyph("\u2261", "="), // ≡ -> =
	menuQuit: glyph("\u23fb", "x"), // ⏻ -> x

	// List bullets (markdown rendering is handled separately in the TUI package,
	// these are for any CLI-side lists/menus).
	bullet: glyph("\u2022", "-"), // • -> -
	bulletSub: glyph("\u25e6", "-"), // ◦ -> -
	bulletDeep: glyph("\u25aa", "-"), // ▪ -> -

	// Misc UI marks.
	arrowRight: glyph("\u203a", ">"), // › -> >
	star: glyph("\u2726", "*"), // ✦ -> *
	check: glyph("\u2713", "v"), // ✓ -> v
	cross: glyph("\u2717", "x"), // ✗ -> x
	dot: glyph("\u00b7", "."), // · -> .
} as const;
