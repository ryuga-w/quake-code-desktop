import type { TurnLifecycle, TurnLifecycleEvent } from "@mrquake/quakecode-cli";

/**
 * One user task spans the complete agent_start → agent_end sequence.
 * turn_start / turn_end are internal model-tool iterations and must not replace it.
 */
export function advanceAgentTurnLifecycle(
  lifecycle: TurnLifecycle,
  eventType: string,
): TurnLifecycleEvent[] {
  if (eventType === "agent_start") {
    const { event, replaced } = lifecycle.beginTurn();
    return replaced ? [replaced, event] : [event];
  }

  if (eventType === "agent_end") {
    const completed = lifecycle.completeTurn();
    return "event" in completed ? [completed.event] : [];
  }

  return [];
}
