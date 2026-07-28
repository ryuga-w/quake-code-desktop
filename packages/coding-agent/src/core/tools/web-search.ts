import type { AgentTool } from "@mrquake/quakecode-agent-core";
import { Text } from "@mrquake/quakecode-tui";
import { type Static, Type } from "@sinclair/typebox";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.js";
import { getTextOutput } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import { quakeWebRuntime } from "./web-runtime.js";

const webSearchSchema = Type.Object({
	query: Type.String({ description: "Search query to run on the web" }),
});

const webOpenPageSchema = Type.Object({
	url: Type.String({ description: "URL to open in the browser" }),
});

const webFindInPageSchema = Type.Object({
	pattern: Type.String({ description: "Text pattern to find on the currently open page" }),
});

export type WebSearchToolInput = Static<typeof webSearchSchema>;
export type WebOpenPageToolInput = Static<typeof webOpenPageSchema>;
export type WebFindInPageToolInput = Static<typeof webFindInPageSchema>;

function dot(theme: typeof import("../../modes/interactive/theme/theme.js").theme, completed: boolean): string {
	return completed ? theme.fg("dim", "•") : theme.fg("muted", "◦");
}

function renderPendingCall(
	label: string,
	detail: string | undefined,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
): Text {
	const parts = [`${dot(theme, false)} ${theme.bold(label)}`];
	if (detail) {
		parts.push(theme.fg("dim", detail));
	}
	return new Text(parts.join(" "), 0, 0);
}

function compactLines(text: string, max = 12): string {
	const lines = text.split(/\r?\n/);
	return lines.slice(0, max).join("\n");
}

function renderToolResult(
	label: string,
	result: { content: Array<{ type: string; text?: string }>; details?: any },
	options: ToolRenderResultOptions,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
) {
	let text = `${dot(theme, true)} ${theme.bold(label)}`;
	const detail = result.details?.query || result.details?.pattern || result.details?.url || result.details?.title;
	if (detail) text += ` ${theme.fg("dim", detail)}`;
	if (options.expanded) {
		const output = getTextOutput(result as any, false);
		if (output) {
			text += `\n${theme.fg("dim", compactLines(output, 20))}`;
		}
	}
	return new Text(text, 0, 0);
}

export function createWebSearchToolDefinition(): ToolDefinition<typeof webSearchSchema, any> {
	return {
		name: "web_search",
		label: "web_search",
		description:
			"Search the web and return the top results in a Codex-style summary. This is the primary tool for general web lookups and browser-free research.",
		promptSnippet: "Search the web with structured results",
		promptGuidelines: [
			"Use web_search first for general research, discovery, and finding candidate URLs.",
			"If the user asks for a general web lookup, call web_search immediately instead of discussing whether it exists.",
			"Do not output messages about verifying whether web_search is available.",
			"For simple factual lookups, use exactly one successful web_search call unless the results are empty or clearly ambiguous.",
			"For simple factual lookups, after one successful web_search call, answer directly from the returned results and stop using tools unless the user asks for deeper verification.",
			"After a successful web_search call, use its returned results directly and do not switch to bash/curl-based searching.",
			"Do not inspect the local repo or tool files to decide whether web_search exists when it is already available.",
			"Use web_open_page after web_search when you already know which result or URL should be opened.",
			"Use web_find_in_page to extract specific text from the currently open page.",
			"Only use browser_* tools when the task requires direct page interaction, screenshots, form filling, clicking, or browser state inspection.",
		],
		parameters: webSearchSchema,
		renderCall(args, theme) {
			return renderPendingCall("Searching the web", args.query, theme);
		},
		renderResult(result, options, theme) {
			return renderToolResult("Searched", result, options, theme);
		},
		async execute(_toolCallId, params) {
			const res = await quakeWebRuntime.search(params.query);
			const lines = res.duplicate
				? [
						`You already searched this query in this turn. Do not search again. Use the previous results now and answer the user directly.`,
						`Search query: ${res.query}`,
						`Results: ${res.results.length}`,
						`Provider: ${res.provider}`,
					]
				: res.status === "empty"
					? [
							`The search completed successfully but returned no results. Rephrase once with broader terms only if the answer cannot be produced without sources.`,
							`Search query: ${res.query}`,
							`Results: 0`,
							`Provider: ${res.provider}`,
						]
					: [
							`Use these web search results directly to answer the user. Do not inspect local source files, tool definitions, or repo contents to decide whether web_search exists. Do not switch to bash/curl searching after this result unless the user explicitly asks for a different method.`,
							`For a simple factual lookup, stop using tools after this and answer directly unless the results are clearly ambiguous.`,
							`Search query: ${res.query}`,
							`Results: ${res.results.length}`,
							`Provider: ${res.provider}`,
							...res.results.map((item, i) => `${i + 1}. ${item.title}\n   ${item.url}\n   ${item.snippet}`),
						];
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: res,
			};
		},
	};
}

export function createWebOpenPageToolDefinition(): ToolDefinition<typeof webOpenPageSchema, any> {
	return {
		name: "web_open_page",
		label: "web_open_page",
		description:
			"Open a specific page in the shared browser session after you already know which URL should be inspected.",
		promptSnippet: "Open a web page in the browser",
		promptGuidelines: ["Use web_open_page after you have a concrete URL from web_search or from the user."],
		parameters: webOpenPageSchema,
		renderCall(args, theme) {
			return new Text(`${dot(theme, false)} ${theme.bold("Opening page")} ${theme.fg("dim", args.url)}`, 0, 0);
		},
		renderResult(result, options, theme) {
			return renderToolResult("Opened page", result, options, theme);
		},
		async execute(_toolCallId, params) {
			const res = await quakeWebRuntime.openPage(params.url);
			return {
				content: [{ type: "text", text: `Opened page for direct inspection.\n${res.title}\n${res.url}` }],
				details: res,
			};
		},
	};
}

export function createWebFindInPageToolDefinition(): ToolDefinition<typeof webFindInPageSchema, any> {
	return {
		name: "web_find_in_page",
		label: "web_find_in_page",
		description: "Find text within the currently open page after it has already been opened.",
		promptSnippet: "Find text on the current web page",
		promptGuidelines: [
			"Use web_find_in_page after opening a page when you need to confirm whether specific text, terms, or identifiers appear on it.",
		],
		parameters: webFindInPageSchema,
		renderCall(args, theme) {
			return new Text(
				`${dot(theme, false)} ${theme.bold("Finding in page")} ${theme.fg("dim", args.pattern)}`,
				0,
				0,
			);
		},
		renderResult(result, options, theme) {
			return renderToolResult("Found in page", result, options, theme);
		},
		async execute(_toolCallId, params) {
			const res = await quakeWebRuntime.findInPage(params.pattern);
			const text = [
				`Use these page-find results directly.`,
				`Pattern: ${res.pattern}`,
				`Matches: ${res.matches}`,
				...res.samples.map((s, i) => `${i + 1}. ${s}`),
			].join("\n");
			return {
				content: [{ type: "text", text }],
				details: res,
			};
		},
	};
}

export const webSearchToolDefinition = createWebSearchToolDefinition();
export const webOpenPageToolDefinition = createWebOpenPageToolDefinition();
export const webFindInPageToolDefinition = createWebFindInPageToolDefinition();

export const webSearchTool: AgentTool<any> = wrapToolDefinition(webSearchToolDefinition);
export const webOpenPageTool: AgentTool<any> = wrapToolDefinition(webOpenPageToolDefinition);
export const webFindInPageTool: AgentTool<any> = wrapToolDefinition(webFindInPageToolDefinition);
