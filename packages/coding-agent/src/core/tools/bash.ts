import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@mrquake/quakecode-agent-core";
import { Container, createSharedAnimationClock, Text, truncateToWidth } from "@mrquake/quakecode-tui";
import { type Static, Type } from "@sinclair/typebox";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.js";
import { truncateToVisualLines } from "../../modes/interactive/components/visual-truncate.js";
import { theme } from "../../modes/interactive/theme/theme.js";
import { getShellConfig, getShellEnv } from "../../utils/shell.js";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.js";
import { gateToolExecution } from "../guardian/tool-gate.js";
import { ensureAgentHttpProxy } from "../network-proxy/index.js";
import { ensureOsSandboxBackend } from "../sandbox/os-backend.js";
import { formatToolMeta, getTextOutput, invalidArgText, joinToolSections, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateTail } from "./truncate.js";

/**
 * Generate a unique temp file path for bash output.
 */
function getTempFilePath(): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `quake-code-bash-${id}.log`);
}

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, default: 120)" })),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
	/** Set when sandbox/execpolicy/guardian blocked the command */
	blocked?: boolean;
	reason?: string;
	decision?: string;
}

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (for example SSH).
 */
export interface BashOperations {
	/**
	 * Execute a command and stream output.
	 * @param command The command to execute
	 * @param cwd Working directory
	 * @param options Execution options
	 * @returns Promise resolving to exit code (null if killed)
	 */
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			env?: NodeJS.ProcessEnv;
		},
	) => Promise<{ exitCode: number | null }>;
}

/**
 * Create bash operations using Quake Code's built-in local shell execution backend.
 *
 * This is useful for extensions that intercept user_bash and still want Quake Code's
 * standard local shell behavior while wrapping or rewriting commands.
 */
export function createLocalBashOperations(): BashOperations {
	return {
		exec: async (command, cwd, { onData, signal, timeout, env }) => {
			if (!existsSync(cwd)) {
				throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
			}

			// Cooperative loopback proxy: start on first bash use when flag is on (T2.P2).
			// ensureAgentHttpProxy is a no-op (null) when the flag is off.
			try {
				await ensureAgentHttpProxy();
			} catch {
				// Bind failure — continue without proxy inject.
			}

			// Route all host spawns through the OS sandbox backend.
			// experimental: async resolve probes QUAKE_COMMAND_RUNNER (T1.P2); fail-closed if unavailable.
			const backend = await ensureOsSandboxBackend();
			const { shell, args } = getShellConfig();

			try {
				const result = await backend.execute({
					command: shell,
					args: [...args, command],
					cwd,
					// Re-read getShellEnv after ensure so HTTP_PROXY is injected when enabled.
					env: env ?? getShellEnv(),
					timeoutMs: timeout !== undefined && timeout > 0 ? timeout * 1000 : undefined,
					signal,
					onStdout: onData,
					onStderr: onData,
				});
				return { exitCode: result.exitCode };
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err));
				// Preserve bash timeout message format used by createBashTool: timeout:<seconds>
				if (error.message.startsWith("timeout:")) {
					throw new Error(`timeout:${timeout}`);
				}
				throw error;
			}
		},
	};
}

