import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const readRepo = (path: string) => readFileSync(join(root, "../..", path), "utf8");

const panel = read("src/client/src/components/sidechat/SideConversationPanel.tsx");
const panelStyles = read("src/client/src/components/sidechat/SideConversationPanel.module.css");
const sharedComposer = read("src/client/src/components/composer/DockConversationComposer.tsx");
const sharedComposerStyles = read("src/client/src/components/composer/DockConversationComposer.module.css");
const rightTabs = read("src/client/src/components/shell/RightPanelTabs.tsx");
const shell = read("src/client/src/app/AppShell.tsx");
const dock = read("src/client/src/app/hooks/useRightDock.ts");
const keyboard = read("src/client/src/app/hooks/useAppKeyboard.ts");
const types = read("src/client/src/types.ts");
const globalStyles = read("src/client/styles.css");
const runtime = read("src/server/runtime.ts");
const server = read("src/server/index.ts");
const protocol = read("src/shared/protocol.ts");
const agentSession = readRepo("packages/coding-agent/src/core/agent-session.ts");

describe("Codex-style side conversation workspace", () => {
  it("keeps side chat separate from parallel-agent management", () => {
    expect(types).toContain('"sidechat"');
    expect(types).toContain('"agents"');
    expect(shell).toContain('rightTab === "sidechat"');
    expect(shell).toContain("<SideConversationPanel");
    expect(shell).toContain('rightTab === "agents"');
    expect(shell).toContain("<AgentsPanel");
    expect(keyboard).toContain('h.openRightPanel("sidechat")');
    expect(dock).toContain('tab === "sidechat"');
  });

  it("forks parent context into parked sessions without duplicating it in the child thread", () => {
    expect(protocol).toContain("WebSideConversationSummary");
    expect(protocol).toContain("WebSideConversationSnapshot");
    expect(runtime).toContain("async createSideConversation");
    expect(runtime).toContain("async promptSideConversation");
    expect(runtime).toContain("async abortSideConversation");
    expect(runtime).toContain("SessionManager.forkFrom(parentSessionPath, this.currentCwd)");
    expect(runtime).toContain('kind: "side-conversation"');
    expect(runtime).toContain("contextInherited");
    expect(runtime).toContain("inheritedMessageCount");
    expect(runtime).toContain("sideConversationTimeline");
    expect(protocol).toContain("contextInherited: boolean");
    expect(protocol).toContain("inheritedMessageCount: number");
    expect(runtime).toContain("installBackgroundHost");
    expect(runtime).toContain("parentSessionPath");
    expect(server).toContain('url.pathname === "/api/side-conversations"');
    expect(server).toContain("activeRuntime.getSideConversation(identifier)");
    expect(server).toContain("activeRuntime.promptSideConversation(identifier, message)");
    expect(server).toContain('action === "preferences"');
    expect(server).toContain("activeRuntime.updateSideConversationPreferences");
    expect(runtime).toContain("setIsolatedModel(model, { persistDefault: false })");
    expect(runtime).toContain("setIsolatedThinking(preferences.thinkingLevel, { persistDefault: false })");
    expect(agentSession).toContain("options?: { persistDefault?: boolean }");
    expect(agentSession).toContain("options?.persistDefault !== false");
  });

  it("renders independent conversations in the standard dock tabs", () => {
    expect(panel).toContain('data-testid="side-conversation-panel"');
    expect(panel).toContain('aria-label="Yan sohbet çalışma alanı"');
    expect(panel).toContain("<DockPanelTabPortal");
    expect(panel).toContain('kind="sidechat"');
    expect(rightTabs).toContain('data-dock-dynamic-tabs={dynamicTabKind}');
    expect(rightTabs).toContain('aria-label={t("rightPanel.newTab")}');
    expect(rightTabs).toContain('tab: "files", labelKey: "rightPanel.tabs.files"');
    expect(rightTabs).toContain('tab: "sidechat", labelKey: "rightPanel.tabs.sidechat"');
    expect(rightTabs).toContain('tab: "browser", labelKey: "rightPanel.tabs.browser"');
    expect(panel).toContain("<ConversationTimeline");
    expect(panel).not.toContain("<MarkdownContent");
    expect(panel).toContain("timelineStreamingMessage");
    expect(panel).toContain('content: [{ type: "thinking", thinking: "Düşünüyor" }]');
    expect(panel).not.toContain('content: "[thinking]Düşünüyor[/thinking]"');
    expect(panel).toContain("<DockConversationComposer");
    expect(panel).toContain('ariaLabel="Yan sohbet mesajı"');
    expect(panel).toContain("NEW_CONVERSATION_DRAFT");
    expect(panel).toContain("moveStagedDraft");
    expect(sharedComposer).toContain("onKeyDown");
    expect(sharedComposer).toContain('event.key !== "Enter"');
    expect(sharedComposer).toContain("onSelectModel");
    expect(sharedComposer).toContain("onSetThinking");
    expect(sharedComposer).toContain('role="menuitemradio"');
    expect(panel).toContain('conversationUrl(conversationId, "preferences")');
    expect(panel).toContain("formatComposerModelLabel");
    expect(panel).toContain("İlk mesajda ana konuşmanın güncel bağlamı aktarılır");
    expect(panel).toContain('conversationUrl(activeConversationId, "abort")');
    expect(panel).toContain("workspaceName");
  });

  it("stays in the resizable right dock while the main conversation remains visible", () => {
    expect(shell).not.toContain("sidechat-layout-focus");
    expect(globalStyles).toContain('#app .rightbar[data-active-panel="sidechat"]');
    expect(globalStyles).toMatch(/#app \.rightbar\[data-active-panel="sidechat"\][\s\S]*?display: flex;/);
    expect(globalStyles).toMatch(/#app \.rightbar\[data-active-panel="sidechat"\] > \.dock-header[\s\S]*?display: flex;/);
    expect(dock).toContain("Math.min(560, Math.max(440, storedWidth))");
    expect(panelStyles).toContain("--side-chat-column: 720px");
    expect(panelStyles).toContain("--conversation-composer-width: 720px");
    expect(panelStyles).toContain("padding: 14px 18px 108px");
    expect(panelStyles).toContain("width: min(var(--conversation-composer-width, 720px), 100%)");
    expect(panelStyles).toContain("container-name: side-conversation");
    expect(panelStyles).toContain("width: min(var(--side-chat-column), calc(100% - 40px))");
    expect(sharedComposerStyles).toContain("min-height: 104px");
    expect(sharedComposerStyles).toContain("border-radius: 19px");
    expect(sharedComposerStyles).toContain("font-size: 14px");
    expect(sharedComposerStyles).toContain(".preferencesPopover");
    expect(panelStyles).toContain("prefers-reduced-motion: reduce");
  });
});
