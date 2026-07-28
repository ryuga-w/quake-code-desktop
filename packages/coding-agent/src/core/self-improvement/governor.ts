import type { ImprovementTask, SelfImprovementState } from "./types.js";

export interface GovernorCheckResult {
	allowed: boolean;
	reason?: string;
}

export class SelfImprovementGovernor {
	checkTaskAllowed(task: ImprovementTask, state: SelfImprovementState): GovernorCheckResult {
		if (task.status === "completed" || task.status === "cancelled" || task.status === "blocked") {
			return { allowed: false, reason: `Task is already ${task.status}` };
		}

		const attempts = state.attempts.filter((a) => a.taskId === task.id);
		const budget = task.budget || {};

		// Check running attempts
		for (const attempt of attempts) {
			if (attempt.status === "running") {
				return { allowed: false, reason: `An attempt (${attempt.id}) is already running for this task` };
			}
		}

		// Check max attempts
		if (budget.maxAttempts !== undefined && attempts.length >= budget.maxAttempts) {
			return { allowed: false, reason: `Max attempts (${budget.maxAttempts}) reached` };
		}

		// Calculate cumulative metrics
		let totalCostUsd = 0;
		let totalRuntimeMs = 0;
		for (const attempt of attempts) {
			totalCostUsd += attempt.metrics?.costUsd || 0;
			totalRuntimeMs += attempt.metrics?.runtimeMs || 0;
		}

		// Check cost budget
		if (budget.maxCostUsd !== undefined && totalCostUsd >= budget.maxCostUsd) {
			return { allowed: false, reason: `Max cost budget ($${budget.maxCostUsd}) exceeded` };
		}

		// Check runtime budget
		if (budget.maxRuntimeMinutes !== undefined && totalRuntimeMs / 60000 >= budget.maxRuntimeMinutes) {
			return { allowed: false, reason: `Max runtime budget (${budget.maxRuntimeMinutes} mins) exceeded` };
		}

		return { allowed: true };
	}
}
