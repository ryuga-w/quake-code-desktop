import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const runtime = readFileSync(resolve(root, "src/server/runtime.ts"), "utf8");
const server = readFileSync(resolve(root, "src/server/index.ts"), "utf8");

 describe("timeline history source contract", () => {
  it("keeps user-visible history independent from compacted model context", () => {
    expect(runtime).toContain("getTimelineMessages(): any[]");
    expect(runtime).toContain("this.session.sessionManager.getBranch()");
    expect(runtime).toContain('entry.type === "message"');
    expect(runtime).toContain('entry.type === "custom_message"');
    expect(runtime).toContain('entry.type === "compaction"');
    expect(runtime).toContain('customType: "context-compaction"');
    expect(runtime).toContain("tokensBefore: entry.tokensBefore");
    expect(runtime).toContain("messages: this.getTimelineMessages()");
    expect(runtime).toContain("messageCount: this.getTimelineMessages().length");
    expect(server).toContain("messages: activeRuntime.getTimelineMessages()");
  });

  it("does not expose compacted session.messages as timeline history", () => {
    expect(runtime).not.toContain("messages: this.session.messages,");
    expect(server).not.toContain("messages: activeRuntime.session.messages");
  });
});
