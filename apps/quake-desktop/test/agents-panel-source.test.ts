import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMergeCommand,
  collectAgentActivity,
  collectWorkspaceSubagents,
  interpretMergeResult,
  isAgentActiveStatus,
  isSafeGitBranchName,
  mergeCommandForAgent,
  MERGE_CONFLICT_DIFF_CMD,
  mergeConflictOutputText,
  parseMergeConflictPaths,
  workspaceAgentStatusLabel,
} from "../src/client/src/components/agents/collect-subagents";

const root = join(import.meta.dirname, "..");

describe("Agents panel (parallel worktree UI)", () => {
  it("ships AgentsPanel + dock wiring source", () => {
    const panel = readFileSync(join(root, "src/client/src/components/agents/AgentsPanel.tsx"), "utf8");
    const main = readFileSync(join(root, "src/client/src/app/App.tsx"), "utf8");
    const shell = readFileSync(join(root, "src/client/src/app/AppShell.tsx"), "utf8");
    const launcher = readFileSync(join(root, "src/client/src/components/chrome/QuickLauncher.tsx"), "utf8");
    const types = readFileSync(join(root, "src/client/src/types.ts"), "utf8");

    expect(panel).toContain("data-testid=\"agents-panel\"");
    expect(panel).toContain("Merge kopyala");
    expect(panel).toContain("Merge uygula");
    expect(panel).toContain("Klasörde aç");
    expect(panel).toContain("git merge ${branch} çalıştırılsın mı?");
    expect(panel).toContain("/api/terminal/run");
    expect(panel).toContain("yol kopyalandı (klasör açılamadı)");
    expect(panel).toContain("data-testid=\"agents-merge-apply\"");
    expect(panel).toContain("data-testid=\"agents-open-folder\"");
    expect(panel).toContain("Paralel ajanlar");
    expect(shell).toContain("rightTab === \"agents\"");
    expect(shell).toContain("<AgentsPanel");
    expect(shell).toContain("onOpenAgents");
    expect(main).toContain("openRightPanel");
    expect(launcher).toContain("agents");
    expect(launcher).toContain('labelKey: "quickLauncher.agents"');
    expect(types).toContain("\"agents\"");
  });

  it("source contract: selection + live activity / thread list", () => {
    const panel = readFileSync(join(root, "src/client/src/components/agents/AgentsPanel.tsx"), "utf8");
    const collect = readFileSync(join(root, "src/client/src/components/agents/collect-subagents.ts"), "utf8");
    const css = readFileSync(join(root, "src/client/src/components/agents/AgentsPanel.module.css"), "utf8");

    expect(panel).toContain("selectedAgentId");
    expect(panel).toContain("setSelectedAgentId");
    expect(panel).toContain("collectAgentActivity");
    expect(panel).toContain("data-testid=\"agents-activity-pane\"");
    expect(panel).toContain("data-testid=\"agents-activity-list\"");
    expect(panel).toContain("data-testid=\"agents-activity-line\"");
    expect(panel).toContain("data-testid=\"agents-activity-empty\"");
    expect(panel).toContain("data-testid=\"agents-card\"");
    expect(panel).toContain("data-selected={selected ? \"true\" : \"false\"}");
    expect(panel).toContain("Bu ajan için henüz konuşma yok");
    expect(panel).toContain("data-testid=\"agents-thread-label\"");
    expect(panel).toContain("Konuşma");
    expect(panel).toContain("data-role={line.role}");
    expect(panel).toContain("data-testid=\"agents-thread-role\"");
    expect(panel).toContain("activityEndRef");
    expect(panel).toContain("stickToBottomRef");
    expect(panel).toContain("scrollIntoView");
    expect(collect).toContain("export function collectAgentActivity");
    expect(collect).toContain("export type AgentActivityLine");
    expect(collect).toContain("export type AgentThreadRole");
    expect(collect).toContain("role: \"user\"");
    expect(collect).toContain("role: \"assistant\"");
    expect(collect).toContain("role: \"tool\"");
    expect(collect).toContain("subagent-notification");
    expect(css).toContain(".activityPane");
    expect(css).toContain(".activityList");
    expect(css).toContain(".threadLabel");
    expect(css).toContain(".roleUser");
    expect(css).toContain(".roleAssistant");
    expect(css).toContain(".roleTool");
    expect(css).toContain('.card[data-selected="true"]');
  });

  it("source contract: merge conflict path UX", () => {
    const panel = readFileSync(join(root, "src/client/src/components/agents/AgentsPanel.tsx"), "utf8");
    const collect = readFileSync(join(root, "src/client/src/components/agents/collect-subagents.ts"), "utf8");
    const css = readFileSync(join(root, "src/client/src/components/agents/AgentsPanel.module.css"), "utf8");

    expect(panel).toContain("parseMergeConflictPaths");
    expect(panel).toContain("MERGE_CONFLICT_DIFF_CMD");
    expect(panel).toContain("data-testid=\"agents-merge-conflict\"");
    expect(panel).toContain("data-testid=\"agents-merge-conflict-list\"");
    expect(panel).toContain("data-testid=\"agents-merge-open-files\"");
    expect(panel).toContain("data-testid=\"agents-merge-diff-copy\"");
    expect(panel).toContain("Dosyalarda aç");
    expect(panel).toContain("Diff komutu kopyala");
    expect(panel).toContain("quake:open-tool-file");
    expect(panel).toContain("setMergeConflict");
    expect(collect).toContain("export function parseMergeConflictPaths");
    expect(collect).toContain("export const MERGE_CONFLICT_DIFF_CMD");
    expect(collect).toContain("git diff --name-only --diff-filter=U");
    expect(css).toContain(".conflictBanner");
    expect(css).toContain(".conflictList");
    expect(css).toContain(".conflictActions");
  });

  it("exposes desktop openPath / showItemInFolder bridge", () => {
    const desktop = readFileSync(join(root, "src/client/src/lib/desktop.ts"), "utf8");
    const preload = readFileSync(join(root, "electron/preload.ts"), "utf8");
    const electronMain = readFileSync(join(root, "electron/main.ts"), "utf8");

    expect(desktop).toContain("openPath?");
    expect(desktop).toContain("showItemInFolder?");
    expect(preload).toContain("shell:openPath");
    expect(preload).toContain("shell:showItemInFolder");
    expect(electronMain).toContain("shell:openPath");
    expect(electronMain).toContain("shell:showItemInFolder");
    expect(electronMain).toContain("shell.openPath");
    expect(electronMain).toContain("shell.showItemInFolder");
  });

  it("collects worktree meta from spawn_agent tool details", () => {
    const tools = {
      t1: {
        id: "t1",
        toolName: "spawn_agent",
        status: "running",
        startedAt: 100,
        updatedAt: 100,
        args: { message: "Fix login" },
        details: {
          agent_id: "agent-1",
          nickname: "Nova",
          status: "running",
          isolation: "worktree",
          worktree_path: "C:/tmp/quake-agent-1",
          worktree_branch: "quake-agent-agent-1",
        },
      },
    } as any;

    const agents = collectWorkspaceSubagents(tools, [], 10);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("Nova");
    expect(agents[0].isolation).toBe("worktree");
    expect(agents[0].worktreeBranch).toBe("quake-agent-agent-1");
    expect(mergeCommandForAgent(agents[0])).toBe("git merge quake-agent-agent-1");
    expect(workspaceAgentStatusLabel("running")).toBe("çalışıyor");
    expect(isAgentActiveStatus("running")).toBe(true);
    expect(isAgentActiveStatus("completed")).toBe(false);
  });

  it("builds safe non-force merge commands only", () => {
    expect(buildMergeCommand("quake-agent-abc")).toBe("git merge quake-agent-abc");
    expect(buildMergeCommand("feature/login-fix")).toBe("git merge feature/login-fix");
    expect(buildMergeCommand("")).toBeNull();
    expect(buildMergeCommand(null)).toBeNull();
    expect(buildMergeCommand("--force")).toBeNull();
    expect(buildMergeCommand("evil; rm -rf /")).toBeNull();
    expect(buildMergeCommand("a && reboot")).toBeNull();
    expect(isSafeGitBranchName("quake-agent-1")).toBe(true);
    expect(isSafeGitBranchName("-Xtheirs")).toBe(false);
    // Never force: command must be plain git merge <branch>
    const cmd = buildMergeCommand("quake-agent-x")!;
    expect(cmd).toBe("git merge quake-agent-x");
    expect(cmd).not.toMatch(/--force|--ours|--theirs|-X/);
  });

  it("interprets merge run results (success / conflict / error)", () => {
    expect(interpretMergeResult({ exitCode: 0, stdout: "Already up to date." })).toBe("success");
    expect(
      interpretMergeResult({
        exitCode: 1,
        stdout: "Auto-merging src/a.ts\nCONFLICT (content): Merge conflict in src/a.ts",
      }),
    ).toBe("conflict");
    expect(
      interpretMergeResult({
        exitCode: 1,
        stderr: "Automatic merge failed; fix conflicts and then commit the result.",
      }),
    ).toBe("conflict");
    expect(interpretMergeResult({ exitCode: 128, stderr: "not a git repository" })).toBe("error");
    expect(interpretMergeResult({ timedOut: true, exitCode: null })).toBe("error");
    expect(interpretMergeResult({ error: "Komut engellendi" })).toBe("error");
  });

  it("parses CONFLICT paths from merge output", () => {
    expect(parseMergeConflictPaths("")).toEqual([]);
    expect(parseMergeConflictPaths("Already up to date.")).toEqual([]);

    const single = parseMergeConflictPaths(
      "Auto-merging src/a.ts\nCONFLICT (content): Merge conflict in src/a.ts\nAutomatic merge failed; fix conflicts and then commit the result.\n",
    );
    expect(single).toEqual(["src/a.ts"]);

    const multi = parseMergeConflictPaths(
      [
        "Auto-merging packages/app/src/main.ts",
        "CONFLICT (content): Merge conflict in packages/app/src/main.ts",
        "Auto-merging README.md",
        "CONFLICT (add/add): Merge conflict in README.md",
        "CONFLICT (modify/delete): Merge conflict in legacy/old.ts",
        "Automatic merge failed; fix conflicts and then commit the result.",
      ].join("\n"),
    );
    expect(multi).toEqual(["packages/app/src/main.ts", "README.md", "legacy/old.ts"]);

    // Dedupes
    const duped = parseMergeConflictPaths(
      "CONFLICT (content): Merge conflict in src/a.ts\nMerge conflict in src/a.ts\n",
    );
    expect(duped).toEqual(["src/a.ts"]);

    // git status style unmerged
    const unmerged = parseMergeConflictPaths(
      "Unmerged paths:\n  both modified:   src/b.ts\n  both added:      src/c.ts\n",
    );
    expect(unmerged).toEqual(["src/b.ts", "src/c.ts"]);

    expect(MERGE_CONFLICT_DIFF_CMD).toBe("git diff --name-only --diff-filter=U");
    expect(mergeConflictOutputText({ stdout: "out", stderr: "err" })).toContain("out");
    expect(mergeConflictOutputText({ stdout: "out", stderr: "err" })).toContain("err");
  });

  it("derives live activity / thread lines for a selected agent id", () => {
    const tools = {
      t1: {
        id: "t1",
        toolName: "spawn_agent",
        status: "running",
        startedAt: 100,
        updatedAt: 200,
        args: { message: "Fix login flow" },
        details: {
          agent_id: "agent-1",
          nickname: "Nova",
          status: "running",
          isolation: "worktree",
          worktree_path: "C:/tmp/quake-agent-1",
          worktree_branch: "quake-agent-agent-1",
        },
        output: "started worker\nreading auth.ts\nok",
      },
      t2: {
        id: "t2",
        toolName: "bash",
        status: "done",
        startedAt: 150,
        updatedAt: 180,
        args: { command: "ls src" },
        details: { agent_id: "agent-1" },
        output: "src/main.ts",
      },
      other: {
        id: "other",
        toolName: "spawn_agent",
        status: "done",
        startedAt: 50,
        updatedAt: 60,
        args: { message: "other task" },
        details: { agent_id: "agent-2", nickname: "Other", status: "completed" },
      },
    } as any;

    const messages = [
      {
        id: "m1",
        customType: "subagent-notification",
        timestamp: 250,
        details: {
          id: "agent-1",
          name: "Nova",
          status: "completed",
          result: "Login fixed successfully with tests green",
          resultPreview: "Login fixed",
        },
      },
    ];

    const activity = collectAgentActivity(tools, messages, "agent-1", 50);
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.every((line) => line.text && line.id && line.role)).toBe(true);
    expect(activity.some((line) => line.role === "user" && /Fix login flow/i.test(line.text))).toBe(true);
    expect(activity.some((line) => line.role === "tool" && line.toolName === "spawn_agent")).toBe(true);
    expect(activity.some((line) => line.role === "tool" && line.toolName === "bash")).toBe(true);
    expect(
      activity.some(
        (line) =>
          line.role === "assistant" &&
          /Login fixed successfully with tests green|Login fixed/i.test(line.text),
      ),
    ).toBe(true);
    // Other agent tools must not leak into this log
    expect(activity.some((line) => /other task/i.test(line.text))).toBe(false);

    const empty = collectAgentActivity(tools, messages, "missing-agent", 50);
    expect(empty).toEqual([]);

    const capped = collectAgentActivity(tools, messages, "agent-1", 2);
    expect(capped.length).toBeLessThanOrEqual(2);
  });
});
