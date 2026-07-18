import { createHash, randomUUID } from "node:crypto";
import { renderGoalBudgetLimit, renderGoalContinuation } from "./prompts.js";
import { isTokenBudgetExceeded } from "./state-machine.js";
import type { GoalEvidence, GoalRuntimeState } from "./types.js";

export const GOAL_CANDIDATE_COMPLETE = "<!-- GOAL_CANDIDATE_COMPLETE -->";
export const UPDATE_GOAL_TOOL_NAME = "update_goal";

export type GoalSchedulerDecision =
  | { type: "continue"; prompt: string; fingerprint: string; evidence: GoalEvidence[]; tokensDelta: number }
  | { type: "verify"; fingerprint: string; evidence: GoalEvidence[]; tokensDelta: number }
  | { type: "agent_complete"; fingerprint: string; evidence: GoalEvidence[]; tokensDelta: number }
  | {
      type: "block";
      reason: string;
      fingerprint: string;
      evidence: GoalEvidence[];
      tokensDelta: number;
      /** When set, goal becomes budget_limited (Codex) rather than blocked. */
      terminal: "blocked" | "budget_limited";
      wrapUpPrompt?: string;
    };

export function decideGoalNextStep(state: GoalRuntimeState, messages: unknown[], assistantText: string): GoalSchedulerDecision {
  const evidence = collectGoalEvidence(messages);
  const fingerprint = progressFingerprint(messages, assistantText, evidence);
  const tokensDelta = collectTokensDelta(messages);
  const nextTurn = state.currentTurn + 1;
  const stagnant = fingerprint === state.lastProgressFingerprint ? state.stagnantTurns + 1 : 0;
  const projectedTokens = (state.tokensUsed ?? 0) + tokensDelta;
  const projectedState: GoalRuntimeState = { ...state, tokensUsed: projectedTokens };

  // Agent update_goal complete takes precedence (Codex agent terminal complete).
  if (findUpdateGoalStatus(messages) === "complete") {
    return { type: "agent_complete", fingerprint, evidence, tokensDelta };
  }

  // Turn budget exhaustion → budget_limited + wrap-up (no infinite continue).
  if (nextTurn >= state.budget.maxTurns) {
    return {
      type: "block",
      terminal: "budget_limited",
      reason: `Maksimum ${state.budget.maxTurns} tura ulaşıldı.`,
      fingerprint,
      evidence,
      tokensDelta,
      wrapUpPrompt: renderGoalBudgetLimit({
        objective: state.objective,
        maxTurns: state.budget.maxTurns,
        timeUsedSeconds: Math.max(0, Math.floor((Date.now() - state.createdAt) / 1000)),
        tokensUsed: projectedTokens,
        tokenBudget: state.budget.tokenBudget,
      }),
    };
  }

  // Token budget exhaustion (when configured).
  if (isTokenBudgetExceeded(projectedState) || (typeof state.budget.tokenBudget === "number" && state.budget.tokenBudget > 0 && projectedTokens >= state.budget.tokenBudget)) {
    return {
      type: "block",
      terminal: "budget_limited",
      reason: `Token bütçesi aşıldı (${projectedTokens}/${state.budget.tokenBudget}).`,
      fingerprint,
      evidence,
      tokensDelta,
      wrapUpPrompt: renderGoalBudgetLimit({
        objective: state.objective,
        maxTurns: state.budget.maxTurns,
        timeUsedSeconds: Math.max(0, Math.floor((Date.now() - state.createdAt) / 1000)),
        tokensUsed: projectedTokens,
        tokenBudget: state.budget.tokenBudget,
      }),
    };
  }

  if (stagnant >= state.budget.maxStagnantTurns) {
    return {
      type: "block",
      terminal: "blocked",
      reason: `${stagnant} tur boyunca farklı çözüm denemelerine rağmen doğrulanabilir ilerleme görülmedi.`,
      fingerprint,
      evidence,
      tokensDelta,
    };
  }

  // Legacy HTML marker → host verification path (reinforcement).
  if (assistantText.includes(GOAL_CANDIDATE_COMPLETE)) {
    return { type: "verify", fingerprint, evidence, tokensDelta };
  }

  return {
    type: "continue",
    fingerprint,
    evidence,
    tokensDelta,
    prompt: renderGoalContinuation({
      objective: state.objective,
      currentTurn: nextTurn + 1,
      maxTurns: state.budget.maxTurns,
      tokensUsed: projectedTokens,
      tokenBudget: state.budget.tokenBudget,
    }),
  };
}

export function verificationPassed(state: GoalRuntimeState): boolean {
  const latestByKind = new Map<GoalEvidence["kind"], GoalEvidence>();
  for (const item of state.evidence) latestByKind.set(item.kind, item);
  const deterministic = [...latestByKind.values()].filter((item) => ["test", "build", "typecheck"].includes(item.kind));
  return deterministic.length > 0 && deterministic.every((item) => item.passed);
}

