import type { AgentMessage, ThinkingLevel } from "@mrquake/quakecode-agent-core";
import type { ImageContent, Model } from "@mrquake/quakecode-ai";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface WebSessionSummary {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  lastUserMessage?: string;
  lastAssistantMessage?: string;
  lastModel?: { provider: string; modelId: string };
  lastThinkingLevel?: string;
}

/** Independent project-aware conversation rendered in the side-chat workspace. */
export interface WebSideConversationSummary {
  id: string;
  path?: string;
  title: string;
  parentSessionPath?: string;
  /** True when this side conversation was created from a snapshot of the parent branch. */
  contextInherited: boolean;
  /** User-visible parent timeline messages available to the child model but hidden from its own thread. */
  inheritedMessageCount: number;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  isStreaming: boolean;
}

export interface WebSideConversationSnapshot extends WebSideConversationSummary {
  messages: AgentMessage[];
  streamingMessage?: AgentMessage;
  model?: { provider: string; id: string; name?: string };
  thinkingLevel: ThinkingLevel;
}

export type WebSubagentStatus =
  | "queued"
  | "running"
  | "completed"
  | "steered"
  | "aborted"
  | "stopped"
  | "interrupted"
  | "shutdown"
  | "error";

/** One real AgentManager child shown in the Outputs card and split workspace. */
export interface WebSubagentSummary {
  id: string;
  name: string;
  type: string;
  description: string;
  status: WebSubagentStatus;
  parentId?: string;
  taskPath: string;
  lastTaskMessage: string;
  createdAt: number;
  startedAt: number;
  completedAt?: number;
  durationMs: number;
  toolUses: number;
  totalTokens?: number;
  sessionFile?: string;
  isolation?: "worktree" | "none";
  worktreePath?: string;
  worktreeBranch?: string;
  resultPreview?: string;
  error?: string;
  model?: { provider: string; id: string; name?: string };
  thinkingLevel?: ThinkingLevel;
  isStreaming: boolean;
  messageCount: number;
}

export interface WebSubagentActivity {
  id: string;
  toolName: string;
  status: "running" | "completed" | "error";
  input?: string;
  output?: string;
  startedAt: number;
  updatedAt: number;
}

export interface WebSubagentSnapshot extends WebSubagentSummary {
  messages: AgentMessage[];
  streamingMessage?: AgentMessage;
  streamingText?: string;
  activities: WebSubagentActivity[];
}

export interface WebSubagentAgentType {
  id: string;
  label: string;
  description: string;
}

export interface WebModelSummary {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
  supportsXhigh?: boolean;
  supportsMax?: boolean;
  input?: string[];
  configured: boolean;
  current: boolean;
}

export interface WebCommandInfo {
  name: string;
  description: string;
  source: "builtin" | "extension" | "prompt" | "skill";
}

export type WebExtensionSource = "bundled" | "workspace" | "personal";

export type WebExtensionCategory = "featured" | "productivity" | "education";

export interface WebExtensionInfo {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  optIn?: boolean;
  installed?: boolean;
  source?: WebExtensionSource;
  category?: WebExtensionCategory;
}

export interface WebSkillInfo {
  name: string;
  description?: string;
  source?: string;
}

export type WebMcpToolDecision = "allow" | "ask" | "deny";

export interface WebMcpServerBase {
  version: 1;
  id: string;
  name: string;
  enabled: boolean;
  autoStart: boolean;
  timeoutMs: number;
  toolPolicy: { default: WebMcpToolDecision; overrides?: Record<string, WebMcpToolDecision> };
  reconnect?: { enabled: boolean; maxAttempts: number; baseDelayMs: number };
}

export type WebMcpServer = WebMcpServerBase & (
  | { transport: "stdio"; command: string; args: string[]; cwd?: string; env?: Record<string, string> }
  | { transport: "streamable-http" | "sse"; url: string; headers?: Record<string, string> }
);

export interface WebRuntimeSettings {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: ThinkingLevel;
  theme?: string;
  blockImages?: boolean;
  showImages?: boolean;
  mcpServers?: WebMcpServer[];
}

/** Provider connection / catalog (Settings → Provider’lar) */
export type ProviderAuthKind = "oauth" | "api_key" | "cloud_env";