export interface BashSpawnContext {
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

function resolveSpawnContext(command: string, cwd: string, spawnHook?: BashSpawnHook): BashSpawnContext {
	const baseContext: BashSpawnContext = { command, cwd, env: { ...getShellEnv() } };
	return spawnHook ? spawnHook(baseContext) : baseContext;
}

export interface BashToolOptions {
	/** Custom operations for command execution. Default: local shell */
	operations?: BashOperations;
	/** Command prefix prepended to every command (for example shell setup commands) */
	commandPrefix?: string;
	/** Hook to adjust command, cwd, or env before execution */
	spawnHook?: BashSpawnHook;
}

const BASH_PREVIEW_LINES = 5;

type BashIntentKind =
	| "inspect"
	| "search"
	| "list"
	| "read"
	| "build"
	| "test"
	| "git"
	| "script"
	| "write"
	| "generic";

type BashIntent = {
	title: string;
	subtitle?: string;
	prefersHeadPreview?: boolean;
	kind: BashIntentKind;
};

function normalizeCommand(command: string): string {
	return command.replace(/^!!\s*/, "").trim();
}

function extractFirstPath(command: string): string | undefined {
	const match = command.match(/(?:^|\s)(\.?\/?[\w./-]+)(?=\s|$)/);
	const value = match?.[1]?.trim();
	if (!value || value === "." || value === "./") return undefined;
	if (
		/^(find|fd|rg|grep|ls|pwd|git|npm|pnpm|yarn|bun|node|python|python3|bash|sh|sed|cat|head|tail|awk|nl|wc)$/i.test(value)
	) {
		return undefined;
	}
	return value.replace(/^\.\//, "");
}

function extractQuotedValue(command: string): string | undefined {
	const match = command.match(/(["'])(.*?)\1/);
	return match?.[2]?.trim() || undefined;
}

function inferBashIntent(command: string): BashIntent {
	const normalized = normalizeCommand(command);
	const lower = normalized.toLowerCase();
	const firstPath = extractFirstPath(normalized);
	const quoted = extractQuotedValue(normalized);

	if (/\b(pwd|ls|dir|tree)\b/.test(lower) || (lower.includes("find ") && lower.includes("-type d"))) {
		return {
			title: "Inspecting workspace structure",
			subtitle: firstPath ? `Scanning folders under ${firstPath}` : "Scanning folders and top-level project layout",
			prefersHeadPreview: true,
			kind: "inspect",
		};
	}
	if (
		/(^|\s)find\s/.test(lower) ||
		lower.includes("rg --files") ||
		/(^|\s)fd\s/.test(lower) ||
		lower.includes("-type f")
	) {
		return {
			title: firstPath ? `Scanning files under ${firstPath}` : "Scanning workspace files",
			subtitle: "Listing candidate files before narrowing scope",
			prefersHeadPreview: true,
			kind: "list",
		};
	}
	if (/\b(rg|grep|ag)\b/.test(lower)) {
		return {
			title: quoted ? `Searching for “${quoted}”` : "Searching workspace",
			subtitle: firstPath ? `Looking through ${firstPath}` : "Looking for matching content",
			prefersHeadPreview: true,
			kind: "search",
		};
	}
	if (/\b(cat|sed|head|tail|awk|nl|wc)\b/.test(lower)) {
		return {
			title: firstPath ? `Reading ${firstPath}` : "Reading file contents",
			subtitle: "Pulling in source details for the next step",
			prefersHeadPreview: true,
			kind: "read",
		};
	}
	if (/\bgit\s+(status|diff|log|show|branch)\b/.test(lower)) {
		return {
			title: "Checking git state",
			subtitle: "Reviewing repository history or changes",
			prefersHeadPreview: true,
			kind: "git",
		};
	}
	if (/\b(npm|pnpm|yarn|bun)\b.*\bbuild\b/.test(lower)) {
		return { title: "Running build", subtitle: "Validating the project compiles cleanly", kind: "build" };
	}
	if (/\b(npm|pnpm|yarn|bun)\b.*\b(test|vitest|jest)\b/.test(lower)) {
		return { title: "Running tests", subtitle: "Checking behavior against the test suite", kind: "test" };
	}
	if (/\b(node|python|python3|bash|sh|pwsh|powershell)\b/.test(lower)) {
		return {
			title: "Running script",
			subtitle: firstPath ? `Executing ${firstPath}` : "Executing a helper command",
			kind: "script",
		};
	}
	if (/\b(mkdir|cp|mv|rm|touch)\b/.test(lower)) {
		return { title: "Updating filesystem", subtitle: "Applying file or directory changes", kind: "write" };
	}
	return { title: "Running shell command", subtitle: normalized, kind: "generic" };
}

type BashRenderState = {
	startedAt: number | undefined;
	endedAt: number | undefined;
	stopAnimation: (() => void) | undefined;
};

type BashResultRenderState = {
	cachedWidth: number | undefined;
	cachedLines: string[] | undefined;
	cachedSkipped: number | undefined;
};

const bashRenderClock = createSharedAnimationClock(180);

class BashResultRenderComponent extends Container {
	state: BashResultRenderState = {
		cachedWidth: undefined,
		cachedLines: undefined,
		cachedSkipped: undefined,
	};
}

function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

function formatBashCall(
	args: { command?: string; timeout?: number } | undefined,
	status: "queued" | "running" | "streaming" | "done" | "error",
	expanded: boolean,
): string {
	const command = str(args?.command);
	const timeout = args?.timeout as number | undefined;
	if (command === null) {
		return joinToolSections(
			theme.fg("muted", "Running shell command"),
			formatToolMeta(theme, "bash", status),
			invalidArgText(theme),
		);
	}
	const intent = inferBashIntent(command || "");
	const subtitle = [intent.subtitle, timeout ? `Timeout ${timeout}s` : undefined].filter(Boolean).join(" · ");
	const commandPreview = (() => {
		if (!command) return undefined;
		if (expanded) {
			return `${theme.fg("dim", "Command")}\n${theme.fg("bashMode", `$ ${command}`)}`;
		}
		const lines = command.split("\n");
		const previewLines = lines.slice(0, 5).map((line) => theme.fg("bashMode", `$ ${line}`));
		if (lines.length > 5) {
			previewLines.push(
				theme.fg(
					"dim",
					`… ${lines.length - 5} more line${lines.length - 5 === 1 ? "" : "s"} · ${keyHint("app.tools.expand", "expand")}`,
				),
			);
		}
		return previewLines.join("\n");
	})();

	return joinToolSections(
		theme.fg("muted", intent.title),
		formatToolMeta(theme, "bash", status),
		subtitle ? theme.fg("muted", subtitle) : undefined,
		commandPreview,
	);
}

function rebuildBashResultRenderComponent(
	component: BashResultRenderComponent,
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: BashToolDetails;
	},
	options: ToolRenderResultOptions,
	showImages: boolean,
	startedAt: number | undefined,
	endedAt: number | undefined,
	command: string | undefined,
	status: "queued" | "running" | "streaming" | "done" | "error",
): void {
	const state = component.state;
	component.clear();

	const output = getTextOutput(result as any, showImages).trim();
	const intent = inferBashIntent(command || "");
	const outputLines = output
		? output
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
		: [];
	const summary =
		status === "error"
			? theme.fg("error", "Command failed")
			: status === "streaming"
				? theme.fg(
						"muted",
						outputLines.length === 0
							? "Waiting for first output"
							: `Streaming ${outputLines.length} line${outputLines.length === 1 ? "" : "s"} of output`,
					)
				: theme.fg(
						"muted",
						outputLines.length === 0
							? "Completed with no output"
							: intent.kind === "search"
								? `Found ${outputLines.length} matching line${outputLines.length === 1 ? "" : "s"}`
								: intent.kind === "list" || intent.kind === "inspect"
									? `Collected ${outputLines.length} path${outputLines.length === 1 ? "" : "s"}`
									: `Produced ${outputLines.length} line${outputLines.length === 1 ? "" : "s"} of output`,
					);
	const commandSummary = command ? truncateToWidth(command.replace(/\s+/g, " "), 92, "...") : undefined;
	component.addChild(
		new Text(
			commandSummary ? `${summary}${theme.fg("dim", " · ")}${theme.fg("bashMode", `$ ${commandSummary}`)}` : summary,
			0,
			0,
		),
	);

	if (output) {
		const styledOutput = output
			.split("\n")
			.map((line) => theme.fg("toolOutput", line))
			.join("\n");

		if (!options.expanded && status !== "error") {
			component.addChild(
				new Text(`\n${theme.fg("dim", `output hidden · ${keyHint("app.tools.expand", "expand")}`)}`, 0, 0),
			);
		} else if (options.expanded) {
			component.addChild(new Text(`\n${styledOutput}`, 0, 0));
		} else {
			component.addChild({
				render: (width: number) => {
					if (state.cachedLines === undefined || state.cachedWidth !== width) {
						const preview = truncateToVisualLines(styledOutput, BASH_PREVIEW_LINES, width);
						state.cachedLines = preview.visualLines;
						state.cachedSkipped = preview.skippedCount;
						state.cachedWidth = width;
					}
					if (state.cachedSkipped && state.cachedSkipped > 0) {
						const hint =
							theme.fg("muted", `... (${state.cachedSkipped} earlier lines,`) +
							` ${keyHint("app.tools.expand", "to expand")})`;
						return ["", truncateToWidth(hint, width, "..."), ...(state.cachedLines ?? [])];
					}
					return ["", ...(state.cachedLines ?? [])];
				},
				invalidate: () => {
					state.cachedWidth = undefined;
					state.cachedLines = undefined;
					state.cachedSkipped = undefined;
				},
			});
		}
	}

	const truncation = result.details?.truncation;
	const fullOutputPath = result.details?.fullOutputPath;
	if (truncation?.truncated || fullOutputPath) {
		const warnings: string[] = [];
		if (fullOutputPath) {
			warnings.push(`Full output: ${fullOutputPath}`);
		}
		if (truncation?.truncated) {
			if (truncation.truncatedBy === "lines") {
				warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
			} else {
				warnings.push(
					`Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
				);
			}
		}
		component.addChild(new Text(`\n${theme.fg("warning", `[${warnings.join(". ")}]`)}`, 0, 0));
	}

	if (startedAt !== undefined) {
		const label = options.isPartial ? "Elapsed" : "Took";
		const endTime = endedAt ?? Date.now();
		component.addChild(new Text(`\n${theme.fg("muted", `${label} ${formatDuration(endTime - startedAt)}`)}`, 0, 0));
	}
}

export function createBashToolDefinition(
	cwd: string,
	options?: BashToolOptions,
): ToolDefinition<typeof bashSchema, BashToolDetails | undefined, BashRenderState> {
	const ops = options?.operations ?? createLocalBashOperations();
	const commandPrefix = options?.commandPrefix;
	const spawnHook = options?.spawnHook;
	return {
		name: "bash",
		label: "bash",
		description: `Execute a bash command in the current working directory. Use shell commands for Codex-style text inspection and repository exploration. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
		promptSnippet: "Execute commands and inspect text files (cat, sed, rg, nl, etc.)",
		promptGuidelines: [
			"For text file inspection, use bash commands such as cat, sed, nl, head, tail, rg, wc, and git show; use targeted ranges instead of dumping very large files.",
			"When searching for text or files, prefer rg or rg --files because they are faster than grep and find when available.",
			"Run independent read-only shell commands as separate parallel tool calls instead of joining them with command separators.",
			"Do not use Python to read or write files when a shell command or the edit/write tools suffice.",
			"Do not use bash, curl, wget, or ad-hoc scraping for general web lookup when web_search is available.",
			"If the user says not to open a browser, do not use browser tools as a substitute for web_search.",
		],
		parameters: bashSchema,
		async execute(
			_toolCallId,
			{ command, timeout = DEFAULT_BASH_TIMEOUT }: { command: string; timeout?: number },
			signal?: AbortSignal,
			onUpdate?,
			_ctx?,
		) {
			const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
			// Codex approval presets + execpolicy + sandbox (shared gate)
			const gate = await gateToolExecution({
				tool: "bash",
				summary: resolvedCommand.slice(0, 400),
				cwd,
				command: resolvedCommand,
				details: { command: resolvedCommand },
			});
			if (!gate.allow) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Command denied (${gate.decision}): ${gate.reason}`,
						},
					],
					details: {
						blocked: true,
						reason: gate.reason,
						decision: gate.decision,
					},
				};
			}
			// Ensure cooperative proxy is up before building spawn env (flag-gated, no-op when off).
			await ensureAgentHttpProxy();
			const spawnContext = resolveSpawnContext(resolvedCommand, cwd, spawnHook);
			if (onUpdate) {
				onUpdate({ content: [], details: undefined });
			}
			return new Promise((resolve, reject) => {
				let tempFilePath: string | undefined;
				let tempFileStream: ReturnType<typeof createWriteStream> | undefined;
				let totalBytes = 0;
				const chunks: Buffer[] = [];
				let chunksBytes = 0;
				const maxChunksBytes = DEFAULT_MAX_BYTES * 2;

				const handleData = (data: Buffer) => {
					totalBytes += data.length;
					// Start writing to a temp file once output exceeds the in-memory threshold.
					if (totalBytes > DEFAULT_MAX_BYTES && !tempFilePath) {
						tempFilePath = getTempFilePath();
						tempFileStream = createWriteStream(tempFilePath);
						// Write all buffered chunks to the file.
						for (const chunk of chunks) tempFileStream.write(chunk);
					}
					// Write to temp file if we have one.
					if (tempFileStream) tempFileStream.write(data);
					// Keep a rolling buffer of recent output for tail truncation.
					chunks.push(data);
					chunksBytes += data.length;
					// Trim old chunks if the rolling buffer grows too large.
					while (chunksBytes > maxChunksBytes && chunks.length > 1) {
						const removed = chunks.shift()!;
						chunksBytes -= removed.length;
					}
					// Stream partial output using the rolling tail buffer.
					if (onUpdate) {
						const fullBuffer = Buffer.concat(chunks);
						const fullText = fullBuffer.toString("utf-8");
						const truncation = truncateTail(fullText);
						onUpdate({
							content: [{ type: "text", text: truncation.content || "" }],
							details: {
								truncation: truncation.truncated ? truncation : undefined,
								fullOutputPath: tempFilePath,
							},
						});
					}
				};

				ops.exec(spawnContext.command, spawnContext.cwd, {
					onData: handleData,
					signal,
					timeout,
					env: spawnContext.env,
				})
					.then(({ exitCode }) => {
						// Close temp file stream before building the final result.
						if (tempFileStream) tempFileStream.end();
						// Combine the rolling buffer chunks.
						const fullBuffer = Buffer.concat(chunks);
						const fullOutput = fullBuffer.toString("utf-8");
						// Apply tail truncation for the final display payload.
						const truncation = truncateTail(fullOutput);
						let outputText = truncation.content || "(no output)";
						let details: BashToolDetails | undefined;
						if (truncation.truncated) {
							// Build truncation details and an actionable notice.
							details = { truncation, fullOutputPath: tempFilePath };
							const startLine = truncation.totalLines - truncation.outputLines + 1;
							const endLine = truncation.totalLines;
							if (truncation.lastLinePartial) {
								// Edge case: the last line alone is larger than the byte limit.
								const lastLineSize = formatSize(Buffer.byteLength(fullOutput.split("\n").pop() || "", "utf-8"));
								outputText += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${tempFilePath}]`;
							} else if (truncation.truncatedBy === "lines") {
								outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${tempFilePath}]`;
							} else {
								outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${tempFilePath}]`;
							}
						}
						if (exitCode !== 0 && exitCode !== null) {
							outputText += `\n\nCommand exited with code ${exitCode}`;
							reject(new Error(outputText));
						} else {
							resolve({ content: [{ type: "text", text: outputText }], details });
						}
					})
					.catch((err: Error) => {
						// Close temp file stream and include buffered output in the error message.
						if (tempFileStream) tempFileStream.end();
						const fullBuffer = Buffer.concat(chunks);
						let output = fullBuffer.toString("utf-8");
						if (err.message === "aborted") {
							if (output) output += "\n\n";
							output += "Command aborted";
							reject(new Error(output));
						} else if (err.message.startsWith("timeout:")) {
							const timeoutSecs = err.message.split(":")[1];
							if (output) output += "\n\n";
							output += `Command timed out after ${timeoutSecs} seconds`;
							reject(new Error(output));
						} else {
							reject(err);
						}
					});
			});
		},
		renderCall(args, _theme, context) {
			const state = context.state;
			if (context.executionStarted && state.startedAt === undefined) {
				state.startedAt = Date.now();
				state.endedAt = undefined;
			}
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const status: "queued" | "running" | "streaming" | "done" | "error" = !context.executionStarted
				? "queued"
				: context.isError
					? "error"
					: context.isPartial
						? "streaming"
						: "done";
			text.setText(formatBashCall(args, status, context.expanded));
			return text;
		},
		renderResult(result, options, _theme, context) {
			const state = context.state;
			if (state.startedAt !== undefined && options.isPartial && !state.stopAnimation) {
				state.stopAnimation = bashRenderClock.subscribe(() => context.invalidate());
			}
			if (!options.isPartial || context.isError) {
				state.endedAt ??= Date.now();
				state.stopAnimation?.();
				state.stopAnimation = undefined;
			}
			const component =
				(context.lastComponent as BashResultRenderComponent | undefined) ?? new BashResultRenderComponent();
			const status: "queued" | "running" | "streaming" | "done" | "error" = context.isError
				? "error"
				: options.isPartial
					? "streaming"
					: "done";
			rebuildBashResultRenderComponent(
				component,
				result as any,
				options,
				context.showImages,
				state.startedAt,
				state.endedAt,
				str(context.args?.command) ?? undefined,
				status,
			);
			component.invalidate();
			return component;
		},
	};
}

export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema> {
	return wrapToolDefinition(createBashToolDefinition(cwd, options));
}

/** Default bash tool using process.cwd() for backwards compatibility. */
export const bashToolDefinition = createBashToolDefinition(process.cwd());
export const bashTool = createBashTool(process.cwd());
export const DEFAULT_BASH_TIMEOUT = 120;
