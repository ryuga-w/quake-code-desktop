/**
 * Codex-style turn lifecycle (TurnStarted / TurnComplete / TurnAborted).
 * Pure helper — session/runtime emit events from these transitions.
 */

export type TurnAbortReason = "interrupted" | "replaced" | "budget_limited" | "review_ended";

export type TurnPhase = "idle" | "in_progress" | "completed" | "aborted";

export interface TurnStartedEvent {
	type: "turn_started";
	turnId: string;
	startedAt: number;
}

export interface TurnCompletedEvent {
	type: "turn_completed";
	turnId: string;
	startedAt: number;
	completedAt: number;
	durationMs: number;
}

export interface TurnAbortedLifecycleEvent {
	type: "turn_aborted";
	turnId: string;
	reason: TurnAbortReason;
	startedAt: number;
	completedAt: number;
	durationMs: number;
}

export type TurnLifecycleEvent = TurnStartedEvent | TurnCompletedEvent | TurnAbortedLifecycleEvent;

export class TurnLifecycle {
	private turnId: string | null = null;
	private phase: TurnPhase = "idle";
	private seq = 0;
	private startedAt = 0;

	getActiveTurnId(): string | null {
		return this.phase === "in_progress" ? this.turnId : null;
	}

	getPhase(): TurnPhase {
		return this.phase;
	}

	/** Begin a new turn; previous in-progress turn is replaced (reason replaced). */
	beginTurn(explicitId?: string): {
		event: TurnStartedEvent;
		replaced?: TurnAbortedLifecycleEvent;
	} {
		let replaced: TurnAbortedLifecycleEvent | undefined;
		if (this.phase === "in_progress" && this.turnId) {
			const prev = this.abortTurn("replaced");
			if ("event" in prev) replaced = prev.event;
		}
		this.seq += 1;
		this.turnId = explicitId?.trim() || `turn-${this.seq}-${Date.now()}`;
		this.phase = "in_progress";
		this.startedAt = Date.now();
		return {
			event: {
				type: "turn_started",
				turnId: this.turnId,
				startedAt: this.startedAt,
			},
			replaced,
		};
	}

	completeTurn(): { event: TurnCompletedEvent } | { error: string } {
		if (this.phase !== "in_progress" || !this.turnId) {
			return { error: "no active turn to complete" };
		}
		const completedAt = Date.now();
		const event: TurnCompletedEvent = {
			type: "turn_completed",
			turnId: this.turnId,
			startedAt: this.startedAt,
			completedAt,
			durationMs: Math.max(0, completedAt - this.startedAt),
		};
		this.phase = "completed";
		return { event };
	}

	abortTurn(reason: TurnAbortReason = "interrupted"): { event: TurnAbortedLifecycleEvent } | { error: string } {
		// Allow abort when idle only if we still have a last turn id after complete — no-op error
		if (!this.turnId) {
			// Start a synthetic aborted turn so interrupt still yields TurnAborted
			this.seq += 1;
			this.turnId = `turn-${this.seq}-${Date.now()}`;
			this.startedAt = Date.now();
		}
		const completedAt = Date.now();
		const event: TurnAbortedLifecycleEvent = {
			type: "turn_aborted",
			turnId: this.turnId,
			reason,
			startedAt: this.startedAt || completedAt,
			completedAt,
			durationMs: Math.max(0, completedAt - (this.startedAt || completedAt)),
		};
		this.phase = "aborted";
		return { event };
	}

	/**
	 * Codex turn/steer expectedTurnId precondition.
	 * Missing expected → ok (optional). Mismatch when a turn is active → reject.
	 */
	assertExpectedTurnId(expected?: string | null): { ok: true; turnId: string | null } | { ok: false; error: string; actual: string | null } {
		if (expected == null || String(expected).trim() === "") {
			return { ok: true, turnId: this.getActiveTurnId() };
		}
		const want = String(expected).trim();
		const actual = this.getActiveTurnId();
		if (!actual) {
			return { ok: false, error: "no active turn to steer", actual: null };
		}
		if (actual !== want) {
			return {
				ok: false,
				error: `expectedTurnId mismatch: expected ${want}, actual ${actual}`,
				actual,
			};
		}
		return { ok: true, turnId: actual };
	}
}

/** Process-global default (desktop + tools share one process). */
export const turnLifecycle = new TurnLifecycle();
