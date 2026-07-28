import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeSessionMetadataPath,
  normalizeWorkspaceNavigationKey,
} from "../src/client/src/app/conversation-navigation";

const root = process.cwd();
const app = readFileSync(join(root, "src/client/src/app/App.tsx"), "utf8");
const hooks = readFileSync(join(root, "src/client/src/app/hooks/index.ts"), "utf8");

describe("App orchestration boundaries", () => {
  it("delegates focused responsibilities to app hooks", () => {
    for (const hook of [
      "useAppSettings",
      "useComposerDraft",
      "useComposerModels",
      "useComposerQueue",
      "useConversationMetadata",
      "useConversationNavigation",
      "useFileWorkspace",
      "useRightDock",
      "useSessionWorkspace",
      "useTerminalWorkspace",
      "useTrustOnboarding",
    ]) {
      expect(app).toContain(`${hook}(`);
      expect(hooks).toContain(hook);
    }
  });

  it("does not duplicate extracted controller implementations in App", () => {
    expect(app).not.toContain("function routeQueuedUserMessage");
    expect(app).not.toContain("async function refreshFiles");
    expect(app).not.toContain("function selectModel");
    expect(app).not.toContain("async function runTerminal");
    expect(app).not.toContain("const onSettingsTerminalPolicy = useCallback");
    expect(app).not.toContain("function setContextChipsDraft");
  });

  it("normalizes Windows session and workspace keys consistently", () => {
    expect(normalizeSessionMetadataPath("C:\\Work\\Session.jsonl")).toBe("c:/work/session.jsonl");
    expect(normalizeSessionMetadataPath("relative/Session.jsonl")).toBe("relative/Session.jsonl");
    expect(normalizeWorkspaceNavigationKey("C:\\Work\\Project\\")).toBe("c:\\work\\project");
    expect(normalizeWorkspaceNavigationKey("/Work/Project/")).toBe("/work/project");
  });
});
