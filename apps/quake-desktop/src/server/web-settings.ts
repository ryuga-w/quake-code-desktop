import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { normalizeMcpServers } from "./mcp/config.js";
import type { McpServerConfig } from "./mcp/types.js";

export type TerminalPolicyModeSetting = "safe" | "allow-all" | "disabled";

export type WebSettings = {
  fileDir?: string;
  selectedModel?: string;
  pinnedComposerModels?: string[];
  /** Durable desktop terminal / approval policy (survives restart). */
  terminalPolicyMode?: TerminalPolicyModeSetting;
  /**
   * Cooperative agent HTTP_PROXY loopback (T2.P2 / S-NET.2).
   * When undefined, desktop may auto-enable on first boot for non-full-access
   * terminal policy (`safe` / `disabled`). Explicit `false` stays off.
   */
  agentHttpProxyEnabled?: boolean;
  /**
   * Experimental OS sandbox flag (T1). When true, sets QUAKE_OS_SANDBOX=experimental.
   * Fail-closed without a native helper — not Windows Sandbox.
   */
  osSandboxExperimental?: boolean;
  /**
   * Codex-style parallel agents: git worktree isolation default.
   * true/undefined → QUAKE_CODE_AGENT_ISOLATION=worktree; false → none.
   */
  agentWorktreeIsolation?: boolean;
  /**
   * S-TRUST.3 first-run trust onboarding dismissed (app-wide).
   * Also mirrored in client localStorage (`quake-web:trustOnboardingSeen`).
   */
  trustOnboardingSeen?: boolean;
  panels?: Record<string, boolean>;
  extensionsEnabled?: Record<string, boolean>;
  mcpServers?: McpServerConfig[];
};

type GlobalWebSettings = Pick<
  WebSettings,
  | "selectedModel"
  | "pinnedComposerModels"
  | "terminalPolicyMode"
  | "agentHttpProxyEnabled"
  | "osSandboxExperimental"
  | "agentWorktreeIsolation"
  | "trustOnboardingSeen"
>;

const GLOBAL_SETTING_KEYS = new Set<keyof WebSettings>([
  "selectedModel",
  "pinnedComposerModels",
  "terminalPolicyMode",
  "agentHttpProxyEnabled",
  "osSandboxExperimental",
  "agentWorktreeIsolation",
  "trustOnboardingSeen",
]);

function sanitizePinnedModels(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.includes("/")))]
    : undefined;
}

export function sanitizeTerminalPolicyMode(value: unknown): TerminalPolicyModeSetting | undefined {
  if (value === "safe" || value === "allow-all" || value === "disabled") return value;
  return undefined;
}

/** Strict boolean only — ignores "1"/0/null so accidental string env values do not pollute JSON. */
export function sanitizeBooleanSetting(value: unknown): boolean | undefined {
  if (value === true || value === false) return value;
  return undefined;
}

async function readJsonFile<T extends object>(path: string): Promise<T> {
  if (!existsSync(path)) return {} as T;
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return {} as T;
  }
}

async function writeJsonFile(path: string, value: object): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(path, { force: true });
  await rename(tempPath, path);
}

/**
 * Workspace settings remain in <workspace>/.quake-code/web-settings.json.
 * Application-wide model picker preferences live under the user's home directory,
 * so changing/reopening a workspace or restarting Electron cannot reset them.
 */
export class WebSettingsService {
  private readonly workspacePath: string;
  private readonly globalPath: string;
  private pendingWrite: Promise<void> = Promise.resolve();
  private cachedSettings: WebSettings = {};

  constructor(cwd: string, globalSettingsDirectory = join(homedir(), ".quake-code")) {
    this.workspacePath = join(cwd, ".quake-code", "web-settings.json");
    this.globalPath = join(globalSettingsDirectory, "desktop-settings.json");
  }

  async read(): Promise<WebSettings> {
    await this.pendingWrite.catch(() => {});
    const { settings, legacyGlobalSettings } = await this.readCurrent();

    // One-time migration from the former workspace-scoped model preferences.
    if (Object.keys(legacyGlobalSettings).length > 0) {
      const global = await this.readGlobal();
      await writeJsonFile(this.globalPath, { ...legacyGlobalSettings, ...global });
    }

    this.cachedSettings = settings;
    return settings;
  }

