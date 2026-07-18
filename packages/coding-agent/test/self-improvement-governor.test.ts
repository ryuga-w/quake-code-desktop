import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { SelfImprovementLedger } from "../src/core/self-improvement/ledger.js";
import { SelfImprovementOrchestrator } from "../src/core/self-improvement/orchestrator.js";

describe("self-improvement governor and scoreboard", () => {
	test("governor blocks task when budget is exceeded and scoreboard aggregates metrics", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quake-governor-"));
		const ledger = new SelfImprovementLedger(path.join(tempDir, "ledger.jsonl"));
		const orchestrator = new SelfImprovementOrchestrator(ledger, { agentName: "test-agent" });

		// Create a task with a tight budget
		const task = orchestrator.createTask({
			title: "Fix bug with budget",
			goal: "Do not exceed limits",
			kind: "bugfix",
			budget: { maxAttempts: 2, maxCostUsd: 1.0 },
		});

		// 1st Attempt - fails but under budget
		const attempt1 = orchestrator.startNextAttempt({ model: "cheap-model" });
		expect(attempt1?.task.id).toBe(task.id);
		if (attempt1) {
			orchestrator.failAttempt(attempt1.attempt.id, task.id, "Failed on first try");
			// Manually inject a cost via ledger for testing
			ledger.finishAttempt(attempt1.attempt.id, task.id, {
				status: "failed",
				metrics: { costUsd: 0.5 },
			});
			// It updates task status to 'failed', but let's queue it back up for the sake of the governor check
			ledger.updateTask(task.id, { status: "queued" });
		}

		// 2nd Attempt - fails, pushes cost to limit
		const attempt2 = orchestrator.startNextAttempt({ model: "cheap-model" });
		expect(attempt2?.task.id).toBe(task.id);
		if (attempt2) {
			ledger.finishAttempt(attempt2.attempt.id, task.id, {
				status: "failed",
				metrics: { costUsd: 0.6 },
			});
			// Queue again to trigger governor check
			ledger.updateTask(task.id, { status: "queued" });
		}

		// 3rd Attempt - Governor should block it now
		const attempt3 = orchestrator.startNextAttempt();
		expect(attempt3).toBeUndefined(); // Should be blocked

		// Check if it got marked as blocked
		const finalState = ledger.replay();
		const finalTask = finalState.tasks.find((t) => t.id === task.id);
		expect(finalTask?.status).toBe("blocked");

		// Let's add some benchmark results to test the scoreboard
		ledger.recordBenchmarkResult({
			suite: "e2e",
			target: "login-flow",
			verdict: "pass",
			score: 1.0,
			latencyMs: 100,
		});
		ledger.recordBenchmarkResult({
			suite: "e2e",
			target: "signup-flow",
			verdict: "fail",
			score: 0.2,
			latencyMs: 200,
		});

		// Check Scoreboard
		const scoreboard = orchestrator.getScoreboardSummary();
		expect(scoreboard.totalTasksCompleted).toBe(0);
		expect(scoreboard.totalCostUsd).toBe(1.1); // 0.5 + 0.6

		const e2eSuite = scoreboard.suiteMetrics.find((s) => s.suite === "e2e");
		expect(e2eSuite).toBeDefined();
		expect(e2eSuite?.totalRuns).toBe(2);
		expect(e2eSuite?.passes).toBe(1);
		expect(e2eSuite?.fails).toBe(1);
		expect(e2eSuite?.averageScore).toBe(0.6); // (1.0 + 0.2) / 2
		expect(e2eSuite?.averageLatencyMs).toBe(150); // (100 + 200) / 2
	});
});
