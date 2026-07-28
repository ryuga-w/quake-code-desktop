import { Container, type Focusable, Spacer, Text } from "@mrquake/quakecode-tui";
import { isDismissOverlayInput } from "./dismissible-overlay.js";
import { theme } from "../theme/theme.js";
import { SelectorFrame } from "./selector-frame.js";

export interface SessionInfoData {
	sessionName?: string;
	sessionFile: string;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
}

export class SessionInfoComponent extends Container implements Focusable {
	private _focused = false;
	private readonly onClose: () => void;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	constructor(data: SessionInfoData, onClose: () => void) {
		super();
		this.onClose = onClose;

		const labelWidth = 13;
		const line = (label: string, value: string | number) => {
			const padded = `${label}:`.padEnd(labelWidth, " ");
			return `${theme.fg("dim", padded)} ${value}`;
		};

		const frame = new SelectorFrame({
			title: "Session Overview",
			subtitle: "Current session details and usage",
			hint: `${theme.fg("dim", "Esc")} ${theme.fg("muted", "· ")}${theme.fg("dim", "×")} ${theme.fg("muted", "close")}`,
			footerHint: "Esc · × close",
			onClose: () => this.onClose(),
		});
		const body = frame.getBody();
		this.addChild(frame);

		const overview = [
			data.sessionName ? line("Name", data.sessionName) : undefined,
			line("ID", data.sessionId),
			line("File", data.sessionFile),
			line("Messages", `${data.totalMessages} total`),
			line("Tokens", `${data.tokens.total.toLocaleString()} total`),
		]
			.filter(Boolean)
			.join("\n");

		const messages = [
			theme.bold(theme.fg("accent", "Messages")),
			line("User", data.userMessages),
			line("Assistant", data.assistantMessages),
			line("Tool calls", data.toolCalls),
			line("Tool results", data.toolResults),
			line("Total", data.totalMessages),
		].join("\n");

		const tokenLines = [
			theme.bold(theme.fg("accent", "Tokens")),
			line("Input", data.tokens.input.toLocaleString()),
			line("Output", data.tokens.output.toLocaleString()),
		];
		if (data.tokens.cacheRead > 0) tokenLines.push(line("Cache read", data.tokens.cacheRead.toLocaleString()));
		if (data.tokens.cacheWrite > 0) tokenLines.push(line("Cache write", data.tokens.cacheWrite.toLocaleString()));
		tokenLines.push(line("Total", data.tokens.total.toLocaleString()));
		if (data.cost > 0) tokenLines.push(line("Cost", `$${data.cost.toFixed(4)}`));
		const tokens = tokenLines.join("\n");

		body.addChild(new Text(overview, 0, 0));
		body.addChild(new Spacer(1));
		body.addChild(new Text(messages, 0, 0));
		body.addChild(new Spacer(1));
		body.addChild(new Text(tokens, 0, 0));
	}

	handleInput(keyData: string): void {
		if (isDismissOverlayInput(keyData)) {
			this.onClose();
		}
	}
}
