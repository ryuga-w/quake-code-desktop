# Codex → Quake: turn interrupt / steer (1:1 mapping)

Source: `openai/codex` (`codex-rs`), vendored at `.vendor/openai-codex`.

## Protocol (codex-rs)

| Codex | Location | Quake |
|-------|----------|-------|
| `Op::UserInput` while active turn | `session/handlers.rs` → `Session::steer_input` | `prompt` with `streamingBehavior:"steer"` **or** `turn_steer` |
| `Op::UserInput` when idle | `SteerInputError::NoActiveTurn` → `spawn_task` | `prompt` (new turn) |
| `Op::Interrupt` | `handlers.rs` → `interrupt_task` → `abort_all_tasks(Interrupted)` | `abort` / `turn_interrupt` |
| `EventMsg::TurnAborted` | `protocol.rs` `TurnAbortedEvent` | SSE `turn_aborted` |
| App-server `turn/steer` | `TurnSteerParams` | `turn_steer` |
| App-server `turn/interrupt` | `TurnInterruptParams` | `turn_interrupt` |

## Semantics (do not invert)

1. **Mid-turn user message = steer** (same-turn `pending_input`), **not** “wait until agent finishes”.
2. **Interrupt** aborts the task and clears active-turn pending input; does **not** start a new turn.
3. **Partial assistant text** remains visible after interrupt.
4. Optional **follow-up** (wait for turn end) exists in Quake agent core for explicit queue UI only — **not** Codex default.

## Config note

Codex `agents.interrupt_message` can inject a model-visible marker when interrupted. Quake shows a client badge `Tur kesildi (interrupted)`; model-visible marker can be added later if needed.

## Related shipped modules

| Gap | Module |
|-----|--------|
| Turn id / expectedTurnId | `packages/coding-agent/src/core/turn/lifecycle.ts` |
| Steer queues + abort clear | Agent.abort + session prompt steer default |
| Guardian kinds + circuit | `core/guardian/*` + `setGuardianInterruptHook` |
| Sandbox / execpolicy | `core/sandbox`, `core/execpolicy`, `gateToolExecution` |
| Turn-diff history | `core/turn-diff/history.ts` + session `turn-diff` entry + ready `turnDiffs` hydrate |
| Execpolicy prefix amendment | `acceptWithExecpolicyAmendment` + session prefix store |
| Network host policy | `core/network-policy/*` + `applyNetworkPolicyAmendment` |
| OS sandbox | policy-only + `QUAKE_OS_SANDBOX` fail-closed hooks — see `CODEX_WINDOWS_SANDBOX.md` |

Gating tests: `core/codex-parity.integration.test.ts`, `guardian.test.ts`, `network-policy/extract.test.ts`, `turn-diff/history.test.ts`, `sandbox/os-backend.test.ts`.
