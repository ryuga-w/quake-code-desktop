import { describe, expect, it, vi } from "vitest";
import { AgentManager } from "../src/bundled/extensions/quake-subagents/agent-manager.js";

vi.mock("../src/bundled/extensions/quake-subagents/agent-runner.js", () => ({
  runAgent: vi.fn(),
  resumeAgent: vi.fn(),
}));

import { runAgent } from "../src/bundled/extensions/quake-subagents/agent-runner.js";

const ctx = { cwd: "C:/workspace" } as any;
const quake = {} as any;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("AgentManager background lifecycle", () => {
  it("waits for queued agents and forwards images when they start", async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    vi.mocked(runAgent).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const manager = new AgentManager(undefined, 1);
    const images = [{ type: "image", data: "abc", mimeType: "image/png" }] as any;
    manager.spawn(quake, ctx, "general-purpose", "first", { name: "Atlas", description: "first", isBackground: true });
    const queuedId = manager.spawn(quake, ctx, "general-purpose", "second", { name: "Nova", description: "second", isBackground: true, images });
    expect(manager.getRecord(queuedId)?.status).toBe("queued");

    const waiting = manager.waitForAll();
    first.resolve({ responseText: "one", session: { dispose: vi.fn() }, aborted: false, steered: false });
    await vi.waitFor(() => expect(manager.getRecord(queuedId)?.status).toBe("running"));
    expect(vi.mocked(runAgent).mock.calls[1]?.[3]?.images).toBe(images);
    second.resolve({ responseText: "two", session: { dispose: vi.fn() }, aborted: false, steered: false });
    await waiting;
    expect(manager.hasRunning()).toBe(false);
    manager.dispose();
  });

  it("stops queued agents without starting them", () => {
    const first = deferred<any>();
    vi.mocked(runAgent).mockReset().mockImplementationOnce(() => first.promise);
    const completed: string[] = [];
    const manager = new AgentManager((record) => completed.push(record.id), 1);
    manager.spawn(quake, ctx, "general-purpose", "first", { name: "Atlas", description: "first", isBackground: true });
    const queuedId = manager.spawn(quake, ctx, "general-purpose", "second", { name: "Nova", description: "second", isBackground: true });
    expect(manager.abort(queuedId)).toBe(true);
    expect(manager.getRecord(queuedId)?.status).toBe("stopped");
    expect(completed).toContain(queuedId);
    expect(vi.mocked(runAgent)).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("requires caller-assigned unique names", () => {
    const running = deferred<any>();
    vi.mocked(runAgent).mockReset().mockImplementationOnce(() => running.promise);
    const manager = new AgentManager(undefined, 1);
    expect(() => manager.spawn(quake, ctx, "Explore", "task", { name: " ", description: "task", isBackground: true })).toThrow(/name is required/i);
    manager.spawn(quake, ctx, "Explore", "task", { name: "Atlas", description: "task", isBackground: true });
    expect(() => manager.spawn(quake, ctx, "Plan", "other", { name: "atlas", description: "other", isBackground: true })).toThrow(/already active/i);
    manager.dispose();
  });
});
