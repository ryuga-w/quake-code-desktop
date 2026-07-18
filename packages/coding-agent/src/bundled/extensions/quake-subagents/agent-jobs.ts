/** Codex-compatible CSV fan-out agent jobs. */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mrquake/quakecode-cli";
import { Type } from "@sinclair/typebox";
import AjvModule from "ajv";
import type { AgentManager } from "./agent-manager.js";
import type { SubagentRuntimeScope } from "./runtime-scope.js";

const Ajv = (AjvModule as any).default || AjvModule;
const DEFAULT_CONCURRENCY = 16;
const DEFAULT_RUNTIME_SECONDS = 1_800;

interface CsvRow {
	values: string[];
	object: Record<string, string>;
	rowIndex: number;
	itemId: string;
	sourceId?: string;
}

interface JobItemResult {
	row: CsvRow;
	status: "completed" | "failed" | "cancelled";
	result?: Record<string, unknown>;
	error?: string;
	reportedAt?: string;
	completedAt: string;
}

function textResult(value: unknown, details?: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: details as any };
}

function parseCsv(content: string): { headers: string[]; rows: string[][] } {
	const records: string[][] = [];
	let record: string[] = [];
	let field = "";
	let quoted = false;

	for (let index = 0; index < content.length; index += 1) {
		const character = content[index]!;
		if (quoted) {
			if (character === '"') {
				if (content[index + 1] === '"') {
					field += '"';
					index += 1;
				} else {
					quoted = false;
				}
			} else {
				field += character;
			}
			continue;
		}

		if (character === '"' && field.length === 0) {
			quoted = true;
		} else if (character === ",") {
			record.push(field);
			field = "";
		} else if (character === "\n") {
			record.push(field.endsWith("\r") ? field.slice(0, -1) : field);
			if (record.some((value) => value.length > 0)) records.push(record);
			record = [];
			field = "";
		} else {
			field += character;
		}
	}
	if (quoted) throw new Error("CSV input contains an unterminated quoted field");
	if (field.length > 0 || record.length > 0) {
		record.push(field.endsWith("\r") ? field.slice(0, -1) : field);
		if (record.some((value) => value.length > 0)) records.push(record);
	}
	if (records.length === 0) throw new Error("CSV input must include a header row");

	const headers = records.shift()!;
	if (headers[0]) headers[0] = headers[0].replace(/^\uFEFF/, "");
	const unique = new Set(headers);
	if (unique.size !== headers.length) throw new Error("CSV headers must be unique");
	if (headers.some((header) => !header)) throw new Error("CSV headers must be non-empty");
	for (let index = 0; index < records.length; index += 1) {
		if (records[index]!.length !== headers.length) {
			throw new Error(`CSV row ${index + 2} has ${records[index]!.length} fields but header has ${headers.length}`);
		}
	}
	return { headers, rows: records };
}

function csvEscape(value: string): string {
	if (!/[",\r\n]/.test(value)) return value;
	return `"${value.replace(/"/g, '""')}"`;
}

function renderInstruction(template: string, row: Record<string, string>): string {
	const openSentinel = "__QUAKE_OPEN_BRACE__";
	const closeSentinel = "__QUAKE_CLOSE_BRACE__";
	let rendered = template.replace(/\{\{/g, openSentinel).replace(/\}\}/g, closeSentinel);
	for (const [key, value] of Object.entries(row)) rendered = rendered.replaceAll(`{${key}}`, value);
	return rendered.replaceAll(openSentinel, "{").replaceAll(closeSentinel, "}");
}

function defaultOutputPath(inputPath: string, jobId: string): string {
	const extension = extname(inputPath);
	const stem = extension ? inputPath.slice(0, -extension.length) : inputPath;
	return `${stem}.agent-job-${jobId.slice(0, 8)}.csv`;
}

function renderOutputCsv(headers: string[], jobId: string, results: JobItemResult[]): string {
	const outputHeaders = [
		...headers,
		"job_id",
		"item_id",
		"row_index",
		"source_id",
		"status",
		"attempt_count",
		"last_error",
		"result_json",
		"reported_at",
		"completed_at",
	];
	const lines = [outputHeaders.map(csvEscape).join(",")];
	for (const item of results) {
		const values = [
			...item.row.values,
			jobId,
			item.row.itemId,
			String(item.row.rowIndex),
			item.row.sourceId ?? "",
			item.status,
			"1",
			item.error ?? "",
			item.result ? JSON.stringify(item.result) : "",
			item.reportedAt ?? "",
			item.completedAt,
		];
		lines.push(values.map(csvEscape).join(","));
	}
	return `${lines.join("\n")}\n`;
}

function writeAtomic(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporaryPath, content, "utf8");
	renameSync(temporaryPath, path);
}

async function runWithConcurrency<T>(
	items: T[],
	limit: number,
	worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
	let nextIndex = 0;
	const runners = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
		while (true) {
			const index = nextIndex;
			nextIndex += 1;
			if (index >= items.length) return;
			await worker(items[index]!, index);
		}
	});
	await Promise.all(runners);
}

