import * as os from "node:os";
import type { ImageContent, TextContent } from "@mrquake/quakecode-ai";
import { getCapabilities, getImageDimensions, imageFallback } from "@mrquake/quakecode-tui";
import stripAnsi from "strip-ansi";
import { sanitizeBinaryOutput } from "../../utils/shell.js";

export function shortenPath(path: unknown): string {
	if (typeof path !== "string") return "";
	const home = os.homedir();
	if (path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

export function str(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (value == null) return "";
	return null;
}

export function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

export function normalizeDisplayText(text: string): string {
	return text.replace(/\r/g, "");
}

export function getTextOutput(
	result: { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> } | undefined,
	showImages: boolean,
): string {
	if (!result) return "";

	const textBlocks = result.content.filter((content) => content.type === "text");
	const imageBlocks = result.content.filter((content) => content.type === "image");

	let output = textBlocks
		.map((content) => sanitizeBinaryOutput(stripAnsi(content.text || "")).replace(/\r/g, ""))
		.join("\n");

	const capabilities = getCapabilities();
	if (imageBlocks.length > 0 && (!capabilities.images || !showImages)) {
		const imageIndicators = imageBlocks
			.map((image) => {
				const mimeType = image.mimeType ?? "image/unknown";
				const dims =
					image.data && image.mimeType ? (getImageDimensions(image.data, image.mimeType) ?? undefined) : undefined;
				return imageFallback(mimeType, dims);
			})
			.join("\n");
		output = output ? `${output}\n${imageIndicators}` : imageIndicators;
	}

	return output;
}

export type ToolRenderResultLike<TDetails> = {
	content: (TextContent | ImageContent)[];
	details: TDetails;
};

export type ToolExecutionStatus = "queued" | "running" | "streaming" | "done" | "error";

export type ToolPreviewDensity = "compact" | "comfortable" | "spacious";

export type ToolPreviewLineLimits = Record<ToolPreviewDensity, { active: number; done: number; error: number }>;

export const DEFAULT_TOOL_PREVIEW_LINE_LIMITS: ToolPreviewLineLimits = {
	compact: { active: 6, done: 3, error: 6 },
	comfortable: { active: 12, done: 4, error: 8 },
	spacious: { active: 18, done: 8, error: 12 },
};

export function getToolExecutionStatus(context: {
	executionStarted?: boolean;
	isPartial?: boolean;
	isError?: boolean;
}): ToolExecutionStatus {
	if (!context.executionStarted) return "queued";
	if (context.isError) return "error";
	if (context.isPartial) return "streaming";
	return "done";
}

export function summarizeToolTextOutput(output: string | undefined, status: ToolExecutionStatus): string | undefined {
	const lines = (output ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (status === "queued") return "Waiting for execution to begin";
	if (status === "running") {
		return lines.length === 0
			? "Waiting for first output"
			: `Streaming ${lines.length} line${lines.length === 1 ? "" : "s"} of output`;
	}
	if (status === "streaming") {
		return lines.length === 0
			? "Receiving partial output"
			: `Streaming ${lines.length} line${lines.length === 1 ? "" : "s"} of output`;
	}
	if (lines.length === 0) {
		return status === "error" ? "Tool failed without text output" : "Completed with no text output";
	}
	if (status === "error") return `Tool returned ${lines.length} line${lines.length === 1 ? "" : "s"} before failing`;
	return `Produced ${lines.length} line${lines.length === 1 ? "" : "s"} of output`;
}

export function pickToolTextPreview(
	output: string | undefined,
	options: { expanded: boolean; prefersHeadPreview?: boolean; maxPreviewLines: number; maxExpandedLines?: number },
): { lines: string[]; hiddenLineCount: number } {
	const lines = (output ?? "").split("\n");
	if (options.expanded) {
		const maxExpandedLines = options.maxExpandedLines ?? lines.length;
		const previewLines = options.prefersHeadPreview
			? lines.slice(0, maxExpandedLines)
			: lines.slice(-maxExpandedLines);
		return {
			lines: previewLines,
			hiddenLineCount: Math.max(0, lines.length - previewLines.length),
		};
	}
	const previewLines = options.prefersHeadPreview
		? lines.slice(0, options.maxPreviewLines)
		: lines.slice(-options.maxPreviewLines);
	return {
		lines: previewLines,
		hiddenLineCount: Math.max(0, lines.length - previewLines.length),
	};
}

export function getToolPreviewLineCount(
	status: ToolExecutionStatus,
	density: ToolPreviewDensity,
	limits: ToolPreviewLineLimits = DEFAULT_TOOL_PREVIEW_LINE_LIMITS,
): number {
	const config = limits[density];
	if (status === "done") return config.done;
	if (status === "error") return config.error;
	return config.active;
}

export function shimmerText(
	theme: { fg: (name: any, text: string) => string; bold?: (text: string) => string },
	text: string,
	baseColor: string = "muted",
	_highlightColor: string = "accent",
): string {
	// Keep status copy stable; the loader glyph provides the only motion.
	// This avoids distracting full-line blinking while preserving activity feedback.
	const styledText = theme.fg(baseColor, text);
	return theme.bold ? theme.bold(styledText) : styledText;
}

export function formatToolMeta(
	theme: { fg: (name: any, text: string) => string; bold?: (text: string) => string },
	label: string,
	status: ToolExecutionStatus,
): string {
	const icon =
		status === "queued"
			? theme.fg("dim", "-")
			: status === "running" || status === "streaming"
				? theme.fg("accent", ">")
				: status === "done"
					? theme.fg("dim", "+")
					: theme.fg("error", "!");
	const statusText =
		status === "queued"
			? theme.fg("dim", "queued")
			: status === "running"
				? shimmerText(theme, "running", "dim", "muted")
				: status === "streaming"
					? shimmerText(theme, "streaming", "dim", "muted")
					: status === "done"
						? theme.fg("success", "done")
						: theme.fg("error", "failed");
	return `${icon} ${theme.fg("dim", label)}${theme.fg("dim", " · ")}${statusText}`;
}

export function joinToolSections(...sections: Array<string | undefined | null | false>): string {
	return sections
		.filter((section): section is string => typeof section === "string" && section.trim().length > 0)
		.join("\n\n");
}

export function invalidArgText(theme: { fg: (name: any, text: string) => string }): string {
	return theme.fg("error", "[invalid arg]");
}
