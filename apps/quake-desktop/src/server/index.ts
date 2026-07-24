import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, parse, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { WebClientCommand, WebCommandResponse, WebServerConfig, WebSideConversationSnapshot } from "../shared/protocol.js";
import {
	builtinApprovalPresets,
	clearDurableGuardianAllows,
	ensureAgentHttpProxy,
	flushGuardianAlwaysWrites,
	getAgentHttpProxyInfo,
	guardianRuntime,
	listDurableGuardianAllows,
	loadDurableGuardianAllows,
	loadDurableNetworkHosts,
	removeGuardianAlwaysCommandKey,
	removeGuardianAlwaysHost,
	removeGuardianAlwaysPrefix,
	resolveOsSandboxBackend,
	resolveOsSandboxMode,
	setGlobalApprovalEmitter,
	shouldAutoEnableAgentHttpProxy,
	stopAgentHttpProxy,
} from "@mrquake/quakecode-cli";
import { SseHub } from "./sse.js";
import { WebRuntimeController } from "./runtime.js";
import { WebFileService } from "./files.js";
import { WebTerminalService } from "./terminal.js";
import { WebAuth } from "./auth.js";
import { AccountAuthService } from "./account-auth.js";
import { AccountHttpController, isAccountApiPath } from "./account-http.js";
import { AsyncLock, SingleFlight } from "./locks.js";
import { parseWorkspaceAllowlist, validateWebSecurity } from "./security.js";
import { TerminalPolicy, parseTerminalPolicyMode } from "./terminal-policy.js";
import { WebSettingsService } from "./web-settings.js";
import type { WebSettings } from "./web-settings.js";
import { ConversationMetadataService } from "./conversation-metadata.js";
import { staticCacheControl } from "./static-cache.js";
import { assertMcpNoPlaintextSecrets, normalizeMcpServer } from "./mcp/config.js";
import {
  clearMcpAlwaysAllows,
  flushMcpAlwaysAllowWrites,
  listMcpAlwaysAllows,
  loadDurableMcpAlwaysAllows,
  removeMcpAlwaysAllow,
} from "./mcp/approval-cache.js";
import { McpConnectionManager } from "./mcp/manager.js";
import { setMcpElicitationEmitter, respondMcpElicitation } from "./mcp/elicitation-bus.js";
import { setMcpToolApprovalEmitter, respondMcpToolApproval } from "./mcp/tool-approval-bus.js";
import { FileHistoryService } from "./file-history.js";
import { FileMutationService } from "./file-mutations.js";
import { undoTurnFileChanges, type TurnFileUndoEntry } from "./turn-file-undo.js";
import { Scheduler, SchedulerError } from "./scheduler.js";
import { searchAll, type SearchableSession } from "./search.js";
import { attachTerminalWebSocket } from "./terminal-pty.js";
import { MobileRuntime } from "./mobile/runtime.js";
import { attachMobileStreamWebSocket, resolveScrcpyExecutable } from "./mobile/scrcpy-stream.js";
import { MobileApiError, MobileRateLimiter, requireAndroid, requireDeviceId, requirePackage } from "./mobile/validation.js";
import { mobileFeatureFlags } from "./mobile/features.js";
import type { MobileAction } from "./mobile/types.js";
import {
  listRecentTrajectorySteps,
  loadComputerUsePolicy,
  probeComputerUseBridge,
  saveComputerUsePolicy,
} from "./computer-use.js";
import {
  getApiKeyEnvVar,
  getCloudDocsHint,
  getProviderList,
  isApiKeyProviderId,
  isKnownProviderId,
  isOAuthProviderId,
} from "./auth-providers.js";
import {
  addApiKeyAccount,
  captureOAuthFromAuthStorage,
  clearProviderAccounts,
  getPoolMeta,
  listAccountSummaries,
  removeAccount,
  reorderAccounts,
  setActiveAccount,
  setRotationEnabled,
} from "./provider-accounts.js";
import { getOAuthProvider } from "@mrquake/quakecode-ai/oauth";
import { parseWorkspaceRootsJson, WorkspaceRegistry } from "./workspace-registry.js";
import {
  readArtifactTemplateCatalog,
  readArtifactTemplatePreview,
  readArtifactTemplateSkill,
  type ArtifactTemplateKind,
} from "./artifact-templates.js";

// Match qm / CLI launcher behavior: if QUAKE_CODE_CODING_AGENT_DIR is not set,
// prefer ~/.grok/agent (where user keeps Azure AI Foundry anthropic models.json)
// so custom overrides like claude-opus-4-8 appear in quake-web model lists.
const GROK_AGENT_DIR = join(homedir(), ".grok", "agent");
if (!process.env.QUAKE_CODE_CODING_AGENT_DIR && existsSync(join(GROK_AGENT_DIR, "models.json"))) {
  process.env.QUAKE_CODE_CODING_AGENT_DIR = GROK_AGENT_DIR;
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "../..");

function readAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
function isMcpSecretReferenceValue(value: string): boolean {
  // Keep ${env:NAME}, ${vault:NAME}, and safe prefixes like "Bearer ${vault:NAME}".
  if (!/\$\{(?:env|vault):[A-Za-z_][A-Za-z0-9_]*\}/.test(value)) return false;
  const stripped = value.replace(/\$\{(?:env|vault):[A-Za-z_][A-Za-z0-9_]*\}/g, "");
  return !/[A-Za-z0-9+/=_-]{12,}/.test(stripped);
}

function redactMcpConfig(config: any): any {
  const redact = (values: Record<string, string> | undefined) => values
    ? Object.fromEntries(Object.entries(values).map(([key, value]) => [key, isMcpSecretReferenceValue(value) ? value : "${env:REDACTED}"]))
    : undefined;
  return config?.transport === "stdio"
    ? { ...config, env: redact(config.env) }
    : { ...config, headers: redact(config?.headers) };
}

function redactMcpSnapshot(snapshot: any): any {
  return snapshot ? { ...snapshot, config: redactMcpConfig(snapshot.config) } : snapshot;
}

const sourceClientDir = join(projectRoot, "src", "client");
const builtClientDir = join(projectRoot, "dist", "client");
// Electron passes the exact asar path for packaged builds. Do not fall back to
// src/client there: that page is a Vite development warning, not a production UI.
const configuredPublicDir = process.env.QUAKE_WEB_PUBLIC_DIR?.trim();
const publicDir = configuredPublicDir || (existsSync(join(builtClientDir, "index.html")) ? builtClientDir : sourceClientDir);
const port = Number(process.env.QUAKE_WEB_PORT ?? 3737);
const host = process.env.QUAKE_WEB_HOST ?? "127.0.0.1";

const hub = new SseHub();
const workspaceCwd = resolve(process.env.QUAKE_WEB_CWD ?? process.cwd());
const workspaceAllowlist = parseWorkspaceAllowlist(process.env.QUAKE_WEB_WORKSPACE_ALLOWLIST);
validateWebSecurity({
  host,
  cwd: workspaceCwd,
  allowRemoteAccess: process.env.QUAKE_WEB_ALLOW_REMOTE === "1",
  workspaceAllowlist,
});
const workspaceRegistry = new WorkspaceRegistry(workspaceCwd);
for (const candidate of parseWorkspaceRootsJson(process.env.QUAKE_WEB_WORKSPACE_ROOTS_JSON)) {
  try {
    workspaceRegistry.add(await validateWorkspacePath(candidate));
  } catch (error) {
    console.warn("[workspace] persisted root ignored", candidate, error instanceof Error ? error.message : error);
  }
}
let currentWorkspaceCwd = workspaceCwd;
const auth = new WebAuth(workspaceCwd);
const accountAuth = new AccountAuthService();
const accountHttp = new AccountHttpController(accountAuth);
process.env.QUAKE_MOBILE_API_BASE = `http://127.0.0.1:${port}`;
process.env.QUAKE_MOBILE_API_TOKEN = auth.token;
const initialWebSettingsService = new WebSettingsService(workspaceCwd);
const conversationMetadata = new ConversationMetadataService();
const initialWebSettings = await initialWebSettingsService.read();
// Durable MCP always-allow cache must load before tools can run.
await loadDurableMcpAlwaysAllows();
// Durable guardian always-allows (commandKeys / prefixes / hosts) — session clear does NOT wipe.
await loadDurableGuardianAllows();
// S-NET.1: durable network host allow/deny (~/.quake-code/agent/network-hosts.json)
await loadDurableNetworkHosts().catch((error) => {
  console.warn("[quake-web] durable network hosts load failed", error instanceof Error ? error.message : error);
});

type WorkspaceServices = {
  root: string;
  webSettings: WebSettingsService;
  settings: WebSettings;
  mcpManager: McpConnectionManager;
  files: WebFileService;
  fileHistory: FileHistoryService;
  fileMutations: FileMutationService;
  terminal?: WebTerminalService;
};

const workspaceServices = new Map<string, WorkspaceServices>();
let runtime: WebRuntimeController | undefined;

