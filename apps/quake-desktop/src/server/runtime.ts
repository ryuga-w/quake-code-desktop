import { cwd as processCwd } from "node:process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { supportsMax, supportsXhigh, type ImageContent } from "@mrquake/quakecode-ai";
import type {
  AgentSessionEvent,
  AgentSessionRuntimeHost,
  ExtensionCommandContextActions,
  SessionInfo,
  UpdatePlanArgs,
} from "@mrquake/quakecode-cli";
import {
  createAgentSessionRuntime,
  AgentSessionRuntimeHost as RuntimeHost,
  SessionManager,
  TurnLifecycle,
  turnDiffAggregator,
  guardianRuntime,
  serializeTurnDiffSnapshot,
  serializeTurnDiffSnapshotForHistory,
  rebuildAllTurnDiffsFromBranch,
  setGuardianInterruptHook,
} from "@mrquake/quakecode-cli";
import type { WebCommandInfo, WebConversationMode, WebModelSummary, WebPlanClarificationAnswer, WebPlanClarificationState, WebPlanPhase, WebPlanState, WebRuntimeSettings, WebSessionState, WebSessionSummary, WebSideConversationSnapshot, WebSideConversationSummary, WebSubagentAgentType, WebSubagentSnapshot, WebSubagentSummary } from "../shared/protocol.js";
import { GoalRuntime } from "./goal/runtime.js";
import { decideGoalNextStep, verificationPassed } from "./goal/scheduler.js";
import { renderGoalObjectiveUpdated } from "./goal/prompts.js";
import { createUpdateGoalToolDefinition } from "./goal/update-goal-tool.js";
import type { SseHub } from "./sse.js";
import type { McpConnectionManager } from "./mcp/manager.js";
import { createMcpToolDefinition } from "./mcp/tool-adapter.js";
import { advanceAgentTurnLifecycle } from "./agent-turn-lifecycle.js";
import { WebExtensionUiBridge } from "./web-extension-ui.js";
import {
  EXTENSION_CATALOG,
  catalogEntryForId,
  extensionIdFromPath,
  resolveExtensionEnabled,
} from "./extension-catalog.js";
import { clearExpiredExhaustion, rotateOnQuotaError } from "./provider-accounts.js";
import { isProviderVisibleInModelPicker } from "./auth-providers.js";

type ExtensionsEnabledReader = () => Record<string, boolean | undefined>;
type ExtensionsEnabledResolver = (cwd: string) => Record<string, boolean | undefined>;
type McpManagerResolver = (cwd: string) => McpConnectionManager | undefined;

type WorkspaceContextHooks = {
  /** Validate and bind cwd-scoped server services before a runtime is created. */
  prepare?: (cwd: string) => Promise<void>;
  /** Apply state that requires the new runtime host to already be active. */
  activated?: (cwd: string) => Promise<void>;
};

function buildRuntimeBootstrap(getExtensionsEnabled: ExtensionsEnabledReader) {
  return {
    resourceLoader: {
      extensionsOverride: (base: any) => {
        const enabledMap = getExtensionsEnabled();
        return {
          ...base,
          extensions: base.extensions.filter((extension: any) =>
            resolveExtensionEnabled(extensionIdFromPath(extension.path), enabledMap),
          ),
        };
      },
    },
  };
}

function runtimeWorkspaceKey(cwd: string): string {
  const normalized = resolve(cwd);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export type WebExtensionSource = "bundled" | "workspace" | "personal";

export type WebExtensionSummary = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  optIn: boolean;
  installed: boolean;
  source: WebExtensionSource;
  category?: "featured" | "productivity" | "education";
};

/** Parked AgentSession hosts so multiple chats can run / stay alive at once. */
type RuntimeSlot = {
  key: string;
  host: AgentSessionRuntimeHost;
  turnLifecycle: TurnLifecycle;
  unsubscribe?: () => void;
  lastUsedAt: number;
  goal: GoalRuntime;
  planUpdate?: UpdatePlanArgs;
  proposedPlan?: { id: string; text: string };
  proposedPlanDraft?: string;
  surface?: "side-conversation";
  parentSessionPath?: string;
  surfaceCreatedAt?: number;
};

type SideConversationMarker = {
  entryId: string;
  parentSessionPath?: string;
  contextInherited: boolean;
  inheritedMessageCount: number;
  createdAt: number;
};

const MAX_RUNTIME_SLOTS = 24;
const ABORT_WAIT_MS = 4500;
const SUBAGENT_WEB_CONTROLS_KEY = Symbol.for("quake-subagents:web-controls");

type RuntimeSubagentControl = {
  sessionId: string;
  list(): WebSubagentSummary[];
  get(id: string): WebSubagentSnapshot | undefined;
  listTypes(): WebSubagentAgentType[];
  spawn(input: {
    message: string;
    name?: string;
    agentType?: string;
    forkContext?: boolean;
    isolation?: "worktree" | "none";
  }): Promise<WebSubagentSnapshot>;
  sendInput(id: string, message: string, interrupt?: boolean): Promise<WebSubagentSnapshot>;
  abort(id: string): WebSubagentSnapshot;
};

export class WebRuntimeController {
  /** Active + background sessions (switch does not kill background work). */
  private readonly slots = new Map<string, RuntimeSlot>();
  private activeKey = "";
  /** Prevent double-rotate on message_end + auto_retry for the same incident. */
  private readonly lastRotationAt = new Map<string, number>();
  private static readonly ROTATION_COOLDOWN_MS = 20_000;
  private workspaceContextHooks: WorkspaceContextHooks = {};
  readonly extensionUi: WebExtensionUiBridge;

  private constructor(
    private readonly hub: SseHub,
    private currentCwd: string,
    private readonly getExtensionsEnabled: ExtensionsEnabledResolver,
    private readonly getMcpManager?: McpManagerResolver,
  ) {
    this.ensureGuardianInterruptHook();
    this.extensionUi = new WebExtensionUiBridge(hub, (ownerKey) => {
      // Pending dialogs belong to the session that created them. Background
      // sessions must never project their clarification into the active chat.
      if (!this.activeKey || ownerKey !== this.activeInteractionOwnerKey()) return false;
      this.emitState();
      return true;
    });
  }

  static async create(
    hub: SseHub,
    cwd = processCwd(),
    getExtensionsEnabled: ExtensionsEnabledResolver = () => ({}),
    getMcpManager?: McpManagerResolver,
  ): Promise<WebRuntimeController> {
    const controller = new WebRuntimeController(hub, cwd, getExtensionsEnabled, getMcpManager);
    const bootstrap = controller.workspaceBootstrap(cwd);
    const runtime = await createAgentSessionRuntime(bootstrap, { cwd });
    const host = new RuntimeHost(bootstrap, runtime);
    await controller.activateHost(host, { bindExtensions: true, sendReady: false });
    return controller;
  }

  setWorkspaceContextHooks(hooks: WorkspaceContextHooks): void {
    this.workspaceContextHooks = hooks;
  }

  private workspaceBootstrap(cwd: string) {
    return buildRuntimeBootstrap(() => this.getExtensionsEnabled(cwd));
  }

  private get host(): AgentSessionRuntimeHost {
    const slot = this.slots.get(this.activeKey);
    if (!slot) throw new Error("Aktif oturum yok");
    return slot.host;
  }

  get session() {
    return this.host.session;
  }

  /** Auth credentials (provider login / API keys). */
  get authStorage() {
    return this.session.modelRegistry.authStorage;
  }

  /** Session files currently running in background (or active). */
  getStreamingSessionFiles(): string[] {
    const out: string[] = [];
    for (const slot of this.slots.values()) {
      if (slot.host.session.isStreaming) {
        const file = slot.host.session.sessionFile;
        if (file) out.push(file);
      }
    }
    return out;
  }

  /**
   * Full user-visible history for the active branch.
   *
   * `session.messages` is the model context and is intentionally shortened by
   * compaction. The timeline must never use it as conversation history: session
   * entries are append-only and remain available before the compaction boundary.
   */
  getTimelineMessages(): any[] {
    return this.getTimelineMessagesForSession(this.session);
  }

  private getTimelineMessagesForSession(session: AgentSessionRuntimeHost["session"]): any[] {
    return this.getTimelineMessagesFromEntries(session.sessionManager.getBranch());
  }

  private getTimelineMessagesFromEntries(branch: any[]): any[] {
    const messages: any[] = [];
    for (const entry of branch) {
      if (entry.type === "message") {
        messages.push({
          ...entry.message,
          messageId: entry.id,
          timestamp: entry.message.timestamp || new Date(entry.timestamp).getTime(),
        });
        continue;
      }
      if (entry.type === "custom_message") {
        messages.push({
          role: "custom",
          customType: entry.customType,
          content: entry.content,
          display: entry.display,
          details: entry.details,
          messageId: entry.id,
          timestamp: new Date(entry.timestamp).getTime(),
        });
        continue;
      }
      if (entry.type === "compaction") {
        messages.push({
          role: "custom",
          customType: "context-compaction",
          content: "Bağlam sıkıştırıldı",
          display: true,
          details: {
            tokensBefore: entry.tokensBefore,
            fromExtension: entry.fromHook === true,
          },
          messageId: entry.id,
          timestamp: new Date(entry.timestamp).getTime(),
        });
      }
    }
    return messages;
  }

  getState(): WebSessionState {
    const session = this.session;
    const plan = this.getPlanState();
    const slot = this.slots.get(this.activeKey);
    return {
      sessionId: session.sessionManager.getSessionId(),
      sessionFile: session.sessionFile,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      autoCompactionEnabled: session.autoCompactionEnabled,
      pendingMessageCount: session.pendingMessageCount,
      messageCount: this.getTimelineMessages().length,
      activeTools: session.getActiveToolNames(),
      cwd: this.currentCwd,
      contextUsage: session.getContextUsage(),
      conversationMode: plan.enabled ? "plan" : "execute",
      plan,
      streamingSessions: this.getStreamingSessionFiles(),
      goal: slot?.goal.snapshot,
    };
  }