  private async readGlobal(): Promise<GlobalWebSettings> {
    const parsed = await readJsonFile<GlobalWebSettings>(this.globalPath);
    const terminalPolicyMode = sanitizeTerminalPolicyMode(parsed.terminalPolicyMode);
    const agentHttpProxyEnabled = sanitizeBooleanSetting(parsed.agentHttpProxyEnabled);
    const osSandboxExperimental = sanitizeBooleanSetting(parsed.osSandboxExperimental);
    const agentWorktreeIsolation = sanitizeBooleanSetting(parsed.agentWorktreeIsolation);
    const trustOnboardingSeen = sanitizeBooleanSetting(parsed.trustOnboardingSeen);
    return {
      ...(typeof parsed.selectedModel === "string" ? { selectedModel: parsed.selectedModel } : {}),
      ...(Array.isArray(parsed.pinnedComposerModels) ? { pinnedComposerModels: sanitizePinnedModels(parsed.pinnedComposerModels) } : {}),
      ...(terminalPolicyMode !== undefined ? { terminalPolicyMode } : {}),
      ...(agentHttpProxyEnabled !== undefined ? { agentHttpProxyEnabled } : {}),
      ...(osSandboxExperimental !== undefined ? { osSandboxExperimental } : {}),
      ...(agentWorktreeIsolation !== undefined ? { agentWorktreeIsolation } : {}),
      ...(trustOnboardingSeen !== undefined ? { trustOnboardingSeen } : {}),
    };
  }

  private async readCurrent(): Promise<{ settings: WebSettings; legacyGlobalSettings: GlobalWebSettings }> {
    const parsed = await readJsonFile<WebSettings>(this.workspacePath);
    const global = await this.readGlobal();
    const legacyGlobalSettings: GlobalWebSettings = {};

    if (global.selectedModel === undefined && typeof parsed.selectedModel === "string") {
      legacyGlobalSettings.selectedModel = parsed.selectedModel;
    }
    if (global.pinnedComposerModels === undefined && Array.isArray(parsed.pinnedComposerModels)) {
      legacyGlobalSettings.pinnedComposerModels = sanitizePinnedModels(parsed.pinnedComposerModels);
    }
    if (global.terminalPolicyMode === undefined) {
      const legacyPolicy = sanitizeTerminalPolicyMode(parsed.terminalPolicyMode);
      if (legacyPolicy !== undefined) legacyGlobalSettings.terminalPolicyMode = legacyPolicy;
    }
    if (global.agentHttpProxyEnabled === undefined) {
      const legacyProxy = sanitizeBooleanSetting(parsed.agentHttpProxyEnabled);
      if (legacyProxy !== undefined) legacyGlobalSettings.agentHttpProxyEnabled = legacyProxy;
    }
    if (global.osSandboxExperimental === undefined) {
      const legacyOs = sanitizeBooleanSetting(parsed.osSandboxExperimental);
      if (legacyOs !== undefined) legacyGlobalSettings.osSandboxExperimental = legacyOs;
    }
    if (global.agentWorktreeIsolation === undefined) {
      const legacyWt = sanitizeBooleanSetting(parsed.agentWorktreeIsolation);
      if (legacyWt !== undefined) legacyGlobalSettings.agentWorktreeIsolation = legacyWt;
    }
    if (global.trustOnboardingSeen === undefined) {
      const legacyTrust = sanitizeBooleanSetting(parsed.trustOnboardingSeen);
      if (legacyTrust !== undefined) legacyGlobalSettings.trustOnboardingSeen = legacyTrust;
    }

    const selectedModel = global.selectedModel ?? legacyGlobalSettings.selectedModel;
    const pinnedComposerModels = global.pinnedComposerModels ?? legacyGlobalSettings.pinnedComposerModels;
    const terminalPolicyMode = global.terminalPolicyMode ?? legacyGlobalSettings.terminalPolicyMode;
    const agentHttpProxyEnabled = global.agentHttpProxyEnabled ?? legacyGlobalSettings.agentHttpProxyEnabled;
    const osSandboxExperimental = global.osSandboxExperimental ?? legacyGlobalSettings.osSandboxExperimental;
    const agentWorktreeIsolation = global.agentWorktreeIsolation ?? legacyGlobalSettings.agentWorktreeIsolation;
    const trustOnboardingSeen = global.trustOnboardingSeen ?? legacyGlobalSettings.trustOnboardingSeen;
    return {
      settings: {
        ...parsed,
        ...(selectedModel !== undefined ? { selectedModel } : {}),
        ...(pinnedComposerModels !== undefined ? { pinnedComposerModels } : {}),
        ...(terminalPolicyMode !== undefined ? { terminalPolicyMode } : {}),
        ...(agentHttpProxyEnabled !== undefined ? { agentHttpProxyEnabled } : {}),
        ...(osSandboxExperimental !== undefined ? { osSandboxExperimental } : {}),
        ...(agentWorktreeIsolation !== undefined ? { agentWorktreeIsolation } : {}),
        ...(trustOnboardingSeen !== undefined ? { trustOnboardingSeen } : {}),
        mcpServers: normalizeMcpServers(parsed.mcpServers, dirname(dirname(this.workspacePath))),
      },
      legacyGlobalSettings,
    };
  }