function workerPrompt(
	jobId: string,
	row: CsvRow,
	instruction: string,
	outputSchema: Record<string, unknown> | undefined,
): string {
	return `You are processing one item for a generic agent job.
Job ID: ${jobId}
Item ID: ${row.itemId}

Task instruction:
${renderInstruction(instruction, row.object)}

Input row (JSON):
${JSON.stringify(row.object, null, 2)}

Expected result schema (JSON Schema or {}):
${JSON.stringify(outputSchema ?? {}, null, 2)}

You MUST call the \`report_agent_job_result\` tool exactly once with:
1. \`job_id\` = "${jobId}"
2. \`item_id\` = "${row.itemId}"
3. \`result\` = a JSON object containing your result for this row.

If the remaining job should stop early, include \`stop\` = true.
After the tool call succeeds, stop.`;
}

export interface RegisterAgentJobToolsOptions {
	manager: AgentManager;
	runtimeScope?: SubagentRuntimeScope;
}

export function registerAgentJobTools(quake: ExtensionAPI, options: RegisterAgentJobToolsOptions): void {
	const { manager, runtimeScope } = options;

	quake.registerTool({
		name: "report_agent_job_result",
		label: "report_agent_job_result",
		description: "Worker-only tool to report the structured result for one spawn_agents_on_csv item.",
		promptSnippet: "Report a CSV agent-job worker result",
		parameters: Type.Object(
			{
				job_id: Type.String(),
				item_id: Type.String(),
				result: Type.Record(Type.String(), Type.Unknown()),
				stop: Type.Optional(Type.Boolean()),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params) {
			const job = runtimeScope?.job;
			if (!job) throw new Error("report_agent_job_result may only be called by an agent-job worker");
			if (params.job_id !== job.jobId || params.item_id !== job.itemId) {
				throw new Error(`Worker identity mismatch: expected ${job.jobId}/${job.itemId}`);
			}
			const accepted = job.report(params.result, params.stop ?? false);
			return textResult({ accepted });
		},
	});

	quake.registerTool({
		name: "spawn_agents_on_csv",
		label: "spawn_agents_on_csv",
		description:
			"Process a CSV by spawning one worker sub-agent per row. Every worker must report a JSON object; the call blocks and exports a result CSV.",
		promptSnippet: "Fan out CSV rows across sub-agents",
		parameters: Type.Object(
			{
				csv_path: Type.String({ description: "Input CSV path relative to the working directory." }),
				instruction: Type.String({ description: "Task template; {column_name} inserts values from each row." }),
				id_column: Type.Optional(Type.String()),
				output_csv_path: Type.Optional(Type.String()),
				max_concurrency: Type.Optional(Type.Integer({ minimum: 1 })),
				max_workers: Type.Optional(Type.Integer({ minimum: 1 })),
				max_runtime_seconds: Type.Optional(Type.Integer({ minimum: 1 })),
				output_schema: Type.Optional(Type.Object({}, { additionalProperties: true })),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
			const params = rawParams as {
				csv_path: string;
				instruction: string;
				id_column?: string;
				output_csv_path?: string;
				max_concurrency?: number;
				max_workers?: number;
				max_runtime_seconds?: number;
				output_schema?: Record<string, unknown>;
			};
			if (!params.instruction.trim()) throw new Error("instruction must be non-empty");
			const inputPath = resolve(ctx.cwd, params.csv_path);
			const parsed = parseCsv(readFileSync(inputPath, "utf8"));
			const idColumnIndex = params.id_column ? parsed.headers.indexOf(params.id_column) : -1;
			if (params.id_column && idColumnIndex < 0) throw new Error(`id_column not found: ${params.id_column}`);

			const seenIds = new Set<string>();
			const rows: CsvRow[] = parsed.rows.map((values, index) => {
				const object = Object.fromEntries(parsed.headers.map((header, column) => [header, values[column] ?? ""]));
				const sourceId = idColumnIndex >= 0 && values[idColumnIndex]?.trim() ? values[idColumnIndex]!.trim() : undefined;
				const baseId = sourceId ?? `row-${index + 1}`;
				let itemId = baseId;
				let suffix = 2;
				while (seenIds.has(itemId)) {
					itemId = `${baseId}-${suffix}`;
					suffix += 1;
				}
				seenIds.add(itemId);
				return { values, object, rowIndex: index, itemId, sourceId };
			});

			const jobId = randomUUID();
			const outputPath = params.output_csv_path
				? resolve(ctx.cwd, params.output_csv_path)
				: defaultOutputPath(inputPath, jobId);
			const requestedConcurrency = params.max_concurrency ?? params.max_workers ?? DEFAULT_CONCURRENCY;
			const concurrency = Math.max(1, Math.min(requestedConcurrency, manager.getMaxConcurrent()));
			const runtimeSeconds = params.max_runtime_seconds ?? DEFAULT_RUNTIME_SECONDS;
			const results: JobItemResult[] = new Array(rows.length);
			const jobController = new AbortController();
			let stopRequested = false;
			const abortFromParent = () => jobController.abort(signal?.reason);
			if (signal?.aborted) abortFromParent();
			else signal?.addEventListener("abort", abortFromParent, { once: true });

			let validateResult: ((value: unknown) => boolean) | undefined;
			if (params.output_schema) {
				const ajv = new Ajv({ strict: false, allErrors: true });
				validateResult = ajv.compile(params.output_schema);
			}

			const parentId = runtimeScope?.currentAgentId;
			const parentType = parentId ? manager.getRecord(parentId)?.type : undefined;
			try {
				await runWithConcurrency(rows, concurrency, async (row, index) => {
					if (stopRequested || jobController.signal.aborted) {
						results[index] = { row, status: "cancelled", error: "cancelled before worker start", completedAt: new Date().toISOString() };
						return;
					}

					let report: Record<string, unknown> | undefined;
					let reportedAt: string | undefined;
					const workerController = new AbortController();
					const abortWorker = () => workerController.abort(jobController.signal.reason);
					jobController.signal.addEventListener("abort", abortWorker, { once: true });
					const timeout = setTimeout(
						() => workerController.abort(new Error(`worker exceeded ${runtimeSeconds} seconds`)),
						runtimeSeconds * 1_000,
					);
					const runtimeJob = {
						jobId,
						itemId: row.itemId,
						report(result: Record<string, unknown>, stop: boolean): boolean {
							if (report) return false;
							if (validateResult && !validateResult(result)) {
								const errors = (validateResult as any).errors;
								throw new Error(`result does not match output_schema: ${JSON.stringify(errors ?? [])}`);
							}
							report = result;
							reportedAt = new Date().toISOString();
							if (stop) {
								stopRequested = true;
								jobController.abort(new Error("cancelled by worker request"));
							}
							return true;
						},
					};

					try {
						const record = await manager.spawnAndWait(
							quake,
							ctx as ExtensionContext,
							parentType ?? "general-purpose",
							workerPrompt(jobId, row, params.instruction, params.output_schema),
							{
								name: `job_${jobId.slice(0, 8)}_${index + 1}`,
								taskName: `job_${jobId.slice(0, 8)}_${index + 1}`.replace(/-/g, "_"),
								description: `CSV worker ${row.itemId}`,
								parentId,
								runtimeJob,
								inheritContext: false,
								signal: workerController.signal,
							},
						);
						const completedAt = new Date().toISOString();
						if (report) {
							results[index] = { row, status: "completed", result: report, reportedAt, completedAt };
						} else {
							results[index] = {
								row,
								status: stopRequested ? "cancelled" : "failed",
								error: record.error ?? "worker finished without calling report_agent_job_result",
								completedAt,
							};
						}
					} catch (error) {
						results[index] = {
							row,
							status: stopRequested ? "cancelled" : "failed",
							error: error instanceof Error ? error.message : String(error),
							completedAt: new Date().toISOString(),
						};
					} finally {
						clearTimeout(timeout);
						jobController.signal.removeEventListener("abort", abortWorker);
					}
				});
			} finally {
				signal?.removeEventListener("abort", abortFromParent);
			}

			for (let index = 0; index < rows.length; index += 1) {
				results[index] ??= {
					row: rows[index]!,
					status: "cancelled",
					error: "cancelled",
					completedAt: new Date().toISOString(),
				};
			}
			writeAtomic(outputPath, renderOutputCsv(parsed.headers, jobId, results));
			const completedItems = results.filter((item) => item.status === "completed").length;
			const failedItems = results.filter((item) => item.status === "failed").length;
			const cancelledItems = results.filter((item) => item.status === "cancelled").length;
			const status = stopRequested || cancelledItems > 0 ? "cancelled" : failedItems > 0 ? "failed" : "completed";
			const failedItemErrors = results
				.filter((item) => item.status === "failed")
				.slice(0, 5)
				.map((item) => ({ item_id: item.row.itemId, source_id: item.row.sourceId, last_error: item.error }));
			const response = {
				job_id: jobId,
				status,
				output_csv_path: outputPath,
				total_items: rows.length,
				completed_items: completedItems,
				failed_items: failedItems,
				cancelled_items: cancelledItems,
				failed_item_errors: failedItemErrors.length > 0 ? failedItemErrors : undefined,
			};
			return textResult(response, response);
		},
	});
}