  /** Conversation turn count (user messages) — aligns with client buildMessageToolHistory. */
  private countConversationTurns(): number {
    let n = 0;
    for (const m of this.getTimelineMessages()) {
      if (m?.role === "user") n += 1;
    }
    return n;
  }

  /** Hydrate turn-diff custom entries for history file-change cards. */
  private collectTurnDiffHistory(): Array<{
    turnId: string;
    lifecycleTurnId?: string;
    diff: string;
    files: any[];
    totalAdded: number;
    totalRemoved: number;
    updatedAt?: number;
  }> {
    try {
      const branch = this.session.sessionManager.getBranch() as Array<{
        type?: string;
        customType?: string;
        data?: unknown;
      }>;
      const rebuilt = rebuildAllTurnDiffsFromBranch(branch);
      return rebuilt.map((e) => ({
        turnId: String(e.conversationTurn),
        lifecycleTurnId: e.lifecycleTurnId,
        diff: e.snapshot.diff,
        files: e.snapshot.files,
        totalAdded: e.snapshot.totalAdded,
        totalRemoved: e.snapshot.totalRemoved,
        updatedAt: e.snapshot.updatedAt,
      }));
    } catch {
      return [];
    }
  }

  private slotHasActiveWork(slot: RuntimeSlot): boolean {
    if (slot.host.session.isStreaming || slot.goal.active) return true;
    const sessionId = slot.host.session.sessionManager.getSessionId();
    const registry = (globalThis as any)[SUBAGENT_WEB_CONTROLS_KEY] as Map<string, RuntimeSubagentControl> | undefined;
    return Boolean(registry?.get(sessionId)?.list().some((agent) => agent.status === "queued" || agent.status === "running"));
  }

  sendReady(): void {
    const streamingMessage = this.getActiveStreamingMessage();
    this.hub.send({
      type: "ready",
      protocolVersion: 1,
      state: this.getState(),
      messages: this.getTimelineMessages(),
      streamingMessage: streamingMessage as any,
      turnDiffs: this.collectTurnDiffHistory(),
    });
  }

  private getActiveStreamingMessage(): unknown {
    return this.getStreamingMessageForSession(this.session);
  }

  private getStreamingMessageForSession(session: AgentSessionRuntimeHost["session"]): unknown {
    try {
      const agent = (session as any)?.agent;
      return agent?.state?.streamingMessage;
    } catch {
      return undefined;
    }
  }

  async prompt(message: string, options?: { displayMessage?: string; streamingBehavior?: "steer" | "followUp"; images?: ImageContent[]; goalOptions?: { maxTurns?: number; maxStagnantTurns?: number; tokenBudget?: number; autoRecover?: boolean } }): Promise<void> {
    const slot = this.slots.get(this.activeKey);
    if (slot && message.startsWith("/goal ")) {
      const objective = message.substring(6).trim();
      const existing = slot.goal.snapshot;
      // Mid-run objective edit: supersede prior objective (Codex objective_updated).
      if (existing && ["planning", "executing", "verifying", "paused", "blocked", "budget_limited"].includes(existing.status)
        && existing.objective.trim() !== objective) {
        slot.goal.updateObjective(objective);
        if (slot.goal.snapshot?.status !== "executing") {
          try { slot.goal.beginExecution(); } catch { /* already executing */ }
        }
        this.syncGoalTools(slot);
        this.emitState();
        const latest = slot.goal.snapshot!;
        message = renderGoalObjectiveUpdated({
          objective: latest.objective,
          tokensUsed: latest.tokensUsed,
          tokenBudget: latest.budget.tokenBudget,
        });
      } else if (!existing || ["completed", "failed", "cancelled"].includes(existing.status)) {
        slot.goal.start(objective, options?.goalOptions);
        slot.goal.beginExecution();
        this.syncGoalTools(slot);
        this.emitState();
        message = [
          "## GOAL RUNTIME V2 — UNATTENDED EXECUTION ##",
          "The user may leave the computer. Work autonomously until the goal is implemented and verified.",
          "Build a checklist, execute it, diagnose failures, retry with different approaches, and collect deterministic verification evidence.",
          "Do not ask for confirmation for normal workspace reads/edits, tests, typechecks, builds, linting, or safe retries.",
          "Pause only for hard safety boundaries, missing credentials, destructive external actions, or a genuinely unresolvable blocker.",
          "This runtime persists goal state and controls completion; do not claim success without evidence.",
          'When the objective is achieved and verified, call update_goal with status "complete".',
          'Call update_goal with status "blocked" only after the same blocking condition on ≥3 consecutive goal turns.',
          "As a legacy fallback when update_goal is unavailable, append <!-- GOAL_CANDIDATE_COMPLETE --> after the same completion audit.",
          "",
          `Goal: ${objective}`,
        ].join("\n");
      } else {
        // Same objective while goal still open — treat as continue nudge.
        this.syncGoalTools(slot);
        this.emitState();
        message = [
          "## GOAL RUNTIME CONTINUATION ##",
          "Continue the active goal. Call update_goal only for complete/blocked per audit rules.",
          "",
          `Goal: ${existing.objective}`,
        ].join("\n");
      }
    }
    await this.session.prompt(expandDesktopMentions(message), {
      streamingBehavior: options?.streamingBehavior,
      images: options?.images,
      displayText: options?.displayMessage,
    });
  }

  pauseGoal(): void {
    const slot = this.slots.get(this.activeKey);
    if (!slot) throw new Error("Aktif oturum yok");
    slot.goal.pause();
    this.emitState();
  }

  resumeGoal(): void {
    const slot = this.slots.get(this.activeKey);
    if (!slot) throw new Error("Aktif oturum yok");
    slot.goal.resume();
    this.emitState();
    this.scheduleGoalRecovery(slot, "resume");
  }

  cancelGoal(): void {
    const slot = this.slots.get(this.activeKey);
    if (!slot) throw new Error("Aktif oturum yok");
    slot.goal.cancel();
    this.emitState();
  }

  async setPlanMode(enabled: boolean): Promise<void> {
    this.session.setCollaborationMode(enabled ? "plan" : "default");
    this.emitState();
  }

  async applyConversationMode(mode: WebConversationMode | undefined): Promise<void> {
    if (!mode) return;
    const plan = this.getPlanState();
    if (mode === "plan") {
      if (!plan.enabled) await this.setPlanMode(true);
      return;
    }
    if (plan.enabled) await this.setPlanMode(false);
  }

  resolveExtensionUiResponse(id: string, response: { value?: unknown; confirmed?: boolean; cancelled?: true }): boolean {
    return this.extensionUi.resolveResponse(id, response, this.activeInteractionOwnerKey());
  }

  completePlanClarification(args: {
    requestId: string;
    clarificationId: string;
    answers: Record<string, WebPlanClarificationAnswer>;
  }): void {
    const handled = this.extensionUi.completeClarification(args.requestId, args.clarificationId, args.answers, this.activeInteractionOwnerKey());
    if (!handled) throw new Error("Plan sorusu artık geçerli değil; durum yenilendi.");
  }

  skipPlanClarification(args: { requestId: string; clarificationId: string }): void {
    const handled = this.extensionUi.skipClarification(args.requestId, args.clarificationId, this.activeInteractionOwnerKey());
    if (!handled) throw new Error("Plan sorusu artık geçerli değil; durum yenilendi.");
  }

  /** Wire guardian circuit-breaker → turn interrupt (once per process host). */
  private ensureGuardianInterruptHook(): void {
    setGuardianInterruptHook((reason) => {
      console.warn("[guardian] circuit-breaker interrupt:", reason);
      void this.abort("interrupted");
    });
  }

  /**
   * Codex `Op::Interrupt` / app-server `turn/interrupt`.
   * Emits `turn_aborted` (TurnAbortedEvent, reason: interrupted).
   * Clears steer/follow-up queues (agent.abort) so Stop cannot restart.
   */
  async abort(reason: "interrupted" | "replaced" | "budget_limited" | "review_ended" = "interrupted"): Promise<void> {
    this.ensureGuardianInterruptHook();
    const slot = this.slots.get(this.activeKey);
    if (slot?.goal.active) slot.goal.pause("session_aborted");
    const session = this.session;
    // Mark the lifecycle synchronously after signalling the session. Waiting first
    // lets a freshly submitted prompt start and receive the previous turn's abort.
    let abortWait: Promise<void> | undefined;
    try {
      abortWait = session.abort();
    } catch (error) {
      console.warn("[runtime] abort error:", error);
    }
    const aborted = slot?.turnLifecycle.abortTurn(reason);
    if (aborted && "event" in aborted) {
      guardianRuntime.endTurn();
      this.hub.send({
        type: "turn_aborted",
        turnId: aborted.event.turnId,
        reason: aborted.event.reason,
        startedAt: Math.floor(aborted.event.startedAt / 1000),
        completedAt: Math.floor(aborted.event.completedAt / 1000),
        durationMs: aborted.event.durationMs,
      } as any);
    }
    try {
      if (!abortWait) throw new Error("Abort başlatılamadı");
      await Promise.race([
        abortWait,
        new Promise<void>((resolve) => setTimeout(resolve, ABORT_WAIT_MS)),
      ]);
    } catch (error) {
      console.warn("[runtime] abort error:", error);
    }
    // Re-emit authoritative state so UI unlocks even if a tool is still winding down.
    this.emitState();
  }

