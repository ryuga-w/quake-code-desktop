import { Container, Text } from "@mrquake/quakecode-tui";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

export type NoticeKind = "info" | "success" | "warning" | "error";

function colorFor(kind: NoticeKind): (text: string) => string {
	switch (kind) {
		case "success":
			return (text) => theme.fg("success", text);
		case "warning":
			return (text) => theme.fg("warning", text);
		case "error":
			return (text) => theme.fg("error", text);
		default:
			return (text) => theme.fg("accent", text);
	}
}

function titleFor(kind: NoticeKind): string {
	switch (kind) {
		case "success":
			return "Success";
		case "warning":
			return "Warning";
		case "error":
			return "Error";
		default:
			return "Info";
	}
}

export class NoticeCard extends Container {
	constructor(kind: NoticeKind, message: string) {
		super();
		const color = colorFor(kind);
		const icon = kind === "success" ? "+" : kind === "warning" ? "!" : kind === "error" ? "x" : ">";
		this.addChild(new DynamicBorder(color));
		this.addChild(new Text(`${color(icon)} ${theme.bold(color(titleFor(kind)))}`, 1, 0));
		this.addChild(new Text(theme.fg("muted", message), 1, 0));
		this.addChild(new DynamicBorder(color));
	}
}
