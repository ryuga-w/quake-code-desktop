/**
 * Process-global bridge so the core `update_plan` tool can emit PlanUpdate
 * without requiring ExtensionContext (Codex PlanHandler → EventMsg::PlanUpdate).
 *
 * Multi-listener: each AgentSession registers itself so multi-slot desktop
 * does not clobber the previous session's checklist updates.
 */

import type { UpdatePlanArgs } from "./plan-protocol.js";

export type PlanUpdateListener = (update: UpdatePlanArgs) => void;

const listeners = new Set<PlanUpdateListener>();
let lastSnapshot: UpdatePlanArgs | undefined;

/** Register a session listener (idempotent). Returns unsubscribe. */
export function setPlanUpdateListener(next: PlanUpdateListener | undefined): () => void {
	// Legacy single-setter API: replace all listeners when a single callback is set
	// from older call sites that expected one global handler.
	if (next) {
		listeners.clear();
		listeners.add(next);
		return () => {
			listeners.delete(next);
		};
	}
	listeners.clear();
	return () => {};
}

export function addPlanUpdateListener(listener: PlanUpdateListener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Emit checklist snapshot to all session clients (and remember last for UI restore). */
export function publishPlanUpdate(update: UpdatePlanArgs): void {
	lastSnapshot = {
		explanation: update.explanation,
		plan: (update.plan || []).map((item) => ({
			step: String(item.step || ""),
			status: item.status === "completed" || item.status === "in_progress" ? item.status : "pending",
		})),
	};
	for (const listener of [...listeners]) {
		try {
			listener(lastSnapshot);
		} catch {
			/* non-fatal per-listener */
		}
	}
}

export function getLastPlanUpdate(): UpdatePlanArgs | undefined {
	return lastSnapshot;
}

export function clearLastPlanUpdate(): void {
	lastSnapshot = undefined;
}
