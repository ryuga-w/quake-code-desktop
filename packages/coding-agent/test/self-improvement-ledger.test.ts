import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { SelfImprovementLedger } from "../src/core/self-improvement/ledger.js";
import { SelfImprovementOrchestrator } from "../src/core/self-improvement/orchestrator.js";

describe("self-improvement ledger", () => {
	test("replays tasks and attempts from the ledger", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quake-self-improvement-"));
		const ledger = new SelfImprovementLedger(path.join(tempDir, "ledger.jsonl"));
		const orchestrator = new SelfImprovementOrchestrator(ledger, { agentName: "test-agent" });

		const task = orchestrator.createTask({
			title: "Strengthen OS smoke tests",
			goal: "Add focused verification coverage for desktop flows",
			kind: "os-smoke",
			priority: 80,
			acceptanceCriteria: ["build passes", "focused verify fields covered"],
		});

		const started = orchestrator.startNextAttempt({ model: "gpt-test", provider: "openai" });
		if (!started) throw new Error("Expected queued task");
		orchestrator.completeAttempt(started.attempt.id, task.id, "Smoke coverage added", 0.91);

		const benchmark = orchestrator.recordBenchmarkResult({
			taskId: task.id,
			attemptId: started.attempt.id,
			suite: "os-smoke",
			target: "focused-verification",
			verdict: "pass",
			score: 0.91,
			latencyMs: 420,
			evidence: ["build ok", "3 schema tests passed"],
		});

		const state = ledger.replay();
		expect(state.tasks).toHaveLength(1);
		expect(state.attempts).toHaveLength(1);
		expect(state.benchmarkResults).toHaveLength(1);
		expect(state.tasks[0]?.status).toBe("completed");
		expect(state.tasks[0]?.owner).toBe("test-agent");
		expect(state.attempts[0]?.status).toBe("completed");
		expect(state.benchmarkResults[0]?.id).toBe(benchmark.id);
		expect(state.benchmarkResults[0]?.verdict).toBe("pass");
		expect(state.notes.some((note) => note.message.includes("Smoke coverage added"))).toBe(true);
		expect(state.notes.some((note) => note.message.includes("Benchmark os-smoke/focused-verification => pass"))).toBe(
			true,
		);
	});
});
