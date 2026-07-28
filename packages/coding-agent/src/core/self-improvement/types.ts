export type ImprovementTaskKind =
	| "bugfix"
	| "feature"
	| "benchmark"
	| "comparison"
	| "os-smoke"
	| "tui-smoke"
	| "maintenance";

export type ImprovementTaskStatus = "queued" | "running" | "blocked" | "completed" | "failed" | "cancelled";

export interface ImprovementBudget {
	maxAttempts?: number;
	maxTokens?: number;
	maxCostUsd?: number;
	maxRuntimeMinutes?: number;
}

export interface ImprovementTask {
	id: string;
	title: string;
	goal: string;
	kind: ImprovementTaskKind;
	status: ImprovementTaskStatus;
	priority: number;
	createdAt: string;
	updatedAt: string;
	tags?: string[];
	contextPaths?: string[];
	acceptanceCriteria?: string[];
	budget?: ImprovementBudget;
	owner?: string;
	lastAttemptId?: string;
}

export interface CreateImprovementTaskInput {
	title: string;
	goal: string;
	kind: ImprovementTaskKind;
	priority?: number;
	tags?: string[];
	contextPaths?: string[];
	acceptanceCriteria?: string[];
	budget?: ImprovementBudget;
	owner?: string;
}

export interface ImprovementAttempt {
	id: string;
	taskId: string;
	startedAt: string;
	endedAt?: string;
	status: "running" | "completed" | "failed" | "cancelled";
	provider?: string;
	model?: string;
	sessionId?: string;
	branchName?: string;
	notes?: string;
	metrics?: {
		tokensUsed?: number;
		costUsd?: number;
		runtimeMs?: number;
		benchmarkScore?: number;
	};
}

export interface BenchmarkResult {
	id: string;
	taskId?: string;
	attemptId?: string;
	createdAt: string;
	suite: string;
	target: string;
	verdict: "pass" | "fail" | "warning";
	score?: number;
	latencyMs?: number;
	retries?: number;
	provider?: string;
	model?: string;
	evidence?: string[];
	metrics?: Record<string, number>;
	notes?: string;
}

export interface RecordBenchmarkResultInput {
	taskId?: string;
	attemptId?: string;
	suite: string;
	target: string;
	verdict: BenchmarkResult["verdict"];
	score?: number;
	latencyMs?: number;
	retries?: number;
	provider?: string;
	model?: string;
	evidence?: string[];
	metrics?: Record<string, number>;
	notes?: string;
}

export type SelfImprovementLedgerEntry =
	| {
			type: "task_created";
			timestamp: string;
			task: ImprovementTask;
	  }
	| {
			type: "task_updated";
			timestamp: string;
			taskId: string;
			patch: Partial<ImprovementTask>;
	  }
	| {
			type: "attempt_started";
			timestamp: string;
			attempt: ImprovementAttempt;
	  }
	| {
			type: "attempt_finished";
			timestamp: string;
			attemptId: string;
			taskId: string;
			patch: Partial<ImprovementAttempt>;
	  }
	| {
			type: "benchmark_result";
			timestamp: string;
			result: BenchmarkResult;
	  }
	| {
			type: "note";
			timestamp: string;
			taskId?: string;
			attemptId?: string;
			message: string;
			tags?: string[];
	  };

export interface SelfImprovementState {
	tasks: ImprovementTask[];
	attempts: ImprovementAttempt[];
	benchmarkResults: BenchmarkResult[];
	notes: Array<Extract<SelfImprovementLedgerEntry, { type: "note" }>>;
}
