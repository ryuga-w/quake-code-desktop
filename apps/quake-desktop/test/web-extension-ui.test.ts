import { describe, expect, it } from "vitest";
import { WebExtensionUiBridge } from "../src/server/web-extension-ui";

describe("WebExtensionUiBridge", () => {
  it("round-trips Codex request_user_input questions", async () => {
    const events: any[] = [];
    const bridge = new WebExtensionUiBridge({ send: (event: any) => events.push(event) } as any);
    const pending = bridge.createContext("session-a").requestUserInput!({
      questions: [{
        id: "scope",
        header: "Scope",
        question: "Which scope?",
        options: [
          { label: "Desktop", description: "Desktop only" },
          { label: "All", description: "All surfaces" },
        ],
      }],
    });
    const request = bridge.getPendingRequests("session-a")[0]!;
    expect(events.some((event) => event.method === "requestUserInput")).toBe(true);
    expect(bridge.completeClarification(request.id, request.clarification!.id, {
      scope: { optionId: "option-1" },
    }, "session-a")).toBe(true);
    await expect(pending).resolves.toEqual({ answers: { scope: { answers: ["All"] } } });
  });

  it("publishes pending clarification state as soon as the form opens", async () => {
    const events: any[] = [];
    let stateChanges = 0;
    const sequence: string[] = [];
    const bridge = new WebExtensionUiBridge(
      { send: (event: any) => { events.push(event); sequence.push(`event:${event.method}`); } } as any,
      () => { stateChanges += 1; sequence.push("state"); },
    );
    const pending = bridge.createContext("session-a").planClarification!({
      id: "scope",
      title: "Planı netleştirelim",
      status: "pending",
      questions: [{ id: "surface", label: "Hangi yüzey?", required: true }],
    });

    expect(stateChanges).toBe(1);
    expect(bridge.getPendingRequests()[0]?.clarification).toEqual(expect.objectContaining({
      requestId: expect.any(String),
      status: "pending",
    }));
    expect(events.some((event) => event.method === "planClarification")).toBe(true);
    expect(sequence.slice(0, 2)).toEqual(["state", "event:planClarification"]);

    bridge.clearPendingRequests();
    expect(stateChanges).toBe(2);
    await expect(pending).resolves.toEqual({ status: "cancelled", cancelled: true });
  });

  it("publishes removal when a pending dialog is aborted", async () => {
    const controller = new AbortController();
    let stateChanges = 0;
    const bridge = new WebExtensionUiBridge(
      { send: () => undefined } as any,
      () => { stateChanges += 1; },
    );
    const pending = bridge.createContext("session-a").input("Kapsam", undefined, { signal: controller.signal });
    expect(stateChanges).toBe(1);
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(bridge.getPendingRequests()).toHaveLength(0);
    expect(stateChanges).toBe(2);
  });

  it("does not publish a background session dialog into the active UI", async () => {
    const events: any[] = [];
    const bridge = new WebExtensionUiBridge(
      { send: (event: any) => events.push(event) } as any,
      (ownerKey) => ownerKey === "active-session",
    );
    const pending = bridge.createContext("background-session").planClarification!({
      id: "background-scope",
      title: "Arka plan sorusu",
      status: "pending",
      questions: [{ id: "choice", label: "Seçim?", required: true }],
    });
    expect(bridge.getPendingRequests("background-session")).toHaveLength(1);
    expect(events).toHaveLength(0);
    bridge.clearPendingRequests("background-session");
    await expect(pending).resolves.toEqual({ status: "cancelled", cancelled: true });
  });

  it("rejects stale responses from a different active session", async () => {
    const bridge = new WebExtensionUiBridge({ send: () => undefined } as any);
    const pending = bridge.createContext("session-a").planClarification!({
      id: "owned-scope",
      title: "Oturuma ait soru",
      status: "pending",
      questions: [{ id: "choice", label: "Seçim?", required: true }],
    });
    const request = bridge.getPendingRequests("session-a")[0]!;

    expect(bridge.completeClarification(request.id, "owned-scope", { choice: { text: "yanıt" } }, "session-b")).toBe(false);
    expect(bridge.getPendingRequests("session-a")).toHaveLength(1);
    expect(bridge.resolveResponse(request.id, { cancelled: true }, "session-b")).toBe(false);

    bridge.clearPendingRequests("session-a");
    await expect(pending).resolves.toEqual({ status: "cancelled", cancelled: true });
  });

  it("clears pending plan UI requests when a session changes", async () => {
    const events: any[] = [];
    const bridge = new WebExtensionUiBridge({ send: (event: any) => events.push(event) } as any);

    const pending = bridge.createContext("session-a").select("Plan modu - sırada ne var?", ["Uygula", "Düzenle", "Plan modunda kal"]);
    expect(bridge.getPendingRequests("session-a")).toHaveLength(1);
    expect(bridge.getPendingRequests("session-b")).toHaveLength(0);

    bridge.clearPendingRequests("session-a");

    expect(bridge.getPendingRequests()).toHaveLength(0);
    await expect(pending).resolves.toEqual({ status: "cancelled", cancelled: true });
    expect(events.some((event) => event.method === "select")).toBe(true);
  });
});