  async patch(patch: WebSettings): Promise<WebSettings> {
    const run = async () => {
      const { settings: current } = await this.readCurrent();
      const workspacePatch = Object.fromEntries(
        Object.entries(patch).filter(([key]) => !GLOBAL_SETTING_KEYS.has(key as keyof WebSettings)),
      ) as WebSettings;
      const currentWorkspace = await readJsonFile<WebSettings>(this.workspacePath);
      const nextWorkspace = {
        ...currentWorkspace,
        ...workspacePatch,
        panels: { ...currentWorkspace.panels, ...workspacePatch.panels },
        extensionsEnabled: { ...currentWorkspace.extensionsEnabled, ...workspacePatch.extensionsEnabled },
        mcpServers: workspacePatch.mcpServers
          ? normalizeMcpServers(workspacePatch.mcpServers, dirname(dirname(this.workspacePath)))
          : currentWorkspace.mcpServers,
      };

      const patchedTerminalPolicy = sanitizeTerminalPolicyMode(patch.terminalPolicyMode);
      const patchedAgentHttpProxy = Object.prototype.hasOwnProperty.call(patch, "agentHttpProxyEnabled")
        ? sanitizeBooleanSetting(patch.agentHttpProxyEnabled)
        : undefined;
      const patchedOsSandbox = Object.prototype.hasOwnProperty.call(patch, "osSandboxExperimental")
        ? sanitizeBooleanSetting(patch.osSandboxExperimental)
        : undefined;
      const patchedWorktree = Object.prototype.hasOwnProperty.call(patch, "agentWorktreeIsolation")
        ? sanitizeBooleanSetting(patch.agentWorktreeIsolation)
        : undefined;
      const patchedTrustOnboarding = Object.prototype.hasOwnProperty.call(patch, "trustOnboardingSeen")
        ? sanitizeBooleanSetting(patch.trustOnboardingSeen)
        : undefined;
      const globalPatch: GlobalWebSettings = {
        ...(typeof patch.selectedModel === "string" ? { selectedModel: patch.selectedModel } : {}),
        ...(Array.isArray(patch.pinnedComposerModels) ? { pinnedComposerModels: sanitizePinnedModels(patch.pinnedComposerModels) } : {}),
        ...(patchedTerminalPolicy !== undefined ? { terminalPolicyMode: patchedTerminalPolicy } : {}),
        ...(patchedAgentHttpProxy !== undefined ? { agentHttpProxyEnabled: patchedAgentHttpProxy } : {}),
        ...(patchedOsSandbox !== undefined ? { osSandboxExperimental: patchedOsSandbox } : {}),
        ...(patchedWorktree !== undefined ? { agentWorktreeIsolation: patchedWorktree } : {}),
        ...(patchedTrustOnboarding !== undefined ? { trustOnboardingSeen: patchedTrustOnboarding } : {}),
      };
      const currentGlobal = await this.readGlobal();
      const nextGlobal = { ...currentGlobal, ...globalPatch };

      if (Object.keys(workspacePatch).length > 0) await writeJsonFile(this.workspacePath, nextWorkspace);
      if (Object.keys(globalPatch).length > 0) await writeJsonFile(this.globalPath, nextGlobal);

      const next: WebSettings = {
        ...current,
        ...workspacePatch,
        ...nextGlobal,
        panels: { ...current.panels, ...workspacePatch.panels },
        extensionsEnabled: { ...current.extensionsEnabled, ...workspacePatch.extensionsEnabled },
        mcpServers: workspacePatch.mcpServers
          ? normalizeMcpServers(workspacePatch.mcpServers, dirname(dirname(this.workspacePath)))
          : current.mcpServers,
      };
      this.cachedSettings = next;
      return next;
    };
    const result = this.pendingWrite.then(run, run);
    this.pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }

  getExtensionsEnabled(): Record<string, boolean | undefined> {
    return this.cachedSettings.extensionsEnabled || {};
  }

  async setExtensionEnabled(name: string, enabled: boolean): Promise<void> {
    const { settings: current } = await this.readCurrent();
    const extensionsEnabled = { ...(current.extensionsEnabled || {}), [name]: enabled };
    await this.patch({ extensionsEnabled });
  }
}
