import {
  GOAL_SCHEMA_VERSION,
  GOAL_STORE_ENTRY_TYPE,
  type GoalRuntimeEvent,
  type GoalRuntimeState,
  type GoalSessionManager,
  type GoalStoreEntry,
} from "./types.js";

export class GoalStore {
  constructor(private readonly sessionManager: GoalSessionManager) {}

  load(): GoalRuntimeState | undefined {
    const entries = this.sessionManager.getEntries();
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index] as { type?: string; customType?: string; data?: unknown } | undefined;
      if (entry?.type !== "custom" || entry.customType !== GOAL_STORE_ENTRY_TYPE) continue;
      const data = normalizeStoreEntry(entry.data);
      if (data) return data.state;
    }
    return undefined;
  }

  save(event: GoalRuntimeEvent["type"], state: GoalRuntimeState): GoalRuntimeState {
    const data: GoalStoreEntry = { schemaVersion: GOAL_SCHEMA_VERSION, event, state };
    this.sessionManager.appendCustomEntry(GOAL_STORE_ENTRY_TYPE, data);
    return state;
  }
}

function normalizeStoreEntry(value: unknown): GoalStoreEntry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Partial<GoalStoreEntry>;
  if (data.schemaVersion !== GOAL_SCHEMA_VERSION || !isGoalState(data.state)) return undefined;
  return {
    schemaVersion: GOAL_SCHEMA_VERSION,
    event: data.event as GoalRuntimeEvent["type"],
    state: hydrateState(data.state),
  };
}

function hydrateState(state: GoalRuntimeState): GoalRuntimeState {
  return {
    ...state,
    tokensUsed: typeof state.tokensUsed === "number" ? state.tokensUsed : 0,
    blockedStreak: typeof state.blockedStreak === "number" ? state.blockedStreak : 0,
  };
}

function isGoalState(value: unknown): value is GoalRuntimeState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<GoalRuntimeState>;
  return state.schemaVersion === GOAL_SCHEMA_VERSION
    && typeof state.id === "string"
    && typeof state.objective === "string"
    && typeof state.status === "string"
    && typeof state.currentTurn === "number"
    && typeof state.createdAt === "number"
    && typeof state.updatedAt === "number"
    && typeof state.revision === "number"
    && Array.isArray(state.criteria)
    && Array.isArray(state.evidence)
    && typeof state.stagnantTurns === "number"
    && Boolean(state.budget)
    && typeof state.budget?.maxTurns === "number"
    && typeof state.budget?.maxStagnantTurns === "number"
    && typeof state.policy?.autoRecover === "boolean";
}
