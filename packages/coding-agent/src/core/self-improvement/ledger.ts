import fs from "node:fs";
import path from "node:path";
import type {
	BenchmarkResult,
	CreateImprovementTaskInput,
	ImprovementAttempt,
	ImprovementTask,
	RecordBenchmarkResultInput,
	SelfImprovementLedgerEntry,
	SelfImprovementState,
} from "./types.js";

function nowIso(): string {
	return new Date().toISOString();
}

function createId(prefix: string): string {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class SelfImprovementLedger {
	readonly ledgerPath: string;

	constructor(ledgerPath: string) {
		this.ledgerPath = ledgerPath;
	}

	ensureReady(): void {
		fs.mkdirSync(path.dirname(this.ledgerPath), { recursive: true });
		if (!fs.existsSync(this.ledgerPath)) {
			fs.writeFileSync(this.ledgerPath, "", "utf8");
		}
	}

	appendEntry(entry: SelfImprovementLedgerEntry): void {
		this.ensureReady();
		fs.appendFileSync(this.ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
	}

	readEntries(): SelfImprovementLedgerEntry[] {
		this.ensureReady();
		const content = fs.readFileSync(this.ledgerPath, "utf8");
		return content
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => JSON.parse(line) as SelfImprovementLedgerEntry);
	}

	replay(): SelfImprovementState {
		const tasks = new Map<string, ImprovementTask>();
		const attempts = new Map<string, ImprovementAttempt>();
		const benchmarkResults: BenchmarkResult[] = [];
		const notes: SelfImprovementState["notes"] = [];

		for (const entry of this.readEntries()) {
			if (entry.type === "task_created") {
				tasks.set(entry.task.id, entry.task);
				continue;
			}
			if (entry.type === "task_updated") {
				const previous = tasks.get(entry.taskId);
				if (!previous) continue;
				tasks.set(entry.taskId, {
					...previous,
					...entry.patch,
					id: previous.id,
					updatedAt: entry.patch.updatedAt || entry.timestamp,
				});
				continue;
			}
			if (entry.type === "attempt_started") {
				attempts.set(entry.attempt.id, entry.attempt);
				continue;
			}
			if (entry.type === "attempt_finished") {
				const previous = attempts.get(entry.attemptId);
				if (!previous) continue;
				attempts.set(entry.attemptId, {
					...previous,
					...entry.patch,
					id: previous.id,
					taskId: previous.taskId,
				});
				continue;
			}
			if (entry.type === "benchmark_result") {
				benchmarkResults.push(entry.result);
				continue;
			}
			notes.push(entry);
		}

		return {
			tasks: Array.from(tasks.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
			attempts: Array.from(attempts.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
			benchmarkResults,
			notes,
		};
	}

	createTask(input: CreateImprovementTaskInput): ImprovementTask {
		const timestamp = nowIso();
		const task: ImprovementTask = {
			id: createId("task"),
			title: input.title,
			goal: input.goal,
			kind: input.kind,
			status: "queued",
			priority: input.priority ?? 50,
			createdAt: timestamp,
			updatedAt: timestamp,
			tags: input.tags,
			contextPaths: input.contextPaths,
			acceptanceCriteria: input.acceptanceCriteria,
			budget: input.budget,
			owner: input.owner,
		};
		this.appendEntry({ type: "task_created", timestamp, task });
		return task;
	}

	updateTask(taskId: string, patch: Partial<ImprovementTask>): void {
		this.appendEntry({
			type: "task_updated",
			timestamp: nowIso(),
			taskId,
			patch: { ...patch, updatedAt: nowIso() },
		});
	}

	startAttempt(
		taskId: string,
		input: Omit<ImprovementAttempt, "id" | "taskId" | "startedAt" | "status"> & {
			status?: ImprovementAttempt["status"];
		},
	): ImprovementAttempt {
		const attempt: ImprovementAttempt = {
			id: createId("attempt"),
			taskId,
			startedAt: nowIso(),
			status: input.status ?? "running",
			provider: input.provider,
			model: input.model,
			sessionId: input.sessionId,
			branchName: input.branchName,
			notes: input.notes,
			metrics: input.metrics,
		};
		this.appendEntry({ type: "attempt_started", timestamp: attempt.startedAt, attempt });
		this.updateTask(taskId, { status: "running", lastAttemptId: attempt.id });
		return attempt;
	}

	finishAttempt(
		attemptId: string,
		taskId: string,
		patch: Partial<ImprovementAttempt> & { status: ImprovementAttempt["status"] },
	): void {
		const timestamp = nowIso();
		this.appendEntry({
			type: "attempt_finished",
			timestamp,
			attemptId,
			taskId,
			patch: {
				...patch,
				endedAt: patch.endedAt ?? timestamp,
			},
		});
		const taskStatus =
			patch.status === "completed" ? "completed" : patch.status === "cancelled" ? "cancelled" : "failed";
		this.updateTask(taskId, { status: taskStatus });
	}

	recordBenchmarkResult(input: RecordBenchmarkResultInput): BenchmarkResult {
		const result: BenchmarkResult = {
			id: createId("benchmark"),
			taskId: input.taskId,
			attemptId: input.attemptId,
			createdAt: nowIso(),
			suite: input.suite,
			target: input.target,
			verdict: input.verdict,
			score: input.score,
			latencyMs: input.latencyMs,
			retries: input.retries,
			provider: input.provider,
			model: input.model,
			evidence: input.evidence,
			metrics: input.metrics,
			notes: input.notes,
		};
		this.appendEntry({ type: "benchmark_result", timestamp: result.createdAt, result });
		return result;
	}

	appendNote(message: string, options?: { taskId?: string; attemptId?: string; tags?: string[] }): void {
		this.appendEntry({
			type: "note",
			timestamp: nowIso(),
			taskId: options?.taskId,
			attemptId: options?.attemptId,
			message,
			tags: options?.tags,
		});
	}
}
