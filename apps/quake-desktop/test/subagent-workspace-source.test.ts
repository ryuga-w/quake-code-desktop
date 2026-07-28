import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSubagentTool,
  summarizeToolBatch,
  toolRunActionLabel,
  toolRunSubject,
} from "../src/client/src/lib/tool-activity";
import { buildToolNoticeHeadline } from "../src/client/src/components/markdown/SemanticFlow";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const readRepo = (path: string) => readFileSync(join(root, "../..", path), "utf8");

const shell = read("src/client/src/app/AppShell.tsx");
const workspace = read("src/client/src/components/agents/SubagentWorkspace.tsx");
const workspaceStyles = read("src/client/src/components/agents/SubagentWorkspace.module.css");
const sharedComposer = read("src/client/src/components/composer/DockConversationComposer.tsx");
const sharedComposerStyles = read("src/client/src/components/composer/DockConversationComposer.module.css");
const rightTabs = read("src/client/src/components/shell/RightPanelTabs.tsx");
const outputs = read("src/client/src/components/shell/WorkspaceChrome.tsx");
const globalStyles = read("src/client/styles.css");
const responsiveStyles = read("src/client/styles-responsive.css");
const dock = read("src/client/src/app/hooks/useRightDock.ts");
const protocol = read("src/shared/protocol.ts");
const runtime = read("src/server/runtime.ts");
const server = read("src/server/index.ts");
const extension = readRepo("packages/coding-agent/src/bundled/extensions/quake-subagents/index.ts");
const webControl = readRepo("packages/coding-agent/src/bundled/extensions/quake-subagents/web-control.ts");

function spawnTool(status: "running" | "done", id: string) {
  return {
    id,
    toolName: "spawn_agent",
    status,
    args: { message: "Kimlik akışını incele" },
    details: status === "done" ? { agent_id: id, nickname: "Gödel", status: "running" } : undefined,
    startedAt: 100,
    updatedAt: 200,
  } as any;
}

