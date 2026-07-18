import { describe, expect, it } from "vitest";
import { TurnLifecycle } from "./lifecycle.js";

describe("TurnLifecycle (Codex turn/*)", () => {
	it("assigns stable turn id and emits started/completed", () => {
		const life = new TurnLifecycle();
		const { event: started } = life.beginTurn("turn-fixed-1");
		expect(started.type).toBe("turn_started");
		expect(started.turnId).toBe("turn-fixed-1");
		expect(life.getActiveTurnId()).toBe("turn-fixed-1");
		expect(life.getPhase()).toBe("in_progress");

		const done = life.completeTurn();
		expect("event" in done).toBe(true);
		if ("event" in done) {
			expect(done.event.type).toBe("turn_completed");
			expect(done.event.turnId).toBe("turn-fixed-1");
			expect(done.event.durationMs).toBeGreaterThanOrEqual(0);
		}
		expect(life.getActiveTurnId()).toBe(null);
		expect(life.getPhase()).toBe("completed");
	});

	it("abort emits interrupted reason and clears active id", () => {
		const life = new TurnLifecycle();
		life.beginTurn("t-abort");
		const aborted = life.abortTurn("interrupted");
		expect("event" in aborted).toBe(true);
		if ("event" in aborted) {
			expect(aborted.event.type).toBe("turn_aborted");
			expect(aborted.event.reason).toBe("interrupted");
			expect(aborted.event.turnId).toBe("t-abort");
		}
		expect(life.getPhase()).toBe("aborted");
		expect(life.getActiveTurnId()).toBe(null);
	});

	it("expectedTurnId rejects mismatch; allows empty expected", () => {
		const life = new TurnLifecycle();
		life.beginTurn("live-turn");
		expect(life.assertExpectedTurnId(undefined).ok).toBe(true);
		expect(life.assertExpectedTurnId("live-turn").ok).toBe(true);
		const bad = life.assertExpectedTurnId("other-turn");
		expect(bad.ok).toBe(false);
		if (!bad.ok) {
			expect(bad.error).toContain("mismatch");
			expect(bad.actual).toBe("live-turn");
		}
	});

	it("beginTurn while in progress replaces prior turn", () => {
		const life = new TurnLifecycle();
		life.beginTurn("old");
		const next = life.beginTurn("new");
		expect(next.replaced?.type).toBe("turn_aborted");
		expect(next.replaced?.reason).toBe("replaced");
		expect(next.event.turnId).toBe("new");
	});
});
