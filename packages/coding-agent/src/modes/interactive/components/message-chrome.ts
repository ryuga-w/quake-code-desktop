import { createSharedAnimationClock } from "@mrquake/quakecode-tui";
import { glyphs, richGlyphsEnabled } from "../glyphs.js";
import { theme } from "../theme/theme.js";

// Braille spinner looks great on modern terminals but renders as boxes on
// legacy conhost. Fall back to a simple ASCII spinner there.
const SPINNER_FRAMES = richGlyphsEnabled
	? (["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const)
	: (["|", "/", "-", "\\"] as const);
export const MESSAGE_GUTTER_WIDTH = 3;
const GUTTER_WIDTH = MESSAGE_GUTTER_WIDTH;
const RISE_DUR_S = 2.8;
const RISE_STAGGER_S = 1.05;
const RISE_TRAVEL_S = 0.42;
const RISE_EDGE_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

const messageAnimationClock = createSharedAnimationClock(120);
let animationFrame = 0;
let clockStarted = false;
const animationListeners = new Set<() => void>();
let clockUnsub: (() => void) | undefined;

function ensureAnimationClock(): void {
	if (clockStarted) return;
	clockStarted = true;
	clockUnsub = messageAnimationClock.subscribe(() => {
		animationFrame++;
		for (const listener of animationListeners) {
			listener();
		}
	});
}

function stopAnimationClockIfIdle(): void {
	if (animationListeners.size > 0) return;
	clockUnsub?.();
	clockUnsub = undefined;
	clockStarted = false;
}

export function subscribeMessageAnimation(listener: () => void): () => void {
	animationListeners.add(listener);
	ensureAnimationClock();
	return () => {
		animationListeners.delete(listener);
		stopAnimationClockIfIdle();
	};
}

export function isRiseAnimationActive(riseStartMs: number): boolean {
	if (riseStartMs <= 0) return false;
	return (Date.now() - riseStartMs) / 1000 < RISE_DUR_S;
}

export function getLineRevealFactor(
	lineIndex: number,
	totalLines: number,
	riseStartMs: number,
	enabled: boolean,
): number {
	if (!enabled || riseStartMs <= 0 || totalLines <= 0) return 1;

	// Bottom-up rise disabled. Lines are always fully visible as they stream in.
	// (Previously delayed from bottom using lineFromBottom.)
	return 1;
}

function railTrack(): string {
	return theme.fg("dim", "│");
}

export function liveGutter(symbol: string): string {
	return `${railTrack()}${symbol} `;
}

export function settledRailPrefix(isFirstLine: boolean): string {
	return isFirstLine ? liveGutter(" ") : liveContinuationPrefix();
}

function hiddenGutter(): string {
	return " ".repeat(GUTTER_WIDTH);
}

function padGutter(content: string): string {
	return content.padEnd(GUTTER_WIDTH, " ");
}

export function riseLeadPrefix(factor: number): string {
	if (factor <= 0) return hiddenGutter();
	const edge =
		RISE_EDGE_CHARS[Math.min(RISE_EDGE_CHARS.length - 1, Math.floor(factor * RISE_EDGE_CHARS.length))] ?? "█";
	return liveGutter(theme.fg("messageRail", edge));
}

export function riseContinuationPrefix(factor: number): string {
	if (factor <= 0) return hiddenGutter();
	if (factor < 1) return liveGutter(theme.fg("messageRail", "·"));
	return liveGutter(theme.fg("dim", "·"));
}

export function thinkingLeadPrefix(): string {
	const spinner = SPINNER_FRAMES[animationFrame % SPINNER_FRAMES.length] ?? "⠋";
	return liveGutter(theme.fg("messageRail", spinner));
}

export function streamingLeadPrefix(): string {
	const visible = Math.floor(animationFrame / 4) % 2 === 0;
	const cursor = visible ? theme.fg("messageRail", "█") : " ";
	return liveGutter(cursor);
}

export function doneLeadPrefix(): string {
	return "";
}

export function liveContinuationPrefix(): string {
	return liveGutter(theme.fg("dim", "·"));
}

export function doneContinuationPrefix(): string {
	return "";
}

export function userLeadPrefix(): string {
	return padGutter(theme.fg("text", "›"));
}

export function userContinuationPrefix(): string {
	return " ".repeat(GUTTER_WIDTH);
}

export function statusLeadPrefix(kind: "error" | "aborted"): string {
	const icon = kind === "error" ? "!" : "x";
	return theme.fg("error", `${icon}  `);
}
