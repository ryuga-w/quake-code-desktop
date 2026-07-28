import type { BenchmarkResult, SelfImprovementState } from "./types.js";

export interface SuiteMetrics {
	suite: string;
	totalRuns: number;
	passes: number;
	fails: number;
	warnings: number;
	averageScore: number;
	averageLatencyMs: number;
}

export interface ScoreboardSummary {
	totalTasksCompleted: number;
	totalAttempts: number;
	totalCostUsd: number;
	suiteMetrics: SuiteMetrics[];
}

export class SelfImprovementScoreboard {
	generateSummary(state: SelfImprovementState): ScoreboardSummary {
		let totalCostUsd = 0;
		for (const attempt of state.attempts) {
			totalCostUsd += attempt.metrics?.costUsd || 0;
		}

		const totalTasksCompleted = state.tasks.filter((t) => t.status === "completed").length;

		const suites = new Map<string, BenchmarkResult[]>();
		for (const res of state.benchmarkResults) {
			const existing = suites.get(res.suite) || [];
			existing.push(res);
			suites.set(res.suite, existing);
		}

		const suiteMetrics: SuiteMetrics[] = [];
		for (const [suite, results] of suites.entries()) {
			let passes = 0;
			let fails = 0;
			let warnings = 0;
			let totalScore = 0;
			let scoredCount = 0;
			let totalLatency = 0;
			let latencyCount = 0;

			for (const r of results) {
				if (r.verdict === "pass") passes++;
				else if (r.verdict === "fail") fails++;
				else if (r.verdict === "warning") warnings++;

				if (r.score !== undefined) {
					totalScore += r.score;
					scoredCount++;
				}
				if (r.latencyMs !== undefined) {
					totalLatency += r.latencyMs;
					latencyCount++;
				}
			}

			suiteMetrics.push({
				suite,
				totalRuns: results.length,
				passes,
				fails,
				warnings,
				averageScore: scoredCount > 0 ? totalScore / scoredCount : 0,
				averageLatencyMs: latencyCount > 0 ? totalLatency / latencyCount : 0,
			});
		}

		return {
			totalTasksCompleted,
			totalAttempts: state.attempts.length,
			totalCostUsd,
			suiteMetrics: suiteMetrics.sort((a, b) => a.suite.localeCompare(b.suite)),
		};
	}
}