  /**
   * Codex `turn/steer` / `Session::steer_input` — inject into active turn only.
   * expectedTurnId mismatch → hard reject (Codex ExpectedTurnMismatch).
   * When idle, falls through to a normal prompt (NoActiveTurn → spawn new turn).
   */
  async steer(message: string, options?: { displayMessage?: string; images?: ImageContent[]; expectedTurnId?: string }): Promise<void> {
    const slot = this.slots.get(this.activeKey);
    if (!slot) throw new Error("Aktif oturum yok");
    const isStreaming = Boolean(this.session?.isStreaming);
    const check = slot.turnLifecycle.assertExpectedTurnId(options?.expectedTurnId);
    if (!check.ok) {
      throw new Error(check.error);
    }
    if (isStreaming) {
      await this.session.prompt(expandDesktopMentions(message), {
        streamingBehavior: "steer",
        images: options?.images,
        displayText: options?.displayMessage,
      });
      this.hub.send({
        type: "turn_steer_accepted",
        turnId: slot.turnLifecycle.getActiveTurnId() || String(this.activeKey || "active"),
        messagePreview: message.slice(0, 200),
      } as any);
      return;
    }
    // Codex SteerInputError::NoActiveTurn → start a regular turn
    await this.prompt(message, { displayMessage: options?.displayMessage, images: options?.images });
  }

  cancelPendingInteractions(): void {
    this.extensionUi.clearPendingRequests(this.activeInteractionOwnerKey());
  }

  async newSession(_options?: {
    parentSession?: string;
    isolation?: "plan" | "goal" | "agent";
    setup?: (sessionManager: any) => Promise<void>;
  }): Promise<{ cancelled: boolean }> {
    // Keep any currently streaming chat alive in the background — cancel only the
    // active session's blocking UI before moving it out of focus.
    const parentSession = _options?.parentSession || this.session.sessionFile || undefined;
    const isolation = _options?.isolation || "agent";
    this.extensionUi.clearPendingRequests(this.activeInteractionOwnerKey());
    const bootstrap = this.workspaceBootstrap(this.currentCwd);
    const runtime = await createAgentSessionRuntime(bootstrap, { cwd: this.currentCwd });
    const host = new RuntimeHost(bootstrap, runtime);
    try {
      // Fresh empty session with optional parent lineage (yan sohbet / isolation tree).
      if (parentSession || isolation !== "agent") {
        host.session.sessionManager.newSession({
          parentSession: parentSession || undefined,
        });
        const agent = (host.session as any).agent;
        if (agent?.state) {
          agent.state.messages = host.session.sessionManager.buildSessionContext().messages;
        }
      }
      host.session.sessionManager.appendCustomEntry("chat-isolation", {
        kind: isolation,
        parentSession: parentSession || null,
        createdAt: Date.now(),
      });
      if (isolation === "plan") {
        host.session.setCollaborationMode("plan");
      } else if (host.session.collaborationMode === "plan") {
        host.session.setCollaborationMode("default");
      }
    } catch (error) {
      console.warn("[runtime] newSession isolation setup failed:", error);
    }
    if (_options?.setup) {
      try {
        await _options.setup(host.session.sessionManager);
        const agent = (host.session as any).agent;
        if (agent?.state) {
          agent.state.messages = host.session.sessionManager.buildSessionContext().messages;
        }
      } catch (error) {
        console.warn("[runtime] newSession setup failed:", error);
      }
    }
    await this.activateHost(host, { bindExtensions: true, sendReady: false });
    await this.pruneSlots();
    this.sendReady();
    return { cancelled: false };
  }

  async openWorkspace(cwd: string): Promise<void> {
    const nextCwd = resolve(cwd);
    // Only the surface being left loses blocking UI. Parked sessions and running
    // agents remain alive, including sessions from other workspace roots.
    this.extensionUi.clearPendingRequests(this.activeInteractionOwnerKey());
    await this.workspaceContextHooks.prepare?.(nextCwd);
    const bootstrap = this.workspaceBootstrap(nextCwd);
    const runtime = await createAgentSessionRuntime(bootstrap, { cwd: nextCwd });
    const host = new RuntimeHost(bootstrap, runtime);
    await this.activateHost(host, { bindExtensions: true, sendReady: false });
    await this.workspaceContextHooks.activated?.(nextCwd);
    await this.pruneSlots();
    this.sendReady();
  }

  listExtensions(): WebExtensionSummary[] {
    const enabledMap = this.getExtensionsEnabled(this.currentCwd);
    const loaded = new Set(
      this.session.resourceLoader
        .getExtensions()
        .extensions.map((extension) => extensionIdFromPath(extension.path)),
    );
    const seen = new Set<string>();
    const rows: WebExtensionSummary[] = [];

    for (const entry of EXTENSION_CATALOG) {
      seen.add(entry.id);
      rows.push({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        enabled: resolveExtensionEnabled(entry.id, enabledMap),
        optIn: true,
        installed: loaded.has(entry.id),
        source: "bundled",
        category: entry.category,
      });
    }

    for (const extension of this.session.resourceLoader.getExtensions().extensions) {
      const id = extensionIdFromPath(extension.path);
      if (seen.has(id)) continue;
      const catalog = catalogEntryForId(id);
      rows.push({
        id,
        name: catalog?.name ?? id,
        description: catalog?.description ?? "Kurulu eklenti",
        enabled: resolveExtensionEnabled(id, enabledMap),
        optIn: false,
        installed: true,
        source: "workspace",
      });
    }

    return rows;
  }

  async reloadExtensionsAfterToggle(): Promise<void> {
    await this.session.reload();
    await this.bindExtensionsForActive();
    this.emitState();
    this.sendReady();
  }

  async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    const target = resolve(sessionPath);
    this.extensionUi.clearPendingRequests(this.activeInteractionOwnerKey());

    // Already active?
    const activeFile = this.session.sessionFile ? resolve(this.session.sessionFile) : "";
    if (activeFile && activeFile === target) {
      this.touchActive();
      this.sendReady();
      return { cancelled: false };
    }

    // Resume parked slot (background agent may still be streaming)
    const parked = this.findSlotBySessionPath(target);
    if (parked) {
      const parkedCwd = parked.host.session.sessionManager.getCwd();
      await this.workspaceContextHooks.prepare?.(parkedCwd);
      this.activeKey = parked.key;
      parked.lastUsedAt = Date.now();
      this.currentCwd = parkedCwd;
      await this.bindExtensionsForActive();
      this.syncMcpTools(parkedCwd);
      await this.workspaceContextHooks.activated?.(parkedCwd);
      this.sendReady();
      return { cancelled: false };
    }

