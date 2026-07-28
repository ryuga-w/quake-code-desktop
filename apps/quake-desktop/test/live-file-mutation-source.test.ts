import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const card = readFileSync(join(root, "src/client/src/components/tools/TurnFileChangesCard.tsx"), "utf8");
const cardStyles = readFileSync(join(root, "src/client/src/components/tools/TurnFileChangesCard.module.css"), "utf8");
const activity = readFileSync(join(root, "src/client/src/components/markdown/ToolActivityNotice.tsx"), "utf8");
const details = readFileSync(join(root, "src/client/src/components/markdown/ToolRunDetails.tsx"), "utf8");
const activityStyles = readFileSync(join(root, "src/client/src/components/markdown/MarkdownMessage.module.css"), "utf8");
const eventHandlers = readFileSync(join(root, "src/client/src/app/sse/createServerEventHandlers.ts"), "utf8");
const markdown = readFileSync(join(root, "src/client/src/components/markdown/MarkdownMessage.tsx"), "utf8");
const timeline = readFileSync(join(root, "src/client/src/components/timeline/Timeline.tsx"), "utf8");
const server = readFileSync(join(root, "src/server/index.ts"), "utf8");
const turnUndo = readFileSync(join(root, "src/server/turn-file-undo.ts"), "utf8");

describe("live file mutation visibility", () => {
  it("builds an in-flight file row directly from apply_patch arguments", () => {
    expect(card).toContain("const argumentPatch = [args.patch, args.diff, args.input].find(");
    expect(card).toContain("const liveDiff = typeof details.diff");
    expect(card).toContain("const isActive = tool.status === \"queued\" || tool.status === \"running\" || tool.status === \"streaming\"");
    expect(card).toContain("if (isActive && !mutations.length) continue");
  });

  it("auto-opens the first live payload and retains that state after settle", () => {
    expect(card).toContain("const [open, setOpen] = useState(() => active && canPreview)");
    expect(card).toContain("const autoOpenedRef = useRef(open)");
    expect(card).toContain("if (!active || !canPreview || autoOpenedRef.current) return");
    expect(card).toContain('data-live={active ? "true" : undefined}');
    expect(card).toContain("key={row.path}");
    expect(card).not.toContain("key={`${row.path}:${active}`}");
    expect(markdown).toContain("One persistent file-change card spans the live and settled phases");
  });

  it("names the file in both live activity surfaces", () => {
    expect(card).toContain('return `${active ? "Düzenleniyor" : "Düzenlendi"} ${name}`');
    expect(activity).toContain("const singlePath = singleRow ? compactMutationPath(singleRow.mutation.path) : undefined");
    expect(activity).toContain("mutationActionLabel(singleKind, fileActive, fileFailed)");
    expect(details).toContain("{displaySubject}");

    const subjectLinkRule = activityStyles.match(/(?:^|\n)\.toolRunSubjectLink\s*\{([^}]*)\}/)?.[1] || "";
    expect(subjectLinkRule).toContain("background-color: transparent");
    expect(subjectLinkRule).not.toMatch(/(^|\s)background\s*:/);
  });

  it("keeps streamed arguments and exact live counters visible", () => {
    expect(eventHandlers).toContain("const signature = toolCallStreamSignature(message)");
    expect(timeline).toContain("buildMessageToolHistory(timelineHistoryMessages, streamingItem)");
    expect(activity).toContain("styles.toolNoticeMutationDelta");
    expect(activity).toContain("`+${totals.added}`");
    expect(activity).toContain("`−${totals.removed}`");
    expect(details).toContain("<b>+{stats.added}</b>");
    expect(details).toContain("<b>−{stats.removed}</b>");
    expect(details).not.toContain("useAnimatedLineNumber");
  });

  it("undoes a complete turn through the guarded diff endpoint", () => {
    expect(card).toContain('apiPost<{ reverted: number; paths: string[] }>("/api/file/undo-turn"');
    expect(card).not.toContain("fileUndoManager");
    expect(server).toContain('url.pathname === "/api/file/undo-turn"');
    expect(turnUndo).toContain("Preflight every file");
    expect(turnUndo).toContain("reverseFileDiff");
  });

  it("keeps live motion subtle and reduced-motion safe", () => {
    expect(cardStyles).toContain('.card[data-live="true"]');
    expect(cardStyles).toContain("animation: fileChangeLivePulse");
    expect(cardStyles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