export type ProviderConnectionStatus =
  | "connected_oauth"
  | "connected_api_key"
  | "connected_env"
  | "not_configured"
  | "error"
  | "expired";

export type ProviderCatalogGroup = "subscription" | "api_key" | "cloud";

export interface WebProviderCatalogEntry {
  id: string;
  name: string;
  kind: ProviderAuthKind;
  group: ProviderCatalogGroup;
  logoUrl: string;
  envVar?: string;
  docsHint?: string;
  supportsOAuth?: boolean;
  supportsApiKey?: boolean;
  usesCallbackServer?: boolean;
  order: number;
}

export interface WebProviderAccountSummary {
  accountId: string;
  label: string;
  kind: string;
  isActive?: boolean;
  exhaustedUntil?: number;
  accountHint?: string;
}

export interface WebProviderStatusEntry {
  id: string;
  status: ProviderConnectionStatus;
  accountHint?: string;
  expiresAt?: number;
  source?: "auth_file" | "env" | "none";
  accountCount?: number;
  rotationEnabled?: boolean;
  accounts?: WebProviderAccountSummary[];
  error?: string;
}

export interface WebProviderListItem extends WebProviderCatalogEntry {
  status: ProviderConnectionStatus;
  accountHint?: string;
  expiresAt?: number;
  source?: "auth_file" | "env" | "none";
  accountCount?: number;
  rotationEnabled?: boolean;
  accounts?: WebProviderAccountSummary[];
  modelCount?: number;
  error?: string;
}

export type WebConversationMode = "execute" | "plan";

export interface WebPlanStep {
  step: number;
  text: string;
  fullText?: string;
  completed: boolean;
  status?: "pending" | "active" | "completed" | "blocked";
}

export type WebPlanPhase = "idle" | "clarifying" | "planning" | "ready";

export interface WebPlanClarificationOption {
  id: string;
  label: string;
  description?: string;
}

export interface WebPlanClarificationAnswer {
  optionId?: string;
  text?: string;
  skipped?: boolean;
}

export interface WebPlanQuestion {
  id: string;
  label: string;
  detail?: string;
  options?: WebPlanClarificationOption[];
  recommendedOptionId?: string;
  required: boolean;
  answer?: WebPlanClarificationAnswer;
}

export interface WebPlanClarificationState {
  id: string;
  requestId?: string;
  title: string;
  status: "pending" | "answered" | "skipped";
  questions: WebPlanQuestion[];
  activeQuestionId?: string;
  summary?: string;
}

export interface WebPlanArtifact {
  id: string;
  title: string;
  markdown: string;
  documentPath?: string;
  revision: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface WebPlanState {
  enabled: boolean;
  phase?: WebPlanPhase;
  steps: WebPlanStep[];
  completed: number;
  activeStep?: number;
  lastPlanText?: string;
  artifact?: WebPlanArtifact;
  clarification?: WebPlanClarificationState;
}

export interface WebServerConfig {
  host: string;
  port: number;
  /** All workspace roots kept open in this desktop window. */
  workspaceRoots: string[];
  /** Active root used by cwd-bound UI services (same value as cwd). */
  cwd: string;
  authEnabled: boolean;
  terminalEnabled: boolean;
  /** Legacy terminal policy; maps to Codex approval presets */
  terminalPolicyMode: "safe" | "allow-all" | "disabled";
  /** Codex approval preset id: read-only | auto | full-access */
  approvalPresetId?: "read-only" | "auto" | "full-access";
  approvalPresetLabel?: string;
  maxFilePreviewBytes: number;
  workspaceAllowlist: string[];
  version: string;
  /**
   * Cooperative agent HTTP proxy (T2.P2). Only clients that honor HTTP_PROXY.
   * Not a transparent OS firewall. Default off.
   */
  agentHttpProxyEnabled?: boolean;
  /** Loopback URL when proxy is running, e.g. http://127.0.0.1:PORT */
  agentHttpProxyUrl?: string | null;
  /** UI status: off | active | error */
  agentHttpProxyStatus?: "off" | "active" | "error";
  agentHttpProxyError?: string | null;
  /** OS sandbox mode from env/settings: off | experimental (not Windows Sandbox). */
  osSandboxMode?: "off" | "experimental";
  /** Backend id: host | experimental-unavailable | … */
  osSandboxBackendId?: string;
  /** False when experimental is on but no helper is installed (fail-closed). */
  osSandboxAvailable?: boolean;
  /** Path from QUAKE_COMMAND_RUNNER if set. */
  osSandboxHelperPath?: string | null;
  /** Persisted experimental flag (Settings switch). */
  osSandboxExperimental?: boolean;
  /**
   * Codex-style parallel agent isolation via git worktree (default true).
   * Maps to QUAKE_CODE_AGENT_ISOLATION=worktree|none.
   */
  agentWorktreeIsolation?: boolean;
}

export interface WebFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
}

