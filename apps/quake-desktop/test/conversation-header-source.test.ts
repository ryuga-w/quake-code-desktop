import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const header = readFileSync(join(root, "src/client/src/components/shell/ConversationHeader.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/src/components/shell/ConversationHeader.module.css"), "utf8");
const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");

describe("Codex-style active conversation header", () => {
  it("shows the active conversation name and a three-dot action menu", () => {
    expect(header).toContain("formatSessionTitle(session)");
    expect(header).toContain("<Folder");
    expect(header).toContain("workspaceIcon");
    expect(header).toContain("styles.divider");
    expect(header).toContain("<MoreHorizontal");
    expect(header).toContain('aria-label="Sohbet işlemleri"');
    expect(shell).toContain("<ConversationHeader");
    expect(shell).toContain('mainView.mode === "chat"');
  });

  it("reuses existing conversation metadata and side-task actions", () => {
    expect(header).toContain("Görevi sabitle");
    expect(header).toContain("Görevi yeniden adlandır");
    expect(header).toContain("Görevi arşivle");
    expect(header).toContain("Yan görevi aç");
    expect(shell).toContain("togglePinSession(activeConversationSession.path)");
    expect(shell).toContain("renameNavSession(activeConversationSession, nextName)");
    expect(shell).toContain("archiveSession(activeConversationSession.path)");
    expect(shell).toContain('openRightPanel("sidechat")');
  });

  it("reserves a compact fixed-height row above the canonical timeline", () => {
    expect(styles).toContain("flex: 0 0 42px");
    expect(styles).toContain("height: 42px");
    expect(styles).toContain("text-overflow: ellipsis");
    expect(styles).toContain(".workspaceIcon");
    expect(styles).toContain(".divider");
  });
});
