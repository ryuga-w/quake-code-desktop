import type { ThemeColor } from "../../modes/interactive/theme/theme.js";
import type { ToolRenderResultOptions } from "../extensions/types.js";
import type { MemoryEntry, MemoryScope } from "../memory/memory-store.js";
import {
	formatToolMeta,
	getTextOutput,
	getToolExecutionStatus,
	joinToolSections,
	shimmerText,
	type ToolExecutionStatus,
} from "./render-utils.js";

type Theme = typeof import("../../modes/interactive/theme/theme.js").theme;

export type MemoryRenderStyle = {
	/** Dimmed display before auto-hide. */
	faded?: boolean;
};

function dimIf(theme: Theme, text: string, faded?: boolean): string {
	return faded ? theme.fg("dim", text) : text;
}

function scopeTone(scope: string | undefined): ThemeColor {
	switch (scope) {
		case "user":
			return "warning";
		case "project":
			return "accent";
		case "local":
			return "muted";
		case "session":
			return "dim";
		default:
			return "muted";
	}
}

function formatScope(theme: Theme, scope: string | undefined): string {
	const label = scope ?? "project";
	return theme.fg(scopeTone(label), label);
}

function formatEntryName(theme: Theme, name: string | undefined): string {
	if (!name?.trim()) return theme.fg("toolOutput", "entry");
	return theme.fg("accent", name.trim());
}

function compactPreview(text: string | undefined, maxLines: number): string | undefined {
	if (!text?.trim()) return undefined;
	const lines = text.trim().split(/\r?\n/).slice(0, maxLines);
	const body = lines.join("\n");
	return lines.length < text.trim().split(/\r?\n/).length ? `${body}\n…` : body;
}

function memoryActionLabel(theme: Theme, verb: string, status: ToolExecutionStatus): string {
	if (status === "running" || status === "streaming") {
		return shimmerText(theme, verb, "muted", "accent");
	}
	if (status === "error") {
		return theme.fg("error", verb);
	}
	return theme.fg("toolTitle", theme.bold(verb));
}

export function formatRememberCall(
	args:
		| {
				name?: string;
				description?: string;
				content?: string;
				scope?: MemoryScope;
				type?: string;
		  }
		| undefined,
	theme: Theme,
	status: ToolExecutionStatus,
	expanded: boolean,
): string {
	const title = [
		memoryActionLabel(theme, "Memory save", status),
		theme.fg("dim", "·"),
		formatScope(theme, args?.scope),
		theme.fg("dim", "·"),
		formatEntryName(theme, args?.name),
	].join(" ");

	const meta: string[] = [];
	if (args?.type) meta.push(theme.fg("muted", args.type));
	if (args?.description?.trim()) {
		meta.push(theme.fg("muted", args.description.trim()));
	}
	const subtitle =
		meta.length > 0 ? meta.join(theme.fg("dim", " · ")) : theme.fg("muted", "Persisting layered memory");

	const sections = [title, formatToolMeta(theme, "memory", status), subtitle];
	if (expanded) {
		const preview = compactPreview(args?.content, 6);
		if (preview) sections.push(theme.fg("toolOutput", preview));
	}
	return joinToolSections(...sections);
}

export function formatRememberResult(
	args:
		| {
				name?: string;
				description?: string;
				content?: string;
				scope?: MemoryScope;
				type?: string;
		  }
		| undefined,
	result: { content: Array<{ type: string; text?: string }>; details?: { created?: boolean; scope?: MemoryScope } },
	options: ToolRenderResultOptions,
	theme: Theme,
	status: ToolExecutionStatus,
	style?: MemoryRenderStyle,
): string {
	const scope = result.details?.scope ?? args?.scope ?? "project";
	const verb = result.details?.created === false ? "Memory updated" : "Memory saved";
	const title = [
		memoryActionLabel(theme, verb, status),
		theme.fg("dim", "·"),
		formatScope(theme, scope),
		theme.fg("dim", "·"),
		formatEntryName(theme, args?.name),
	].join(" ");

	const meta: string[] = [];
	if (args?.type) meta.push(theme.fg("muted", args.type));
	if (args?.description?.trim()) meta.push(theme.fg("muted", args.description.trim()));

	const sections = [dimIf(theme, title, style?.faded)];
	if (options.expanded && meta.length > 0) {
		sections.push(dimIf(theme, meta.join(theme.fg("dim", " · ")), style?.faded));
	}

	if (options.expanded) {
		const preview = compactPreview(args?.content, 12);
		if (preview) sections.push(theme.fg("toolOutput", preview));
		const output = getTextOutput(result as any, false);
		if (output && !preview) sections.push(theme.fg("dim", output));
	}
	return joinToolSections(...sections);
}

