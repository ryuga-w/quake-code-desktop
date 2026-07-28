/**
 * SGR mouse protocol parsing and terminal mode helpers.
 * @see https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
 */

import type { Terminal } from "./terminal.js";

const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

export const MOUSE_MOD_SHIFT = 4;
export const MOUSE_MOD_ALT = 8;
export const MOUSE_MOD_CTRL = 16;

const MOUSE_MODIFIER_MASK = MOUSE_MOD_SHIFT | MOUSE_MOD_ALT | MOUSE_MOD_CTRL;

/** Base button index with modifier bits stripped (xterm: bits 4/8/16). */
export function stripMouseButton(raw: number): number {
	return raw & ~MOUSE_MODIFIER_MASK;
}

export function hasMouseModifier(raw: number, bit: number): boolean {
	return (raw & bit) !== 0;
}

export type MouseEventType = "down" | "up" | "motion" | "wheel";

export interface MouseEventBase {
	x: number;
	y: number;
	rawButton: number;
	button: number;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
}

export interface MouseClickEvent extends MouseEventBase {
	type: "down" | "up";
}

export interface MouseMotionEvent extends MouseEventBase {
	type: "motion";
}

export interface MouseWheelEvent extends MouseEventBase {
	type: "wheel";
	direction: "up" | "down";
}

export type MouseEvent = MouseClickEvent | MouseMotionEvent | MouseWheelEvent;

export interface MouseModeOptions {
	click?: boolean;
	drag?: boolean;
	hover?: boolean;
	sgr?: boolean;
}

/**
 * Parse an SGR mouse sequence (`CSI < Cb ; Cx ; Cy M/m`).
 * Returns undefined when the input is not a mouse event.
 */
export function parseSgrMouse(data: string): MouseEvent | undefined {
	const match = data.match(SGR_MOUSE_RE);
	if (!match) return undefined;

	const rawButton = Number.parseInt(match[1]!, 10);
	const x = Number.parseInt(match[2]!, 10) - 1;
	const y = Number.parseInt(match[3]!, 10) - 1;
	const pressed = match[4] === "M";

	// Strip modifier bits (shift/alt/ctrl) first so wheel and motion codes match
	// regardless of which modifier keys are held.
	const button = stripMouseButton(rawButton);

	// Wheel: SGR encodes the scroll wheel with bit 6 set, i.e. base codes 64 (up)
	// and 65 (down). (The older x10 button codes 4/5 are NOT wheel events.)
	if (button === 64 || button === 65) {
		return {
			x,
			y,
			rawButton,
			button,
			shift: hasMouseModifier(rawButton, MOUSE_MOD_SHIFT),
			alt: hasMouseModifier(rawButton, MOUSE_MOD_ALT),
			ctrl: hasMouseModifier(rawButton, MOUSE_MOD_CTRL),
			type: "wheel",
			direction: button === 64 ? "up" : "down",
		};
	}

	const base: MouseEventBase = {
		x,
		y,
		rawButton,
		button,
		shift: hasMouseModifier(rawButton, MOUSE_MOD_SHIFT),
		alt: hasMouseModifier(rawButton, MOUSE_MOD_ALT),
		ctrl: hasMouseModifier(rawButton, MOUSE_MOD_CTRL),
	};

	if (button === 0 || button === 1 || button === 2) {
		return {
			...base,
			type: pressed ? "down" : "up",
		};
	}

	// Motion: bit 5 (32) is set during button-held drag (32=left, 33=middle,
	// 34=right) and for pure pointer motion in 1003 "any-event" mode (35).
	if (button === 32 || button === 33 || button === 34 || button === 35) {
		return {
			...base,
			type: "motion",
		};
	}

	return {
		...base,
		type: pressed ? "down" : "up",
	};
}

export function isSgrMouseSequence(data: string): boolean {
	return SGR_MOUSE_RE.test(data);
}

/** Enable mouse reporting modes on the terminal output stream. */
export function enableMouseModes(
	terminal: Terminal,
	options: MouseModeOptions = { click: true, drag: true, sgr: true },
): void {
	const modes: string[] = [];
	if (options.click !== false) modes.push("1000");
	if (options.drag) modes.push("1002");
	if (options.hover) modes.push("1003");
	if (options.sgr !== false) modes.push("1006");
	for (const mode of modes) {
		terminal.write(`\x1b[?${mode}h`);
	}
}

/** Disable mouse reporting modes (reverse order of enable is conventional). */
export function disableMouseModes(
	terminal: Terminal,
	options: MouseModeOptions = { click: true, drag: true, hover: true, sgr: true },
): void {
	const modes: string[] = [];
	if (options.sgr !== false) modes.push("1006");
	if (options.hover) modes.push("1003");
	if (options.drag) modes.push("1002");
	if (options.click !== false) modes.push("1000");
	for (const mode of modes) {
		terminal.write(`\x1b[?${mode}l`);
	}
}

export function setHoverMouseMode(terminal: Terminal, enabled: boolean): void {
	terminal.write(enabled ? "\x1b[?1003h" : "\x1b[?1003l");
}

/** CSS-style pointer shapes via OSC 22 (Kitty, Ghostty, Foot, iTerm2; optional elsewhere). */
export type PointerShape = "default" | "pointer" | "text";

/** Bold + underline SGR wrapper for mouse-hover affordance in the TUI. */
export function applyMouseHoverStyle(text: string): string {
	return `\x1b[4;1m${text}\x1b[24;22m`;
}

/** Set the terminal mouse pointer shape. Use `default` to reset. */
export function setPointerShape(terminal: Terminal, shape: PointerShape): void {
	if (shape === "default") {
		terminal.write("\x1b]22;\x1b\\");
		return;
	}
	terminal.write(`\x1b]22;${shape}\x1b\\`);
}