    // Open session file into a new slot without disposing others
    const sessionManager = SessionManager.open(sessionPath);
    const sessionCwd = sessionManager.getCwd();
    await this.workspaceContextHooks.prepare?.(sessionCwd);
    const bootstrap = this.workspaceBootstrap(sessionCwd);
    const previousSessionFile = this.session.sessionFile;
    const runtime = await createAgentSessionRuntime(bootstrap, {
      cwd: sessionCwd,
      sessionManager,
      sessionStartEvent: {
        type: "session_start",
        reason: "resume",
        previousSessionFile,
      },
    });
    const host = new RuntimeHost(bootstrap, runtime);
    await this.activateHost(host, { bindExtensions: true, sendReady: false });
    await this.workspaceContextHooks.activated?.(sessionCwd);
    await this.pruneSlots();
    this.sendReady();
    return { cancelled: false };
  }

  async forkSession(entryId: string): Promise<{ cancelled: boolean }> {
    // Fork only mutates the active host; parked slots stay alive.
    this.extensionUi.clearPendingRequests(this.activeInteractionOwnerKey());
    const result = await this.host.fork(entryId);
    if (result.cancelled) return { cancelled: true };

    // host.fork disposed previous active session and installed a new one on same host —
    // re-key + re-subscribe active slot.
    const oldActive = this.slots.get(this.activeKey);
    oldActive?.unsubscribe?.();
    this.slots.delete(this.activeKey);
    const newKey = this.slotKeyFromHost(this.host);
    const unsub = this.host.session.subscribe((event) => this.forwardEvent(newKey, event));
    this.slots.set(newKey, {
      key: newKey,
      host: this.host,
      turnLifecycle: new TurnLifecycle(),
      unsubscribe: unsub,
      lastUsedAt: Date.now(),
      goal: new GoalRuntime(this.host.session.sessionManager),
    });
    this.activeKey = newKey;
    this.currentCwd = this.session.sessionManager.getCwd();
    await this.bindExtensionsForActive();
    this.sendReady();
    return { cancelled: false };
  }

  async setThinkingLevel(level: WebSessionState["thinkingLevel"]): Promise<void> {
    this.session.setThinkingLevel(level);
    this.emitState();
  }

  getRuntimeSettings(): WebRuntimeSettings {
    return {
      defaultProvider: this.session.settingsManager.getDefaultProvider(),
      defaultModel: this.session.settingsManager.getDefaultModel(),
      defaultThinkingLevel: this.session.settingsManager.getDefaultThinkingLevel(),
      theme: this.session.settingsManager.getTheme(),
      blockImages: this.session.settingsManager.getBlockImages(),
      showImages: this.session.settingsManager.getShowImages(),
    };
  }

  async setDefaultModel(provider: string, modelId: string): Promise<void> {
    this.session.settingsManager.setDefaultModelAndProvider(provider, modelId);
    await this.session.settingsManager.flush();
  }

  async setDefaultThinkingLevel(level: WebSessionState["thinkingLevel"]): Promise<void> {
    this.session.settingsManager.setDefaultThinkingLevel(level);
    await this.session.settingsManager.flush();
  }

  async setAutoCompactionEnabled(enabled: boolean): Promise<void> {
    this.session.setAutoCompactionEnabled(enabled);
    this.emitState();
  }

  async setBlockImages(blocked: boolean): Promise<void> {
    this.session.settingsManager.setBlockImages(blocked);
    await this.session.settingsManager.flush();
  }

  async setShowImages(show: boolean): Promise<void> {
    this.session.settingsManager.setShowImages(show);
    await this.session.settingsManager.flush();
  }

  async listSessions(all = false): Promise<WebSessionSummary[]> {
    const sessions = all ? await SessionManager.listAll() : await SessionManager.list(this.currentCwd);
    // Empty runtime drafts are not conversation history. A chat becomes visible
    // only after its first user message has been persisted.
    return sessions
      .filter((session) => session.userMessageCount > 0 && session.firstMessage !== "(no messages)")
      .slice(0, 100)
      .map((session) => this.toSessionSummary(session));
  }

  /** List persisted and currently empty side conversations without changing the active chat. */
  async listSideConversations(parentSessionPath?: string): Promise<WebSideConversationSummary[]> {
    const expectedParent = normalizeOptionalSessionPath(parentSessionPath);
    const rows = new Map<string, WebSideConversationSummary>();

    for (const slot of this.slots.values()) {
      const marker = this.readSideConversationMarker(slot.host.session.sessionManager);
      if (!marker) continue;
      slot.surface = "side-conversation";
      slot.parentSessionPath = marker.parentSessionPath;
      slot.surfaceCreatedAt = marker.createdAt;
      const summary = this.sideConversationSnapshotFromSlot(slot);
      if (expectedParent && normalizeOptionalSessionPath(summary.parentSessionPath) !== expectedParent) continue;
      rows.set(summary.id, summary);
    }

    const sessions = await SessionManager.list(this.currentCwd);
    for (const sessionInfo of sessions.slice(0, 150)) {
      if (rows.has(sessionInfo.id)) continue;
      try {
        const manager = SessionManager.open(sessionInfo.path);
        const marker = this.readSideConversationMarker(manager);
        if (!marker) continue;
        if (expectedParent && normalizeOptionalSessionPath(marker.parentSessionPath) !== expectedParent) continue;
        const timeline = this.sideConversationTimeline(manager, marker);
        rows.set(sessionInfo.id, {
          id: sessionInfo.id,
          path: sessionInfo.path,
          title: manager.getSessionName() || sideConversationTitle(sessionInfo.firstMessage),
          parentSessionPath: marker.parentSessionPath,
          contextInherited: timeline.contextInherited,
          inheritedMessageCount: timeline.inheritedMessageCount,
          createdAt: marker.createdAt || sessionInfo.created.getTime(),
          updatedAt: sessionInfo.modified.getTime(),
          messageCount: timeline.messages.length,
          isStreaming: false,
        });
      } catch {
        // A concurrently rotated/deleted history file must not break the launcher.
      }
    }

    return [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Create a parked fork of the parent branch while leaving the main conversation active. */
  async createSideConversation(options?: { parentSessionPath?: string }): Promise<WebSideConversationSnapshot> {
    const parentSessionPath = options?.parentSessionPath || this.session.sessionFile || undefined;
    const bootstrap = this.workspaceBootstrap(this.currentCwd);
    const createdAt = Date.now();
    let contextInherited = false;
    let sessionManager: SessionManager;

    if (parentSessionPath && existsSync(parentSessionPath)) {
      sessionManager = SessionManager.forkFrom(parentSessionPath, this.currentCwd);
      contextInherited = true;
    } else {
      sessionManager = SessionManager.create(this.currentCwd);
      if (parentSessionPath) sessionManager.newSession({ parentSession: parentSessionPath });
    }

    const inheritedMessageCount = this.getTimelineMessagesFromEntries(sessionManager.getBranch()).length;
    sessionManager.appendCustomEntry("chat-isolation", {
      kind: "side-conversation",
      parentSession: parentSessionPath || null,
      contextInherited,
      inheritedMessageCount,
      createdAt,
    });
    sessionManager.appendSessionInfo("Yeni yan sohbet");

    const runtime = await createAgentSessionRuntime(bootstrap, {
      cwd: sessionManager.getCwd(),
      sessionManager,
    });
    const host = new RuntimeHost(bootstrap, runtime);

    const slot = await this.installBackgroundHost(host);
    slot.surface = "side-conversation";
    slot.parentSessionPath = parentSessionPath;
    slot.surfaceCreatedAt = createdAt;
    await this.pruneSlots();
    return this.sideConversationSnapshotFromSlot(slot);
  }

  async getSideConversation(identifier: string): Promise<WebSideConversationSnapshot> {
    const slot = await this.ensureSideConversationSlot(identifier);
    slot.lastUsedAt = Date.now();
    return this.sideConversationSnapshotFromSlot(slot);
  }

  async promptSideConversation(identifier: string, message: string): Promise<void> {
    const text = String(message || "").trim();
    if (!text) throw new Error("Yan sohbet mesajı boş olamaz");
    const slot = await this.ensureSideConversationSlot(identifier);
    slot.lastUsedAt = Date.now();
    const marker = this.readSideConversationMarker(slot.host.session.sessionManager);
    if (!marker) throw new Error("Bu oturum bir yan sohbet değil");
    const messages = this.sideConversationTimeline(slot.host.session.sessionManager, marker).messages;
    if (!messages.some((entry) => entry?.role === "user")) {
      slot.host.session.sessionManager.appendSessionInfo(sideConversationTitle(text));
    }
    await slot.host.session.prompt(expandDesktopMentions(text), {
      streamingBehavior: slot.host.session.isStreaming ? "steer" : undefined,
      displayText: text,
    });
  }

  async updateSideConversationPreferences(
    identifier: string,
    preferences: {
      provider?: string;
      modelId?: string;
      thinkingLevel?: WebSideConversationSnapshot["thinkingLevel"];
    },
  ): Promise<WebSideConversationSnapshot> {
    const slot = await this.ensureSideConversationSlot(identifier);
    const session = slot.host.session;
    if (preferences.provider || preferences.modelId) {
      if (!preferences.provider || !preferences.modelId) {
        throw new Error("Model sağlayıcısı ve model kimliği birlikte gönderilmelidir");
      }
      const model = session.modelRegistry.find(preferences.provider, preferences.modelId);
      if (!model) throw new Error(`Bilinmeyen model: ${preferences.provider}/${preferences.modelId}`);
      const setIsolatedModel = session.setModel.bind(session) as unknown as (
        nextModel: typeof model,
        options: { persistDefault: false },
      ) => Promise<void>;
      await setIsolatedModel(model, { persistDefault: false });
    }
    if (preferences.thinkingLevel) {
      const setIsolatedThinking = session.setThinkingLevel.bind(session) as unknown as (
        level: WebSideConversationSnapshot["thinkingLevel"],
        options: { persistDefault: false },
      ) => void;
      setIsolatedThinking(preferences.thinkingLevel, { persistDefault: false });
    }
    slot.lastUsedAt = Date.now();
    return this.sideConversationSnapshotFromSlot(slot);
  }

  async abortSideConversation(identifier: string): Promise<void> {
    const slot = await this.ensureSideConversationSlot(identifier);
    await Promise.race([
      slot.host.session.abort(),
      new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ABORT_WAIT_MS)),
    ]);
  }

  /** Live AgentManager children belonging to one loaded root chat. */
  listSubagents(sessionId?: string): { agents: WebSubagentSummary[]; agentTypes: WebSubagentAgentType[]; available: boolean } {
    const control = this.resolveSubagentControl(sessionId);
    if (!control) return { agents: [], agentTypes: [], available: false };
    return { agents: control.list(), agentTypes: control.listTypes(), available: true };
  }

  getSubagent(id: string, sessionId?: string): WebSubagentSnapshot {
    const control = this.requireSubagentControl(sessionId);
    const snapshot = control.get(id);
    if (!snapshot) throw new Error("Subagent bulunamadı");
    return snapshot;
  }

  async createSubagent(input: {
    message: string;
    name?: string;
    agentType?: string;
    forkContext?: boolean;
    isolation?: "worktree" | "none";
    sessionId?: string;
  }): Promise<WebSubagentSnapshot> {
    const control = this.requireSubagentControl(input.sessionId);
    return control.spawn(input);
  }

  async sendSubagentInput(id: string, message: string, options?: { interrupt?: boolean; sessionId?: string }): Promise<WebSubagentSnapshot> {
    const control = this.requireSubagentControl(options?.sessionId);
    return control.sendInput(id, message, options?.interrupt === true);
  }

  abortSubagent(id: string, sessionId?: string): WebSubagentSnapshot {
    return this.requireSubagentControl(sessionId).abort(id);
  }

  private resolveSubagentControl(requestedSessionId?: string): RuntimeSubagentControl | undefined {
    const activeSessionId = this.session.sessionManager.getSessionId();
    const sessionId = String(requestedSessionId || activeSessionId).trim();
    if (!sessionId) return undefined;

    // Do not let a request reach an unrelated process-global manager. The target
    // must belong to a runtime slot currently owned by this desktop controller.
    const loaded = [...this.slots.values()].some(
      (slot) => slot.host.session.sessionManager.getSessionId() === sessionId,
    );
    if (!loaded) return undefined;

    const registry = (globalThis as any)[SUBAGENT_WEB_CONTROLS_KEY] as Map<string, RuntimeSubagentControl> | undefined;
    return registry?.get(sessionId);
  }

  private requireSubagentControl(sessionId?: string): RuntimeSubagentControl {
    const control = this.resolveSubagentControl(sessionId);
    if (!control) throw new Error("Bu sohbet için subagent çalışma zamanı hazır değil");
    return control;
  }

  /**
   * List models for the UI picker.
   * Default: only providers the user actually connected (Providers login / API key / pool /
   * cloud env / models.json keys), plus always-on Quake Code Free (opencode-free).
   * Hides other free catalogs (9router) and pure env-only greys (e.g. grok-cli without auth.json).
   */
  async listModels(options?: { includeUnconfigured?: boolean }): Promise<WebModelSummary[]> {
    const models = this.session.modelRegistry.getAll();
    const auth = this.authStorage;
    const byKey = new Map<string, WebModelSummary>();
    const visibilityCache = new Map<string, boolean>();

    const providerVisible = (providerId: string, registryConfigured: boolean): boolean => {
      if (options?.includeUnconfigured) return true;
      const cached = visibilityCache.get(providerId);
      if (cached !== undefined) return cached;
      const ok = isProviderVisibleInModelPicker(auth, providerId, registryConfigured);
      visibilityCache.set(providerId, ok);
      return ok;
    };

    for (const model of models) {
      const key = `${model.provider}/${model.id}`;
      const registryConfigured = this.session.modelRegistry.hasConfiguredAuth(model);
      if (!providerVisible(model.provider, registryConfigured)) continue;

      const summary: WebModelSummary = {
        provider: model.provider,
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        reasoning: model.reasoning,
        supportsXhigh: supportsXhigh(model),
        supportsMax: supportsMax(model),
        input: model.input,
        configured: true,
        current: this.session.model?.provider === model.provider && this.session.model?.id === model.id,
      };
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, summary);
        continue;
      }
      if (summary.current && !existing.current) {
        byKey.set(key, summary);
      }
    }
    return Array.from(byKey.values());
  }

  listCommands(): WebCommandInfo[] {
    const builtins: WebCommandInfo[] = [
      { name: "/new", description: "Yeni sohbet başlat", source: "builtin" },
      { name: "/status", description: "Çalışma zamanı durumunu yenile", source: "builtin" },
      { name: "/reload", description: "Eklentileri ve kaynakları yenile", source: "builtin" },
      { name: "/compact", description: "Mevcut konuşmayı sıkıştır", source: "builtin" },
      { name: "/model", description: "Model seçiciyi odakla", source: "builtin" },
      { name: "/resume", description: "Sohbet listesini odakla", source: "builtin" },
      { name: "/settings", description: "Ayarları aç", source: "builtin" },
      { name: "/plan", description: "Plan modunu aç/kapat", source: "builtin" },
      { name: "/skillcreator", description: "Yeni bir yetenek (skill) oluştur", source: "builtin" },
      { name: "/skill-creator", description: "Yeni bir yetenek (skill) oluştur", source: "builtin" },
      { name: "/goal", description: "Hedef tabanlı otonom çalışma modunu başlat", source: "builtin" },
      { name: "/review", description: "PR / branch / uncommitted değişiklikleri incele", source: "builtin" },
    ];
    const prompts: WebCommandInfo[] = this.session.promptTemplates.map((template) => ({
      name: `/${template.name}`,
      description: template.description || "Prompt şablonu",
      source: "prompt",
    }));
    // Load skills from filesystem
    const skills: WebCommandInfo[] = this.loadSkillsFromFs();
    return [...builtins, ...prompts, ...skills];
  }

  private loadSkillsFromFs(): WebCommandInfo[] {
    const result: WebCommandInfo[] = [];
    try {
      const skillsDir = join(homedir(), ".quake-code", "agent", "skills");
      if (!existsSync(skillsDir)) return result;
      const dirs = readdirSync(skillsDir, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const skillFile = join(skillsDir, dir.name, "SKILL.md");
        if (!existsSync(skillFile)) continue;
        try {
          const content = readFileSync(skillFile, "utf-8");
          const match = content.match(/^---[\s\S]*?name:\s*(.+?)\n[\s\S]*?description:\s*[>|]?\s*([\s\S]*?)\n---/);
          if (match) {
            const name = match[1].trim();
            const desc = match[2].trim().split("\n")[0].substring(0, 100);
            result.push({ name: `/${name}`, description: desc || dir.name, source: "skill" });
          } else {
            result.push({ name: `/${dir.name}`, description: dir.name, source: "skill" });
          }
        } catch {
          result.push({ name: `/${dir.name}`, description: dir.name, source: "skill" });
        }
      }
    } catch (e) { console.error("Skill loading error:", e); }
    return result;
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    const model = this.session.modelRegistry.find(provider, modelId);
    if (!model) throw new Error(`Unknown model: ${provider}/${modelId}`);
    await this.session.setModel(model);
    // AgentSession updates the SettingsManager in memory; explicitly flush here so
    // Desktop restarts cannot lose a model selected from Settings/composer.
    await this.session.settingsManager.flush();
    this.emitState();
  }

  async runSlashCommand(command: string, args = ""): Promise<void> {
    const raw = command.startsWith("/") ? command : `/${command}`;
    const name = raw.slice(1);

    switch (name) {
      case "new":
        await this.newSession();
        return;
      case "status":
        this.sendReady();
        return;
      case "reload":
        await this.session.reload();
        await this.bindExtensionsForActive();
        this.sendReady();
        return;
      case "compact":
        this.session.compact(args || undefined);
        return;
      case "model":
      case "resume":
      case "settings":
      case "checklist":
        this.hub.send({ type: "extension_ui_request", id: `web-focus-${name}`, method: "setStatus", statusKey: "web-focus", statusText: name });
        return;
      case "desktop":
      case "bilgisayar":
        // Panel açma — doğrudan computer-use görevi olarak prompt
        await this.prompt(
          args?.trim()
            ? `@bilgisayar ${args.trim()}`
            : "@bilgisayar Kullanıcının masaüstünde istediği işlemi yap. Önce durumu anla (screenshot), sonra desktop_* ile uygula.",
        );
        this.emitState();
        return;
      case "skillcreator":
      case "skill-creator":
      case "skillcreate":
        if (!args || args.trim().length === 0) {
          await this.prompt("Lütfen oluşturmak istediğiniz yeteneğin (skill) açıklamasını yazın. Örnek: /skillcreator bana her gün takvimi kontrol edip iş planı hazırlayan bir skill yap");
        } else {
          const skillPrompt = `Yetenek Oluşturucu: Aşağıdaki açıklamaya dayanarak yeni bir yetenek (skill) oluştur:\n\nKullanıcı açıklaması: "${args}"\n\nTalimatlar:\n1. Kullanıcının ne istediğini anla\n2. Uygun skill adını belirle (ingilizce, kısa, tanımlayıcı)\n3. SKILL.md dosyasını oluştur:\n   - name: skill adı\n   - description: Ne zaman tetiklenmeli, ne yapmalı (hem İngilizce hem Türkçe tetikleme ifadeleri ekle)\n   - Talimatları yaz\n4. Gerekirse script/ veya references/ klasörleri oluştur\n5. Skill dizinini ~/.quake-code/agent/skills/[skill-name]/ altına kaydet\n\nÖnemli:\n- description kısmında tetikleme ifadelerini geniş tut (hem İngilizce hem Türkçe)\n- Talimatları adım adım, net yaz\n- Gerekirse örnekler ekle\n- Kullanıcıya oluşturulan skilli ve nasıl kullanılacağını açıkla`;
          await this.prompt(skillPrompt);
        }
        this.emitState();
        return;
      case "review":
      case "pr-review":
      case "prreview": {
        const target = args?.trim() || "the current branch or uncommitted changes";
        await this.prompt(
          [
            `Use $quake-review to review ${target}.`,
            "Follow the skill rubric (references/rubric.md).",
            "Gather the change with git status/diff/log as needed, read changed files, and produce:",
            "1) Merge readiness 2) High-severity issues 3) Medium concerns 4) Testing gaps 5) Optional polish 6) Recommended next action.",
            "Prefer fewer stronger findings over nitpicks. Reply in the user's language.",
          ].join("\n"),
        );
        this.emitState();
        return;
      }
      default:
        // AgentSession.prompt already dispatches extension commands, prompt templates,
        // and skill commands. TUI-only built-ins are intentionally handled above or
        // exposed as dedicated web UI controls.
        await this.prompt(args ? `${raw} ${args}` : raw);
        this.emitState();
    }
  }

  private getPlanState(): WebPlanState {
    const slot = this.slots.get(this.activeKey);
    const persistedPlan = [...this.session.sessionManager.getEntries()]
      .reverse()
      .find((item: any) => item?.type === "custom" && item?.customType === "plan-item") as
      | { data?: { id?: string; text?: string } }
      | undefined;
    const proposedPlan = slot?.proposedPlan || (
      typeof persistedPlan?.data?.text === "string"
        ? { id: String(persistedPlan.data.id || `plan-${this.session.sessionId}`), text: persistedPlan.data.text }
        : undefined
    );
    const steps = (slot?.planUpdate?.plan || []).map((item, index) => ({
      step: index + 1,
      text: item.step,
      fullText: item.step,
      completed: item.status === "completed",
      status: item.status === "completed" ? "completed" as const : item.status === "in_progress" ? "active" as const : "pending" as const,
    }));
    const completed = steps.filter((item) => item.completed).length;
    const activePendingRequests = this.extensionUi.getPendingRequests(this.activeInteractionOwnerKey());
    const pendingClarification = activePendingRequests.find((request) => isWebPlanClarificationRequest(request))?.clarification;
    const enabled = this.session.collaborationMode === "plan";
    const planMarkdown = proposedPlan?.text || slot?.proposedPlanDraft || "";
    const phase: WebPlanPhase = pendingClarification
      ? "clarifying"
      : enabled
        ? proposedPlan
          ? "ready"
          : "planning"
        : "idle";
    return {
      enabled,
      phase,
      steps,
      completed,
      activeStep: steps.find((item) => item.status === "active")?.step,
      lastPlanText: planMarkdown || undefined,
      artifact: planMarkdown ? {
        id: proposedPlan?.id || `plan-${this.session.sessionId}`,
        title: derivePlanArtifactTitle(planMarkdown),
        markdown: planMarkdown,
        revision: 1,
      } : undefined,
      clarification: pendingClarification,
    };
  }

  private toSessionSummary(session: SessionInfo): WebSessionSummary {
    return {
      path: session.path,
      id: session.id,
      cwd: session.cwd,
      name: session.name,
      parentSessionPath: session.parentSessionPath,
      created: session.created.toISOString(),
      modified: session.modified.toISOString(),
      messageCount: session.messageCount,
      firstMessage: session.firstMessage,
      lastUserMessage: session.lastUserMessage,
      lastAssistantMessage: session.lastAssistantMessage,
      lastModel: session.lastModel,
      lastThinkingLevel: session.lastThinkingLevel,
    };
  }

  private emitState(): void {
    this.hub.send({ type: "state", state: this.getState() });
  }

  private slotKeyFromHost(host: AgentSessionRuntimeHost): string {
    const file = host.session.sessionFile;
    if (file) return resolve(file);
    return `id:${host.session.sessionManager.getSessionId()}`;
  }

  private findSlotBySessionPath(sessionPath: string): RuntimeSlot | undefined {
    const target = resolve(sessionPath);
    for (const slot of this.slots.values()) {
      const file = slot.host.session.sessionFile;
      if (file && resolve(file) === target) return slot;
      if (slot.key === target) return slot;
    }
    return undefined;
  }

  private findSlotByIdentifier(identifier: string): RuntimeSlot | undefined {
    const wanted = String(identifier || "").trim();
    if (!wanted) return undefined;
    const direct = this.slots.get(wanted);
    if (direct) return direct;
    for (const slot of this.slots.values()) {
      const manager = slot.host.session.sessionManager;
      if (manager.getSessionId() === wanted) return slot;
      const file = slot.host.session.sessionFile;
      if (file && (file === wanted || normalizeOptionalSessionPath(file) === normalizeOptionalSessionPath(wanted))) return slot;
    }
    return undefined;
  }

  private readSideConversationMarker(manager: any): SideConversationMarker | undefined {
    const entry = [...manager.getEntries()].reverse().find((candidate: any) =>
      candidate?.type === "custom"
      && candidate?.customType === "chat-isolation"
      && candidate?.data?.kind === "side-conversation",
    ) as {
      id?: unknown;
      data?: {
        parentSession?: unknown;
        contextInherited?: unknown;
        inheritedMessageCount?: unknown;
        createdAt?: unknown;
      };
      timestamp?: string;
    } | undefined;
    if (!entry) return undefined;
    const parentSessionPath = typeof entry.data?.parentSession === "string" && entry.data.parentSession.trim()
      ? entry.data.parentSession
      : undefined;
    const parsedTimestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
    const createdAt = Number(entry.data?.createdAt) || parsedTimestamp || Date.now();
    return {
      entryId: String(entry.id || ""),
      parentSessionPath,
      contextInherited: entry.data?.contextInherited === true,
      inheritedMessageCount: Math.max(0, Number(entry.data?.inheritedMessageCount) || 0),
      createdAt,
    };
  }

  private sideConversationTimeline(manager: any, marker: SideConversationMarker) {
    const branch = manager.getBranch() as any[];
    const boundaryIndex = branch.findIndex((entry) => entry?.id === marker.entryId);
    if (boundaryIndex < 0) {
      const allMessages = this.getTimelineMessagesFromEntries(branch);
      const inheritedMessageCount = Math.min(marker.inheritedMessageCount, allMessages.length);
      return {
        contextInherited: marker.contextInherited,
        inheritedMessageCount,
        messages: allMessages.slice(inheritedMessageCount),
      };
    }
    const inheritedMessageCount = this.getTimelineMessagesFromEntries(branch.slice(0, boundaryIndex)).length;
    return {
      contextInherited: marker.contextInherited || inheritedMessageCount > 0,
      inheritedMessageCount,
      messages: this.getTimelineMessagesFromEntries(branch.slice(boundaryIndex + 1)),
    };
  }

  private sideConversationSnapshotFromSlot(slot: RuntimeSlot): WebSideConversationSnapshot {
    const session = slot.host.session;
    const manager = session.sessionManager;
    const marker = this.readSideConversationMarker(manager);
    if (!marker) throw new Error("Bu oturum bir yan sohbet değil");
    const timeline = this.sideConversationTimeline(manager, marker);
    const messages = timeline.messages;
    const entries = manager.getEntries() as Array<{ timestamp?: string }>;
    const lastTimestamp = entries.length ? new Date(entries[entries.length - 1]?.timestamp || 0).getTime() : 0;
    const firstUserText = messages.find((entry) => entry?.role === "user");
    const title = manager.getSessionName() || sideConversationTitle(messageTextForSideConversation(firstUserText));
    const model = session.model;
    return {
      id: manager.getSessionId(),
      path: session.sessionFile,
      title,
      parentSessionPath: marker.parentSessionPath,
      contextInherited: timeline.contextInherited,
      inheritedMessageCount: timeline.inheritedMessageCount,
      createdAt: marker.createdAt,
      updatedAt: Math.max(marker.createdAt, lastTimestamp || 0),
      messageCount: messages.length,
      isStreaming: session.isStreaming,
      messages,
      streamingMessage: this.getStreamingMessageForSession(session) as any,
      model: model ? { provider: model.provider, id: model.id, name: model.name } : undefined,
      thinkingLevel: session.thinkingLevel,
    };
  }

  private async installBackgroundHost(host: AgentSessionRuntimeHost): Promise<RuntimeSlot> {
    const previousKey = this.activeKey;
    const previousCwd = this.currentCwd;
    await this.activateHost(host, { bindExtensions: true, sendReady: false });
    const installed = this.slots.get(this.activeKey);
    if (!installed) throw new Error("Yan sohbet oturumu oluşturulamadı");

    if (previousKey && this.slots.has(previousKey)) {
      this.activeKey = previousKey;
      this.currentCwd = previousCwd;
      await this.bindExtensionsForActive();
    }
    return installed;
  }

  private async ensureSideConversationSlot(identifier: string): Promise<RuntimeSlot> {
    const existing = this.findSlotByIdentifier(identifier);
    if (existing) {
      if (!this.readSideConversationMarker(existing.host.session.sessionManager)) {
        throw new Error("Bu oturum bir yan sohbet değil");
      }
      return existing;
    }

    const wanted = String(identifier || "").trim();
    const sessions = await SessionManager.list(this.currentCwd);
    const sessionInfo = sessions.find((candidate) =>
      candidate.id === wanted
      || candidate.path === wanted
      || normalizeOptionalSessionPath(candidate.path) === normalizeOptionalSessionPath(wanted),
    );
    if (!sessionInfo) throw new Error("Yan sohbet bulunamadı");

    const sessionManager = SessionManager.open(sessionInfo.path);
    const marker = this.readSideConversationMarker(sessionManager);
    if (!marker) throw new Error("Bu oturum bir yan sohbet değil");
    const bootstrap = this.workspaceBootstrap(sessionManager.getCwd());
    const runtime = await createAgentSessionRuntime(bootstrap, {
      cwd: sessionManager.getCwd(),
      sessionManager,
      sessionStartEvent: {
        type: "session_start",
        reason: "resume",
        previousSessionFile: this.session.sessionFile,
      },
    });
    const host = new RuntimeHost(bootstrap, runtime);
    const slot = await this.installBackgroundHost(host);
    slot.surface = "side-conversation";
    slot.parentSessionPath = marker.parentSessionPath;
    slot.surfaceCreatedAt = marker.createdAt;
    await this.pruneSlots();
    return slot;
  }

  private touchActive(): void {
    const slot = this.slots.get(this.activeKey);
    if (slot) slot.lastUsedAt = Date.now();
  }

  private async activateHost(
    host: AgentSessionRuntimeHost,
    options: { bindExtensions: boolean; sendReady: boolean },
  ): Promise<void> {
    const key = this.slotKeyFromHost(host);
    // Drop any prior slot with same key (shouldn't normally happen)
    const existing = this.slots.get(key);
    if (existing && existing.host !== host) {
      existing.unsubscribe?.();
      try {
        existing.host.session.dispose();
      } catch {
        /* ignore */
      }
    }
    const unsubscribe = host.session.subscribe((event) => this.forwardEvent(key, event));
    const goal = new GoalRuntime(host.session.sessionManager);
    const sideConversation = this.readSideConversationMarker(host.session.sessionManager);
    const slot: RuntimeSlot = {
      key,
      host,
      turnLifecycle: new TurnLifecycle(),
      unsubscribe,
      lastUsedAt: Date.now(),
      goal,
      surface: sideConversation ? "side-conversation" : undefined,
      parentSessionPath: sideConversation?.parentSessionPath,
      surfaceCreatedAt: sideConversation?.createdAt,
    };
    this.slots.set(key, slot);
    this.activeKey = key;
    try {
      this.currentCwd = host.session.sessionManager.getCwd();
    } catch {
      /* keep previous cwd */
    }
    if (options.bindExtensions) await this.bindExtensionsForActive();
    this.syncMcpTools(this.currentCwd);
    this.syncGoalTools(slot);
    if (options.sendReady) this.sendReady();
    if (goal.snapshot?.status === "executing" && goal.snapshot.policy.autoRecover && !host.session.isStreaming) {
      this.scheduleGoalRecovery(slot, "restart");
    }
  }

  syncMcpTools(workspaceCwd?: string): void {
    for (const slot of this.slots.values()) {
      const slotCwd = slot.host.session.sessionManager.getCwd();
      if (workspaceCwd && runtimeWorkspaceKey(slotCwd) !== runtimeWorkspaceKey(workspaceCwd)) continue;
      const manager = this.getMcpManager?.(slotCwd);
      const definitions = manager
        ? manager.list().filter((server) => server.status === "connected").flatMap((server) =>
            server.tools.map((tool) => createMcpToolDefinition(manager, server.config.id, tool, () => this.mcpExecutionContext(slot.key))),
          )
        : [];
      const wanted = new Set(definitions.map((tool) => tool.name));
      const session = slot.host.session as typeof slot.host.session & {
        registerRuntimeTool(tool: ReturnType<typeof createMcpToolDefinition>): void;
        unregisterRuntimeTool(name: string): boolean;
      };
      for (const definition of definitions) session.registerRuntimeTool(definition);
      for (const tool of session.getAllTools()) {
        if (tool.sourceInfo.source === "sdk" && tool.name.startsWith("mcp__") && !wanted.has(tool.name)) {
          session.unregisterRuntimeTool(tool.name);
        }
      }
    }
  }

  private mcpExecutionContext(slotKey: string) {
    const slot = this.slots.get(slotKey);
    const planEnabled = slot?.host.session.collaborationMode === "plan";
    const goalActive = Boolean(slot?.goal.snapshot && ["planning", "executing", "verifying"].includes(slot.goal.snapshot.status));
    return {
      mode: goalActive ? "goal" as const : planEnabled ? "plan" as const : "agent" as const,
      // Codex-style MCP tool approval via SSE approval_request (not modal confirm)
      requestApproval: async (input: {
        serverId: string;
        tool: any;
        params: Record<string, unknown>;
        reason: string;
        risk: "low" | "medium" | "high";
      }) => {
        const { requestMcpToolApprovalUi } = await import("./mcp/tool-approval-bus.js");
        return requestMcpToolApprovalUi({
          serverId: input.serverId,
          tool: input.tool,
          params: input.params,
          reason: input.reason,
          risk: input.risk,
        });
      },
      onBlocked: (reason: string) => {
        if (!slot?.goal.snapshot || slot.goal.snapshot.status === "blocked") return;
        slot.goal.block(reason);
        this.hub.send({ type: "extension_ui_request", id: `mcp-goal-blocked-${slot.goal.snapshot.id}`, method: "notify", message: reason, notifyType: "warning" });
        this.emitState();
      },
    };
  }

  private activeInteractionOwnerKey(): string {
    return this.session.sessionManager.getSessionId();
  }

  private async bindExtensionsForActive(): Promise<void> {
    const ownerKey = this.activeInteractionOwnerKey();
    await this.session.bindExtensions({
      uiContext: this.extensionUi.createContext(ownerKey),
      commandContextActions: this.createCommandActions(),
      shutdownHandler: () => {
        this.hub.send({ type: "error", message: "Web eklenti bağlamından kapatma isteği geldi" });
      },
      onError: (error) => {
        this.hub.send({
          type: "error",
          message: `Extension ${error.extensionPath}: ${error.error}`,
          stack: error.stack,
        });
      },
    });
  }

  private async pruneSlots(): Promise<void> {
    if (this.slots.size <= MAX_RUNTIME_SLOTS) return;
    const victims = [...this.slots.values()]
      .filter((slot) => slot.key !== this.activeKey && !this.slotHasActiveWork(slot))
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    for (const victim of victims) {
      if (this.slots.size <= MAX_RUNTIME_SLOTS) break;
      this.disposeSlot(victim.key);
    }
  }

  private disposeSlot(key: string): void {
    const slot = this.slots.get(key);
    if (!slot) return;
    slot.unsubscribe?.();
    try {
      slot.host.session.dispose();
    } catch {
      /* ignore */
    }
    this.slots.delete(key);
  }

  private createCommandActions(): ExtensionCommandContextActions {
    return {
      waitForIdle: async () => {
        while (this.session.isStreaming) await new Promise((resolve) => setTimeout(resolve, 50));
      },
      newSession: async (options) => this.newSession(options),
      fork: async (entryId) => this.forkSession(entryId),
      navigateTree: async (_targetId) => ({ cancelled: true }),
      switchSession: async (sessionPath) => this.switchSession(sessionPath),
      reload: async () => {
        await this.session.reload();
        await this.bindExtensionsForActive();
      },
    };
  }

  private forwardEvent(slotKey: string, event: AgentSessionEvent): void {
    // Re-key when sessionFile becomes available after first persist.
    const resolvedKey = this.maybeRekeySlot(slotKey);
    const slot = this.slots.get(resolvedKey);

    // Quota / rate-limit → multi-account rotation (all slots, not just active UI)
    if (slot) {
      this.maybeRotateAccounts(slot, event);
      this.maybeAdvanceGoal(slot, event);
      if (event.type === "turn/plan/updated") {
        slot.planUpdate = { explanation: event.explanation, plan: event.plan };
      } else if (event.type === "item/started" && event.item.type === "plan") {
        slot.proposedPlanDraft = "";
      } else if (event.type === "item/plan/delta") {
        slot.proposedPlanDraft = `${slot.proposedPlanDraft || ""}${event.delta}`;
      } else if (event.type === "item/completed" && event.item.type === "plan") {
        slot.proposedPlan = { id: event.item.id, text: event.item.text };
        slot.proposedPlanDraft = undefined;
      }
    }

    // Advance every slot, including background chats, so returning to a completed
    // chat cannot replace a stale process-global turn. Only active-slot events are
    // projected to the renderer below.
    const eventType = String((event as any).type || "");
    const lifecycleEvents = slot
      ? advanceAgentTurnLifecycle(slot.turnLifecycle, eventType)
      : [];

    // Background chats keep running; only the active chat drives the main UI.
    if (resolvedKey !== this.activeKey) {
      if (
        event.type === "message_end" ||
        event.type === "message_start" ||
        (event as any).type === "agent_end"
      ) {
        // Refresh streamingSessions badges without touching active message list.
        this.emitState();
      }
      return;
    }

    this.hub.send({ type: "agent_event", event: event as any });

    // Codex turn lifecycle + turn/diff/updated
    try {
      const et = eventType;
      for (const lifecycleEvent of lifecycleEvents) {
        if (lifecycleEvent.type === "turn_aborted") {
          this.hub.send({
            type: "turn_aborted",
            turnId: lifecycleEvent.turnId,
            reason: lifecycleEvent.reason,
            startedAt: Math.floor(lifecycleEvent.startedAt / 1000),
            completedAt: Math.floor(lifecycleEvent.completedAt / 1000),
            durationMs: lifecycleEvent.durationMs,
          } as any);
          continue;
        }

        if (lifecycleEvent.type === "turn_started") {
          guardianRuntime.beginTurn(lifecycleEvent.turnId);
          turnDiffAggregator.beginTurn(lifecycleEvent.turnId);
          this.hub.send({
            type: "turn_started",
            turnId: lifecycleEvent.turnId,
            startedAt: lifecycleEvent.startedAt,
          } as any);
          continue;
        }

        if (lifecycleEvent.type === "turn_completed") {
          guardianRuntime.endTurn();
          this.hub.send({
            type: "turn_completed",
            turnId: lifecycleEvent.turnId,
            startedAt: lifecycleEvent.startedAt,
            completedAt: lifecycleEvent.completedAt,
            durationMs: lifecycleEvent.durationMs,
          } as any);
          // Persist turn-diff for history rebuild (session custom entry)
          try {
            const snap = turnDiffAggregator.snapshot();
            if (snap.files?.length) {
              const conversationTurn = Math.max(1, this.countConversationTurns());
              const payload = serializeTurnDiffSnapshotForHistory(snap, {
                conversationTurn,
                lifecycleTurnId: snap.turnId,
              });
              (this as any)._lastTurnDiff = payload;
              (this as any)._lastConversationTurn = conversationTurn;
              this.session?.sessionManager?.appendCustomEntry?.("turn-diff", payload);
            }
          } catch {
            /* non-fatal */
          }
        }
      }
      const shouldEmitTurnDiff =
        (et === "tool_execution_end" && !(event as any).isError) ||
        et === "agent_end" ||
        et === "turn_end";
      if (shouldEmitTurnDiff) {
        const snap = turnDiffAggregator.snapshot();
        if (snap.files?.length) {
          const conversationTurn =
            Number((this as any)._lastConversationTurn) || Math.max(1, this.countConversationTurns());
          this.hub.send({
            type: "turn_diff_updated",
            turnId: snap.turnId,
            conversationTurn,
            diff: snap.diff,
            files: snap.files,
            totalAdded: snap.totalAdded,
            totalRemoved: snap.totalRemoved,
            updatedAt: snap.updatedAt,
          } as any);
          try {
            (this as any)._lastTurnDiff = serializeTurnDiffSnapshotForHistory(snap, {
              conversationTurn,
              lifecycleTurnId: snap.turnId,
            });
          } catch {
            /* non-fatal */
          }
        }
      }
    } catch {
      /* non-fatal */
    }

    if ((event as any).type === "tool_result" && (event as any).toolName) {
      const toolName = String((event as any).toolName);
      if (toolName.startsWith("browser_")) {
        const details = ((event as any).result as any)?.details as Record<string, unknown> | undefined;
        this.hub.send({
          type: "browser_activity",
          tool: toolName,
          target: (event as any).params?.target as string | undefined,
          url: details?.url as string | undefined,
          tabId: details?.tabId as string | undefined,
        });
      }
    }

    if (shouldEmitStateForEvent(event)) this.emitState();
  }

  /**
   * On rate-limit / quota errors: mark active account exhausted and switch to
   * the next available account so auto-retry / next turn uses the backup.
   *
   * Only runs on assistant message_end (not auto_retry_start) — otherwise a single
   * 429 would rotate twice and burn both accounts as exhausted.
   */
  private scheduleGoalRecovery(slot: RuntimeSlot, reason: "resume" | "restart"): void {
    const state = slot.goal.snapshot;
    if (!state || state.status !== "executing") return;
    setTimeout(() => {
      const latest = slot.goal.snapshot;
      if (!latest || latest.status !== "executing" || slot.host.session.isStreaming) return;
      const prompt = [
        "## GOAL RUNTIME RECOVERY ##",
        `Recovery reason: ${reason}`,
        `Goal: ${latest.objective}`,
        `Completed turns: ${latest.currentTurn}/${latest.budget.maxTurns}`,
        latest.lastMessage ? `Last recorded result:\n${latest.lastMessage.slice(-1200)}` : "No previous result was recorded.",
        "The user may be away. Inspect current workspace state, reconstruct progress, and continue autonomously.",
        "Do not repeat completed work. Verify existing changes before choosing the next step.",
      ].join("\n\n");
      void slot.host.session.prompt(prompt, { streamingBehavior: "followUp" }).catch((error: unknown) => {
        console.error("[goal recovery] failed:", error);
        try { slot.goal.block(`Goal recovery başlatılamadı: ${error instanceof Error ? error.message : String(error)}`); } catch { /* settled elsewhere */ }
        this.emitState();
      });
    }, 250);
  }

  private syncGoalTools(slot: RuntimeSlot): void {
    const session = slot.host.session as typeof slot.host.session & {
      registerRuntimeTool(tool: ReturnType<typeof createUpdateGoalToolDefinition>): void;
    };
    session.registerRuntimeTool(createUpdateGoalToolDefinition(() => {
      const current = this.slots.get(slot.key);
      return current?.goal;
    }));
  }

  private maybeAdvanceGoal(slot: RuntimeSlot, event: AgentSessionEvent): void {
    if ((event as any).type !== "agent_end") return;
    // If agent already settled via update_goal tool mid-turn, just emit and stop auto-continue.
    const settled = slot.goal.snapshot;
    if (settled && (settled.status === "completed" || settled.status === "blocked" || settled.status === "budget_limited")) {
      this.emitState();
      return;
    }
    if (!slot.goal.active) return;
    const state = slot.goal.snapshot;
    if (!state || state.status !== "executing") return;
    const messages = Array.isArray((event as any).messages) ? (event as any).messages : slot.host.session.messages;
    const assistant = [...messages].reverse().find((message: any) => message?.role === "assistant");
    const assistantText = messageContentText(assistant);
    const decision = decideGoalNextStep(state, messages, assistantText);
    slot.goal.recordTurn({
      fingerprint: decision.fingerprint,
      message: assistantText,
      evidence: decision.evidence,
      tokensDelta: decision.tokensDelta,
    });

    if (decision.type === "agent_complete") {
      try {
        slot.goal.agentComplete();
      } catch {
        try { slot.goal.complete(); } catch { /* already terminal */ }
      }
      this.emitState();
      this.hub.send({
        type: "extension_ui_request",
        id: `goal-complete-${state.id}`,
        method: "notify",
        message: "Goal update_goal(complete) ile tamamlandı.",
        notifyType: "info",
      });
      return;
    }

    if (decision.type === "block") {
      if (decision.terminal === "budget_limited") {
        slot.goal.budgetLimit(decision.reason);
      } else {
        slot.goal.block(decision.reason);
      }
      this.emitState();
      this.hub.send({
        type: "extension_ui_request",
        id: `goal-blocked-${state.id}`,
        method: "notify",
        message: `Goal durduruldu: ${decision.reason}`,
        notifyType: "warning",
      });
      // Budget wrap-up once; do not keep auto-continuing as if still open.
      if (decision.wrapUpPrompt) {
        setTimeout(() => {
          if (slot.host.session.isStreaming) return;
          void slot.host.session.prompt(decision.wrapUpPrompt!, { streamingBehavior: "followUp" }).catch((error: unknown) => {
            console.error("[goal scheduler] budget wrap-up failed:", error);
          });
        }, 80);
      }
      return;
    }
    if (decision.type === "verify") {
      const verifying = slot.goal.beginVerification();
      if (verificationPassed(verifying)) {
        slot.goal.complete();
        this.emitState();
        this.hub.send({ type: "extension_ui_request", id: `goal-complete-${state.id}`, method: "notify", message: "Goal doğrulama kanıtlarıyla tamamlandı.", notifyType: "info" });
        return;
      }
      const reason = "Doğrulama eksik veya başarısız: başarılı test, build ya da typecheck kanıtı üret.";
      slot.goal.verificationFailed(reason);
      this.emitState();
      setTimeout(() => {
        const latest = slot.goal.snapshot;
        if (!latest || latest.status !== "executing" || slot.host.session.isStreaming) return;
        void slot.host.session.prompt([
          "## GOAL VERIFICATION FAILED ##",
          `Goal: ${latest.objective}`,
          reason,
          "Fix failures, run deterministic verification, then call update_goal with status complete (or append <!-- GOAL_CANDIDATE_COMPLETE -->).",
        ].join("\n"), { streamingBehavior: "followUp" }).catch((error: unknown) => {
          console.error("[goal scheduler] verification recovery failed:", error);
          try { slot.goal.fail(); } catch { /* settled elsewhere */ }
          this.emitState();
        });
      }, 100);
      return;
    }

    this.emitState();
    setTimeout(() => {
      const latest = slot.goal.snapshot;
      if (!latest || latest.status !== "executing" || slot.host.session.isStreaming) return;
      void slot.host.session.prompt(decision.prompt, { streamingBehavior: "followUp" }).catch((error: unknown) => {
        console.error("[goal scheduler] continuation failed:", error);
        try { slot.goal.fail(); } catch { /* settled elsewhere */ }
        this.emitState();
      });
    }, 100);
  }

  private maybeRotateAccounts(slot: RuntimeSlot, event: AgentSessionEvent): void {
    try {
      // Single trigger: final error message. auto_retry will re-call getApiKey after we switch.
      if (event.type !== "message_end") return;
      const msg = (event as any).message;
      if (!msg || msg.role !== "assistant") return;
      const stop = String(msg.stopReason || "");
      const err = String(msg.errorMessage || msg.error || "");
      if (stop !== "error" && !err) return;
      const errorText = err || stop;
      if (!errorText) return;

      clearExpiredExhaustion();

      const providerId = slot.host.session.model?.provider;
      if (!providerId) return;

      const lastAt = this.lastRotationAt.get(providerId) || 0;
      if (Date.now() - lastAt < WebRuntimeController.ROTATION_COOLDOWN_MS) {
        return; // already rotated for this incident
      }

      const auth = slot.host.session.modelRegistry.authStorage;
      const result = rotateOnQuotaError(auth, providerId, errorText);
      if (!result.rotated && result.reason !== "all_exhausted") return;

      if (result.rotated) {
        this.lastRotationAt.set(providerId, Date.now());
      }

      // Keep all parked runtimes' in-memory auth in sync with disk
      this.reloadAuthOnAllSlots();

      if (result.rotated) {
        console.log(
          `[runtime] account rotation: ${providerId} ${result.fromLabel} → ${result.toLabel}`,
        );
        this.hub.send({
          type: "provider_rotation",
          providerId: result.providerId,
          fromLabel: result.fromLabel,
          toLabel: result.toLabel,
          reason: result.reason,
          exhaustedUntil: result.exhaustedUntil,
        } as any);
      } else if (result.reason === "all_exhausted") {
        this.hub.send({
          type: "error",
          message: `${providerId}: tüm yedek hesaplar kota dolu. Provider’lar’dan yeni hesap ekleyin.`,
        } as any);
      }
    } catch (error) {
      console.warn("[runtime] account rotation failed:", error);
    }
  }

  private reloadAuthOnAllSlots(): void {
    for (const slot of this.slots.values()) {
      try {
        slot.host.session.modelRegistry.authStorage.reload();
      } catch {
        /* ignore */
      }
    }
  }

  private maybeRekeySlot(oldKey: string): string {
    const slot = this.slots.get(oldKey);
    if (!slot) return oldKey;
    const nextKey = this.slotKeyFromHost(slot.host);
    if (nextKey === oldKey) return oldKey;
    this.slots.delete(oldKey);
    slot.key = nextKey;
    slot.unsubscribe?.();
    slot.unsubscribe = slot.host.session.subscribe((event) => this.forwardEvent(nextKey, event));
    this.slots.set(nextKey, slot);
    if (this.activeKey === oldKey) this.activeKey = nextKey;
    return nextKey;
  }
}