function workspaceServiceKey(root: string): string {
  const normalized = resolve(root);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function createWorkspaceMcpManager(root: string): McpConnectionManager {
  let manager: McpConnectionManager;
  manager = new McpConnectionManager(() => {
    if (workspaceServiceKey(root) === workspaceServiceKey(currentWorkspaceCwd)) {
      hub.send({ type: "mcp_status", servers: manager.list().map(redactMcpSnapshot) } as any);
    }
    runtime?.syncMcpTools(root);
  });
  return manager;
}

async function ensureWorkspaceServices(
  root: string,
  preload?: { webSettings: WebSettingsService; settings: WebSettings },
): Promise<WorkspaceServices> {
  const normalized = resolve(root);
  const key = workspaceServiceKey(normalized);
  const existing = workspaceServices.get(key);
  if (existing) return existing;

  const workspaceSettings = preload?.webSettings ?? new WebSettingsService(normalized);
  const settings = preload?.settings ?? await workspaceSettings.read();
  const workspaceMcpManager = createWorkspaceMcpManager(normalized);
  await workspaceMcpManager.reconcile(settings.mcpServers || []);
  const fileHistory = new FileHistoryService(normalized);
  await fileHistory.init();
  const services: WorkspaceServices = {
    root: normalized,
    webSettings: workspaceSettings,
    settings,
    mcpManager: workspaceMcpManager,
    files: new WebFileService(normalized),
    fileHistory,
    fileMutations: new FileMutationService(normalized, fileHistory),
  };
  workspaceServices.set(key, services);
  return services;
}

const initialWorkspaceServices = await ensureWorkspaceServices(workspaceCwd, {
  webSettings: initialWebSettingsService,
  settings: initialWebSettings,
});
let webSettings = initialWorkspaceServices.webSettings;
let mcpManager = initialWorkspaceServices.mcpManager;
// MCP elicitation/create → desktop composer card
setMcpElicitationEmitter({
  emit: (req) => {
    hub.send({
      type: "mcp_elicitation_request",
      id: req.id,
      serverId: req.serverId,
      serverName: req.serverName,
      mode: req.mode,
      message: req.message,
      fields: req.fields,
      url: req.url,
      elicitationId: req.elicitationId,
      createdAt: req.createdAt,
    } as any);
  },
});
// MCP tool approval → same approval_request surface as guardian
setMcpToolApprovalEmitter({
  emit: (req) => {
    hub.send({
      type: "approval_request",
      id: req.id,
      tool: req.tool.qualifiedName || req.tool.name,
      summary: req.summary,
      command: req.paramsPreview,
      reason: req.reason,
      risk: req.risk,
      availableDecisions: ["accept", "acceptForSession", "acceptAlways", "decline", "cancel"],
      kind: "mcp_tool",
      presetLabel: "MCP",
      mcp: {
        serverId: req.serverId,
        toolName: req.tool.name,
      },
    } as any);
  },
});
runtime = await WebRuntimeController.create(
  hub,
  workspaceCwd,
  (cwd) => workspaceServices.get(workspaceServiceKey(cwd))?.webSettings.getExtensionsEnabled() || {},
  (cwd) => workspaceServices.get(workspaceServiceKey(cwd))?.mcpManager,
);
const activeRuntime = runtime;

async function restorePreferredModel(settings: { selectedModel?: string }): Promise<void> {
  const separator = settings.selectedModel?.indexOf("/") ?? -1;
  if (!settings.selectedModel || separator <= 0) return;
  const provider = settings.selectedModel.slice(0, separator);
  const modelId = settings.selectedModel.slice(separator + 1);
  const available = await activeRuntime.listModels();
  if (!available.some((model) => model.provider === provider && model.id === modelId)) return;
  await activeRuntime.setModel(provider, modelId);
}

await restorePreferredModel(initialWebSettings).catch((error) => {
  console.warn("[settings] persisted model could not be restored", error);
});
let files = initialWorkspaceServices.files;
// Priority: persisted desktop setting → env → default "safe"
const persistedTerminalPolicy =
  initialWebSettings.terminalPolicyMode === "safe"
  || initialWebSettings.terminalPolicyMode === "allow-all"
  || initialWebSettings.terminalPolicyMode === "disabled"
    ? initialWebSettings.terminalPolicyMode
    : undefined;
let terminalPolicyMode = persistedTerminalPolicy
  ?? parseTerminalPolicyMode(process.env.QUAKE_WEB_TERMINAL_POLICY);
let terminal = new WebTerminalService(workspaceCwd, new TerminalPolicy(terminalPolicyMode));
initialWorkspaceServices.terminal = terminal;

// Codex guardian: map terminal policy → approval presets + SSE approval prompts
try {
  guardianRuntime.setWorkspaceRoot(workspaceCwd);
  guardianRuntime.setFromTerminalPolicy(terminalPolicyMode);
  setGlobalApprovalEmitter({
    emit: (req) => {
      const preset = guardianRuntime.getPreset();
      const details = (req.details || {}) as Record<string, unknown>;
      const approvalKind =
        req.kind ||
        (details.kind === "file_change" || Array.isArray(details.files)
          ? "file_change"
          : req.command || details.command
            ? "exec"
            : "generic");
      const fileChange =
        approvalKind === "file_change" || details.kind === "file_change" || Array.isArray(details.files)
          ? {
              files: Array.isArray(details.files)
                ? (details.files as Array<{ path: string; kind: string; added: number; removed: number }>)
                : [],
              patchPreview:
                typeof details.patchPreview === "string" ? details.patchPreview : undefined,
            }
          : undefined;
      hub.send({
        type: "approval_request",
        id: req.id,
        tool: req.tool,
        summary: req.summary,
        command: req.command || (typeof details.patchPreview === "string" ? details.patchPreview : undefined),
        reason: req.reason,
        risk: req.risk,
        availableDecisions: req.availableDecisions,
        presetLabel: preset.label,
        kind: approvalKind,
        fileChange,
        proposedExecpolicyAmendment: req.proposedExecpolicyAmendment,
        networkApprovalContext: req.networkApprovalContext,
        proposedNetworkPolicyAmendments: req.proposedNetworkPolicyAmendments,
      } as any);
    },
  });
} catch (err) {
  console.warn("[quake-web] guardian init failed", err);
}
let fileHistory = initialWorkspaceServices.fileHistory;
let fileMutations = initialWorkspaceServices.fileMutations;
const runtimeLock = new AsyncLock();
const terminalLock = new SingleFlight();
const mobileRuntime = new MobileRuntime(workspaceCwd);
const mobileRateLimiter = new MobileRateLimiter();

function wireScheduler(instance: Scheduler): Scheduler {
  instance.setTaskRunner(async (task) => {
    await activeRuntime.prompt(task.prompt);
  });
  instance.start();
  return instance;
}

let scheduler = wireScheduler(new Scheduler(workspaceCwd));

function approvalMetaFromPolicy(mode: typeof terminalPolicyMode): {
  approvalPresetId: "read-only" | "auto" | "full-access";
  approvalPresetLabel: string;
} {
  if (mode === "allow-all") return { approvalPresetId: "full-access", approvalPresetLabel: "Full Access" };
  if (mode === "disabled") return { approvalPresetId: "read-only", approvalPresetLabel: "Read Only" };
  return { approvalPresetId: "auto", approvalPresetLabel: "Default" };
}

/** Last proxy start error (for UI status pill); cleared on success or disable. */
let agentHttpProxyLastError: string | null = null;

function osSandboxHelperPath(): string | null {
  const raw = String(process.env.QUAKE_COMMAND_RUNNER || "").trim();
  return raw || null;
}

function applyOsSandboxExperimentalFlag(experimental: boolean): void {
  if (experimental) {
    process.env.QUAKE_OS_SANDBOX = "experimental";
  } else {
    delete process.env.QUAKE_OS_SANDBOX;
  }
}

function isolationConfigSlice(): Pick<
  WebServerConfig,
  | "agentHttpProxyEnabled"
  | "agentHttpProxyUrl"
  | "agentHttpProxyStatus"
  | "agentHttpProxyError"
  | "osSandboxMode"
  | "osSandboxBackendId"
  | "osSandboxAvailable"
  | "osSandboxHelperPath"
  | "osSandboxExperimental"
  | "agentWorktreeIsolation"
> {
  const proxyEnabled = process.env.QUAKE_AGENT_HTTP_PROXY === "1";
  const proxyInfo = getAgentHttpProxyInfo();
  let agentHttpProxyStatus: "off" | "active" | "error" = "off";
  if (proxyEnabled) {
    agentHttpProxyStatus = proxyInfo ? "active" : "error";
  }
  const mode = resolveOsSandboxMode();
  const backend = resolveOsSandboxBackend();
  const experimental = mode === "experimental";
  const isolationRaw = String(process.env.QUAKE_CODE_AGENT_ISOLATION || "worktree").toLowerCase().trim();
  const agentWorktreeIsolation = !(isolationRaw === "none" || isolationRaw === "off" || isolationRaw === "0" || isolationRaw === "false");
  return {
    agentHttpProxyEnabled: proxyEnabled,
    agentHttpProxyUrl: proxyInfo?.url ?? null,
    agentHttpProxyStatus,
    agentHttpProxyError: agentHttpProxyLastError,
    osSandboxMode: mode,
    osSandboxBackendId: backend.id,
    osSandboxAvailable: backend.available,
    osSandboxHelperPath: osSandboxHelperPath(),
    osSandboxExperimental: experimental,
    agentWorktreeIsolation,
  };
}

function refreshIsolationConfig(): void {
  Object.assign(serverConfig, isolationConfigSlice());
}

async function setAgentHttpProxyEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    process.env.QUAKE_AGENT_HTTP_PROXY = "1";
    try {
      const info = await ensureAgentHttpProxy();
      agentHttpProxyLastError = info ? null : "Proxy başlatılamadı";
    } catch (error) {
      agentHttpProxyLastError = error instanceof Error ? error.message : String(error);
      console.warn("[quake-web] agent HTTP proxy start failed", agentHttpProxyLastError);
    }
  } else {
    delete process.env.QUAKE_AGENT_HTTP_PROXY;
    agentHttpProxyLastError = null;
    try {
      await stopAgentHttpProxy();
    } catch (error) {
      console.warn("[quake-web] agent HTTP proxy stop failed", error instanceof Error ? error.message : error);
    }
  }
  await webSettings.patch({ agentHttpProxyEnabled: enabled }).catch((error) => {
    console.warn("[settings] agentHttpProxyEnabled persist failed", error);
  });
  refreshIsolationConfig();
}

async function setOsSandboxExperimental(experimental: boolean): Promise<void> {
  applyOsSandboxExperimentalFlag(experimental);
  await webSettings.patch({ osSandboxExperimental: experimental }).catch((error) => {
    console.warn("[settings] osSandboxExperimental persist failed", error);
  });
  refreshIsolationConfig();
}

function applyAgentWorktreeIsolationFlag(enabled: boolean): void {
  // Default for Codex parallel agents is worktree; "none" only when user disables.
  process.env.QUAKE_CODE_AGENT_ISOLATION = enabled ? "worktree" : "none";
}

async function setAgentWorktreeIsolation(enabled: boolean): Promise<void> {
  applyAgentWorktreeIsolationFlag(enabled);
  await webSettings.patch({ agentWorktreeIsolation: enabled }).catch((error) => {
    console.warn("[settings] agentWorktreeIsolation persist failed", error);
  });
  refreshIsolationConfig();
}

// Restore isolation flags from durable desktop settings (global) before tools run.
// Explicit process env from launcher wins; otherwise honor persisted Settings.
const envOsSandboxSet = String(process.env.QUAKE_OS_SANDBOX || "").trim() !== "";
if (!envOsSandboxSet && initialWebSettings.osSandboxExperimental === true) {
  applyOsSandboxExperimentalFlag(true);
}
const envAgentProxyOn = ["1", "true", "on", "yes"].includes(
  String(process.env.QUAKE_AGENT_HTTP_PROXY || "").toLowerCase().trim(),
);
// S-NET.2: default-on cooperative proxy for non-full-access when never persisted.
// Explicit false stays off; env and explicit true still force on.
const terminalPolicyForProxy = initialWebSettings.terminalPolicyMode ?? "safe";
const proxyPersisted = initialWebSettings.agentHttpProxyEnabled;
const autoEnableAgentProxy =
  proxyPersisted === undefined &&
  !envAgentProxyOn &&
  shouldAutoEnableAgentHttpProxy(terminalPolicyForProxy);
if (envAgentProxyOn || proxyPersisted === true || autoEnableAgentProxy) {
  process.env.QUAKE_AGENT_HTTP_PROXY = "1";
  try {
    const info = await ensureAgentHttpProxy();
    agentHttpProxyLastError = info ? null : "Proxy başlatılamadı";
  } catch (error) {
    agentHttpProxyLastError = error instanceof Error ? error.message : String(error);
    console.warn("[quake-web] agent HTTP proxy boot failed", agentHttpProxyLastError);
  }
  // First-boot auto-enable: persist true so Settings reflects the live default.
  if (autoEnableAgentProxy) {
    await webSettings.patch({ agentHttpProxyEnabled: true }).catch((error) => {
      console.warn("[settings] agentHttpProxyEnabled first-boot persist failed", error);
    });
  }
}
const envAgentIsolationSet = String(process.env.QUAKE_CODE_AGENT_ISOLATION || "").trim() !== "";
if (!envAgentIsolationSet) {
  // Default worktree ON (Codex parity) unless user persisted false.
  applyAgentWorktreeIsolationFlag(initialWebSettings.agentWorktreeIsolation !== false);
}