describe("reference subagent execution workspace", () => {
  it("exposes session-scoped real AgentManager snapshots and actions", () => {
    expect(protocol).toContain("WebSubagentSummary");
    expect(protocol).toContain("WebSubagentSnapshot");
    expect(webControl).toContain('Symbol.for("quake-subagents:web-controls")');
    expect(webControl).toContain("manager.listAgents()");
    expect(webControl).toContain("manager.sendInputById");
    expect(webControl).toContain("manager.abort");
    expect(webControl).toContain("forkAsSession: true");
    expect(webControl).toContain("persistSession: true");
    expect(webControl).toContain("conversationStartedAt");
    expect(extension).toContain("registerSubagentWebControl");
    expect(runtime).toContain("listSubagents(sessionId");
    expect(runtime).toContain("getSubagent(id");
    expect(runtime).toContain("createSubagent(input");
    expect(runtime).toContain("sendSubagentInput");
    expect(server).toContain('url.pathname === "/api/subagents"');
    expect(server).toContain('action === "message"');
    expect(server).toContain('action === "abort"');
    expect(protocol).toContain("WebSubagentActivity");
    expect(webControl).toContain('event.type === "tool_execution_update"');
    expect(webControl).toContain("streamingText: tracker?.streamingText");
  });

  it("auto-opens only the responsive Outputs card when a new agent appears", () => {
    expect(outputs).toContain('aria-label={t("workspace.outputs.label")}');
    expect(outputs).toContain("knownAgentIdsRef");
    expect(outputs).toContain("!previousIds.has(agent.id)");
    expect(outputs).toContain("setSummaryVisibility(true)");
    expect(outputs).toContain('t("workspace.outputs.subagents")');
    expect(outputs).toContain('t("workspace.outputs.resources")');
    expect(outputs).toContain('data-active={active ? "true" : undefined}');
    expect(outputs).toContain("onOpenSubagent?.(agent.id)");
    expect(outputs).toContain("/api/subagents");
    expect(globalStyles).toContain("--workspace-context-width: clamp(286px, 22vw, 324px)");
    expect(globalStyles).toContain("max-height: min(620px, calc(100dvh");
    expect(globalStyles).toContain("workspaceAgentWorking");
    expect(globalStyles).toContain("workspaceAgentSignal");
    expect(globalStyles).toContain('[data-theme="light"] .workspace-context-card');
    expect(responsiveStyles).toContain(".app-shell:has(#app.subagents-layout-split) .workspace-chrome");
    expect(responsiveStyles).toContain("@media (max-width: 720px)");
    expect(responsiveStyles).toContain("left: max(8px, env(safe-area-inset-left))");
    expect(responsiveStyles).toContain("max-height: min(68dvh");
    expect(responsiveStyles).toContain(".app-shell:has(#app:not(.right-collapsed)) .workspace-chrome");
    expect(responsiveStyles).toContain("grid-template-columns: 20px minmax(0, 1fr) auto");
    expect(outputs).not.toContain("openRightPanel");
    expect(shell).toContain("openSubagentWorkspace");
  });

  it("opens a resizable split instead of replacing the main conversation", () => {
    expect(shell).toContain("openSubagentWorkspace");
    expect(shell).toContain('openRightPanel("subagents")');
    expect(shell).toContain('rightTab === "subagents"');
    expect(shell).toContain("<SubagentWorkspace");
    expect(globalStyles).toContain('#app .rightbar[data-active-panel="subagents"]');
    expect(globalStyles).not.toContain("subagent-layout-focus");
    expect(shell).toContain("subagents-layout-split");
    expect(dock).toContain("Math.round(available * 0.58)");
    expect(dock).toContain('readStorageValue("quake-web:subagentRightWidth")');
    expect(dock).toContain("Math.min(maximum, Math.max(minimum, stored || desired))");
    expect(responsiveStyles).toContain("@media (min-width: 721px) and (max-width: 1100px)");
    expect(responsiveStyles).toContain('rightbar[data-active-panel="subagents"]');
    expect(workspaceStyles).toContain("container-name: subagent-workspace");
  });

  it("uses standard dock tabs, an isolated transcript, and steer/resume composer", () => {
    expect(workspace).toContain('data-testid="subagent-workspace"');
    expect(workspace).toContain("<DockPanelTabPortal");
    expect(workspace).toContain('kind="subagents"');
    expect(rightTabs).toContain('data-dock-dynamic-tabs={dynamicTabKind}');
    expect(rightTabs).toContain('aria-label={t("rightPanel.newTab")}');
    expect(rightTabs).toContain('tab: "files", labelKey: "rightPanel.tabs.files"');
    expect(rightTabs).toContain('tab: "sidechat", labelKey: "rightPanel.tabs.sidechat"');
    expect(rightTabs).toContain('tab: "browser", labelKey: "rightPanel.tabs.browser"');
    expect(workspace).not.toContain("styles.newAgent");
    expect(workspace).toContain('aria-label="Yeni subagent oluştur"');
    expect(workspace).toContain("createForkContext");
    expect(workspace).toContain("createIsolation");
    expect(workspace).toContain("agentTypes.map");
    expect(workspace).toContain("<ConversationTimeline");
    expect(workspace).not.toContain("<MarkdownContent");
    expect(workspace).toContain("<DockConversationComposer");
    expect(workspace).toContain('ariaLabel="Subagent mesajı"');
    expect(sharedComposer).toContain("onKeyDown");
    expect(sharedComposer).toContain('event.key !== "Enter"');
    expect(workspace).toContain('interrupt: false');
    expect(workspace).toContain('agentUrl(activeAgentId, "abort"');
    expect(workspace).toContain("pendingMessages");
    expect(workspace).toContain("active ?");
    expect(workspace).toContain("projectSubagentTimeline");
    expect(workspace).not.toContain("<LiveAgentActivity");
    expect(workspace).toContain("activeSnapshot?.streamingText");
    expect(workspace).toContain('content: [{ type: "thinking", thinking: "Düşünüyor" }]');
    expect(workspace).not.toContain('content: "[thinking]Düşünüyor[/thinking]"');
    expect(workspaceStyles).toContain(".timelineHost");
    expect(workspaceStyles).toContain("--subagent-thread-width: 690px");
    expect(workspaceStyles).toContain("--conversation-composer-width: 720px");
    expect(workspaceStyles).toContain("padding: 14px 18px 108px");
    expect(workspaceStyles).toContain("width: min(var(--conversation-composer-width, 720px), 100%)");
    expect(sharedComposerStyles).toContain("min-height: 104px");
    expect(sharedComposerStyles).toContain("border-radius: 19px");
    expect(sharedComposerStyles).toContain("background: var(--composer-surface, #2b2b2b)");
    expect(sharedComposerStyles).toContain("font-size: 14px");
    expect(workspaceStyles).toContain("prefers-reduced-motion: reduce");
  });

  it("keeps manual side chat and worktree management separate", () => {
    expect(shell).toContain('rightTab === "sidechat"');
    expect(shell).toContain("<SideConversationPanel");
    expect(shell).toContain('rightTab === "subagents"');
    expect(shell).toContain("<SubagentWorkspace");
    expect(shell).toContain('rightTab === "agents"');
    expect(shell).toContain("<AgentsPanel");
  });

  it("renders spawn_agent as lightweight inline agent activity", () => {
    const running = spawnTool("running", "agent-1");
    const done = spawnTool("done", "agent-1");
    expect(isSubagentTool("spawn_agent")).toBe(true);
    expect(toolRunActionLabel(running)).toBe("Oluşturuluyor");
    expect(toolRunActionLabel(done)).toBe("Oluşturuldu");
    expect(toolRunSubject(done)).toBe("bir ajan");
    expect(summarizeToolBatch([done], ["spawn_agent"])).toBe("1 ajan oluşturuldu");
    expect(summarizeToolBatch([running, spawnTool("running", "agent-2")], ["spawn_agent"])).toBe("2 ajan oluşturuluyor");
    expect(buildToolNoticeHeadline([running], ["spawn_agent"], true)).toMatchObject({
      verb: "Oluşturuluyor",
      subject: "bir ajan",
    });
  });
});
