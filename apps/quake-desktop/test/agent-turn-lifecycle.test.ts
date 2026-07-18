import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TurnLifecycle } from "@mrquake/quakecode-cli";
import { advanceAgentTurnLifecycle } from "../src/server/agent-turn-lifecycle.js";

describe("desktop agent turn lifecycle", () => {
  it("keeps internal model iterations inside one agent turn", () => {
    const lifecycle = new TurnLifecycle();
    const events = ["agent_start", "turn_start", "message_start", "turn_end", "agent_end"]
      .flatMap((eventType) => advanceAgentTurnLifecycle(lifecycle, eventType));

    expect(events.map((event) => event.type)).toEqual(["turn_started", "turn_completed"]);
    expect(events.some((event) => event.type === "turn_aborted")).toBe(false);
    expect(events[0]?.turnId).toBe(events[1]?.turnId);
  });

  it("still reports a genuinely replaced agent run", () => {
    const lifecycle = new TurnLifecycle();
    advanceAgentTurnLifecycle(lifecycle, "agent_start");
    const events = advanceAgentTurnLifecycle(lifecycle, "agent_start");

    expect(events.map((event) => event.type)).toEqual(["turn_aborted", "turn_started"]);
    expect(events[0]).toMatchObject({ type: "turn_aborted", reason: "replaced" });
  });

  it("does not quarantine the replacement event in the renderer", () => {
    const client = readFileSync(
      resolve(import.meta.dirname, "../src/client/src/app/sse/createServerEventHandlers.ts"),
      "utf8",
    );

    expect(client).toContain('if (event.type === "turn_aborted" && event.reason !== "replaced")');
  });
});