/**
 * @bilgisayar / @desktop / @computer → masaüstü computer-use modu.
 * Gerçek OS fare/klavye + UIA; sahte ajan imleci/overlay yok.
 */
function expandDesktopMentions(message: string): string {
  const text = String(message || "");
  const mentionRe = /@(bilgisayar|desktop|computer)\b/gi;
  if (!mentionRe.test(text)) return text;
  mentionRe.lastIndex = 0;
  const task = text.replace(mentionRe, " ").replace(/\s+/g, " ").trim();
  return [
    "[MASAÜSTÜ MODU @bilgisayar]",
    "MODEL: Computer-use için güçlü bir model kullan (zayıf free modeller sık hata yapar).",
    "Araç sırası: desktop_open_app → desktop_focus_window → desktop_ui_snapshot → desktop_ui_click / desktop_ui_type (isimle).",
    "Koordinat tıklama (desktop_click) yalnızca UIA bulamazsa. Win+arama ile app AÇMA.",
    "Her kritik adımdan sonra doğrula (snapshot/screenshot). Bittiğinde desktop_task_done(closeTitles=...).",
    "Gerçek Windows masaüstü; web için browser_*. Overlay/imleç yok — session tur bitince kapanır.",
    "",
    `Görev: ${task || "Masaüstü üzerinde kullanıcının istediği işlemi yap."}`,
  ].join("\n");
}