export type WebGoalStatus =
  | "draft"
  | "planning"
  | "executing"
  | "verifying"
  | "paused"
  | "blocked"
  | "budget_limited"
  | "completed"
  | "failed"
  | "cancelled";

export interface WebGoalState {
  schemaVersion: 2;
  id: string;
  objective: string;
  status: WebGoalStatus;
  currentTurn: number;
  budget: {
    maxTurns: number;
    maxStagnantTurns: number;
    tokenBudget?: number;
  };
  criteria: Array<{
    id: string;
    text: string;
    required: boolean;
    status: "pending" | "passed" | "failed" | "unknown";
    evidenceIds: string[];
  }>;
  evidence: Array<{
    id: string;
    kind: "tool" | "test" | "build" | "typecheck" | "agent_report";
    label: string;
    passed: boolean;
    summary: string;
    createdAt: number;
  }>;
  stagnantTurns: number;
  /** Codex tokens_used */
  tokensUsed?: number;
  /** Consecutive same-blocker turns for blocked×3 audit */
  blockedStreak?: number;
  lastProgressFingerprint?: string;
  lastMessage?: string;
  createdAt: number;
  updatedAt: number;
  pausedAt?: number;
  completedAt?: number;
  stopReason?: "user_paused" | "user_cancelled" | "session_aborted" | "legacy_import" | "budget_limited";
  blockedReason?: string;
  revision: number;
}

export interface WebSessionState {
  sessionId: string;
  sessionFile?: string;
  model?: Model<any>;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  autoCompactionEnabled: boolean;
  pendingMessageCount: number;
  messageCount: number;
  activeTools: string[];
  cwd: string;
  contextUsage?: WebContextUsage;
  conversationMode: WebConversationMode;
  plan: WebPlanState;
  /** Session files that currently have a running agent (active or background). */
  streamingSessions?: string[];
  goal?: WebGoalState;
}

export interface WebContextUsage {
  /** Estimated tokens that would be sent with the next model request. */
  tokens: number | null;
  contextWindow: number;
  /** Percentage of the active model context window, or null while recalculating after compaction. */
  percent: number | null;
}