function isMemoryEntry(value: unknown): value is MemoryEntry {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as MemoryEntry).name === "string" &&
		typeof (value as MemoryEntry).scope === "string"
	);
}

function extractRecallEntries(details: unknown): MemoryEntry[] {
	if (Array.isArray(details)) {
		return details.filter(isMemoryEntry);
	}
	if (isMemoryEntry(details)) return [details];
	return [];
}

function formatRecallEntryMeta(theme: Theme, entry: MemoryEntry): string {
	const parts: string[] = [];
	if (entry.type) parts.push(theme.fg("muted", entry.type));
	if (entry.description?.trim()) parts.push(theme.fg("muted", entry.description.trim()));
	return parts.join(theme.fg("dim", " · "));
}

function formatRecallTitle(
	theme: Theme,
	status: ToolExecutionStatus,
	entries: MemoryEntry[],
	args?: { query?: string; name?: string; scope?: MemoryScope },
): string {
	if (entries.length === 1) {
		const entry = entries[0]!;
		return [
			memoryActionLabel(theme, "Memory recalled", status),
			theme.fg("dim", "·"),
			formatEntryName(theme, entry.name),
			theme.fg("dim", "·"),
			formatScope(theme, entry.scope),
		].join(" ");
	}

	if (entries.length > 1) {
		return [
			memoryActionLabel(theme, "Memory recalled", status),
			theme.fg("dim", "·"),
			theme.fg("accent", `${entries.length} entries`),
		].join(" ");
	}

	if (args?.name) {
		return [
			memoryActionLabel(theme, "Memory recalled", status),
			theme.fg("dim", "·"),
			formatEntryName(theme, args.name),
			theme.fg("dim", "·"),
			formatScope(theme, args.scope),
		].join(" ");
	}

	if (args?.query?.trim()) {
		return [
			memoryActionLabel(theme, "Memory recalled", status),
			theme.fg("dim", "·"),
			theme.fg("accent", `"${args.query.trim()}"`),
		].join(" ");
	}

	return memoryActionLabel(theme, "Memory recalled", status);
}

export function formatRecallCall(
	args: { query?: string; name?: string; scope?: MemoryScope } | undefined,
	theme: Theme,
	status: ToolExecutionStatus,
): string {
	const target = args?.name
		? [
				formatEntryName(theme, args.name),
				...(args.scope ? [theme.fg("dim", "·"), formatScope(theme, args.scope)] : []),
			].join(" ")
		: args?.query?.trim()
			? theme.fg("accent", `"${args.query.trim()}"`)
			: theme.fg("toolOutput", "all entries");
	const scopeHint = args?.scope && !args?.name ? ` in ${args.scope}` : "";
	const title = [memoryActionLabel(theme, "Memory recall", status), theme.fg("dim", "·"), target].join(" ");
	const subtitle = theme.fg("muted", `Searching layered memory${scopeHint}`);
	return joinToolSections(title, formatToolMeta(theme, "memory", status), subtitle);
}

export function formatRecallResult(
	result: { content: Array<{ type: string; text?: string }>; details?: unknown },
	options: ToolRenderResultOptions,
	theme: Theme,
	status: ToolExecutionStatus,
	args?: { query?: string; name?: string; scope?: MemoryScope },
	style?: MemoryRenderStyle,
): string {
	const output = getTextOutput(result as any, false);
	if (status === "error") {
		return joinToolSections(
			memoryActionLabel(theme, "Memory recall failed", status),
			theme.fg("error", output || "Tool execution failed"),
		);
	}
	if (output.startsWith("No ") || output === "Memory is empty.") {
		return joinToolSections(
			dimIf(theme, memoryActionLabel(theme, "Memory recall", status), style?.faded),
			dimIf(theme, output, style?.faded),
		);
	}

	const entries = extractRecallEntries(result.details);
	const title = formatRecallTitle(theme, status, entries, args);
	const sections = [dimIf(theme, title, style?.faded)];

	if (options.expanded) {
		if (entries.length === 1) {
			const meta = formatRecallEntryMeta(theme, entries[0]!);
			if (meta) sections.push(dimIf(theme, meta, style?.faded));
		} else if (entries.length > 1) {
			const preview = entries
				.slice(0, 4)
				.map((e) => `${e.scope}/${e.name}`)
				.join(theme.fg("dim", " · "));
			const suffix = entries.length > 4 ? theme.fg("dim", ` · +${entries.length - 4} more`) : "";
			sections.push(dimIf(theme, preview + suffix, style?.faded));
		}
		if (output) {
			sections.push(theme.fg("toolOutput", compactPreview(output, 16) ?? output));
		}
	}

	return joinToolSections(...sections);
}

