import type { ExtensionAPI } from "@mrquake/quakecode-cli";
import { Text } from "@mrquake/quakecode-tui";
import { Type } from "@sinclair/typebox";
import { quakeWebRuntime } from "../../../core/tools/web-runtime.js";

function _silver(text: string): string {
	return `\x1b[38;2;192;192;192m${text}\x1b[0m`;
}

export default function (quake: ExtensionAPI) {
	quake.registerTool({
		name: "web_search",
		label: "web_search",
		description: "Search the web without opening a browser and return the top results.",
		promptSnippet: "Search the web without opening a browser",
		promptGuidelines: [
			"Use web_search for general web lookups and discovery.",
			"If the user says not to open a browser, prefer web_search over browser tools.",
			"After a successful web_search, answer directly from the returned results unless deeper inspection is needed.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query to run on the web" }),
		}),
		renderCall(args, theme) {
			return new Text(`${theme.bold("Searching the web")} ${theme.fg("dim", args.query)}`, 0, 0);
		},
		renderResult(result, options, theme) {
			let text = `${theme.bold("Searched")}`;
			const detail = result.details?.query;
			if (detail) text += ` ${theme.fg("dim", detail)}`;
			if (options.expanded) {
				const body = result.content?.find((c: any) => c.type === "text")?.text;
				if (body) text += `\n${theme.fg("dim", body.split(/\r?\n/).slice(0, 16).join("\n"))}`;
			}
			return new Text(text, 0, 0);
		},
		async execute(_toolCallId, params) {
			const response = await quakeWebRuntime.search(params.query);
			const text = response.status === "empty"
				? `Search query: ${response.query}\nResults: 0\nNo meaningful web search results found.`
				: [
						`Search query: ${response.query}`,
						`Results: ${response.results.length}`,
						`Provider: ${response.provider}`,
						...response.results.map((item, i) => `${i + 1}. ${item.title}\n   ${item.url}\n   ${item.snippet}`),
					].join("\n");

			return {
				content: [{ type: "text" as const, text }],
				details: response,
			};
		},
	});
}