const serverConfig: WebServerConfig = {
  host,
  port,
  workspaceRoots: workspaceRegistry.list(),
  cwd: currentWorkspaceCwd,
  authEnabled: auth.enabled,
  terminalEnabled: terminalPolicyMode !== "disabled",
  terminalPolicyMode,
  ...approvalMetaFromPolicy(terminalPolicyMode),
  maxFilePreviewBytes: 1024 * 1024,
  workspaceAllowlist,
  version: readAppVersion(),
  ...isolationConfigSlice(),
};

function securityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

type WorkspaceRoot = { label: string; path: string; kind: "current" | "home" | "folder" | "drive" };

function uniqueRoots(roots: WorkspaceRoot[]): WorkspaceRoot[] {
  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = resolve(root.path).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function directoryExists(path: string): Promise<boolean> {
  return Boolean((await stat(path).catch(() => undefined))?.isDirectory());
}

async function getWorkspaceRoots(): Promise<{ roots: WorkspaceRoot[]; workspaceRoots: string[]; activeRoot: string }> {
  const home = homedir();
  const candidates: WorkspaceRoot[] = [
    { label: "Geçerli çalışma alanı", path: currentWorkspaceCwd, kind: "current" },
    { label: "Ana klasör", path: home, kind: "home" },
    { label: "Masaüstü", path: join(home, "Desktop"), kind: "folder" },
    { label: "İndirilenler", path: join(home, "Downloads"), kind: "folder" },
    { label: "Belgeler", path: join(home, "Documents"), kind: "folder" },
  ];

  if (process.platform === "win32") {
    for (let code = 67; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      candidates.push({ label: drive.replace("\\", ""), path: drive, kind: "drive" });
    }
  } else {
    candidates.push({ label: "Kök", path: "/", kind: "drive" });
  }

  const roots: WorkspaceRoot[] = [];
  for (const root of uniqueRoots(candidates)) {
    if (await directoryExists(root.path)) roots.push(root);
  }
  return { roots, workspaceRoots: workspaceRegistry.list(), activeRoot: workspaceRegistry.active };
}

async function listWorkspaceFolders(input?: string): Promise<{ path: string; parent?: string; entries: Array<{ name: string; path: string }> }> {
  const target = input ? resolve(input) : currentWorkspaceCwd;
  const info = await stat(target).catch(() => undefined);
  const dir = info?.isDirectory() ? target : resolve(target, "..");
  const parsed = parse(dir);
  const parent = dir === parsed.root ? undefined : resolve(dir, "..");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const folders = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({ name: entry.name, path: resolve(dir, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .slice(0, 300);
  return { path: dir, parent, entries: folders };
}

/** Git yok: depo durumu takip edilmez. Ajan araçlarından gelen canlı özet istemci tarafında. */
async function getWorkspaceChanges(): Promise<{ files: number; added: number; removed: number; paths: string[] }> {
  return { files: 0, added: 0, removed: 0, paths: [] };
}

async function validateWorkspacePath(input: string): Promise<string> {
  const target = resolve(input || "");
  const info = await stat(target).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error("Çalışma alanı yolu klasör değil");
  if (workspaceAllowlist.length > 0 && !workspaceAllowlist.some((root) => target === root || target.startsWith(`${root}\\`) || target.startsWith(`${root}/`))) {
    throw new Error("Çalışma alanı izin verilen konumların dışında");
  }
  return target;
}

async function prepareWorkspaceServices(nextCwd: string): Promise<void> {
  const validatedCwd = await validateWorkspacePath(nextCwd);
  const services = await ensureWorkspaceServices(validatedCwd);
  services.settings = await services.webSettings.read();
  await services.mcpManager.reconcile(services.settings.mcpServers || []);
  services.terminal ??= new WebTerminalService(validatedCwd, new TerminalPolicy(terminalPolicyMode));

  workspaceRegistry.activate(validatedCwd);
  currentWorkspaceCwd = validatedCwd;
  serverConfig.cwd = validatedCwd;
  serverConfig.workspaceRoots = workspaceRegistry.list();
  webSettings = services.webSettings;
  mcpManager = services.mcpManager;
  files = services.files;
  fileHistory = services.fileHistory;
  fileMutations = services.fileMutations;
  terminal = services.terminal;
  mobileRuntime.setWorkspace(validatedCwd);

  // Keep Codex approval preset sandbox rooted on the active workspace. Tool
  // gates still re-assert their own session cwd before every execution.
  try {
    guardianRuntime.setWorkspaceRoot(validatedCwd);
    guardianRuntime.setFromTerminalPolicy(terminalPolicyMode);
  } catch {
    /* non-fatal */
  }
  scheduler.stop();
  scheduler = wireScheduler(new Scheduler(validatedCwd));
}

async function activatePreparedWorkspace(nextCwd: string): Promise<void> {
  const services = workspaceServices.get(workspaceServiceKey(nextCwd));
  if (!services) throw new Error("Çalışma alanı servisleri hazırlanmadı");
  await restorePreferredModel(services.settings).catch((error) => {
    console.warn("[settings] persisted model could not be restored after workspace change", error);
  });
}

activeRuntime.setWorkspaceContextHooks({
  prepare: prepareWorkspaceServices,
  activated: activatePreparedWorkspace,
});

const QUICK_ADJECTIVES = [
  "swift", "bright", "calm", "bold", "quiet", "eager", "gentle", "keen",
  "lucid", "noble", "rapid", "serene", "vivid", "warm", "crisp", "fair",
  "peaceful", "excited", "curious", "brave", "clear", "happy", "kind", "open",
];
const QUICK_NOUNS = [
  "nova", "orbit", "river", "summit", "harbor", "cedar", "falcon", "maple",
  "pixel", "quartz", "ridge", "spark", "tide", "valley", "wave", "zenith",
  "archimedes", "volta", "carson", "newton", "curie", "tesla", "hopper", "turing",
];

function randomProjectSlug(): string {
  const a = QUICK_ADJECTIVES[Math.floor(Math.random() * QUICK_ADJECTIVES.length)];
  const n = QUICK_NOUNS[Math.floor(Math.random() * QUICK_NOUNS.length)];
  return `${a}-${n}`;
}

async function createQuickProjectDir(): Promise<string> {
  const docs = join(homedir(), "Documents");
  const root = join(docs, "QuakeProjects");
  await mkdir(root, { recursive: true });
  let dir = join(root, randomProjectSlug());
  let tries = 0;
  while (existsSync(dir) && tries < 12) {
    dir = join(root, `${randomProjectSlug()}-${Date.now().toString(36).slice(-3)}`);
    tries += 1;
  }
  await mkdir(dir, { recursive: true });
  return dir;
}

async function resolveNoProjectDir(): Promise<string> {
  const dir = join(homedir(), ".quake-code", "no-project");
  await mkdir(dir, { recursive: true });
  return dir;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}

function errorStatusCode(error: unknown): number {
  if (error instanceof MobileApiError) return error.status;
  const statusCode = Number((error as { statusCode?: number } | undefined)?.statusCode);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : 500;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function parseCommand(req: IncomingMessage): Promise<WebClientCommand> {
  const text = await readBody(req);
  return JSON.parse(text || "{}") as WebClientCommand;
}

function ok(id: string | undefined, command: WebClientCommand["type"], data?: any): WebCommandResponse {
  return { type: "command_response", id, command, success: true, data };
}

function fail(id: string | undefined, command: string, error: unknown): WebCommandResponse {
  return { type: "command_response", id, command, success: false, error: error instanceof Error ? error.message : String(error) };
}

async function handleCommand(command: WebClientCommand): Promise<WebCommandResponse> {
  try {
    if (
      command.type === "new_session" ||
      command.type === "open_workspace" ||
      command.type === "open_workspaces" ||
      command.type === "create_quick_project" ||
      command.type === "clear_workspace" ||
      command.type === "switch_session" ||
      command.type === "fork_session"
    ) {
      activeRuntime.cancelPendingInteractions();
    }

    switch (command.type) {
      case "prompt": {
        await activeRuntime.applyConversationMode(command.conversationMode);
        // Do not block the HTTP request on the full agent turn — stream via SSE.
        // This keeps abort / switch_session responsive while a reply is generating.
        // Codex: active turn + UserInput → steer (default when streamingBehavior omitted).
        void activeRuntime
          .prompt(command.message, { displayMessage: command.displayMessage, streamingBehavior: command.streamingBehavior, images: command.images, goalOptions: command.goalOptions })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[prompt] failed:", message);
            hub.send({ type: "error", message: `Prompt başarısız: ${message}` });
            try {
              hub.send({ type: "state", state: activeRuntime.getState() });
            } catch {
              /* ignore */
            }
          });
        return ok(command.id, command.type);
      }
      case "turn_steer": {
        // Codex app-server `turn/steer`
        await activeRuntime.applyConversationMode(command.conversationMode);
        void activeRuntime
          .steer(command.message, { displayMessage: command.displayMessage, images: command.images, expectedTurnId: command.expectedTurnId })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[turn_steer] failed:", message);
            hub.send({ type: "error", message: `Steer başarısız: ${message}` });
            try {
              hub.send({ type: "state", state: activeRuntime.getState() });
            } catch {
              /* ignore */
            }
          });
        return ok(command.id, command.type);
      }
      case "abort":
      case "turn_interrupt":
        // Codex `Op::Interrupt` / app-server `turn/interrupt`
        await activeRuntime.abort();
        // Always return success so the UI can unlock; activeRuntime.abort is time-bounded.
        return ok(command.id, command.type);
      case "goal_pause":
        activeRuntime.pauseGoal();
        return ok(command.id, command.type);
      case "goal_resume":
        activeRuntime.resumeGoal();
        return ok(command.id, command.type);
      case "goal_cancel":
        activeRuntime.cancelGoal();
        return ok(command.id, command.type);
      case "extension_ui_response":
        return ok(command.id, command.type, { handled: activeRuntime.resolveExtensionUiResponse(command.id, command) });
      case "mcp_elicitation_respond": {
        const handled = respondMcpElicitation(command.requestId, {
          action: command.action,
          content: command.content,
        });
        return ok(command.id, command.type, { handled, requestId: command.requestId, action: command.action });
      }
      case "plan_clarification_complete":
        activeRuntime.completePlanClarification({
          requestId: command.requestId,
          clarificationId: command.clarificationId,
          answers: command.answers,
        });
        return ok(command.id, command.type);
      case "plan_clarification_skip":
        activeRuntime.skipPlanClarification({ requestId: command.requestId, clarificationId: command.clarificationId });
        return ok(command.id, command.type);
      case "new_session":
      case "open_workspace":
      case "open_workspaces":
      case "create_quick_project":
      case "clear_workspace":
      case "switch_session":
      case "fork_session":
      case "set_thinking_level":
      case "set_model":
      case "set_default_model":
      case "set_default_thinking":
      case "set_auto_compaction":
      case "set_block_images":
      case "set_show_images":
      case "set_terminal_policy":
      case "approval_respond":
      case "set_plan_mode":
      case "slash_command":
        return await runtimeLock.run(async () => {
          switch (command.type) {
            case "new_session":
              return ok(
                command.id,
                command.type,
                await activeRuntime.newSession({
                  parentSession: (command as { parentSession?: string }).parentSession,
                  isolation: (command as { isolation?: "plan" | "goal" | "agent" }).isolation,
                }),
              );
            case "open_workspace": {
              const nextCwd = await validateWorkspacePath(command.path);
              await activeRuntime.openWorkspace(nextCwd);
              return ok(command.id, command.type, {
                cwd: nextCwd,
                workspaceRoots: workspaceRegistry.list(),
                noProject: false,
              });
            }
            case "open_workspaces": {
              const requested = Array.isArray(command.paths) ? command.paths : [];
              if (requested.length === 0) throw new Error("En az bir çalışma alanı yolu gerekli");
              const validatedRoots: string[] = [];
              for (const path of requested) validatedRoots.push(await validateWorkspacePath(path));
              const requestedActive = command.activePath
                ? await validateWorkspacePath(command.activePath)
                : validatedRoots[validatedRoots.length - 1];
              if (!validatedRoots.some((root) => workspaceServiceKey(root) === workspaceServiceKey(requestedActive))) {
                throw new Error("Aktif çalışma alanı eklenen köklerden biri olmalı");
              }
              workspaceRegistry.addMany(validatedRoots);
              serverConfig.workspaceRoots = workspaceRegistry.list();
              await activeRuntime.openWorkspace(requestedActive);
              return ok(command.id, command.type, {
                cwd: requestedActive,
                workspaceRoots: workspaceRegistry.list(),
                noProject: false,
              });
            }
            case "create_quick_project": {
              const nextCwd = await createQuickProjectDir();
              await activeRuntime.openWorkspace(nextCwd);
              return ok(command.id, command.type, {
                cwd: nextCwd,
                name: basename(nextCwd),
                workspaceRoots: workspaceRegistry.list(),
                noProject: false,
              });
            }
            case "clear_workspace": {
              const nextCwd = await resolveNoProjectDir();
              await activeRuntime.openWorkspace(nextCwd);
              return ok(command.id, command.type, { cwd: nextCwd, noProject: true });
            }
            case "switch_session":
              return ok(command.id, command.type, await activeRuntime.switchSession(command.sessionPath));
            case "fork_session":
              return ok(command.id, command.type, await activeRuntime.forkSession(command.entryId));
            case "set_thinking_level":
              await activeRuntime.setThinkingLevel(command.level);
              return ok(command.id, command.type);
            case "set_model":
              await activeRuntime.setModel(command.provider, command.modelId);
              return ok(command.id, command.type);
            case "set_default_model":
              await activeRuntime.setDefaultModel(command.provider, command.modelId);
              return ok(command.id, command.type);
            case "set_default_thinking":
              await activeRuntime.setDefaultThinkingLevel(command.level);
              return ok(command.id, command.type);
            case "set_auto_compaction":
              await activeRuntime.setAutoCompactionEnabled(command.enabled);
              return ok(command.id, command.type);
            case "set_block_images":
              await activeRuntime.setBlockImages(command.blocked);
              return ok(command.id, command.type);
            case "set_show_images":
              await activeRuntime.setShowImages(command.show);
              return ok(command.id, command.type);
            case "set_terminal_policy": {
              terminalPolicyMode = command.mode;
              for (const services of workspaceServices.values()) {
                services.terminal = new WebTerminalService(services.root, new TerminalPolicy(terminalPolicyMode));
              }
              terminal = workspaceServices.get(workspaceServiceKey(currentWorkspaceCwd))?.terminal
                ?? new WebTerminalService(currentWorkspaceCwd, new TerminalPolicy(terminalPolicyMode));
              serverConfig.terminalPolicyMode = terminalPolicyMode;
              serverConfig.terminalEnabled = terminalPolicyMode !== "disabled";
              const meta = approvalMetaFromPolicy(terminalPolicyMode);
              serverConfig.approvalPresetId = meta.approvalPresetId;
              serverConfig.approvalPresetLabel = meta.approvalPresetLabel;
              await webSettings.patch({ terminalPolicyMode }).catch((error) => {
                console.warn("[settings] terminal policy could not be persisted", error);
              });
              try {
                guardianRuntime.setWorkspaceRoot(currentWorkspaceCwd);
                const preset = guardianRuntime.setFromTerminalPolicy(terminalPolicyMode);
                serverConfig.approvalPresetId = preset.id as typeof meta.approvalPresetId;
                serverConfig.approvalPresetLabel = preset.label;
                return ok(command.id, command.type, {
                  terminalPolicyMode,
                  terminalEnabled: serverConfig.terminalEnabled,
                  approvalPreset: preset.id,
                  approvalLabel: preset.label,
                });
              } catch {
                return ok(command.id, command.type, {
                  terminalPolicyMode,
                  terminalEnabled: serverConfig.terminalEnabled,
                  ...meta,
                });
              }
            }
            case "approval_respond": {
              // MCP tool approval bus first (ids: mcp_apr_*)
              const mcpDecision =
                command.decision === "acceptAlways"
                  ? "acceptAlways"
                  : command.decision === "acceptForSession"
                    ? "acceptForSession"
                    : command.decision === "accept"
                      ? "accept"
                      : command.decision === "cancel"
                        ? "cancel"
                        : "decline";
              const mcpResponded = respondMcpToolApproval(command.requestId, mcpDecision);
              if (mcpResponded) {
                // session/always already applied in tool-adapter when decision returns
                return ok(command.id, command.type, {
                  responded: true,
                  requestId: command.requestId,
                  decision: command.decision,
                  source: "mcp",
                });
              }
              // acceptAlways is durable write-through (guardian-always.json); session clear does not wipe it.
              const guardianDecision = command.decision;
              const responded = guardianRuntime.respond({
                id: command.requestId,
                decision: guardianDecision as any,
                execpolicyAmendment: (command as any).execpolicyAmendment,
                networkPolicyAmendment: (command as any).networkPolicyAmendment,
                scope: (command as any).scope === "always" ? "always" : "session",
              });
              // Flush durable disk writes when always scope / acceptAlways
              if (
                command.decision === "acceptAlways" ||
                (command as any).scope === "always"
              ) {
                await flushGuardianAlwaysWrites().catch(() => {});
              }
              return ok(command.id, command.type, { responded, requestId: command.requestId, decision: command.decision });
            }
            case "set_plan_mode":
              await activeRuntime.setPlanMode(command.enabled);
              return ok(command.id, command.type);
            case "slash_command":
              await activeRuntime.runSlashCommand(command.command, command.args);
              return ok(command.id, command.type);
          }
        });
      default:
        return fail(undefined, (command as { type?: string }).type ?? "unknown", "Desteklenmeyen komut");
    }
  } catch (error) {
    return fail(command.id, command.type, error);
  }
}

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = resolve(publicDir, `.${pathname}`);
  if (!filePath.startsWith(resolve(publicDir))) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  try {
    let content: Uint8Array = await readFile(filePath);
    if (pathname === "/index.html") content = auth.injectClientToken(content);
    res.writeHead(200, {
      ...securityHeaders(),
      "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": staticCacheControl(pathname),
    });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  try {
    // Public account endpoints authenticate with their own HttpOnly session
    // cookie. They intentionally do not require the local workspace token.
    if (isAccountApiPath(url.pathname)) {
      await accountHttp.handle(req, res, url, sendJson);
      return;
    }
    if (url.pathname.startsWith("/api/") && !auth.isAuthorized(req, url)) {
      auth.reject(res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      hub.add(res);
      activeRuntime.sendReady();
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/config") {
      refreshIsolationConfig();
      sendJson(res, 200, { config: serverConfig });
      return;
    }
    if (req.method === "PATCH" && url.pathname === "/api/security/agent-http-proxy") {
      const body = JSON.parse((await readBody(req)) || "{}") as { enabled?: unknown };
      if (typeof body.enabled !== "boolean") {
        sendJson(res, 400, { error: "enabled (boolean) gerekli" });
        return;
      }
      await setAgentHttpProxyEnabled(body.enabled);
      sendJson(res, 200, { config: serverConfig, ok: true });
      return;
    }
    if (req.method === "PATCH" && url.pathname === "/api/security/agent-worktree-isolation") {
      const body = JSON.parse((await readBody(req)) || "{}") as { enabled?: unknown };
      if (typeof body.enabled !== "boolean") {
        sendJson(res, 400, { error: "enabled (boolean) gerekli" });
        return;
      }
      await setAgentWorktreeIsolation(body.enabled);
      sendJson(res, 200, { config: serverConfig, ok: true });
      return;
    }
    if (req.method === "PATCH" && url.pathname === "/api/security/os-sandbox") {
      const body = JSON.parse((await readBody(req)) || "{}") as { experimental?: unknown };
      if (typeof body.experimental !== "boolean") {
        sendJson(res, 400, { error: "experimental (boolean) gerekli" });
        return;
      }
      await setOsSandboxExperimental(body.experimental);
      sendJson(res, 200, { config: serverConfig, ok: true });
      return;
    }
    if (url.pathname === "/api/subagents" && req.method === "GET") {
      const sessionId = url.searchParams.get("sessionId") || undefined;
      sendJson(res, 200, activeRuntime.listSubagents(sessionId));
      return;
    }
    if (url.pathname === "/api/subagents" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        message?: unknown;
        name?: unknown;
        agentType?: unknown;
        forkContext?: unknown;
        isolation?: unknown;
        sessionId?: unknown;
      };
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) {
        sendJson(res, 400, { error: "Subagent görevi boş olamaz" });
        return;
      }
      if (message.length > 120_000) {
        sendJson(res, 413, { error: "Subagent görevi çok uzun" });
        return;
      }
      const isolation = body.isolation === "none" ? "none" : "worktree";
      try {
        const agent = await runtimeLock.run(() => activeRuntime.createSubagent({
          message,
          name: typeof body.name === "string" ? body.name.trim().slice(0, 48) || undefined : undefined,
          agentType: typeof body.agentType === "string" ? body.agentType.trim() || undefined : undefined,
          forkContext: body.forkContext === true,
          isolation,
          sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
        }));
        sendJson(res, 201, { agent });
      } catch (error: any) {
        sendJson(res, 400, { error: error?.message || "Subagent oluşturulamadı" });
      }
      return;
    }
    const subagentRoute = url.pathname.match(/^\/api\/subagents\/([^/]+)(?:\/(message|abort))?$/);
    if (subagentRoute) {
      const agentId = decodeURIComponent(subagentRoute[1]);
      const action = subagentRoute[2];
      const querySessionId = url.searchParams.get("sessionId") || undefined;
      if (req.method === "GET" && !action) {
        try {
          sendJson(res, 200, { agent: activeRuntime.getSubagent(agentId, querySessionId) });
        } catch (error: any) {
          sendJson(res, 404, { error: error?.message || "Subagent bulunamadı" });
        }
        return;
      }
      if (req.method === "POST" && action === "message") {
        const body = JSON.parse((await readBody(req)) || "{}") as { message?: unknown; interrupt?: unknown; sessionId?: unknown };
        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (!message) {
          sendJson(res, 400, { error: "Subagent mesajı boş olamaz" });
          return;
        }
        if (message.length > 120_000) {
          sendJson(res, 413, { error: "Subagent mesajı çok uzun" });
          return;
        }
        try {
          const agent = await activeRuntime.sendSubagentInput(agentId, message, {
            interrupt: body.interrupt === true,
            sessionId: typeof body.sessionId === "string" ? body.sessionId : querySessionId,
          });
          sendJson(res, 202, { accepted: true, agent });
        } catch (error: any) {
          sendJson(res, 400, { error: error?.message || "Subagent mesajı gönderilemedi" });
        }
        return;
      }
      if (req.method === "POST" && action === "abort") {
        const body = JSON.parse((await readBody(req)) || "{}") as { sessionId?: unknown };
        try {
          const agent = activeRuntime.abortSubagent(
            agentId,
            typeof body.sessionId === "string" ? body.sessionId : querySessionId,
          );
          sendJson(res, 200, { aborted: true, agent });
        } catch (error: any) {
          sendJson(res, 400, { error: error?.message || "Subagent durdurulamadı" });
        }
        return;
      }
      sendJson(res, 405, { error: "Yönteme izin verilmiyor" });
      return;
    }
    if (url.pathname === "/api/side-conversations" && req.method === "GET") {
      const parentSessionPath = url.searchParams.get("parentSession") || undefined;
      const conversations = await activeRuntime.listSideConversations(parentSessionPath);
      sendJson(res, 200, { conversations });
      return;
    }
    if (url.pathname === "/api/side-conversations" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as { parentSessionPath?: unknown };
      const parentSessionPath = typeof body.parentSessionPath === "string" ? body.parentSessionPath : undefined;
      const conversation = await runtimeLock.run(() => activeRuntime.createSideConversation({ parentSessionPath }));
      sendJson(res, 201, { conversation });
      return;
    }
    const sideConversationRoute = url.pathname.match(/^\/api\/side-conversations\/([^/]+)(?:\/(prompt|abort|preferences))?$/);
    if (sideConversationRoute) {
      const identifier = decodeURIComponent(sideConversationRoute[1]);
      const action = sideConversationRoute[2];
      if (req.method === "GET" && !action) {
        const conversation = await runtimeLock.run(() => activeRuntime.getSideConversation(identifier));
        sendJson(res, 200, { conversation });
        return;
      }
      if (req.method === "POST" && action === "prompt") {
        const body = JSON.parse((await readBody(req)) || "{}") as { message?: unknown };
        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (!message) {
          sendJson(res, 400, { error: "Yan sohbet mesajı boş olamaz" });
          return;
        }
        if (message.length > 120_000) {
          sendJson(res, 413, { error: "Yan sohbet mesajı çok uzun" });
          return;
        }
        void activeRuntime.promptSideConversation(identifier, message).catch((error: unknown) => {
          console.error("[side-conversation] prompt failed:", error);
        });
        sendJson(res, 202, { accepted: true });
        return;
      }
      if (req.method === "POST" && action === "abort") {
        await activeRuntime.abortSideConversation(identifier);
        sendJson(res, 200, { aborted: true });
        return;
      }
      if (req.method === "POST" && action === "preferences") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          provider?: unknown;
          modelId?: unknown;
          thinkingLevel?: unknown;
        };
        const provider = typeof body.provider === "string" ? body.provider.trim() : undefined;
        const modelId = typeof body.modelId === "string" ? body.modelId.trim() : undefined;
        const thinkingLevels = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
        const thinkingLevel = typeof body.thinkingLevel === "string" && thinkingLevels.has(body.thinkingLevel)
          ? body.thinkingLevel as WebSideConversationSnapshot["thinkingLevel"]
          : undefined;
        if ((provider && !modelId) || (!provider && modelId)) {
          sendJson(res, 400, { error: "Model sağlayıcısı ve model kimliği birlikte gönderilmelidir" });
          return;
        }
        if (body.thinkingLevel !== undefined && !thinkingLevel) {
          sendJson(res, 400, { error: "Geçersiz çaba seviyesi" });
          return;
        }
        if (!provider && !thinkingLevel) {
          sendJson(res, 400, { error: "Değiştirilecek bir Yan görev tercihi gönderilmedi" });
          return;
        }
        const conversation = await runtimeLock.run(() => activeRuntime.updateSideConversationPreferences(identifier, {
          provider,
          modelId,
          thinkingLevel,
        }));
        sendJson(res, 200, { conversation });
        return;
      }
      sendJson(res, 405, { error: "Yönteme izin verilmiyor" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, { state: activeRuntime.getState(), messages: activeRuntime.getTimelineMessages(), locks: { terminal: terminalLock.isActive } });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/sessions") {
      sendJson(res, 200, { sessions: await activeRuntime.listSessions(url.searchParams.get("all") === "1") });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/settings") {
      sendJson(res, 200, { settings: activeRuntime.getRuntimeSettings() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/conversation-metadata") {
      sendJson(res, 200, { metadata: await conversationMetadata.read() });
      return;
    }
    if (req.method === "PATCH" && url.pathname === "/api/conversation-metadata") {
      const patch = JSON.parse((await readBody(req)) || "{}");
      sendJson(res, 200, { metadata: await conversationMetadata.patch(patch) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/models") {
      // Default: only models from logged-in / auth-configured providers.
      // ?all=1 returns the full catalog (debug / internal tools).
      const includeUnconfigured = url.searchParams.get("all") === "1";
      sendJson(res, 200, { models: await activeRuntime.listModels({ includeUnconfigured }) });
      return;
    }
    // ─── Providers (Settings → Provider’lar) ───
    if (req.method === "GET" && url.pathname === "/api/providers") {
      const models = await activeRuntime.listModels();
      const modelCounts: Record<string, number> = {};
      for (const m of models) {
        modelCounts[m.provider] = (modelCounts[m.provider] || 0) + 1;
      }
      const providers = getProviderList(activeRuntime.authStorage, modelCounts);
      sendJson(res, 200, { providers });
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/providers/") && url.pathname.endsWith("/api-key")) {
      const providerId = decodeURIComponent(url.pathname.slice("/api/providers/".length, -"/api-key".length));
      if (!isKnownProviderId(providerId) || !isApiKeyProviderId(providerId)) {
        sendJson(res, 400, { error: "Bu provider API key kabul etmiyor" });
        return;
      }
      const body = JSON.parse(await readBody(req) || "{}") as { apiKey?: string; label?: string; makeActive?: boolean };
      const apiKey = String(body.apiKey || "").trim();
      if (!apiKey || apiKey.length < 8) {
        sendJson(res, 400, { error: "Geçerli bir API key girin" });
        return;
      }
      try {
        const added = addApiKeyAccount(activeRuntime.authStorage, providerId, apiKey, body.label, {
          makeActive: body.makeActive !== false,
        });
        sendJson(res, 200, {
          success: true,
          id: providerId,
          accountId: added.accountId,
          label: added.label,
          ...getPoolMeta(providerId, activeRuntime.authStorage),
          accounts: listAccountSummaries(providerId, activeRuntime.authStorage),
        });
      } catch (error: any) {
        sendJson(res, 400, { error: error?.message || "API key kaydedilemedi" });
      }
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/providers/") && url.pathname.endsWith("/logout")) {
      const providerId = decodeURIComponent(url.pathname.slice("/api/providers/".length, -"/logout".length));
      if (!isKnownProviderId(providerId)) {
        sendJson(res, 404, { error: "Bilinmeyen provider" });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}") as { accountId?: string; all?: boolean };
      try {
        if (body.accountId) {
          const result = removeAccount(activeRuntime.authStorage, providerId, body.accountId);
          sendJson(res, 200, { success: true, id: providerId, remaining: result.remaining });
        } else {
          clearProviderAccounts(activeRuntime.authStorage, providerId);
          sendJson(res, 200, { success: true, id: providerId, remaining: 0 });
        }
      } catch (error: any) {
        sendJson(res, 400, { error: error?.message || "Çıkış başarısız" });
      }
      return;
    }
    // GET /api/providers/:id/accounts
    if (req.method === "GET" && url.pathname.startsWith("/api/providers/") && url.pathname.endsWith("/accounts")) {
      const providerId = decodeURIComponent(url.pathname.slice("/api/providers/".length, -"/accounts".length));
      if (!isKnownProviderId(providerId)) {
        sendJson(res, 404, { error: "Bilinmeyen provider" });
        return;
      }
      sendJson(res, 200, {
        ...getPoolMeta(providerId, activeRuntime.authStorage),
        accounts: listAccountSummaries(providerId, activeRuntime.authStorage),
      });
      return;
    }
    // POST /api/providers/:id/accounts/active  { accountId }
    if (req.method === "POST" && url.pathname.startsWith("/api/providers/") && url.pathname.endsWith("/accounts/active")) {
      const providerId = decodeURIComponent(url.pathname.slice("/api/providers/".length, -"/accounts/active".length));
      if (!isKnownProviderId(providerId)) {
        sendJson(res, 404, { error: "Bilinmeyen provider" });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}") as { accountId?: string };
      if (!body.accountId) {
        sendJson(res, 400, { error: "accountId gerekli" });
        return;
      }
      try {
        setActiveAccount(activeRuntime.authStorage, providerId, body.accountId);
        sendJson(res, 200, {
          success: true,
          ...getPoolMeta(providerId, activeRuntime.authStorage),
          accounts: listAccountSummaries(providerId, activeRuntime.authStorage),
        });
      } catch (error: any) {
        sendJson(res, 400, { error: error?.message || "Aktif hesap seçilemedi" });
      }
      return;
    }
    // POST /api/providers/:id/accounts/rotation  { enabled }
    if (req.method === "POST" && url.pathname.startsWith("/api/providers/") && url.pathname.endsWith("/accounts/rotation")) {
      const providerId = decodeURIComponent(url.pathname.slice("/api/providers/".length, -"/accounts/rotation".length));
      if (!isKnownProviderId(providerId)) {
        sendJson(res, 404, { error: "Bilinmeyen provider" });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}") as { enabled?: boolean };
      setRotationEnabled(providerId, body.enabled !== false);
      sendJson(res, 200, {
        success: true,
        ...getPoolMeta(providerId, activeRuntime.authStorage),
        accounts: listAccountSummaries(providerId, activeRuntime.authStorage),
      });
      return;
    }
    // POST /api/providers/:id/accounts/order  { order: string[] }
    if (req.method === "POST" && url.pathname.startsWith("/api/providers/") && url.pathname.endsWith("/accounts/order")) {
      const providerId = decodeURIComponent(url.pathname.slice("/api/providers/".length, -"/accounts/order".length));
      if (!isKnownProviderId(providerId)) {
        sendJson(res, 404, { error: "Bilinmeyen provider" });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}") as { order?: string[] };
      try {
        reorderAccounts(providerId, Array.isArray(body.order) ? body.order : []);
        sendJson(res, 200, {
          success: true,
          ...getPoolMeta(providerId, activeRuntime.authStorage),
          accounts: listAccountSummaries(providerId, activeRuntime.authStorage),
        });
      } catch (error: any) {
        sendJson(res, 400, { error: error?.message || "Sıra güncellenemedi" });
      }
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/providers/") && url.pathname.endsWith("/login")) {
      const providerId = decodeURIComponent(url.pathname.slice("/api/providers/".length, -"/login".length));
      if (!isOAuthProviderId(providerId)) {
        sendJson(res, 400, { error: "Bu provider OAuth desteklemiyor — API key kullanın" });
        return;
      }
      const oauth = getOAuthProvider(providerId);
      if (!oauth) {
        sendJson(res, 404, { error: "OAuth provider bulunamadı" });
        return;
      }
      // Long-running OAuth: return auth URL ASAP via first callback, keep connection until done
      let responded = false;
      const flushAuthUrl = (authUrl: string, instructions?: string) => {
        if (responded) return;
        responded = true;
        sendJson(res, 200, {
          success: true,
          pending: true,
          authUrl,
          instructions: instructions || "Tarayıcıda oturum açın, tamamlanınca bu sayfayı yenileyin.",
          usesCallbackServer: oauth.usesCallbackServer ?? false,
        });
      };
      try {
        await activeRuntime.authStorage.login(providerId, {
          onAuth: (info) => {
            // Device-code flows (GitHub Copilot): url = verification page, instructions include user code
            flushAuthUrl(info.url, info.instructions);
          },
          onPrompt: async (prompt) => {
            const msg = String(prompt?.message || "");
            // GitHub Copilot asks for Enterprise URL — blank means github.com
            if (
              prompt?.allowEmpty ||
              /github\s*enterprise/i.test(msg) ||
              /blank for github\.com/i.test(msg)
            ) {
              return "";
            }
            // Other interactive prompts not supported in web UI yet
            throw new Error(
              msg ||
                "Bu OAuth akışı ek girdi istiyor. CLI'da `/login " + providerId + "` kullanın.",
            );
          },
          onProgress: (message) => {
            try {
              hub.send({
                type: "provider_rotation",
                providerId,
                toLabel: providerId,
                reason: String(message || "oauth_progress"),
              } as any);
            } catch {
              /* ignore */
            }
          },
        });
        // Capture as additional pool account (multi OAuth) and keep active
        const captured = captureOAuthFromAuthStorage(activeRuntime.authStorage, providerId, { makeActive: true });
        if (!responded) {
          sendJson(res, 200, {
            success: true,
            pending: false,
            connected: true,
            accountId: captured?.accountId,
            label: captured?.label,
          });
        } else {
          hub.send({
            type: "provider_rotation",
            providerId,
            toLabel: captured?.label || providerId,
            reason: "oauth_connected",
          } as any);
        }
      } catch (error: any) {
        if (!responded) {
          sendJson(res, 500, { error: error?.message || "OAuth giriş başarısız" });
        } else {
          // Client already has auth URL; surface failure without double-send
          try {
            hub.send({ type: "error", message: `OAuth başarısız (${providerId}): ${error?.message || "bilinmeyen hata"}` });
          } catch {
            /* ignore */
          }
        }
      }
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/providers/") && url.pathname.endsWith("/test")) {
      const providerId = decodeURIComponent(url.pathname.slice("/api/providers/".length, -"/test".length));
      if (!isKnownProviderId(providerId)) {
        sendJson(res, 404, { error: "Bilinmeyen provider" });
        return;
      }
      try {
        const models = await activeRuntime.listModels();
        const mine = models.filter((m) => m.provider === providerId);
        const configured = mine.filter((m) => m.configured);
        if (configured.length === 0 && mine.length === 0) {
          // still check auth presence
          const has = Boolean(activeRuntime.authStorage.get(providerId)) || Boolean(getApiKeyEnvVar(providerId) && process.env[getApiKeyEnvVar(providerId)!]);
          sendJson(res, 200, {
            success: has,
            message: has
              ? "Kimlik bilgisi var; model listesinde kayıt yok (yine de kullanılabilir)."
              : "Bağlantı yok — önce bağlayın.",
            modelCount: 0,
            configuredCount: 0,
          });
          return;
        }
        sendJson(res, 200, {
          success: configured.length > 0,
          message:
            configured.length > 0
              ? `${configured.length} yapılandırılmış model hazır`
              : `${mine.length} model var ama kimlik doğrulama eksik`,
          modelCount: mine.length,
          configuredCount: configured.length,
        });
      } catch (error: any) {
        sendJson(res, 500, { success: false, error: error?.message || "Test başarısız" });
      }
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/providers/") && url.pathname.endsWith("/models")) {
      const providerId = decodeURIComponent(url.pathname.slice("/api/providers/".length, -"/models".length));
      // Only models for this provider that are actually usable (auth present).
      const models = (await activeRuntime.listModels({ includeUnconfigured: false })).filter(
        (m) => m.provider === providerId,
      );
      sendJson(res, 200, {
        models,
        docsHint: getCloudDocsHint(providerId),
        envVar: getApiKeyEnvVar(providerId),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/commands") {
      sendJson(res, 200, { commands: activeRuntime.listCommands() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/extensions") {
      const extensions = activeRuntime.listExtensions().map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        enabled: entry.enabled,
        optIn: entry.optIn,
        installed: entry.installed,
        source: entry.source,
        category: entry.category,
      }));
      sendJson(res, 200, { extensions });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/extensions/toggle") {
      const body = JSON.parse(await readBody(req) || "{}");
      const id = String(body.id || body.name || "");
      const enabled = Boolean(body.enabled);
      await webSettings.setExtensionEnabled(id, enabled);
      await activeRuntime.reloadExtensionsAfterToggle();
      sendJson(res, 200, { success: true, id, name: id, enabled });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/status") {
      const status = await mobileRuntime.getStatus();
      const features = mobileFeatureFlags();
      sendJson(res, 200, { ...status, features, stream: { available: features.scrcpyStream && Boolean(resolveScrcpyExecutable()), transport: "h264-websocket", fallback: "screenshot" } });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/build") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.profileId) { sendJson(res, 400, { error: "Build profili gerekli" }); return; }
      sendJson(res, 200, { result: await mobileRuntime.build(String(body.profileId), body.deviceId ? String(body.deviceId) : undefined) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/build/jobs") {
      mobileRateLimiter.check(req.socket.remoteAddress || "local", 10);
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.profileId) { sendJson(res, 400, { error: "Build profili gerekli" }); return; }
      sendJson(res, 202, { job: await mobileRuntime.createBuildJob(String(body.profileId), body.deviceId ? String(body.deviceId) : undefined) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/build/jobs") {
      sendJson(res, 200, { jobs: mobileRuntime.listBuildJobs() });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/mobile/build/jobs/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/mobile/build/jobs/".length));
      const job = mobileRuntime.getBuildJob(id);
      if (!job) { sendJson(res, 404, { error: "Build job bulunamadı" }); return; }
      sendJson(res, 200, { job });
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/cancel") && url.pathname.startsWith("/api/mobile/build/jobs/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/mobile/build/jobs/".length, -"/cancel".length));
      sendJson(res, mobileRuntime.cancelBuildJob(id) ? 200 : 409, { success: mobileRuntime.getBuildJob(id)?.status === "cancelled" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/avd/catalog") {
      sendJson(res, 200, await mobileRuntime.avdCatalog());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/avd/image/install") {
      const body = JSON.parse((await readBody(req)) || "{}");
      await mobileRuntime.installSystemImage(String(body.image || ""));
      sendJson(res, 200, { success: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/avd/create") {
      const body = JSON.parse((await readBody(req)) || "{}");
      await mobileRuntime.createVirtualDevice(String(body.name || ""), String(body.image || ""), body.devicePreset ? String(body.devicePreset) : undefined);
      sendJson(res, 201, { success: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/avd/delete") {
      const body = JSON.parse((await readBody(req)) || "{}");
      await mobileRuntime.deleteVirtualDevice(String(body.name || ""));
      sendJson(res, 200, { success: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/avd/snapshot") {
      const body = JSON.parse((await readBody(req)) || "{}");
      await mobileRuntime.snapshotVirtualDevice(String(body.deviceId || ""), body.operation === "load" ? "load" : "save", String(body.name || ""));
      sendJson(res, 200, { success: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/device/state") {
      const body = JSON.parse((await readBody(req)) || "{}");
      await mobileRuntime.setDeviceState(String(body.deviceId || ""), body.state || {});
      sendJson(res, 200, { success: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/emulator/start") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.name) { sendJson(res, 400, { error: "Sanal cihaz adı gerekli" }); return; }
      await mobileRuntime.startVirtualDevice(String(body.platform || "android"), String(body.name), { coldBoot: body.coldBoot !== false, wipeData: Boolean(body.wipeData), headless: body.headless !== false });
      sendJson(res, 202, { success: true, status: "starting" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/emulator/stop") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.deviceId) { sendJson(res, 400, { error: "deviceId gerekli" }); return; }
      await mobileRuntime.stopVirtualDevice(String(body.platform || "android"), String(body.deviceId));
      sendJson(res, 200, { success: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/emulator/restart") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.name || !body.deviceId) { sendJson(res, 400, { error: "Sanal cihaz adı ve deviceId gerekli" }); return; }
      await mobileRuntime.restartVirtualDevice(String(body.platform || "android"), String(body.name), String(body.deviceId));
      sendJson(res, 202, { success: true, status: "starting" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/logs") {
      const platform = url.searchParams.get("platform") || "";
      const deviceId = url.searchParams.get("deviceId") || "";
      const lines = Number(url.searchParams.get("lines") || 120);
      const packageName = url.searchParams.get("packageName") || undefined;
      const query = (url.searchParams.get("query") || "").toLowerCase();
      const minimumLevel = url.searchParams.get("level") || "verbose";
      if (!deviceId) { sendJson(res, 400, { error: "deviceId gerekli" }); return; }
      const levels = ["verbose", "debug", "info", "warning", "error", "fatal"];
      const minimumIndex = Math.max(0, levels.indexOf(minimumLevel));
      const logs = (await mobileRuntime.logs(platform, deviceId, lines, packageName)).filter((log) => levels.indexOf(log.level) >= minimumIndex && (!query || `${log.tag || ""} ${log.message}`.toLowerCase().includes(query)));
      sendJson(res, 200, { logs, events: logs.filter((log) => log.event) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/quality/accessibility") { const snapshot = await mobileRuntime.snapshot(url.searchParams.get("platform") || "android", url.searchParams.get("deviceId") || ""); sendJson(res, 200, mobileRuntime.auditAccessibility(snapshot)); return; }
    if (req.method === "GET" && url.pathname === "/api/mobile/quality/runtime") { const logs = await mobileRuntime.logs("android", url.searchParams.get("deviceId") || "", 500, url.searchParams.get("packageName") || undefined); sendJson(res, 200, mobileRuntime.qualityFromLogs(logs)); return; }
    if (req.method === "POST" && url.pathname === "/api/mobile/quality/baseline") { const body = JSON.parse((await readBody(req)) || "{}"); const image = await mobileRuntime.screenshot("android", String(body.deviceId || "")); sendJson(res, 200, body.action === "compare" ? mobileRuntime.compareBaseline(String(body.name || ""), image) : mobileRuntime.updateBaseline(String(body.name || ""), image, body.confirmed === true)); return; }
    if (req.method === "POST" && url.pathname === "/api/mobile/quality/baseline/delete") { const body = JSON.parse((await readBody(req)) || "{}"); mobileRuntime.removeBaseline(String(body.name || ""), body.confirmed === true); sendJson(res, 200, { success: true }); return; }
    if (req.method === "GET" && url.pathname === "/api/mobile/tests/capability") { sendJson(res, 200, await mobileRuntime.testCapability()); return; }
    if (req.method === "POST" && url.pathname === "/api/mobile/tests/jobs") { const body = JSON.parse((await readBody(req)) || "{}"); sendJson(res, 202, { job: mobileRuntime.createTestJob(String(body.deviceId || ""), String(body.flow || "")) }); return; }
    if (req.method === "GET" && url.pathname === "/api/mobile/tests/jobs") { sendJson(res, 200, { jobs: mobileRuntime.listTestJobs() }); return; }
    if (req.method === "GET" && url.pathname.startsWith("/api/mobile/tests/jobs/")) { const job = mobileRuntime.getTestJob(decodeURIComponent(url.pathname.slice("/api/mobile/tests/jobs/".length))); if (!job) { sendJson(res, 404, { error: "Test job bulunamadı" }); return; } sendJson(res, 200, { job }); return; }
    if (req.method === "GET" && url.pathname === "/api/mobile/artifacts") {
      sendJson(res, 200, { artifacts: mobileRuntime.listArtifacts(url.searchParams.get("sessionKey") || "default") });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/artifacts/clear") {
      const body = JSON.parse((await readBody(req)) || "{}"); mobileRuntime.clearArtifacts(String(body.sessionKey || "default")); sendJson(res, 200, { success: true }); return;
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/screenshot") {
      const platform = url.searchParams.get("platform") || "";
      const deviceId = url.searchParams.get("deviceId") || "";
      if (!deviceId) { sendJson(res, 400, { error: "deviceId gerekli" }); return; }
      const screenshot = await mobileRuntime.screenshot(platform, deviceId);
      const sessionKey = url.searchParams.get("sessionKey");
      if (sessionKey) mobileRuntime.saveArtifact(sessionKey, "screenshot", `screenshot-${Date.now()}.png`, screenshot, true);
      res.writeHead(200, { ...securityHeaders(), "Content-Type": "image/png", "Cache-Control": "no-store" });
      res.end(screenshot);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/snapshot") {
      const platform = url.searchParams.get("platform") || "";
      const deviceId = url.searchParams.get("deviceId") || "";
      if (!deviceId) { sendJson(res, 400, { error: "deviceId gerekli" }); return; }
      sendJson(res, 200, await mobileRuntime.snapshot(platform, deviceId));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/action") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.deviceId || !body.action?.type) { sendJson(res, 400, { error: "deviceId ve action gerekli" }); return; }
      await mobileRuntime.perform(requireAndroid(body.platform), requireDeviceId(body.deviceId), body.action as MobileAction);
      sendJson(res, 200, { success: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/sandbox") {
      sendJson(res, 200, await mobileRuntime.inspectSandbox(url.searchParams.get("deviceId") || "", url.searchParams.get("packageName") || "", url.searchParams.get("path") || "."));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/sandbox/file") {
      sendJson(res, 200, { content: await mobileRuntime.readSandboxFile(url.searchParams.get("deviceId") || "", url.searchParams.get("packageName") || "", url.searchParams.get("path") || "") });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/database/query") {
      const body = JSON.parse((await readBody(req)) || "{}");
      sendJson(res, 200, { result: await mobileRuntime.queryDatabase(String(body.deviceId || ""), String(body.packageName || ""), String(body.database || ""), String(body.query || "")) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/network/proxy") {
      const body = JSON.parse((await readBody(req)) || "{}");
      await mobileRuntime.configureProxy(String(body.deviceId || ""), body.proxy ? String(body.proxy) : undefined, body.confirmed === true);
      sendJson(res, 200, { success: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/development/port") {
      const body = JSON.parse((await readBody(req)) || "{}");
      await mobileRuntime.configurePort(String(body.deviceId || ""), body.direction === "forward" ? "forward" : "reverse", Number(body.localPort), Number(body.remotePort), Boolean(body.remove));
      sendJson(res, 200, { success: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/development/action") {
      const body = JSON.parse((await readBody(req)) || "{}");
      await mobileRuntime.developmentAction(String(body.deviceId || ""), String(body.adapter || ""), body.action);
      sendJson(res, 200, { success: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/app") {
      const body = JSON.parse((await readBody(req)) || "{}");
      await mobileRuntime.manageApplication(requireDeviceId(body.deviceId), body.operation, requirePackage(body.packageName), body.value ? String(body.value) : undefined);
      sendJson(res, 200, { success: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/install") {
      const body = JSON.parse((await readBody(req)) || "{}");
      await mobileRuntime.installArtifact(String(body.deviceId || ""), String(body.artifact || ""), { reinstall: body.reinstall !== false, downgrade: Boolean(body.downgrade) });
      sendJson(res, 200, { success: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/computer-use/status") {
      const bridge = await probeComputerUseBridge();
      sendJson(res, 200, {
        bridge,
        policy: loadComputerUsePolicy(currentWorkspaceCwd),
        trajectory: listRecentTrajectorySteps(currentWorkspaceCwd, 12),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/computer-use/policy") {
      sendJson(res, 200, { policy: loadComputerUsePolicy(currentWorkspaceCwd) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/computer-use/policy") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const policy = saveComputerUsePolicy(currentWorkspaceCwd, {
        actuateEnabled: body.actuateEnabled,
        stepLimit: typeof body.stepLimit === "number" ? body.stepLimit : undefined,
        toolMode: body.toolMode === "claude_native" ? "claude_native" : body.toolMode === "custom" ? "custom" : undefined,
      });
      sendJson(res, 200, { policy });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/skills") {
      const commands = activeRuntime.listCommands();
      const skills = commands.filter((c: any) => c.source === "skill").map((c: any) => ({ name: c.name, description: c.description, source: c.source }));
      sendJson(res, 200, { skills });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/artifact-templates") {
      const requestedKind = url.searchParams.get("kind");
      const kind: ArtifactTemplateKind | undefined = requestedKind === "document"
        || requestedKind === "spreadsheet"
        || requestedKind === "presentation"
        ? requestedKind
        : undefined;
      sendJson(res, 200, { templates: readArtifactTemplateCatalog(undefined, kind) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/artifact-templates/preview") {
      const id = url.searchParams.get("id") || "";
      const preview = readArtifactTemplatePreview(id);
      if (!preview) {
        sendJson(res, 404, { error: "Şablon önizlemesi bulunamadı" });
        return;
      }
      res.writeHead(200, {
        ...securityHeaders(),
        "Content-Type": "image/png",
        "Content-Length": preview.byteLength,
        "Cache-Control": "private, max-age=300",
      });
      res.end(preview);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/artifact-templates/skill") {
      const id = url.searchParams.get("id") || "";
      const skill = readArtifactTemplateSkill(id);
      if (!skill) {
        sendJson(res, 404, { error: "Şablon skilli bulunamadı" });
        return;
      }
      sendJson(res, 200, skill, { "Cache-Control": "private, max-age=60" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/prompts") {
      const commands = activeRuntime.listCommands();
      const prompts = commands.filter((c: any) => c.source === "prompt").map((c: any) => ({ name: c.name, description: c.description }));
      sendJson(res, 200, { prompts });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/web-settings") {
      const settings = await webSettings.read();
      sendJson(res, 200, { settings: { ...settings, mcpServers: (settings.mcpServers || []).map(redactMcpConfig) } });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/mcp/servers") {
      sendJson(res, 200, { servers: mcpManager.list().map((server) => ({ ...server, config: redactMcpConfig(server.config) })) });
      return;
    }
    // Durable "always allow" MCP tool approvals (survives restart; session allows stay memory-only)
    if (req.method === "GET" && url.pathname === "/api/mcp/always-allows") {
      sendJson(res, 200, { tools: listMcpAlwaysAllows() });
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/api/mcp/always-allows") {
      const serverId = String(url.searchParams.get("serverId") || "").trim();
      const toolName = String(url.searchParams.get("toolName") || "").trim();
      if (!serverId || !toolName) {
        sendJson(res, 400, { error: "serverId ve toolName gerekli" });
        return;
      }
      const removed = removeMcpAlwaysAllow(serverId, toolName);
      await flushMcpAlwaysAllowWrites();
      sendJson(res, 200, { ok: true, removed, tools: listMcpAlwaysAllows() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mcp/always-allows/clear") {
      clearMcpAlwaysAllows();
      await flushMcpAlwaysAllowWrites();
      sendJson(res, 200, { ok: true, tools: [] });
      return;
    }
    // Durable guardian always-allows (commandKeys / prefixes / hosts) — separate from MCP
    if (req.method === "GET" && url.pathname === "/api/security/guardian-allows") {
      sendJson(res, 200, { allows: listDurableGuardianAllows() });
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/api/security/guardian-allows") {
      const kind = String(url.searchParams.get("kind") || "").trim();
      let removed = false;
      if (kind === "commandKey") {
        const key = String(url.searchParams.get("key") || "").trim();
        if (!key) {
          sendJson(res, 400, { error: "key gerekli" });
          return;
        }
        removed = removeGuardianAlwaysCommandKey(key);
      } else if (kind === "prefix") {
        const prefixParam = String(url.searchParams.get("prefix") || "").trim();
        if (!prefixParam) {
          sendJson(res, 400, { error: "prefix gerekli" });
          return;
        }
        let prefix: string[] | string = prefixParam;
        try {
          const parsed = JSON.parse(prefixParam);
          if (Array.isArray(parsed)) prefix = parsed.map(String);
        } catch {
          /* space-separated string */
        }
        removed = removeGuardianAlwaysPrefix(prefix);
      } else if (kind === "host") {
        const host = String(url.searchParams.get("host") || "").trim();
        const actionRaw = String(url.searchParams.get("action") || "").trim();
        const action =
          actionRaw === "allow" || actionRaw === "deny" ? (actionRaw as "allow" | "deny") : undefined;
        if (!host) {
          sendJson(res, 400, { error: "host gerekli" });
          return;
        }
        removed = removeGuardianAlwaysHost(host, action);
      } else {
        sendJson(res, 400, { error: "kind=commandKey|prefix|host gerekli" });
        return;
      }
      await flushGuardianAlwaysWrites();
      sendJson(res, 200, { ok: true, removed, allows: listDurableGuardianAllows() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/security/guardian-allows/clear") {
      clearDurableGuardianAllows();
      await flushGuardianAlwaysWrites();
      sendJson(res, 200, {
        ok: true,
        allows: { commandKeys: [], prefixes: [], hosts: { allow: [], deny: [] } },
      });
      return;
    }
    const mcpMatch = url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)(?:\/(connect|disconnect|restart|logs|tools|resources|prompts))?$/);
    if (mcpMatch) {
      const id = decodeURIComponent(mcpMatch[1]);
      const action = mcpMatch[2];
      if (req.method === "GET") {
        const snapshot = mcpManager.get(id)?.snapshot;
        if (!snapshot) { sendJson(res, 404, { error: "MCP sunucusu bulunamadı" }); return; }
        if (action === "logs") sendJson(res, 200, { logs: mcpManager.logs(id) });
        else if (action === "tools") sendJson(res, 200, { tools: snapshot.tools });
        else if (action === "resources") {
          const uri = url.searchParams.get("uri");
          sendJson(res, 200, uri ? { resource: await mcpManager.readResource(id, uri) } : { resources: snapshot.resources });
        }
        else if (action === "prompts") {
          const name = url.searchParams.get("name");
          const args = url.searchParams.get("args");
          let parsedArgs: Record<string, string> | undefined;
          if (args) {
            try {
              const candidate = JSON.parse(args);
              if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || Object.values(candidate).some((value) => typeof value !== "string")) throw new Error();
              parsedArgs = candidate;
            } catch {
              sendJson(res, 400, { error: "Prompt args geçerli bir string sözlüğü olmalı" });
              return;
            }
          }
          sendJson(res, 200, name ? { prompt: await mcpManager.getPrompt(id, name, parsedArgs) } : { prompts: snapshot.prompts });
        }
        else sendJson(res, 200, { server: redactMcpSnapshot(snapshot) });
        return;
      }
      if (req.method === "POST" && action) {
        const server = action === "connect" ? await mcpManager.connect(id) : action === "restart" ? await mcpManager.restart(id) : (await mcpManager.disconnect(id), mcpManager.get(id)?.snapshot);
        sendJson(res, 200, { server: redactMcpSnapshot(server) });
        return;
      }
      if (req.method === "PATCH" && !action) {
        const settings = await webSettings.read();
        const body = JSON.parse((await readBody(req)) || "{}");
        const current = (settings.mcpServers || []).find((server) => server.id === id);
        if (!current) { sendJson(res, 404, { error: "MCP sunucusu bulunamadı" }); return; }
        assertMcpNoPlaintextSecrets(body);
        const server = normalizeMcpServer({ ...current, ...body, id }, currentWorkspaceCwd);
        const mcpServers = (settings.mcpServers || []).map((item) => item.id === id ? server : item);
        await webSettings.patch({ mcpServers });
        await mcpManager.reconcile(mcpServers);
        sendJson(res, 200, { server: redactMcpSnapshot(mcpManager.get(id)?.snapshot) });
        return;
      }
      if (req.method === "DELETE" && !action) {
        const settings = await webSettings.read();
        const mcpServers = (settings.mcpServers || []).filter((server) => server.id !== id);
        await webSettings.patch({ mcpServers });
        await mcpManager.reconcile(mcpServers);
        sendJson(res, 200, { ok: true });
        return;
      }
    }
    if (req.method === "POST" && url.pathname === "/api/mcp/servers") {
      const settings = await webSettings.read();
      const body = JSON.parse((await readBody(req)) || "{}");
      assertMcpNoPlaintextSecrets(body);
      const server = normalizeMcpServer(body, currentWorkspaceCwd);
      const mcpServers = [...(settings.mcpServers || []), server];
      await webSettings.patch({ mcpServers });
      await mcpManager.reconcile(mcpServers);
      sendJson(res, 201, { server: redactMcpSnapshot(mcpManager.get(server.id)?.snapshot) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/workspace/roots") {
      sendJson(res, 200, await getWorkspaceRoots());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/workspace/browse") {
      sendJson(res, 200, await listWorkspaceFolders(url.searchParams.get("path") || undefined));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/workspace/changes") {
      sendJson(res, 200, await getWorkspaceChanges());
      return;
    }
    if (url.pathname.startsWith("/api/git/")) {
      sendJson(res, 410, { error: "Git devre dışı — bu proje gitsiz çalışır" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/search") {
      const q = url.searchParams.get("q") ?? "";
      const sessions = (await activeRuntime.listSessions(true)) as SearchableSession[];
      sendJson(res, 200, await searchAll(currentWorkspaceCwd, q, sessions));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/scheduled") {
      try {
        sendJson(res, 200, { tasks: await scheduler.list() });
      } catch (error) {
        sendJson(res, error instanceof SchedulerError ? error.status : 500, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/scheduled") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        sendJson(res, 200, { task: await scheduler.create({ name: String(body.name || ""), cron: String(body.cron || ""), prompt: String(body.prompt || ""), enabled: body.enabled }) });
      } catch (error) {
        sendJson(res, error instanceof SchedulerError ? error.status : 500, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    {
      const scheduledMatch = url.pathname.match(/^\/api\/scheduled\/([^/]+)(\/run)?$/);
      if (scheduledMatch) {
        const id = decodeURIComponent(scheduledMatch[1]);
        const isRun = Boolean(scheduledMatch[2]);
        try {
          if (req.method === "POST" && isRun) {
            await scheduler.runNow(id);
            sendJson(res, 200, { ok: true });
            return;
          }
          if (req.method === "PATCH" && !isRun) {
            const body = JSON.parse((await readBody(req)) || "{}");
            sendJson(res, 200, { task: await scheduler.update(id, body) });
            return;
          }
          if (req.method === "DELETE" && !isRun) {
            await scheduler.remove(id);
            sendJson(res, 200, { ok: true });
            return;
          }
        } catch (error) {
          sendJson(res, error instanceof SchedulerError ? error.status : 500, { error: error instanceof Error ? error.message : String(error) });
          return;
        }
      }
    }
    if (req.method === "POST" && url.pathname === "/api/web-settings") {
      const patch = JSON.parse((await readBody(req)) || "{}");
      if (Object.prototype.hasOwnProperty.call(patch, "mcpServers")) {
        sendJson(res, 400, { error: "MCP yapılandırmasını /api/mcp/servers üzerinden yönetin" });
        return;
      }
      sendJson(res, 200, { settings: await webSettings.patch(patch) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/files") {
      const options = { includeHidden: url.searchParams.get("hidden") === "1", includeGenerated: url.searchParams.get("generated") === "1" };
      sendJson(res, 200, { entries: await files.list(url.searchParams.get("path") ?? ".", options) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/files/search") {
      const options = { includeHidden: url.searchParams.get("hidden") === "1", includeGenerated: url.searchParams.get("generated") === "1", limit: Number(url.searchParams.get("limit") || 200) };
      sendJson(res, 200, { entries: await files.search(url.searchParams.get("q") ?? "", options) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/file") {
      sendJson(res, 200, await files.read(url.searchParams.get("path") ?? "."));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/file/write") {
      const body = JSON.parse(await readBody(req) || "{}");
      const content = String(body.content ?? "");
      const result = await fileMutations.writeFile(String(body.path || "."), content, { createBackup: body.createBackup !== false });
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/file/patch") {
      const body = JSON.parse(await readBody(req) || "{}");
      const patches = Array.isArray(body.patches) ? body.patches : [];
      const result = await fileMutations.patchFile(String(body.path || "."), patches);
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/file/delete") {
      const body = JSON.parse(await readBody(req) || "{}");
      const result = await fileMutations.deleteFile(String(body.path || "."));
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/file/undo-turn") {
      const body = JSON.parse(await readBody(req) || "{}");
      const entries = Array.isArray(body.files) ? body.files as TurnFileUndoEntry[] : [];
      const result = await undoTurnFileChanges(currentWorkspaceCwd, fileMutations, entries);
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/file/mkdir") {
      const body = JSON.parse(await readBody(req) || "{}");
      const result = await fileMutations.createDirectory(String(body.path || "."));
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/file/rename") {
      const body = JSON.parse(await readBody(req) || "{}");
      const result = await fileMutations.renameEntry(String(body.from || "."), String(body.to || "."));
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/file/history") {
      const path = url.searchParams.get("path") ?? ".";
      const versions = await fileHistory.getHistory(path);
      sendJson(res, 200, { versions });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/file/restore") {
      const body = JSON.parse(await readBody(req) || "{}");
      const success = await fileHistory.restoreToVersion(String(body.versionId || ""), currentWorkspaceCwd);
      sendJson(res, 200, { success });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/command") {
      const command = await parseCommand(req);
      sendJson(res, 200, await handleCommand(command));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/terminal/run") {
      const body = JSON.parse(await readBody(req) || "{}");
      const id = String(body.id || randomUUID());
      const command = String(body.command ?? "");
      activeRuntime.extensionUi.notifyTerminalInput(command);
      const result = await terminal.run(command, {
        id,
        timeoutMs: Number(body.timeoutMs ?? 30_000),
        onStart: (command) => hub.send({ type: "terminal_start", id, command }),
        onOutput: (stream, text) => hub.send({ type: "terminal_output", id, stream, text }),
      });
      hub.send({ type: "terminal_end", id, exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, durationMs: result.durationMs });
      sendJson(res, 200, { id, ...result });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/terminal/stop") {
      const body = JSON.parse(await readBody(req) || "{}");
      sendJson(res, 200, { stopped: terminal.stop(String(body.id || "")) });
      return;
    }
    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }
    sendJson(res, 405, { error: "Yönteme izin verilmiyor" });
  } catch (error) {
    sendJson(res, errorStatusCode(error), { error: error instanceof Error ? error.message : String(error), ...(error instanceof MobileApiError ? { code: error.code } : {}) });
  }
});

// Gercek interaktif terminal: /api/terminal WebSocket -> node-pty PTY.
const terminalPtyServer = attachTerminalWebSocket(server, {
  getCwd: () => currentWorkspaceCwd,
  auth,
  isEnabled: () => terminalPolicyMode !== "disabled",
  allowRemote: process.env.QUAKE_WEB_TERMINAL_REMOTE === "1",
});
const mobileStreamServer = attachMobileStreamWebSocket(server, auth);

server.listen(port, host, () => {
  console.log(`Quake Code çalışıyor: http://${host}:${port}`);
  if (auth.enabled) console.log("Quake Code web auth: enabled (token not logged)");
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  try { scheduler.stop(); } catch { /* ignore */ }
  try { terminalPtyServer.dispose(); } catch { /* ignore */ }
  try { mobileStreamServer.close(); } catch { /* ignore */ }
  void flushMcpAlwaysAllowWrites()
    .catch(() => {})
    .then(() => Promise.allSettled([...workspaceServices.values()].map((services) => services.mcpManager.dispose())))
    .finally(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