function normalizeOptionalSessionPath(value?: string): string {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return resolve(text);
  } catch {
    return text;
  }
}

function messageTextForSideConversation(message: any): string {
  if (!message) return "";
  if (typeof message.displayContent === "string") return message.displayContent;
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part: any) => part?.type === "text" || typeof part?.text === "string")
    .map((part: any) => String(part?.text || ""))
    .filter(Boolean)
    .join("\n");
}

function sideConversationTitle(value: string): string {
  const firstLine = String(value || "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*_#>]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  if (!firstLine) return "Yeni yan sohbet";
  return firstLine.length > 42 ? `${firstLine.slice(0, 39).trimEnd()}…` : firstLine;
}

function messageContentText(message: any): string {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content.map((part: any) => String(part?.text || "")).join("\n");
}

function isWebPlanClarificationRequest(request: { method?: string; clarification?: WebPlanClarificationState }): boolean {
  return (request.method === "planClarification" || request.method === "requestUserInput") && Boolean(request.clarification);
}

function derivePlanArtifactTitle(text: string): string {
  const heading = String(text || "").match(/^#\s+(.+)$/m)?.[1]
    ?.replace(/^Plan\s*[:—-]?\s*/i, "")
    .replace(/\s+Planı$/i, "")
    .trim();
  return heading || "Uygulama Planı";
}

function shouldEmitStateForEvent(event: AgentSessionEvent): boolean {
  const type = String((event as { type?: string } | undefined)?.type || "");
  return type !== "message_update" && type !== "tool_execution_update";
}