export function formatForgetCall(
	args: { name?: string; scope?: MemoryScope } | undefined,
	theme: Theme,
	status: ToolExecutionStatus,
): string {
	const title = [
		memoryActionLabel(theme, "Memory forget", status),
		theme.fg("dim", "·"),
		formatEntryName(theme, args?.name),
	].join(" ");
	const scopeHint = args?.scope ? formatScope(theme, args.scope) : theme.fg("muted", "any scope");
	const subtitle = theme.fg("muted", `Removing from ${scopeHint}`);
	return joinToolSections(title, formatToolMeta(theme, "memory", status), subtitle);
}

export function formatForgetResult(
	args: { name?: string } | undefined,
	result: { content: Array<{ type: string; text?: string }>; details?: { deleted?: boolean } },
	options: ToolRenderResultOptions,
	theme: Theme,
	status: ToolExecutionStatus,
	style?: MemoryRenderStyle,
): string {
	const deleted = result.details?.deleted ?? getTextOutput(result as any, false).startsWith("Deleted");
	const verb = deleted ? "Memory removed" : "Memory not found";
	const title = [
		memoryActionLabel(theme, verb, status),
		theme.fg("dim", "·"),
		formatEntryName(theme, args?.name),
	].join(" ");

	const sections = [dimIf(theme, title, style?.faded)];
	if (options.expanded) {
		const output = getTextOutput(result as any, false);
		if (output) sections.push(theme.fg("dim", output));
	}
	return joinToolSections(...sections);
}

export function formatManagedMemoryFileCall(
	verb: "read" | "save" | "update",
	filePath: string | null | undefined,
	theme: Theme,
	status: ToolExecutionStatus,
	scope?: MemoryScope,
	expanded?: boolean,
	preview?: string,
): string {
	const action = verb === "read" ? "Memory read" : verb === "save" ? "Memory save" : "Memory update";
	const title = [memoryActionLabel(theme, action, status), theme.fg("dim", "·"), formatScope(theme, scope)].join(" ");
	const sections = [title, formatToolMeta(theme, "memory", status)];
	if (filePath) {
		sections.push(theme.fg("muted", filePath));
	}
	if (preview && expanded) {
		sections.push(theme.fg("toolOutput", compactPreview(preview, 8) ?? preview));
	} else {
		sections.push(
			theme.fg(
				"muted",
				verb === "read"
					? "Use memory_recall instead of reading MEMORY.md directly"
					: "Use memory_remember instead of editing MEMORY.md directly",
			),
		);
	}
	return joinToolSections(...sections);
}

export function formatManagedMemoryFileResult(
	verb: "read" | "saved" | "updated" | "blocked",
	theme: Theme,
	status: ToolExecutionStatus,
	detail?: string,
): string {
	const label =
		verb === "read"
			? "Memory read"
			: verb === "saved"
				? "Memory saved"
				: verb === "updated"
					? "Memory updated"
					: "Memory blocked";
	const sections = [memoryActionLabel(theme, label, status)];
	if (detail) sections.push(theme.fg(status === "error" ? "error" : "muted", detail));
	return joinToolSections(...sections);
}

export function memoryStatusFromContext(context: {
	executionStarted: boolean;
	isPartial: boolean;
	isError: boolean;
}): ToolExecutionStatus {
	return getToolExecutionStatus({
		executionStarted: context.executionStarted,
		isPartial: context.isPartial,
		isError: context.isError,
	});
}
