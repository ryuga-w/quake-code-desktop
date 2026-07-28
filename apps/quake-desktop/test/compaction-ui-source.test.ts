import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const app = readFileSync(join(root, "src/client/src/app/App.tsx"), "utf8");
const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");
const composer = readFileSync(join(root, "src/client/src/components/composer/ChatComposer.tsx"), "utf8");
const composerStyles = readFileSync(join(root, "src/client/src/components/composer/ChatComposer.module.css"), "utf8");
const timeline = readFileSync(join(root, "src/client/src/components/timeline/Timeline.tsx"), "utf8");
const timelineStyles = readFileSync(join(root, "src/client/src/components/timeline/timeline.css"), "utf8");
const events = readFileSync(join(root, "src/client/src/app/sse/createServerEventHandlers.ts"), "utf8");

describe("desktop compaction visibility", () => {
  it("shows live compaction state in the composer", () => {
    expect(app).toContain("isSessionCompacting: Boolean(state.state?.isCompacting)");
    expect(app).toContain("isCompacting={isSessionCompacting}");
    expect(shell).toContain("isCompacting={isCompacting}");
    expect(composer).toContain('t("composer.contextCompacting")');
    expect(composerStyles).toContain(".compactionStatus");
    expect(composerStyles).toContain("composerCompactionSpin");
  });

  it("refreshes persisted history when compaction completes", () => {
    expect(events).toContain('if (event?.type === "compaction_start")');
    expect(events).toContain("ctx.patchSessionState({ isCompacting: true })");
    expect(events).toContain('if (event?.type === "compaction_end")');
    expect(events).toContain("ctx.patchSessionState({ isCompacting: false })");
    expect(events).toContain("ctx.refreshSessionState({ quiet: true, settleIfIdle: false })");
  });

  it("renders a persistent, flat timeline marker with pre-compaction usage", () => {
    expect(timeline).toContain('item.message.customType === "context-compaction"');
    expect(timeline).toContain("Bağlam sıkıştırıldı");
    expect(timeline).toContain("tam timeline korunuyor");
    expect(timeline).toContain('toLocaleString("tr-TR")');
    expect(timelineStyles).toContain(".timeline-compaction-event");
    expect(timelineStyles).toMatch(/\.timeline-compaction-event \{[\s\S]*?border-top:/);
    expect(timelineStyles).not.toMatch(/\.timeline-compaction-event \{[^}]*background:/);
  });
});