/**
 * Find the latest *successful* update_goal tool result status.
 * Failed attempts (ok:false / isError) must not terminalize the goal — e.g. a
 * rejected blocked audit or a malformed complete payload with status set but ok:false.
 */
export function findUpdateGoalStatus(messages: unknown[]): "complete" | "blocked" | undefined {
  const recent = messages.slice(-40) as any[];
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const message = recent[i];
    const name = String(message?.toolName || message?.name || "");
    if (message?.role !== "toolResult" && message?.role !== "tool_result") continue;
    if (name !== UPDATE_GOAL_TOOL_NAME && name !== "update_goal") continue;
    if (message?.isError) continue;
    const details = message?.details || message?.result?.details || {};
    // Gate on explicit success. Rejected blocked×3 and failed complete both set ok:false.
    if (details && typeof details === "object" && "ok" in details && details.ok !== true) continue;
    if (details?.ok !== true) {
      // Without structured ok:true, do not infer terminal status from free text.
      continue;
    }
    const status = String(details?.status || details?.goal?.status || "").toLowerCase();
    if (status === "complete" || status === "completed") return "complete";
    if (status === "blocked") return "blocked";
  }
  return undefined;
}

export function collectTokensDelta(messages: unknown[]): number {
  const recent = messages.slice(-12) as any[];
  let total = 0;
  for (const message of recent) {
    if (message?.role !== "assistant") continue;
    const usage = message.usage || message.result?.usage;
    if (!usage || typeof usage !== "object") continue;
    const input = Number(usage.input || usage.inputTokens || 0) || 0;
    const output = Number(usage.output || usage.outputTokens || 0) || 0;
    const cacheRead = Number(usage.cacheRead || 0) || 0;
    const cacheWrite = Number(usage.cacheWrite || 0) || 0;
    total += input + output + cacheRead + cacheWrite;
  }
  return Math.max(0, total);
}

function collectGoalEvidence(messages: unknown[]): GoalEvidence[] {
  const recent = messages.slice(-20) as any[];
  const evidence: GoalEvidence[] = [];
  for (const message of recent) {
    if (message?.role !== "toolResult") continue;
    const text = messageText(message);
    const label = String(message.toolName || message.name || "tool");
    if (label === UPDATE_GOAL_TOOL_NAME) continue;
    const classified = classifyEvidence(label, text);
    if (!classified) continue;
    evidence.push({
      id: randomUUID(),
      kind: classified,
      label,
      passed: !message.isError && !looksFailed(text),
      summary: text.slice(-800),
      createdAt: Number(message.timestamp || Date.now()),
    });
  }
  return dedupeEvidence(evidence);
}

function classifyEvidence(label: string, text: string): GoalEvidence["kind"] | undefined {
  const value = `${label}\n${text}`.toLowerCase();
  if (/typecheck|tsc\s|tsgo\s/.test(value)) return "typecheck";
  if (/\btest(s|ing)?\b|vitest|jest|pytest|playwright/.test(value)) return "test";
  if (/\bbuild\b|vite build|webpack|rollup/.test(value)) return "build";
  return undefined;
}

function looksFailed(text: string): boolean {
  return /command exited with code [1-9]|\bfailed\b|\berror\b|not passed/i.test(text);
}

function progressFingerprint(messages: unknown[], assistantText: string, evidence: GoalEvidence[]): string {
  // Exclude update_goal control-plane tool results so 1/3 vs 2/3 audit text does not
  // look like "progress" and scramble stagnant-turn detection.
  const recentTools = (messages.slice(-30) as any[])
    .filter((message) => message?.role === "toolResult")
    .filter((message) => {
      const name = String(message?.toolName || message?.name || "");
      return name !== UPDATE_GOAL_TOOL_NAME && name !== "update_goal";
    })
    .map((message) => ({
      tool: message?.toolName || message?.name,
      error: Boolean(message?.isError),
      details: stableDetails(message?.details || message?.result?.details),
      text: messageText(message).slice(-500),
    }));
  const normalizedAssistant = assistantText
    .replace(GOAL_CANDIDATE_COMPLETE, "")
    .replace(/blocked audit not satisfied\s*\(\d+\/\d+\)/gi, "<blocked-audit>")
    .replace(/goal marked (complete|blocked)/gi, "<goal-status>")
    .replace(/\b\d{1,2}:\d{2}:\d{2}\b/g, "<time>")
    .replace(/\b\d{10,13}\b/g, "<timestamp>")
    .slice(-1_000);
  return createHash("sha256")
    .update(JSON.stringify({ recentTools, assistantText: normalizedAssistant, evidence: evidence.map((item) => [item.kind, item.passed, item.label, item.summary.slice(-200)]) }))
    .digest("hex");
}

function stableDetails(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/duration|timestamp|createdAt|updatedAt/i.test(key))
    .sort(([left], [right]) => left.localeCompare(right)));
}

function messageText(message: any): string {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content.map((part: any) => String(part?.text || "")).join("\n");
}

function dedupeEvidence(items: GoalEvidence[]): GoalEvidence[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}|${item.label}|${item.passed}|${item.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