export type WebExtensionUiRequest =
  | { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
  | { type: "extension_ui_request"; id: string; method: "requestUserInput"; title: string; clarification: WebPlanClarificationState }
  | { type: "extension_ui_request"; id: string; method: "planClarification"; title: string; clarification: WebPlanClarificationState }
  | { type: "extension_ui_request"; id: string; method: "notify"; message: string; notifyType?: "info" | "warning" | "error" }
  | { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText?: string }
  | { type: "extension_ui_request"; id: string; method: "setWidget"; widgetKey: string; widgetLines?: string[]; widgetPlacement?: "aboveEditor" | "belowEditor" }
  | { type: "extension_ui_request"; id: string; method: "setSidebar"; sidebarKey: string; sidebarLines?: string[] }
  | { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
  | { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

/** Conversation-keyed turn-diff snapshot for session restore (history cards). */
export type WebTurnDiffEntry = {
  turnId: string;
  lifecycleTurnId?: string;
  diff: string;
  files: Array<{
    path: string;
    kind: "create" | "modify" | "delete";
    diff: string;
    added: number;
    removed: number;
    previousPath?: string;
  }>;
  totalAdded: number;
  totalRemoved: number;
  updatedAt?: number;
};

export type WebApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "acceptAlways"
  | "acceptWithExecpolicyAmendment"
  | "applyNetworkPolicyAmendment"
  | "decline"
  | "cancel";

export type WebAgentEvent =
  | {
      type: "ready";
      protocolVersion: 1;
      state: WebSessionState;
      messages: AgentMessage[];
      streamingMessage?: AgentMessage;
      /** Hydrated turn-diff history for file-change cards after restore */
      turnDiffs?: WebTurnDiffEntry[];
    }
  | { type: "state"; state: WebSessionState }
  | { type: "agent_event"; event: JsonValue }
  | { type: "terminal_start"; id: string; command: string }
  | { type: "terminal_output"; id: string; stream: "stdout" | "stderr"; text: string }
  | { type: "terminal_end"; id: string; exitCode: number | null; signal: string | null; timedOut: boolean; durationMs: number }
  | { type: "browser_activity"; tool: string; target?: string; url?: string; tabId?: string }
  | {
      type: "provider_rotation";
      providerId: string;
      fromLabel?: string;
      toLabel?: string;
      reason?: string;
      exhaustedUntil?: number;
    }
  | { type: "error"; message: string; stack?: string }
  /** Codex-style command/tool approval prompt (guardian) */
  | {
      type: "approval_request";
      id: string;
      tool: string;
      summary: string;
      command?: string;
      reason?: string;
      risk: "low" | "medium" | "high";
      availableDecisions: WebApprovalDecision[];
      /** Active preset label for UI */
      presetLabel?: string;
      /** exec | file_change | network | mcp_tool | generic */
      kind?: "exec" | "file_change" | "network" | "mcp_tool" | "generic";
      /** File-change approval: structured file list + patch preview */
      fileChange?: {
        files: Array<{ path: string; kind: string; added: number; removed: number }>;
        patchPreview?: string;
      };
      proposedExecpolicyAmendment?: { command: string[] };
      networkApprovalContext?: { host: string; protocol: "http" | "https" | "socks5_tcp" | "socks5_udp" };
      proposedNetworkPolicyAmendments?: Array<{
        host: string;
        action: "allow" | "deny";
        protocol?: "http" | "https" | "socks5_tcp" | "socks5_udp";
      }>;
      /** MCP tool metadata */
      mcp?: { serverId: string; serverName?: string; toolName: string };
    }
  /** MCP server elicitation/create — form or URL user input */
  | {
      type: "mcp_elicitation_request";
      id: string;
      serverId: string;
      serverName: string;
      mode: string;
      message: string;
      fields: Array<{
        name: string;
        type: string;
        title?: string;
        description?: string;
        required?: boolean;
        enum?: string[];
        enumNames?: string[];
        default?: string | number | boolean | string[];
        format?: string;
        secret?: boolean;
      }>;
      url?: string;
      elicitationId?: string;
      createdAt: number;
    }
  /** Codex turn/diff/updated — aggregated unified diff for the turn */
  | {
      type: "turn_diff_updated";
      turnId: string;
      /** Conversation turn index when known (client history key) */
      conversationTurn?: number;
      diff: string;
      files: Array<{
        path: string;
        kind: "create" | "modify" | "delete";
        diff: string;
        added: number;
        removed: number;
        previousPath?: string;
      }>;
      totalAdded: number;
      totalRemoved: number;
      updatedAt: number;
    }
  /** Codex TurnStarted */
  | { type: "turn_started"; turnId: string; startedAt: number }
  /** Codex TurnComplete */
  | { type: "turn_completed"; turnId: string; startedAt: number; completedAt: number; durationMs: number }
  /**
   * Codex `EventMsg::TurnAborted` / app-server turn interrupted.
   * reason maps TurnAbortReason (interrupted | replaced | budget_limited | review_ended).
   */
  | {
      type: "turn_aborted";
      turnId?: string;
      reason: "interrupted" | "replaced" | "budget_limited" | "review_ended";
      startedAt?: number;
      completedAt?: number;
      durationMs?: number;
    }
  /**
   * Codex same-turn steer accepted (`Session::steer_input` Ok(turn_id)).
   * User message is pending_input on the active turn — not a new turn.
   */
  | { type: "turn_steer_accepted"; turnId: string; messagePreview?: string }
  | WebExtensionUiRequest;

export type WebClientCommand =
  | { type: "prompt"; id?: string; message: string; displayMessage?: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp"; conversationMode?: WebConversationMode; goalOptions?: { maxTurns?: number; maxStagnantTurns?: number; tokenBudget?: number; autoRecover?: boolean } }
  /**
   * Codex `Op::Interrupt` / `turn/interrupt`.
   * Aborts active task; does not start a new turn. Emits `turn_aborted`.
   */
  | { type: "abort"; id?: string }
  /** Alias for abort — Codex app-server method name */
  | { type: "turn_interrupt"; id?: string; turnId?: string }
  /**
   * Codex `turn/steer` — inject into active turn (expectedTurnId optional precondition).
   * Equivalent to prompt with streamingBehavior:"steer" while streaming.
   */
  | {
      type: "turn_steer";
      id?: string;
      message: string;
      displayMessage?: string;
      images?: ImageContent[];
      expectedTurnId?: string;
      conversationMode?: WebConversationMode;
    }
  | {
      type: "new_session";
      id?: string;
      /** Optional parent session file path (branch / isolation lineage). */
      parentSession?: string;
      /**
       * Isolated collaboration surface for the new chat.
       * - plan: empty session starts in plan mode
       * - goal: empty session is reserved for goal work (agent mode + goal pref client-side)
       * - agent: default execute
       */
      isolation?: "plan" | "goal" | "agent";
    }
  | { type: "open_workspace"; id?: string; path: string }
  | { type: "open_workspaces"; id?: string; paths: string[]; activePath?: string }
  | { type: "create_quick_project"; id?: string }
  | { type: "clear_workspace"; id?: string }
  | { type: "switch_session"; id?: string; sessionPath: string }
  | { type: "fork_session"; id?: string; entryId: string }
  | { type: "set_thinking_level"; id?: string; level: ThinkingLevel }
  | { type: "set_model"; id?: string; provider: string; modelId: string }
  | { type: "set_default_model"; id?: string; provider: string; modelId: string }
  | { type: "set_default_thinking"; id?: string; level: ThinkingLevel }
  | { type: "set_auto_compaction"; id?: string; enabled: boolean }
  | { type: "set_block_images"; id?: string; blocked: boolean }
  | { type: "set_show_images"; id?: string; show: boolean }
  | { type: "set_terminal_policy"; id?: string; mode: "safe" | "allow-all" | "disabled" }
  /** Codex approval decision for a pending guardian request */
  | {
      type: "approval_respond";
      id?: string;
      requestId: string;
      decision: WebApprovalDecision;
      execpolicyAmendment?: { command: string[] };
      networkPolicyAmendment?: {
        host: string;
        action: "allow" | "deny";
        protocol?: "http" | "https" | "socks5_tcp" | "socks5_udp";
      };
      /**
       * Scope for execpolicy / network amendments:
       * - session (default): memory only
       * - always: durable guardian-always.json write-through
       */
      scope?: "session" | "always";
    }
  /** Resolve MCP elicitation/create */
  | {
      type: "mcp_elicitation_respond";
      id?: string;
      requestId: string;
      action: "accept" | "decline" | "cancel";
      content?: Record<string, string | number | boolean | string[]>;
    }
  | { type: "set_plan_mode"; id?: string; enabled: boolean }
  | { type: "goal_pause"; id?: string }
  | { type: "goal_resume"; id?: string }
  | { type: "goal_cancel"; id?: string }
  | { type: "plan_clarification_complete"; id?: string; requestId: string; clarificationId: string; answers: Record<string, WebPlanClarificationAnswer> }
  | { type: "plan_clarification_skip"; id?: string; requestId: string; clarificationId: string }
  | { type: "slash_command"; id?: string; command: string; args?: string }
  | { type: "extension_ui_response"; id: string; value?: string; confirmed?: boolean; cancelled?: true };

export type WebCommandResponse =
  | { type: "command_response"; id?: string; command: WebClientCommand["type"]; success: true; data?: JsonValue }
  | { type: "command_response"; id?: string; command: string; success: false; error: string };
