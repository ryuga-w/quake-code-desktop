import * as path from "node:path";
import { supportsRichGlyphs } from "@mrquake/quakecode-tui";
import type { ToolExecutionStatus } from "./render-utils.js";
import { getTextOutput, str } from "./render-utils.js";

export const TOOL_STATUS_GLYPHS = supportsRichGlyphs()
  ? ({ queued: "○", active: "●", done: "✓", error: "×" } as const)
  : ({ queued: "o", active: ">", done: "+", error: "x" } as const);

export type CompactToolLogInput = {
  toolName: string;
  args: unknown;
  result?: {
    content: Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    isError: boolean;
    details?: unknown;
  };
  status: ToolExecutionStatus;
  cwd: string;
  showImages?: boolean;
};

function normalizeSlashes(value: string): string {
  return value.replace(/\//g, "\\");
}

function formatLogPath(rawPath: string, cwd: string): string {
  const cwdPath = path.resolve(cwd);
  const resolved = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(cwdPath, rawPath);
  const relative = path.relative(cwdPath, resolved);
  if (!relative) return ".";
  if (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  ) {
    return normalizeSlashes(relative);
  }
  return normalizeSlashes(rawPath);
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function firstPathArg(
  args: Record<string, unknown> | undefined,
): string | undefined {
  return pickString(
    args?.path,
    args?.file_path,
    args?.cwd,
    args?.dir,
    args?.directory,
  );
}

function firstQueryArg(
  args: Record<string, unknown> | undefined,
): string | undefined {
  return pickString(
    args?.pattern,
    args?.query,
    Array.isArray(args?.queries) ? args?.queries[0] : undefined,
  );
}

function countOutputLines(
  result: CompactToolLogInput["result"],
  showImages: boolean,
): number {
  if (!result) return 0;
  return getTextOutput(result, showImages)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function readRangeSuffix(
  args: Record<string, unknown> | undefined,
  result: CompactToolLogInput["result"],
  showImages: boolean,
): string {
  const details = result?.details as
    { truncation?: { totalLines?: number; outputLines?: number } } | undefined;
  const total = details?.truncation?.totalLines;
  const offset = typeof args?.offset === "number" ? args.offset : 1;
  const lineCount = countOutputLines(result, showImages);
  if (total && lineCount > 0) {
    const end = offset + lineCount - 1;
    return ` (${offset}-${end} of ${total})`;
  }
  if (lineCount > 0 && typeof args?.limit === "number") {
    const end = offset + args.limit - 1;
    return ` (${offset}-${end})`;
  }
  if (lineCount > 0) {
    return ` (${lineCount} line${lineCount === 1 ? "" : "s"})`;
  }
  return "";
}

function matchCountSuffix(
  result: CompactToolLogInput["result"],
  showImages: boolean,
): string {
  const count = countOutputLines(result, showImages);
  if (!result) return "";
  return count === 0
    ? " (no matches)"
    : ` (${count} match${count === 1 ? "" : "es"})`;
}

function humanizeToolName(toolName: string): string {
  const cleanName = toolName.replace(/^default[-_]api:/i, "");
  return cleanName
    .split(/[-_:]/g)
    .filter(Boolean)
    .filter((part) => !["default", "api"].includes(part.toLowerCase()))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function activeSuffix(status: ToolExecutionStatus): string {
  return status === "queued" || status === "running" || status === "streaming"
    ? ".."
    : "";
}

export type CompactToolLogPresentation = {
	label: string;
	subject: string;
	meta: string;
};

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function presentationMeta(
	status: ToolExecutionStatus,
	doneMeta = "done",
	liveMeta?: string,
): string {
	if (status === "error") return "failed";
	if (status === "queued") return "waiting";
	if (status === "running") return liveMeta ? `${liveMeta} · working` : "working";
	if (status === "streaming") return liveMeta ? `${liveMeta} · live` : "live";
	return doneMeta;
}

/** Structured data for the terminal activity-row renderer. */
export function getCompactToolLogPresentation(input: CompactToolLogInput): CompactToolLogPresentation {
	const {
		toolName,
		args: rawArgs,
		result,
		status,
		cwd,
		showImages = true,
	} = input;
	const args = (rawArgs ?? {}) as Record<string, unknown>;
	const pathArg = firstPathArg(args);
	const queryArg = firstQueryArg(args);
	const commandArg = pickString(args?.command);
	const urlArg = pickString(args?.url, Array.isArray(args?.urls) ? args.urls[0] : undefined);
	const lineCount = countOutputLines(result, showImages);
	const lineMeta = lineCount > 0 ? countLabel(lineCount, "line") : undefined;

	if (toolName === "read") {
		const subject = pathArg ? formatLogPath(pathArg, cwd) : "file";
		const rangeMeta = readRangeSuffix(args, result, showImages)
			.trim()
			.replace(/^\((.*)\)$/, "$1");
		return {
			label: "READ",
			subject,
			meta: presentationMeta(status, rangeMeta || "done", rangeMeta || lineMeta),
		};
	}

	if (toolName === "grep") {
		const pattern = queryArg ?? "pattern";
		const scope = pathArg ? formatLogPath(pathArg, cwd) : ".";
		const matches = result
			? lineCount === 0
				? "no matches"
				: countLabel(lineCount, "match", "matches")
			: undefined;
		return {
			label: "SEARCH",
			subject: `“${pattern}” · ${scope}`,
			meta: presentationMeta(status, matches ?? "done", matches),
		};
	}

	if (toolName === "find") {
		const pattern = queryArg ?? "*";
		const scope = pathArg ? formatLogPath(pathArg, cwd) : ".";
		const files = result ? (lineCount === 0 ? "no files" : countLabel(lineCount, "file")) : undefined;
		return {
			label: "FIND",
			subject: `“${pattern}” · ${scope}`,
			meta: presentationMeta(status, files ?? "done", files),
		};
	}

	if (toolName === "ls") {
		const scope = pathArg ? formatLogPath(pathArg, cwd) : ".";
		const entries = result
			? lineCount === 0
				? "empty"
				: countLabel(lineCount, "entry", "entries")
			: undefined;
		return {
			label: "LIST",
			subject: scope,
			meta: presentationMeta(status, entries ?? "done", entries),
		};
	}

	if (toolName === "edit" || toolName === "write") {
		return {
			label: toolName.toUpperCase(),
			subject: pathArg ? formatLogPath(pathArg, cwd) : "file",
			meta: presentationMeta(status),
		};
	}

	if (toolName === "bash") {
		const command = commandArg?.replace(/\s+/g, " ").trim() || "shell command";
		const completed = result ? (lineCount === 0 ? "no output" : lineMeta ?? "done") : "done";
		return {
			label: "SHELL",
			subject: `$ ${command}`,
			meta: presentationMeta(status, completed, lineMeta),
		};
	}

	if (urlArg) {
		return {
			label: "FETCH",
			subject: urlArg,
			meta: presentationMeta(status, lineMeta ?? "done", lineMeta),
		};
	}

	const humanizedName = humanizeToolName(toolName) || "Tool";
	if (queryArg) {
		const scope = pathArg ? ` · ${formatLogPath(pathArg, cwd)}` : "";
		return {
			label: humanizedName.toUpperCase(),
			subject: `“${queryArg}”${scope}`,
			meta: presentationMeta(status, lineMeta ?? "done", lineMeta),
		};
	}
	if (commandArg) {
		return {
			label: humanizedName.toUpperCase(),
			subject: `$ ${commandArg.replace(/\s+/g, " ").trim()}`,
			meta: presentationMeta(status, lineMeta ?? "done", lineMeta),
		};
	}
	if (pathArg) {
		return {
			label: humanizedName.toUpperCase(),
			subject: formatLogPath(pathArg, cwd),
			meta: presentationMeta(status, lineMeta ?? "done", lineMeta),
		};
	}
	return {
		label: "TOOL",
		subject: humanizedName,
		meta: presentationMeta(status, lineMeta ?? "done", lineMeta),
	};
}

export function formatCompactToolLogLine(input: CompactToolLogInput): string {
  const {
    toolName,
    args: rawArgs,
    result,
    status,
    cwd,
    showImages = true,
  } = input;
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const pathArg = firstPathArg(args);
  const queryArg = firstQueryArg(args);
  const commandArg = pickString(args?.command);
  const urlArg = pickString(
    args?.url,
    Array.isArray(args?.urls) ? args?.urls[0] : undefined,
  );
  const suffix = activeSuffix(status);
  const isError = result?.isError ?? false;

  if (toolName === "read") {
    const target = pathArg ? formatLogPath(pathArg, cwd) : "file";
    if (isError) return `Read ${target} (failed)`;
    return `Read ${target}${readRangeSuffix(args, result, showImages)}${suffix}`;
  }

  if (toolName === "grep") {
    const pattern = queryArg ?? "";
    const scope = pathArg ? formatLogPath(pathArg, cwd) : ".";
    if (isError) return `Search "${pattern}" in ${scope} (failed)`;
    if (!result) return `Search "${pattern}" in ${scope}${suffix}`;
    return `Search "${pattern}" in ${scope}${matchCountSuffix(result, showImages)}${suffix}`;
  }

  if (toolName === "find") {
    const pattern = queryArg ?? "*";
    const scope = pathArg ? formatLogPath(pathArg, cwd) : ".";
    if (!result || isError) return `Find "${pattern}" in ${scope}${suffix}`;
    const count = countOutputLines(result, showImages);
    return `Find "${pattern}" in ${scope}${count === 0 ? " (no files)" : ` (${count} file${count === 1 ? "" : "s"})`}${suffix}`;
  }

  if (toolName === "ls") {
    const scope = pathArg ? formatLogPath(pathArg, cwd) : ".";
    if (!result || isError) return `List ${scope}${suffix}`;
    const count = countOutputLines(result, showImages);
    return `List ${scope}${count === 0 ? "" : ` (${count} entr${count === 1 ? "y" : "ies"})`}${suffix}`;
  }

  if (toolName === "edit") {
    const target = pathArg ? formatLogPath(pathArg, cwd) : "file";
    if (isError) return `Edit ${target} (failed)`;
    return `Edit ${target}${suffix}`;
  }

  if (toolName === "write") {
    const target = pathArg ? formatLogPath(pathArg, cwd) : "file";
    if (isError) return `Write ${target} (failed)`;
    return `Write ${target}${suffix}`;
  }

  if (toolName === "bash") {
    const command =
      commandArg && commandArg !== null
        ? commandArg.replace(/\s+/g, " ").trim()
        : "shell command";
    if (!result) return `$ ${command}${suffix}`;
    const lines = countOutputLines(result, showImages);
    if (isError) return `$ ${command} (failed)`;
    const summary =
      lines === 0
        ? "Completed with no output"
        : `Produced ${lines} line${lines === 1 ? "" : "s"} of output`;
    return `${summary} · $ ${command}${suffix}`;
  }

  if (urlArg && urlArg !== null) {
    return `Fetch ${urlArg}${suffix}`;
  }

  if (queryArg) {
    const scope = pathArg ? formatLogPath(pathArg, cwd) : undefined;
    const scopeText = scope ? ` in ${scope}` : "";
    if (!result)
      return `${humanizeToolName(toolName)} "${queryArg}"${scopeText}${suffix}`;
    const count = countOutputLines(result, showImages);
    return `${humanizeToolName(toolName)} "${queryArg}"${scopeText}${count === 0 ? " (no output)" : ` (${count} line${count === 1 ? "" : "s"})`}${suffix}`;
  }

  if (commandArg && commandArg !== null) {
    return `${humanizeToolName(toolName)} · $ ${commandArg.replace(/\s+/g, " ").trim()}${suffix}`;
  }

  if (pathArg) {
    const target = formatLogPath(pathArg, cwd);
    if (!result || isError)
      return `${humanizeToolName(toolName)} ${target}${suffix}`;
    const lines = countOutputLines(result, showImages);
    return `${humanizeToolName(toolName)} ${target}${lines === 0 ? "" : ` (${lines} line${lines === 1 ? "" : "s"})`}${suffix}`;
  }

  if (!result) {
    return `${humanizeToolName(toolName)}${suffix}`;
  }

  const lines = countOutputLines(result, showImages);
  if (isError) return `${humanizeToolName(toolName)} (failed)`;
  return `${humanizeToolName(toolName)}${lines === 0 ? "" : ` (${lines} line${lines === 1 ? "" : "s"})`}${suffix}`;
}
