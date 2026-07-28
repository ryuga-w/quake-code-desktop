import { createSharedAnimationClock } from "../animation-clock.js";
import type { TUI } from "../tui.js";
import { truncateToWidth } from "../utils.js";
import { Text } from "./text.js";

const loaderAnimationClock = createSharedAnimationClock(120);

/**
 * Loader component with a shared, throttled animation cadence.
 * Multiple loaders reuse the same clock instead of opening their own timers.
 */
export class Loader extends Text {
	private currentFrame = 0;
	private static readonly hintSeparator = "   ";
	private stopAnimation?: () => void;
	private ui: TUI | null = null;

	constructor(
		ui: TUI,
		private spinnerColorFn: (str: string) => string,
		private messageColorFn: (str: string) => string,
		private message: string = "Loading...",
	) {
		super("", 0, 0);
		this.ui = ui;
		this.start();
	}

	render(width: number): string[] {
		// Keep loaders to a single terminal row. If this wraps, parent layouts grow
		// and the prompt/input area jumps while tools stream status updates.
		const line = super.render(width)[0] ?? "";
		return [truncateToWidth(line, width)];
	}

	start() {
		if (this.stopAnimation) return;
		this.updateDisplay();
		this.stopAnimation = loaderAnimationClock.subscribe(() => {
			this.currentFrame++;
			this.updateDisplay();
		});
	}

	stop() {
		this.stopAnimation?.();
		this.stopAnimation = undefined;
	}

	setMessage(message: string) {
		this.message = message;
		this.updateDisplay();
	}

	private updateDisplay() {
		const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
		const left = frames[this.currentFrame % frames.length] ?? "⠋";
		const [status, hint] = this.message.split(Loader.hintSeparator, 2);
		const animatedStatus = this.renderStatusSweep(status || this.message);
		const hintText = hint ? `${Loader.hintSeparator}${this.messageColorFn(hint)}` : "";
		this.setText(`  ${this.spinnerColorFn(left)}  ${animatedStatus}${hintText}`);
		if (this.ui) {
			this.ui.requestRender();
		}
	}

	private renderStatusSweep(status: string): string {
		const chars = Array.from(status);
		if (chars.length === 0) return "";
		const center = this.currentFrame % (chars.length + 4);
		return chars
			.map((char, index) => (Math.abs(index - center) <= 1 ? this.spinnerColorFn(char) : this.messageColorFn(char)))
			.join("");
	}
}
