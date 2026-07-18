import { SelfImprovementGovernor } from "./governor.js";
import type { SelfImprovementLedger } from "./ledger.js";
import { type ScoreboardSummary, SelfImprovementScoreboard } from "./scoreboard.js";
import type {
	BenchmarkResult,
	CreateImprovementTaskInput,
	ImprovementAttempt,
	ImprovementTask,
	RecordBenchmarkResultInput,
	SelfImprovementState,
} from "./types.js";

export interface SelfImprovementOrchestratorOptions {
	agentName?: string;
}

export class SelfImprovementOrchestrator {
	readonly ledger: SelfImprovementLedger;
	readonly agentName: string;
	readonly governor: SelfImprovementGovernor;
	readonly scoreboard: SelfImprovementScoreboard;

	constructor(ledger: SelfImprovementLedger, options?: SelfImprovementOrchestratorOptions) {
		this.ledger = ledger;
		this.agentName = options?.agentName || "quake-self-improvement";
		this.governor = new SelfImprovementGovernor();
		this.scoreboard = new SelfImprovementScoreboard();
	}

	getState(): SelfImprovementState {
		return this.ledger.replay();
	}

	createTask(input: CreateImprovementTaskInput): ImprovementTask {
		return this.ledger.createTask({
			owner: input.owner || this.agentName,
			...input,
		});
	}

	listTasks(): ImprovementTask[] {
		return this.getState().tasks;
	}

	getScoreboardSummary(): ScoreboardSummary {
		return this.scoreboard.generateSummary(this.getState());
	}

	getNextQueuedTask(): ImprovementTask | undefined {
		const state = this.getState();
		const queued = state.tasks
			.filter((task) => task.status === "queued")
			.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));

		for (const task of queued) {
			const check = this.governor.checkTaskAllowed(task, state);
			if (check.allowed) {
				return task;
			} else {
				// Auto-block the task if it's no longer allowed
				this.blockTask(task.id, check.reason || "Blocked by governor");
			}
		}
		return undefined;
	}

	startNextAttempt(input?: {
		provider?: string;
		model?: string;
		sessionId?: string;
		branchName?: string;
		notes?: string;
	}): { task: ImprovementTask; attempt: ImprovementAttempt } | undefined {
		const task = this.getNextQueuedTask();
		if (!task) return undefined;
		const attempt = this.ledger.startAttempt(task.id, {
			provider: input?.provider,
			model: input?.model,
			sessionId: input?.sessionId,
			branchName: input?.branchName,
			notes: input?.notes,
		});
		this.ledger.appendNote(`Started attempt ${attempt.id} for task ${task.title}`, {
			taskId: task.id,
			attemptId: attempt.id,
			tags: ["attempt", "start"],
		});
		return { task, attempt };
	}

	completeAttempt(attemptId: string, taskId: string, notes?: string, benchmarkScore?: number): void {
		this.ledger.finishAttempt(attemptId, taskId, {
			status: "completed",
			notes,
			metrics: benchmarkScore !== undefined ? { benchmarkScore } : undefined,
		});
		if (notes) {
			this.ledger.appendNote(notes, { taskId, attemptId, tags: ["attempt", "completed"] });
		}
	}

	failAttempt(attemptId: string, taskId: string, notes: string): void {
		this.ledger.finishAttempt(attemptId, taskId, {
			status: "failed",
			notes,
		});
		this.ledger.appendNote(notes, { taskId, attemptId, tags: ["attempt", "failed"] });
	}

	blockTask(taskId: string, reason: string): void {
		this.ledger.updateTask(taskId, { status: "blocked" });
		this.ledger.appendNote(reason, { taskId, tags: ["task", "blocked"] });
	}

	recordBenchmarkResult(input: RecordBenchmarkResultInput): BenchmarkResult {
		const result = this.ledger.recordBenchmarkResult(input);
		this.ledger.appendNote(
			`Benchmark ${result.suite}/${result.target} => ${result.verdict}${result.score !== undefined ? ` (score=${result.score})` : ""}`,
			{
				taskId: result.taskId,
				attemptId: result.attemptId,
				tags: ["benchmark", result.verdict],
			},
		);
		return result;
	}

	appendNote(message: string, options?: { taskId?: string; attemptId?: string; tags?: string[] }): void {
		this.ledger.appendNote(message, options);
	}
}
