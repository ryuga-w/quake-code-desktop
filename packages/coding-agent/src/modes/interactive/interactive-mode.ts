/**
 * Interactive mode for the coding agent.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@mrquake/quakecode-agent-core";
import type {
  AssistantMessage,
  ImageContent,
  Message,
  Model,
  OAuthProviderId,
} from "@mrquake/quakecode-ai";
import type {
  AutocompleteItem,
  EditorComponent,
  EditorTheme,
  Keybinding,
  KeyId,
  MarkdownTheme,
  OverlayHandle,
  OverlayOptions,
  SlashCommand,
} from "@mrquake/quakecode-tui";
import {
  CombinedAutocompleteProvider,
  type Component,
  Container,
  fuzzyFilter,
  Loader,
  Markdown,
  type MouseLayoutCollector,
  matchesKey,
  type OverlayInteractiveTarget,
  ProcessTerminal,
  Spacer,
  setKeybindings,
  Text,
  TruncatedText,
  TUI,
  truncateToWidth,
  visibleWidth,
} from "@mrquake/quakecode-tui";
import { spawn, spawnSync } from "child_process";
import {
  APP_NAME,
  DISPLAY_NAME,
  ENV_OFFLINE,
  getAgentDir,
  getAuthPath,
  getDebugLogPath,
  getShareViewerUrl,
  VERSION,
} from "../../config.js";
import {
  type AgentSession,
  type AgentSessionEvent,
  parseSkillBlock,
} from "../../core/agent-session.js";
import {
  extractProposedPlanText,
  stripProposedPlanBlocks,
} from "../../bundled/extensions/plan-mode/proposed-plan.js";
import type { AgentSessionRuntimeHost } from "../../core/agent-session-runtime.js";
import type {
  ExtensionContext,
  ExtensionRunner,
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
} from "../../core/extensions/index.js";
import {
  FooterDataProvider,
  type ReadonlyFooterDataProvider,
} from "../../core/footer-data-provider.js";
import {
  type AppKeybinding,
  KeybindingsManager,
} from "../../core/keybindings.js";
import { createCompactionSummaryMessage } from "../../core/messages.js";
import {
  findExactModelReferenceMatch,
  resolveModelScope,
} from "../../core/model-resolver.js";
import { OsTestExecutor } from "../../core/os-test-executor.js";
import {
  buildOsTestPrompt,
  parseOsTestCommand,
} from "../../core/os-test-runner.js";
import { DefaultPackageManager } from "../../core/package-manager.js";
import type { ResourceDiagnostic } from "../../core/resource-loader.js";
import {
  type SessionContext,
  SessionManager,
} from "../../core/session-manager.js";
import { BUILTIN_SLASH_COMMANDS } from "../../core/slash-commands.js";
import type { SourceInfo } from "../../core/source-info.js";
import { shimmerText } from "../../core/tools/render-utils.js";
import type { TruncationResult } from "../../core/tools/truncate.js";
import {
  getChangelogPath,
  getNewEntries,
  parseChangelog,
} from "../../utils/changelog.js";
import { copyToClipboard } from "../../utils/clipboard.js";
import {
  extensionForImageMimeType,
  readClipboardImage,
} from "../../utils/clipboard-image.js";
import { parseGitUrl } from "../../utils/git.js";
import { ensureTool } from "../../utils/tools-manager.js";
import { ArminComponent } from "./components/armin.js";
import { AssistantMessageComponent } from "./components/assistant-message.js";
import { BashExecutionComponent } from "./components/bash-execution.js";
import { BorderedLoader } from "./components/bordered-loader.js";
import { BranchSummaryMessageComponent } from "./components/branch-summary-message.js";
import { CompactionSummaryMessageComponent } from "./components/compaction-summary-message.js";
import { composerPrompt } from "./components/composer-chrome.js";
import { ComposerHintComponent } from "./components/composer-hint.js";
import { CustomEditor } from "./components/custom-editor.js";
import { CustomMessageComponent } from "./components/custom-message.js";
import { DaxnutsComponent } from "./components/daxnuts.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { ExtensionEditorComponent } from "./components/extension-editor.js";
import { ExtensionInputComponent } from "./components/extension-input.js";
import { ExtensionSelectorComponent } from "./components/extension-selector.js";
import { FooterComponent } from "./components/footer.js";
import { keyText } from "./components/keybinding-hints.js";
import { LoginDialogComponent } from "./components/login-dialog.js";
import { MemoryPanelComponent } from "./components/memory-panel.js";
import { ModelSelectorComponent } from "./components/model-selector.js";
import { NoticeCard } from "./components/notice-card.js";
import { OAuthSelectorComponent } from "./components/oauth-selector.js";
import { ScopedModelsSelectorComponent } from "./components/scoped-models-selector.js";
import { SessionSelectorComponent } from "./components/session-selector.js";
import { SessionTabsComponent } from "./components/session-tabs.js";
import { SettingsSelectorComponent } from "./components/settings-selector.js";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message.js";
import {
  getToolWorkingStatusTitle,
  isEphemeralMemoryTool,
  ToolExecutionComponent,
  type ToolExecutionOptions,
} from "./components/tool-execution.js";
import { TreeSelectorComponent } from "./components/tree-selector.js";
import {
  buildUserRenderablePartsFromMessage,
  UserMessageComponent,
  type UserRenderablePart,
} from "./components/user-message.js";
import { UserMessageSelectorComponent } from "./components/user-message-selector.js";
import {
  WelcomeBoardComponent,
  type WelcomeMenuAction,
  WelcomeTipComponent,
} from "./components/welcome-board.js";
import { buildGrokStatusLines, handleGrokRefresh } from "./grok-status.js";
import { InteractiveInputLayer } from "./input-layer.js";
import { MouseLayoutBuilder } from "./mouse-layout.js";
import { showDismissibleTextOverlay } from "./overlay-utils.js";
import {
  getAvailableThemes,
  getAvailableThemesWithPaths,
  getEditorTheme,
  getMarkdownTheme,
  getThemeByName,
  initTheme,
  onThemeChange,
  setRegisteredThemes,
  setTheme,
  setThemeInstance,
  Theme,
  type ThemeColor,
  theme,
} from "./theme/theme.js";

/** Interface for components that can be expanded/collapsed */
interface Expandable {
  setExpanded(expanded: boolean): void;
  isExpanded?(): boolean;
}

function isExpandable(obj: unknown): obj is Expandable {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "setExpanded" in obj &&
    typeof obj.setExpanded === "function"
  );
}

function _rgbText(text: string, colors: string[]): string {
  if (!text) return "";
  const chars = Array.from(text);
  return chars
    .map((char, index) => {
      const color =
        colors[Math.min(index, colors.length - 1)] ??
        colors[colors.length - 1] ??
        "#9ad08f";
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `\x1b[38;2;${r};${g};${b}m${char}\x1b[39m`;
    })
    .join("");
}

type CompactionQueuedMessage = {
  text: string;
  mode: "steer" | "followUp";
  images?: ImageContent[];
};

// Rendering the full chat history at a narrower wrapped width is expensive on
// medium terminals. Auto mode keeps the live sidebar for truly wide windows;
// /sidebar on can force it on reasonably wide terminals when the user wants it.
const SIDEBAR_AUTO_MIN_TERMINAL_WIDTH = 180;
const SIDEBAR_FORCE_MIN_TERMINAL_WIDTH = 180;
const SIDEBAR_WIDTH = 34;
type SidebarMode = "auto" | "on" | "off";

class HorizontalSplit implements Component {
  constructor(
    private readonly left: Component,
    private readonly right: Component,
    private readonly getRightVisible: () => boolean,
    private readonly getMinWidth: () => number,
    private readonly rightWidth = SIDEBAR_WIDTH,
  ) {}

  invalidate(): void {
    this.left.invalidate?.();
    this.right.invalidate?.();
  }

  render(width: number, layout?: MouseLayoutCollector): string[] {
    if (!this.getRightVisible() || width < this.getMinWidth()) {
      return this.left.render(width, layout);
    }

    const separatorWidth = 1;
    const rightWidth = Math.min(
      this.rightWidth,
      Math.max(28, Math.floor(width * 0.34)),
    );
    const leftWidth = Math.max(1, width - rightWidth - separatorWidth);
    const leftLines = this.left.render(leftWidth, layout);
    const rightLines = this.right.render(rightWidth);
    const height = Math.max(leftLines.length, rightLines.length);
    const lines: string[] = [];
    const separator = theme.fg("borderMuted", "│");
    for (let i = 0; i < height; i++) {
      const leftLine = leftLines[i] ?? "";
      const rightLine = rightLines[i] ?? "";
      const truncatedLeft = truncateToWidth(leftLine, leftWidth, "");
      const paddedLeft =
        truncatedLeft +
        " ".repeat(Math.max(0, leftWidth - visibleWidth(truncatedLeft)));
      const truncatedRight = truncateToWidth(rightLine, rightWidth, "");
      lines.push(
        truncateToWidth(
          `${paddedLeft}${separator}${truncatedRight}`,
          width,
          "",
        ),
      );
    }
    return lines;
  }
}

/**
 * Options for InteractiveMode initialization.
 */
export interface InteractiveModeOptions {
  /** Providers that were migrated to auth.json (shows warning) */
  migratedProviders?: string[];
  /** Warning message if session model couldn't be restored */
  modelFallbackMessage?: string;
  /** Initial message to send on startup (can include @file content) */
  initialMessage?: string;
  /** Images to attach to the initial message */
  initialImages?: ImageContent[];
  /** Additional messages to send after the initial message */
  initialMessages?: string[];
  /** Force verbose startup (overrides quietStartup setting) */
  verbose?: boolean;
}

export class InteractiveMode {
  private runtimeHost: AgentSessionRuntimeHost;
  private ui: TUI;
  private chatContainer: Container;
  private mainContentContainer: Container;
  private sidebarContainer: Container;
  private mainSplit: HorizontalSplit;
  private startupHero: WelcomeBoardComponent | undefined;
  private welcomeTip: WelcomeTipComponent | undefined;
  private startupHeroActive = false;
  private sidebarMode: SidebarMode = "auto";
  private pendingMessagesContainer: Container;
  private statusContainer: Container;
  private readonly idleStatusSpacer = new Spacer(1);
  private defaultEditor: CustomEditor;
  private editor: EditorComponent;
  private autocompleteProvider: CombinedAutocompleteProvider | undefined;
  private fdPath: string | undefined;
  private editorContainer: Container;
  private composerHint: ComposerHintComponent;
  private footer: FooterComponent;
  private footerDataProvider: FooterDataProvider;
  // Stored so the same manager can be injected into custom editors, selectors, and extension UI.
  private keybindings: KeybindingsManager;
  private version: string;
  private isInitialized = false;
  private onInputCallback?: (text: string, images?: ImageContent[]) => void;
  private loadingAnimation: Loader | undefined = undefined;
  private pendingWorkingMessage: string | undefined = undefined;
  private workingMessageHideTimer: NodeJS.Timeout | undefined = undefined;
  private readonly defaultWorkingMessage = "Thinking";
  private readonly defaultHiddenThinkingLabel = "Thinking...";
  private hiddenThinkingLabel = this.defaultHiddenThinkingLabel;
  private lastStreamUpdateMs = 0;

  private lastSigintTime = 0;
  private lastEscapeTime = 0;
  private changelogMarkdown: string | undefined = undefined;

  // Status line tracking (for mutating immediately-sequential status updates)
  private lastStatusSpacer: Spacer | undefined = undefined;
  private lastStatusText: Text | undefined = undefined;

  // Streaming message tracking
  private streamingComponent: AssistantMessageComponent | undefined = undefined;
  private streamingMessage: AssistantMessage | undefined = undefined;
  private planStreamingComponent: Text | undefined = undefined;
  private planStreamingBuffer = "";
  private activePlanItemId: string | undefined;

  // Tool execution tracking: toolCallId -> component
  private pendingTools = new Map<string, ToolExecutionComponent>();
  private activeTerminalTitleState: string | undefined;

  /** Clipboard images for `[iN]` markers in the input line (short tokens, atomic backspace). */
  private editorImageSlots = new Map<
    number,
    { filePath: string; mimeType: string }
  >();
  private nextEditorImageSlotId = 1;
  /** Filled in onSubmit for the main `run()` loop `session.prompt(..., { images })`. */
  private pendingUserImages: ImageContent[] | undefined = undefined;

  // Tool output expansion defaults to collapsed; Ctrl+O inspects only the latest tool.
  private toolOutputExpanded = false;

  // Thinking block visibility state
  private hideThinkingBlock = false;

  // Skill commands: command name -> skill file path
  private skillCommands = new Map<string, string>();

  // Agent subscription unsubscribe function
  private unsubscribe?: () => void;

  // Track if editor is in bash mode (text starts with !)
  private isBashMode = false;

  // Track current bash execution component
  private bashComponent: BashExecutionComponent | undefined = undefined;

  // Track pending bash components (shown in pending area, moved to chat on submit)
  private pendingBashComponents: BashExecutionComponent[] = [];

  // Auto-compaction state
  private autoCompactionLoader: Loader | undefined = undefined;
  private autoCompactionEscapeHandler?: () => void;

  // Auto-retry state
  private retryLoader: Loader | undefined = undefined;
  private retryEscapeHandler?: () => void;

  // Messages queued while compaction is running
  private compactionQueuedMessages: CompactionQueuedMessage[] = [];

  // Shutdown state
  private shutdownRequested = false;

  // Extension UI state
  private extensionSelector: ExtensionSelectorComponent | undefined = undefined;
  private extensionInput: ExtensionInputComponent | undefined = undefined;
  private extensionEditor: ExtensionEditorComponent | undefined = undefined;
  private extensionTerminalInputUnsubscribers = new Set<() => void>();

  // Extension widgets (components rendered above/below the editor)
  private extensionWidgetsAbove = new Map<
    string,
    Component & { dispose?(): void }
  >();
  private extensionWidgetsBelow = new Map<
    string,
    Component & { dispose?(): void }
  >();
  private widgetContainerAbove!: Container;
  private widgetContainerBelow!: Container;
  private extensionSidebars = new Map<
    string,
    Component & { dispose?(): void }
  >();

  // Custom footer from extension (undefined = use built-in footer)
  private customFooter: (Component & { dispose?(): void }) | undefined =
    undefined;

  // Header container that holds the built-in or custom header
  private headerContainer: Container;

  // Built-in header (logo + keybinding hints + changelog)
  private builtInHeader: Component | undefined = undefined;

  // Custom header from extension (undefined = use built-in header)
  private customHeader: (Component & { dispose?(): void }) | undefined =
    undefined;

  private readonly mouseLayoutBuilder: MouseLayoutBuilder;
  private readonly inputLayer: InteractiveInputLayer;
  private afterRenderUnsub?: () => void;
  private chatScrollPinned = true;
  private activeOverlayInteractive: OverlayInteractiveTarget | null = null;

  // Convenience accessors
  private get session(): AgentSession {
    return this.runtimeHost.session;
  }
  private get agent() {
    return this.session.agent;
  }
  private get sessionManager() {
    return this.session.sessionManager;
  }
  private get settingsManager() {
    return this.session.settingsManager;
  }

  constructor(
    runtimeHost: AgentSessionRuntimeHost,
    private options: InteractiveModeOptions = {},
  ) {
    this.runtimeHost = runtimeHost;
    this.version = VERSION;
    this.ui = new TUI(
      new ProcessTerminal(),
      this.settingsManager.getShowHardwareCursor(),
    );
    this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
    this.headerContainer = new Container();
    this.chatContainer = new Container();
    this.mainContentContainer = new Container();
    this.sidebarContainer = new Container();
    this.mainSplit = new HorizontalSplit(
      this.mainContentContainer,
      this.sidebarContainer,
      () => this.shouldRenderSidebarContent(),
      () => this.getSidebarMinWidth(),
    );
    this.pendingMessagesContainer = new Container();
    this.statusContainer = new Container();
    this.reserveIdleStatusLine();
    this.widgetContainerAbove = new Container();
    this.widgetContainerBelow = new Container();
    this.keybindings = KeybindingsManager.create();
    setKeybindings(this.keybindings);
    const editorPaddingX = this.settingsManager.getEditorPaddingX();
    const autocompleteMaxVisible =
      this.settingsManager.getAutocompleteMaxVisible();
    this.defaultEditor = new CustomEditor(
      this.ui,
      getEditorTheme(),
      this.keybindings,
      {
        paddingX: Math.max(1, editorPaddingX),
        autocompleteMaxVisible,
        noBorders: true,
        prompt: composerPrompt(),
        placeholder: "",
      },
    );
    this.editor = this.defaultEditor;
    this.editorContainer = new Container();
    this.composerHint = new ComposerHintComponent(
      () => this.session,
      () => this.footerDataProvider,
    );
    this.defaultEditor.setComposerFooterHint(() => this.composerHint.getText());
    this.mountEditorContainer();
    this.footerDataProvider = new FooterDataProvider(
      this.sessionManager.getCwd(),
    );
    this.footer = new FooterComponent(this.session, this.footerDataProvider);
    this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);

    // Load hide thinking block setting
    this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();

    // Register themes from resource loader and initialize
    setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
    initTheme(this.settingsManager.getTheme(), true);

    this.mouseLayoutBuilder = new MouseLayoutBuilder({
      getContentWidth: (totalWidth) => this.getMainContentWidth(totalWidth),
    });

    this.inputLayer = new InteractiveInputLayer({
      isOverlayActive: () => this.ui.hasOverlay(),
      isAutocompleteActive: () =>
        this.editor instanceof CustomEditor &&
        this.editor.isShowingAutocomplete(),
      isStartupHeroActive: () => this.startupHeroActive,
      hasHoverTargets: () => this.mouseLayoutBuilder.hasHoverTargets(),
      getLayoutBuilder: () => this.mouseLayoutBuilder,
      getContentWidth: (totalWidth) => this.getMainContentWidth(totalWidth),
      getTerminal: () => this.ui.terminal,
      requestRender: (full) => this.ui.requestRender(full),
      onToolClick: (tool) => this.toggleToolExpansion(tool),
      onWelcomeAction: (action) => void this.handleWelcomeMenuAction(action),
      onWheelScroll: (direction) => this.handleChatWheelScroll(direction),
      onAutocompleteWheelScroll: (direction) => {
        if (this.editor instanceof CustomEditor) {
          this.editor.handleAutocompleteWheel(direction);
        }
      },
      onOverlayWheelScroll: (direction) => {
        this.activeOverlayInteractive?.scrollByWheel(direction);
        this.ui.requestRender();
      },
      onOverlayItemHover: (index) => {
        this.activeOverlayInteractive?.setMouseHoverIndex(index);
      },
      onOverlayItemClick: (index) => {
        this.activeOverlayInteractive?.selectMouseIndex(index);
        this.ui.requestRender();
      },
      onToolHover: () => {},
      onWelcomeHover: (action) => {
        this.startupHero?.setMouseHovered(action);
      },
      onAutocompleteHover: (index) => {
        if (this.editor instanceof CustomEditor) {
          this.editor.setAutocompleteMouseHover(index);
        }
      },
      onAutocompleteClick: (index) => {
        if (this.editor instanceof CustomEditor) {
          this.editor.selectAutocompleteFilteredIndex(index);
        }
      },
      getMaxScrollOffset: () => this.getMaxChatScrollOffset(),
      getScrollOffset: () => this.ui.getViewportScrollOffset(),
      setScrollOffset: (offset) => {
        this.ui.setViewportScrollOffset(offset);
        this.chatScrollPinned = offset === 0;
      },
    });
  }

  private getAutocompleteSourceTag(
    sourceInfo?: SourceInfo,
  ): string | undefined {
    if (!sourceInfo) {
      return undefined;
    }

    const scopePrefix =
      sourceInfo.scope === "user"
        ? "u"
        : sourceInfo.scope === "project"
          ? "p"
          : "t";
    const source = sourceInfo.source.trim();

    if (source === "auto" || source === "local" || source === "cli") {
      return scopePrefix;
    }

    if (source.startsWith("npm:")) {
      return `${scopePrefix}:${source}`;
    }

    const gitSource = parseGitUrl(source);
    if (gitSource) {
      const ref = gitSource.ref ? `@${gitSource.ref}` : "";
      return `${scopePrefix}:git:${gitSource.host}/${gitSource.path}${ref}`;
    }

    return scopePrefix;
  }

  private prefixAutocompleteDescription(
    description: string | undefined,
    sourceInfo?: SourceInfo,
  ): string | undefined {
    const sourceTag = this.getAutocompleteSourceTag(sourceInfo);
    if (!sourceTag) {
      return description;
    }
    return description ? `[${sourceTag}] ${description}` : `[${sourceTag}]`;
  }

  private getBuiltInCommandConflictDiagnostics(
    extensionRunner: ExtensionRunner | undefined,
  ): ResourceDiagnostic[] {
    if (!extensionRunner) {
      return [];
    }

    const builtinNames = new Set(
      BUILTIN_SLASH_COMMANDS.map((command) => command.name),
    );
    return extensionRunner
      .getRegisteredCommands()
      .filter((command) => builtinNames.has(command.name))
      .map((command) => ({
        type: "warning" as const,
        message:
          command.invocationName === command.name
            ? `Extension command '/${command.name}' conflicts with built-in interactive command. Skipping in autocomplete.`
            : `Extension command '/${command.name}' conflicts with built-in interactive command. Available as '/${command.invocationName}'.`,
        path: command.sourceInfo.path,
      }));
  }

  private setupAutocomplete(fdPath: string | undefined): void {
    // Define commands for autocomplete
    const slashCommands: SlashCommand[] = BUILTIN_SLASH_COMMANDS.map(
      (command) => ({
        name: command.name,
        description: command.description,
      }),
    );

    const modelCommand = slashCommands.find(
      (command) => command.name === "model",
    );
    if (modelCommand) {
      modelCommand.getArgumentCompletions = (
        prefix: string,
      ): AutocompleteItem[] | null => {
        // Get available models (scoped or from registry)
        const models =
          this.session.scopedModels.length > 0
            ? this.session.scopedModels.map((s) => s.model)
            : this.session.modelRegistry.getAvailable();

        if (models.length === 0) return null;

        // Create items with provider/id format
        const items = models.map((m) => ({
          id: m.id,
          provider: m.provider,
          label: `${m.provider}/${m.id}`,
        }));

        // Fuzzy filter by model ID + provider (allows "opus anthropic" to match)
        const filtered = fuzzyFilter(
          items,
          prefix,
          (item) => `${item.id} ${item.provider}`,
        );

        if (filtered.length === 0) return null;

        return filtered.map((item) => ({
          value: item.label,
          label: item.id,
          description: item.provider,
        }));
      };
    }

    // Convert prompt templates to SlashCommand format for autocomplete
    const templateCommands: SlashCommand[] = this.session.promptTemplates.map(
      (cmd) => ({
        name: cmd.name,
        description: this.prefixAutocompleteDescription(
          cmd.description,
          cmd.sourceInfo,
        ),
      }),
    );

    // Convert extension commands to SlashCommand format
    const builtinCommandNames = new Set(slashCommands.map((c) => c.name));
    const extensionCommands: SlashCommand[] = (
      this.session.extensionRunner
        ?.getRegisteredCommands()
        .filter((cmd) => !builtinCommandNames.has(cmd.name)) ?? []
    ).map((cmd) => ({
      name: cmd.invocationName,
      description: this.prefixAutocompleteDescription(
        cmd.description,
        cmd.sourceInfo,
      ),
      getArgumentCompletions: cmd.getArgumentCompletions,
    }));

    // Build skill commands from session.skills (if enabled)
    this.skillCommands.clear();
    const skillCommandList: SlashCommand[] = [];
    if (this.settingsManager.getEnableSkillCommands()) {
      for (const skill of this.session.resourceLoader.getSkills().skills) {
        const commandName = `skill:${skill.name}`;
        this.skillCommands.set(commandName, skill.filePath);
        skillCommandList.push({
          name: commandName,
          description: this.prefixAutocompleteDescription(
            skill.description,
            skill.sourceInfo,
          ),
        });
      }
    }

    // Setup autocomplete
    this.autocompleteProvider = new CombinedAutocompleteProvider(
      [
        ...slashCommands,
        ...templateCommands,
        ...extensionCommands,
        ...skillCommandList,
      ],
      this.sessionManager.getCwd(),
      fdPath,
    );
    this.defaultEditor.setAutocompleteProvider(this.autocompleteProvider);
    if (this.editor !== this.defaultEditor) {
      this.editor.setAutocompleteProvider?.(this.autocompleteProvider);
    }
  }

  private getToolExecutionOptions(): ToolExecutionOptions {
    return {
      showImages: this.settingsManager.getShowImages(),
      density: this.settingsManager.getToolPreviewDensity(),
    };
  }

  /** Collapse prior memory tool rows when a new memory tool starts. */
  private hideCompletedMemoryToolCards(exceptToolCallId?: string): void {
    for (const child of this.chatContainer.children) {
      if (!(child instanceof ToolExecutionComponent)) continue;
      if (!child.isEphemeralMemoryToolCard() || child.isEphemeralHidden())
        continue;
      if (exceptToolCallId && child.getToolCallId() === exceptToolCallId)
        continue;
      child.hideEphemeral();
    }
  }

  private mountEditorContainer(): void {
    this.editorContainer.clear();
    this.editorContainer.addChild(this.editor as Component);
  }

  private centerLine(text: string, width: number): string {
    const line = truncateToWidth(text, width, "");
    const pad = Math.max(0, Math.floor((width - visibleWidth(line)) / 2));
    return `${" ".repeat(pad)}${line}`;
  }

  private hasConversationEntries(): boolean {
    return this.sessionManager
      .getEntries()
      .some((entry) => entry.type === "message");
  }

  private shouldUseStartupHero(): boolean {
    return (
      !this.options.initialMessage &&
      !this.options.initialMessages?.length &&
      !this.hasConversationEntries()
    );
  }

  private getStartupCwd(): string {
    const cwd = this.sessionManager.getCwd();
    const home = process.env.HOME || process.env.USERPROFILE;
    return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  }

  private getStartupModelLabel(): string {
    const model = this.session.model?.id ?? "no model";
    const provider = this.session.model?.provider;
    const modelLabel = provider ? `${provider}/${model}` : model;
    const thinking = this.session.model?.reasoning
      ? ` · thinking ${this.session.state.thinkingLevel || "off"}`
      : "";
    return `${modelLabel}${thinking}`;
  }

  private getWelcomeAnnouncement(): { title: string; body: string } {
    const markdown = this.changelogMarkdown?.trim();
    if (markdown) {
      const titleMatch = markdown.match(/^###\s+(.+)$/m);
      if (titleMatch?.[1]) {
        return {
          title: titleMatch[1].trim(),
          body: "See Change log (ctrl+d) for what's new in this version.",
        };
      }
    }
    return {
      title: "Agent memory is here!",
      body: "Use memory tools to remember context across sessions. Try /model to switch models.",
    };
  }

  private createWelcomeBoard(): WelcomeBoardComponent {
    const announcement = this.getWelcomeAnnouncement();
    return new WelcomeBoardComponent({
      version: this.version,
      displayName: DISPLAY_NAME,
      announcementTitle: announcement.title,
      announcementBody: announcement.body,
      workspace: this.getStartupCwd(),
      model: this.getStartupModelLabel(),
      getTerminalRows: () => this.ui.terminal.rows,
      onMenuAction: (action) => void this.handleWelcomeMenuAction(action),
      requestRender: () => this.ui.requestRender(),
    });
  }

  private mountWelcomeTip(): void {
    this.welcomeTip = new WelcomeTipComponent(
      "tab commands   @ file context   ctrl+p models",
    );
    this.widgetContainerAbove.clear();
    this.widgetContainerAbove.addChild(this.welcomeTip);
  }

  private clearWelcomeTip(): void {
    this.welcomeTip = undefined;
    this.widgetContainerAbove.clear();
    this.renderWidgets();
  }

  private async handleWelcomeMenuAction(
    action: WelcomeMenuAction,
  ): Promise<void> {
    switch (action) {
      case "newSession":
        await this.handleClearCommand();
        break;
      case "resumeSession":
        await this.showSessionSelector();
        break;
      case "changelog":
        this.handleChangelogCommand();
        break;
      case "quit":
        await this.shutdown();
        break;
    }
  }

  private buildStartupDashboard(): string {
    const width = Math.max(72, Math.min(this.ui.terminal.columns - 4, 112));
    const cardWidth = Math.max(58, Math.min(width - 8, 86));
    const model = this.session.model?.id ?? "no model";
    const provider = this.session.model?.provider;
    const modelLabel = provider ? `${provider}/${model}` : model;
    const thinking = this.session.model?.reasoning
      ? `thinking ${this.session.state.thinkingLevel || "off"}`
      : "standard";
    const cwd = this.sessionManager.getCwd();
    const home = process.env.HOME || process.env.USERPROFILE;
    const shortCwd =
      home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
    const logo = [
      " ██████╗ ██╗   ██╗ █████╗ ██╗  ██╗███████╗ ",
      "██╔═══██╗██║   ██║██╔══██╗██║ ██╔╝██╔════╝ ",
      "██║   ██║██║   ██║███████║█████╔╝ █████╗   ",
      "██║▄▄ ██║██║   ██║██╔══██║██╔═██╗ ██╔══╝   ",
      "╚██████╔╝╚██████╔╝██║  ██║██║  ██╗███████╗ ",
      " ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝ ",
    ];
    const brand = theme.bold(theme.fg("accent", "Quake Code"));
    const promptText =
      theme.fg("muted", "Ask anything... ") +
      theme.fg("dim", '"What is the tech stack here?"');
    const metaText = `${theme.fg("accent", "Ready")} ${theme.fg("dim", "·")} ${theme.bold(modelLabel)} ${theme.fg("dim", `· ${thinking}`)}`;
    const topBorder = `${theme.fg("accent", "▌")}${theme.bg("userMessageBg" as any, " ".repeat(cardWidth + 1))}`;
    const cardLine = (text: string) => {
      const bodyWidth = Math.max(1, cardWidth - 4);
      const body = truncateToWidth(text, bodyWidth, "…");
      return `${theme.fg("accent", "▌")}${theme.bg("userMessageBg" as any, `  ${body}${" ".repeat(Math.max(0, bodyWidth - visibleWidth(body)))}  `)}`;
    };
    const lines: string[] = ["", "", "", ""];
    for (const line of logo) {
      lines.push(
        this.centerLine(
          theme.fg("muted", line.replace(/m/g, theme.fg("text", "m"))),
          width,
        ),
      );
    }
    lines.push(this.centerLine(brand, width));
    lines.push("");
    lines.push(this.centerLine(topBorder, width));
    lines.push(this.centerLine(cardLine(promptText), width));
    lines.push(this.centerLine(cardLine(""), width));
    lines.push(this.centerLine(cardLine(metaText), width));
    lines.push(this.centerLine(topBorder, width));
    lines.push("");
    lines.push(
      this.centerLine(
        `${theme.bold("tab")} ${theme.fg("muted", "commands")}    ${theme.bold("ctrl+p")} ${theme.fg("muted", "models")}    ${theme.bold("/resume")} ${theme.fg("muted", "sessions")}`,
        width,
      ),
    );
    lines.push("");
    lines.push(
      this.centerLine(
        `${theme.fg("accent", "◆ Tip")} ${theme.bold("/model")} ${theme.fg("muted", "switch models")}    ${theme.bold("@file")} ${theme.fg("muted", "attach context")}    ${theme.bold("/resume")} ${theme.fg("muted", "sessions")}`,
        width,
      ),
    );
    lines.push("");
    lines.push(theme.fg("dim", truncateToWidth(shortCwd, width, "…")));
    return lines.join("\n");
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    // Load changelog (only show new entries, skip for resumed sessions)
    this.changelogMarkdown = this.getChangelogForDisplay();

    // Ensure fd and rg are available (downloads if missing, adds to PATH via getBinDir)
    // Both are needed: fd for autocomplete, rg for grep tool and bash commands
    const [fdPath] = await Promise.all([ensureTool("fd"), ensureTool("rg")]);
    this.fdPath = fdPath;

    this.startupHeroActive = this.shouldUseStartupHero();

    // Add header container as first child
    this.ui.addChild(this.headerContainer);
    if (!this.startupHeroActive) {
      this.headerContainer.addChild(
        new SessionTabsComponent(
          () => this.getSessionTabLabel(),
          () => this.getDisplayName(),
        ),
      );
      this.headerContainer.addChild(new Spacer(1));
    }

    // Welcome board on fresh sessions is independent of quietStartup (quiet only silences dashboard/resources).
    if (this.startupHeroActive) {
      this.headerContainer.addChild(
        new Text(theme.fg("dim", DISPLAY_NAME.toLowerCase()), 1, 0),
      );
      this.startupHero = this.createWelcomeBoard();
      this.builtInHeader = this.startupHero;
      this.headerContainer.addChild(this.builtInHeader);
    } else if (
      this.options.verbose ||
      !this.settingsManager.getQuietStartup()
    ) {
      this.builtInHeader = new Text(this.buildStartupDashboard(), 0, 0);
      this.headerContainer.addChild(this.builtInHeader);
      this.headerContainer.addChild(new Spacer(1));

      if (this.changelogMarkdown) {
        this.headerContainer.addChild(new DynamicBorder());
        if (this.settingsManager.getCollapseChangelog()) {
          const versionMatch = this.changelogMarkdown.match(
            /##\s+\[?(\d+\.\d+\.\d+)\]?/,
          );
          const latestVersion = versionMatch ? versionMatch[1] : this.version;
          const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/changelog")} to view full changelog.`;
          this.headerContainer.addChild(new Text(condensedText, 1, 0));
        } else {
          this.headerContainer.addChild(
            new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0),
          );
          this.headerContainer.addChild(new Spacer(1));
          this.headerContainer.addChild(
            new Markdown(
              this.changelogMarkdown.trim(),
              1,
              0,
              this.getMarkdownThemeWithSettings(),
            ),
          );
          this.headerContainer.addChild(new Spacer(1));
        }
        this.headerContainer.addChild(new DynamicBorder());
      }
    } else {
      // Minimal header when silenced on resumed sessions
      this.builtInHeader = new Text("", 0, 0);
      this.headerContainer.addChild(this.builtInHeader);
      if (this.changelogMarkdown) {
        this.headerContainer.addChild(new Spacer(1));
        const versionMatch = this.changelogMarkdown.match(
          /##\s+\[?(\d+\.\d+\.\d+)\]?/,
        );
        const latestVersion = versionMatch ? versionMatch[1] : this.version;
        const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/changelog")} to view full changelog.`;
        this.headerContainer.addChild(new Text(condensedText, 1, 0));
      }
    }

    this.mainContentContainer.addChild(this.chatContainer);
    this.mainContentContainer.addChild(this.pendingMessagesContainer);
    this.mainContentContainer.addChild(this.statusContainer);
    this.ui.addChild(this.mainSplit);
    this.renderSidebar();
    this.renderWidgets(); // Initialize with default spacer
    this.ui.addChild(this.widgetContainerAbove);
    this.ui.addChild(this.editorContainer);
    this.ui.addChild(this.widgetContainerBelow);
    if (this.startupHeroActive) {
      this.mountWelcomeTip();
    }
    this.ui.setFocus(this.editor);
    if (this.startupHeroActive) {
      this.syncHardwareCursorVisibility();
    }
    this.ui.addChild(this.footer);

    this.setupKeyHandlers();
    this.setupEditorSubmitHandler();
    this.ui.addInputListener((data) => this.handleGlobalInput(data));
    this.afterRenderUnsub = this.ui.addAfterRenderListener((ctx) => {
      this.mouseLayoutBuilder.rebuild(ctx);
      this.inputLayer.syncHoverTracking();
    });

    // Start from a clean viewport so the startup hero is not mixed with the shell prompt.
    this.ui.terminal.clearScreen();
    // Start the UI before initializing extensions so session_start handlers can use interactive dialogs
    this.ui.start();
    this.isInitialized = true;
    if (this.startupHeroActive) {
      this.syncHardwareCursorVisibility();
      this.ui.requestRender(true);
    }

    // Initialize extensions first so resources are shown before messages
    await this.bindCurrentSessionExtensions();

    // Render initial messages AFTER showing loaded resources
    this.renderInitialMessages();

    // Set terminal title
    this.updateTerminalTitle();

    // Subscribe to agent events
    this.subscribeToAgent();

    // Set up theme file watcher
    onThemeChange(() => {
      this.ui.invalidate();
      this.updateEditorBorderColor();
      this.ui.requestRender();
    });

    // Set up git branch watcher (uses provider instead of footer)
    this.footerDataProvider.onBranchChange(() => {
      this.ui.requestRender();
    });

    // Initialize available provider count for footer display
    await this.updateAvailableProviderCount();
  }

  private getSessionTabLabel(): string {
    return (
      this.sessionManager.getSessionName() ||
      path.basename(this.sessionManager.getCwd()) ||
      "new session"
    );
  }

  private getDisplayName(): string {
    return DISPLAY_NAME;
  }

  private updateTerminalTitle(): void {
    const sessionName = this.sessionManager.getSessionName();
    const displayName = this.getDisplayName();
    const title = sessionName ? `${displayName} - ${sessionName}` : displayName;

    // Animate the terminal tab only while the agent is actively working.
    // Keep it stable when idle so the tab does not flicker unnecessarily.
    const isActive =
      this.session.agent.state.isStreaming ||
      this.session.agent.state.pendingToolCalls.size > 0;
    if (isActive) {
      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      const frame = frames[Math.floor(Date.now() / 160) % frames.length] ?? "⠋";
      const stateLabel = this.activeTerminalTitleState ?? "thinking";
      this.ui.terminal.setTitle(`${frame} ${stateLabel} · ${title}`);
    } else {
      this.ui.terminal.setTitle(title);
    }
  }

  /**
   * Run the interactive mode. This is the main entry point.
   * Initializes the UI, shows warnings, processes initial messages, and starts the interactive loop.
   */
  async run(): Promise<void> {
    await this.init();

    // Start version check asynchronously
    this.checkForNewVersion().then((newVersion) => {
      if (newVersion) {
        this.showNewVersionNotification(newVersion);
      }
    });

    // Start package update check asynchronously
    this.checkForPackageUpdates().then((updates) => {
      if (updates.length > 0) {
        this.showPackageUpdateNotification(updates);
      }
    });

    // Check tmux keyboard setup asynchronously
    this.checkTmuxKeyboardSetup().then((warning) => {
      if (warning) {
        this.showWarning(warning);
      }
    });

    // Start thinking/working animation loop for terminal title.
    // Only writes while active; idle title stays stable.
    setInterval(() => {
      const state = this.session.agent.state;
      if (state.isStreaming || state.pendingToolCalls.size > 0) {
        this.updateTerminalTitle();
      }
    }, 160);

    // Show startup warnings
    const {
      migratedProviders,
      modelFallbackMessage,
      initialMessage,
      initialImages,
      initialMessages,
    } = this.options;

    if (migratedProviders && migratedProviders.length > 0) {
      this.showWarning(
        `Migrated credentials to auth.json: ${migratedProviders.join(", ")}`,
      );
    }

    const modelsJsonError = this.session.modelRegistry.getError();
    if (modelsJsonError) {
      this.showError(`models.json error: ${modelsJsonError}`);
    }

    if (modelFallbackMessage) {
      this.showWarning(modelFallbackMessage);
    }

    // Process initial messages
    if (initialMessage) {
      try {
        await this.session.prompt(initialMessage, { images: initialImages });
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        this.showError(errorMessage);
      }
    }

    if (initialMessages) {
      for (const message of initialMessages) {
        try {
          await this.session.prompt(message);
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error occurred";
          this.showError(errorMessage);
        }
      }
    }

    // Main interactive loop
    while (true) {
      const { text, images } = await this.getUserInput();
      this.pendingUserImages = images;
      try {
        await this.session.prompt(
          text,
          images?.length ? { images } : undefined,
        );
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        this.showError(errorMessage);
      } finally {
        this.pendingUserImages = undefined;
      }
    }
  }

  /**
   * Check npm registry for a newer version.
   */
  private compareVersions(a: string, b: string): number {
    const parse = (value: string) =>
      value.split(".").map((part) => Number.parseInt(part, 10) || 0);
    const av = parse(a);
    const bv = parse(b);
    const len = Math.max(av.length, bv.length);
    for (let i = 0; i < len; i++) {
      const ai = av[i] ?? 0;
      const bi = bv[i] ?? 0;
      if (ai > bi) return 1;
      if (ai < bi) return -1;
    }
    return 0;
  }

  private async checkForNewVersion(): Promise<string | undefined> {
    if (
      process.env.QUAKE_CODE_SKIP_VERSION_CHECK ||
      process.env[ENV_OFFLINE] ||
      process.env.PI_OFFLINE
    )
      return undefined;

    const cachePath = path.join(getAgentDir(), "update-check.json");
    const now = Date.now();
    let cache: { checkedAt?: number; latestVersion?: string } = {};
    try {
      if (fs.existsSync(cachePath)) {
        cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      }
    } catch {
      cache = {};
    }

    let latestVersion: string | undefined;
    try {
      const response = await fetch(
        "https://registry.npmjs.org/@mrquake/quakecode-cli/latest",
        {
          signal: AbortSignal.timeout(10000),
        },
      );
      if (response.ok) {
        const data = (await response.json()) as { version?: string };
        latestVersion = data.version;
        try {
          fs.mkdirSync(path.dirname(cachePath), { recursive: true });
          fs.writeFileSync(
            cachePath,
            JSON.stringify({ checkedAt: now, latestVersion }, null, 2),
            "utf-8",
          );
        } catch {
          // ignore cache write errors
        }
      }
    } catch {
      // network failed; fall back to cached latestVersion if available
      latestVersion = cache.latestVersion;
    }

    if (!latestVersion) {
      return undefined;
    }

    return this.compareVersions(latestVersion, this.version) > 0
      ? latestVersion
      : undefined;
  }

  private async checkForPackageUpdates(): Promise<string[]> {
    if (process.env[ENV_OFFLINE] || process.env.PI_OFFLINE) {
      return [];
    }

    try {
      const packageManager = new DefaultPackageManager({
        cwd: this.sessionManager.getCwd(),
        agentDir: getAgentDir(),
        settingsManager: this.settingsManager,
      });
      const updates = await packageManager.checkForAvailableUpdates();
      return updates.map((update) => update.displayName);
    } catch {
      return [];
    }
  }

  private async checkTmuxKeyboardSetup(): Promise<string | undefined> {
    if (!process.env.TMUX) return undefined;

    const runTmuxShow = (option: string): Promise<string | undefined> => {
      return new Promise((resolve) => {
        const proc = spawn("tmux", ["show", "-gv", option], {
          stdio: ["ignore", "pipe", "ignore"],
        });
        let stdout = "";
        const timer = setTimeout(() => {
          proc.kill();
          resolve(undefined);
        }, 2000);

        proc.stdout?.on("data", (data) => {
          stdout += data.toString();
        });
        proc.on("error", () => {
          clearTimeout(timer);
          resolve(undefined);
        });
        proc.on("close", (code) => {
          clearTimeout(timer);
          resolve(code === 0 ? stdout.trim() : undefined);
        });
      });
    };

    const [extendedKeys, extendedKeysFormat] = await Promise.all([
      runTmuxShow("extended-keys"),
      runTmuxShow("extended-keys-format"),
    ]);

    // If we couldn't query tmux (timeout, sandbox, etc.), don't warn
    if (extendedKeys === undefined) return undefined;

    if (extendedKeys !== "on" && extendedKeys !== "always") {
      return "tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys on` to ~/.tmux.conf and restart tmux.";
    }

    if (extendedKeysFormat === "xterm") {
      return "tmux extended-keys-format is xterm. Quake Code works best with csi-u. Add `set -g extended-keys-format csi-u` to ~/.tmux.conf and restart tmux.";
    }

    return undefined;
  }

  /**
   * Get changelog entries to display on startup.
   * Only shows new entries since last seen version, skips for resumed sessions.
   */
  private getChangelogForDisplay(): string | undefined {
    // Skip changelog for resumed/continued sessions (already have messages)
    if (this.session.state.messages.length > 0) {
      return undefined;
    }

    const lastVersion = this.settingsManager.getLastChangelogVersion();
    const changelogPath = getChangelogPath();
    const entries = parseChangelog(changelogPath);

    if (!lastVersion) {
      // Fresh install - just record the version, don't show changelog
      this.settingsManager.setLastChangelogVersion(VERSION);
      return undefined;
    } else {
      const newEntries = getNewEntries(entries, lastVersion);
      if (newEntries.length > 0) {
        this.settingsManager.setLastChangelogVersion(VERSION);
        return newEntries.map((e) => e.content).join("\n\n");
      }
    }

    return undefined;
  }

  private getMarkdownThemeWithSettings(): MarkdownTheme {
    return {
      ...getMarkdownTheme(),
      codeBlockIndent: this.settingsManager.getCodeBlockIndent(),
    };
  }

  // =========================================================================
  // Extension System
  // =========================================================================

  private formatDisplayPath(p: string): string {
    const home = os.homedir();
    let result = p;

    // Replace home directory with ~
    if (result.startsWith(home)) {
      result = `~${result.slice(home.length)}`;
    }

    return result;
  }

  /**
   * Get a short path relative to the package root for display.
   */
  private getShortPath(fullPath: string, sourceInfo?: SourceInfo): string {
    const source = sourceInfo?.source ?? "";
    const npmMatch = fullPath.match(
      /node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/,
    );
    if (npmMatch && source.startsWith("npm:")) {
      return npmMatch[2];
    }

    const gitMatch = fullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
    if (gitMatch && source.startsWith("git:")) {
      return gitMatch[1];
    }

    return this.formatDisplayPath(fullPath);
  }

  private getDisplaySourceInfo(sourceInfo?: SourceInfo): {
    label: string;
    scopeLabel?: string;
    color: "accent" | "muted";
  } {
    const source = sourceInfo?.source ?? "local";
    const scope = sourceInfo?.scope ?? "project";
    if (source === "local") {
      if (scope === "user") {
        return { label: "user", color: "muted" };
      }
      if (scope === "project") {
        return { label: "project", color: "muted" };
      }
      if (scope === "temporary") {
        return { label: "path", scopeLabel: "temp", color: "muted" };
      }
      return { label: "path", color: "muted" };
    }

    if (source === "cli") {
      return {
        label: "path",
        scopeLabel: scope === "temporary" ? "temp" : undefined,
        color: "muted",
      };
    }

    const scopeLabel =
      scope === "user"
        ? "user"
        : scope === "project"
          ? "project"
          : scope === "temporary"
            ? "temp"
            : undefined;
    return { label: source, scopeLabel, color: "accent" };
  }

  private getScopeGroup(sourceInfo?: SourceInfo): "user" | "project" | "path" {
    const source = sourceInfo?.source ?? "local";
    const scope = sourceInfo?.scope ?? "project";
    if (source === "cli" || scope === "temporary") return "path";
    if (scope === "user") return "user";
    if (scope === "project") return "project";
    return "path";
  }

  private isPackageSource(sourceInfo?: SourceInfo): boolean {
    const source = sourceInfo?.source ?? "";
    return source.startsWith("npm:") || source.startsWith("git:");
  }

  private buildScopeGroups(
    items: Array<{ path: string; sourceInfo?: SourceInfo }>,
  ): Array<{
    scope: "user" | "project" | "path";
    paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
    packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
  }> {
    const groups: Record<
      "user" | "project" | "path",
      {
        scope: "user" | "project" | "path";
        paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
        packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
      }
    > = {
      user: { scope: "user", paths: [], packages: new Map() },
      project: { scope: "project", paths: [], packages: new Map() },
      path: { scope: "path", paths: [], packages: new Map() },
    };

    for (const item of items) {
      const groupKey = this.getScopeGroup(item.sourceInfo);
      const group = groups[groupKey];
      const source = item.sourceInfo?.source ?? "local";

      if (this.isPackageSource(item.sourceInfo)) {
        const list = group.packages.get(source) ?? [];
        list.push(item);
        group.packages.set(source, list);
      } else {
        group.paths.push(item);
      }
    }

    return [groups.project, groups.user, groups.path].filter(
      (group) => group.paths.length > 0 || group.packages.size > 0,
    );
  }

  private formatScopeGroups(
    groups: Array<{
      scope: "user" | "project" | "path";
      paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
      packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
    }>,
    options: {
      formatPath: (item: { path: string; sourceInfo?: SourceInfo }) => string;
      formatPackagePath: (
        item: { path: string; sourceInfo?: SourceInfo },
        source: string,
      ) => string;
    },
  ): string {
    const lines: string[] = [];

    for (const group of groups) {
      lines.push(`  ${theme.fg("accent", group.scope)}`);

      const sortedPaths = [...group.paths].sort((a, b) =>
        a.path.localeCompare(b.path),
      );
      for (const item of sortedPaths) {
        lines.push(theme.fg("dim", `    ${options.formatPath(item)}`));
      }

      const sortedPackages = Array.from(group.packages.entries()).sort(
        ([a], [b]) => a.localeCompare(b),
      );
      for (const [source, items] of sortedPackages) {
        lines.push(`    ${theme.fg("mdLink", source)}`);
        const sortedPackagePaths = [...items].sort((a, b) =>
          a.path.localeCompare(b.path),
        );
        for (const item of sortedPackagePaths) {
          lines.push(
            theme.fg("dim", `      ${options.formatPackagePath(item, source)}`),
          );
        }
      }
    }

    return lines.join("\n");
  }

  private findSourceInfoForPath(
    p: string,
    sourceInfos: Map<string, SourceInfo>,
  ): SourceInfo | undefined {
    const exact = sourceInfos.get(p);
    if (exact) return exact;

    let current = p;
    while (current.includes("/")) {
      current = current.substring(0, current.lastIndexOf("/"));
      const parent = sourceInfos.get(current);
      if (parent) return parent;
    }

    return undefined;
  }

  private formatPathWithSource(p: string, sourceInfo?: SourceInfo): string {
    if (sourceInfo) {
      const shortPath = this.getShortPath(p, sourceInfo);
      const { label, scopeLabel } = this.getDisplaySourceInfo(sourceInfo);
      const labelText = scopeLabel ? `${label} (${scopeLabel})` : label;
      return `${labelText} ${shortPath}`;
    }
    return this.formatDisplayPath(p);
  }

  private formatDiagnostics(
    diagnostics: readonly ResourceDiagnostic[],
    sourceInfos: Map<string, SourceInfo>,
  ): string {
    const lines: string[] = [];

    // Group collision diagnostics by name
    const collisions = new Map<string, ResourceDiagnostic[]>();
    const otherDiagnostics: ResourceDiagnostic[] = [];

    for (const d of diagnostics) {
      if (d.type === "collision" && d.collision) {
        const list = collisions.get(d.collision.name) ?? [];
        list.push(d);
        collisions.set(d.collision.name, list);
      } else {
        otherDiagnostics.push(d);
      }
    }

    // Format collision diagnostics grouped by name
    for (const [name, collisionList] of collisions) {
      const first = collisionList[0]?.collision;
      if (!first) continue;
      lines.push(theme.fg("warning", `  "${name}" collision:`));
      lines.push(
        theme.fg(
          "dim",
          `    ${theme.fg("success", "✓")} ${this.formatPathWithSource(first.winnerPath, this.findSourceInfoForPath(first.winnerPath, sourceInfos))}`,
        ),
      );
      for (const d of collisionList) {
        if (d.collision) {
          lines.push(
            theme.fg(
              "dim",
              `    ${theme.fg("warning", "✗")} ${this.formatPathWithSource(d.collision.loserPath, this.findSourceInfoForPath(d.collision.loserPath, sourceInfos))} (skipped)`,
            ),
          );
        }
      }
    }

    for (const d of otherDiagnostics) {
      if (d.path) {
        const formattedPath = this.formatPathWithSource(
          d.path,
          this.findSourceInfoForPath(d.path, sourceInfos),
        );
        lines.push(
          theme.fg(
            d.type === "error" ? "error" : "warning",
            `  ${formattedPath}`,
          ),
        );
        lines.push(
          theme.fg(
            d.type === "error" ? "error" : "warning",
            `    ${d.message}`,
          ),
        );
      } else {
        lines.push(
          theme.fg(d.type === "error" ? "error" : "warning", `  ${d.message}`),
        );
      }
    }

    return lines.join("\n");
  }

  private showLoadedResources(options?: {
    extensions?: Array<{ path: string; sourceInfo?: SourceInfo }>;
    force?: boolean;
    showDiagnosticsWhenQuiet?: boolean;
  }): void {
    const defaultShowListing =
      APP_NAME === "quake-code"
        ? false
        : !this.settingsManager.getQuietStartup();
    const showListing =
      options?.force || this.options.verbose || defaultShowListing;
    const showDiagnostics =
      showListing || options?.showDiagnosticsWhenQuiet === true;
    if (!showListing && !showDiagnostics) {
      return;
    }

    const sectionHeader = (name: string, color: ThemeColor = "mdHeading") =>
      theme.fg(color, `[${name}]`);

    const skillsResult = this.session.resourceLoader.getSkills();
    const promptsResult = this.session.resourceLoader.getPrompts();
    const themesResult = this.session.resourceLoader.getThemes();
    const extensions =
      options?.extensions ??
      this.session.resourceLoader
        .getExtensions()
        .extensions.map((extension) => ({
          path: extension.path,
          sourceInfo: extension.sourceInfo,
        }));
    const sourceInfos = new Map<string, SourceInfo>();
    for (const extension of extensions) {
      if (extension.sourceInfo) {
        sourceInfos.set(extension.path, extension.sourceInfo);
      }
    }
    for (const skill of skillsResult.skills) {
      if (skill.sourceInfo) {
        sourceInfos.set(skill.filePath, skill.sourceInfo);
      }
    }
    for (const prompt of promptsResult.prompts) {
      if (prompt.sourceInfo) {
        sourceInfos.set(prompt.filePath, prompt.sourceInfo);
      }
    }
    for (const loadedTheme of themesResult.themes) {
      if (loadedTheme.sourcePath && loadedTheme.sourceInfo) {
        sourceInfos.set(loadedTheme.sourcePath, loadedTheme.sourceInfo);
      }
    }

    if (showListing) {
      const contextFiles =
        this.session.resourceLoader.getAgentsFiles().agentsFiles;
      if (contextFiles.length > 0) {
        this.chatContainer.addChild(new Spacer(1));
        const contextList = contextFiles
          .map((f) => theme.fg("dim", `  ${this.formatDisplayPath(f.path)}`))
          .join("\n");
        this.chatContainer.addChild(
          new Text(`${sectionHeader("Context")}\n${contextList}`, 0, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      const skills = skillsResult.skills;
      if (skills.length > 0) {
        const groups = this.buildScopeGroups(
          skills.map((skill) => ({
            path: skill.filePath,
            sourceInfo: skill.sourceInfo,
          })),
        );
        const skillList = this.formatScopeGroups(groups, {
          formatPath: (item) => this.formatDisplayPath(item.path),
          formatPackagePath: (item) =>
            this.getShortPath(item.path, item.sourceInfo),
        });
        this.chatContainer.addChild(
          new Text(`${sectionHeader("Skills")}\n${skillList}`, 0, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      const templates = this.session.promptTemplates;
      if (templates.length > 0) {
        const groups = this.buildScopeGroups(
          templates.map((template) => ({
            path: template.filePath,
            sourceInfo: template.sourceInfo,
          })),
        );
        const templateByPath = new Map(templates.map((t) => [t.filePath, t]));
        const templateList = this.formatScopeGroups(groups, {
          formatPath: (item) => {
            const template = templateByPath.get(item.path);
            return template
              ? `/${template.name}`
              : this.formatDisplayPath(item.path);
          },
          formatPackagePath: (item) => {
            const template = templateByPath.get(item.path);
            return template
              ? `/${template.name}`
              : this.formatDisplayPath(item.path);
          },
        });
        this.chatContainer.addChild(
          new Text(`${sectionHeader("Prompts")}\n${templateList}`, 0, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      if (extensions.length > 0) {
        const groups = this.buildScopeGroups(extensions);
        const extList = this.formatScopeGroups(groups, {
          formatPath: (item) => this.formatDisplayPath(item.path),
          formatPackagePath: (item) =>
            this.getShortPath(item.path, item.sourceInfo),
        });
        this.chatContainer.addChild(
          new Text(
            `${sectionHeader("Extensions", "mdHeading")}\n${extList}`,
            0,
            0,
          ),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      // Show loaded themes (excluding built-in)
      const loadedThemes = themesResult.themes;
      const customThemes = loadedThemes.filter((t) => t.sourcePath);
      if (customThemes.length > 0) {
        const groups = this.buildScopeGroups(
          customThemes.map((loadedTheme) => ({
            path: loadedTheme.sourcePath!,
            sourceInfo: loadedTheme.sourceInfo,
          })),
        );
        const themeList = this.formatScopeGroups(groups, {
          formatPath: (item) => this.formatDisplayPath(item.path),
          formatPackagePath: (item) =>
            this.getShortPath(item.path, item.sourceInfo),
        });
        this.chatContainer.addChild(
          new Text(`${sectionHeader("Themes")}\n${themeList}`, 0, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
      }
    }

    if (showDiagnostics) {
      const skillDiagnostics = skillsResult.diagnostics;
      if (skillDiagnostics.length > 0) {
        const warningLines = this.formatDiagnostics(
          skillDiagnostics,
          sourceInfos,
        );
        this.chatContainer.addChild(
          new Text(
            `${theme.fg("warning", "[Skill conflicts]")}\n${warningLines}`,
            0,
            0,
          ),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      const promptDiagnostics = promptsResult.diagnostics;
      if (promptDiagnostics.length > 0) {
        const warningLines = this.formatDiagnostics(
          promptDiagnostics,
          sourceInfos,
        );
        this.chatContainer.addChild(
          new Text(
            `${theme.fg("warning", "[Prompt conflicts]")}\n${warningLines}`,
            0,
            0,
          ),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      const extensionDiagnostics: ResourceDiagnostic[] = [];
      const extensionErrors =
        this.session.resourceLoader.getExtensions().errors;
      if (extensionErrors.length > 0) {
        for (const error of extensionErrors) {
          extensionDiagnostics.push({
            type: "error",
            message: error.error,
            path: error.path,
          });
        }
      }

      const commandDiagnostics =
        this.session.extensionRunner?.getCommandDiagnostics() ?? [];
      extensionDiagnostics.push(...commandDiagnostics);
      extensionDiagnostics.push(
        ...this.getBuiltInCommandConflictDiagnostics(
          this.session.extensionRunner,
        ),
      );

      const shortcutDiagnostics =
        this.session.extensionRunner?.getShortcutDiagnostics() ?? [];
      extensionDiagnostics.push(...shortcutDiagnostics);

      if (extensionDiagnostics.length > 0) {
        const warningLines = this.formatDiagnostics(
          extensionDiagnostics,
          sourceInfos,
        );
        this.chatContainer.addChild(
          new Text(
            `${theme.fg("warning", "[Extension issues]")}\n${warningLines}`,
            0,
            0,
          ),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      const themeDiagnostics = themesResult.diagnostics;
      if (themeDiagnostics.length > 0) {
        const warningLines = this.formatDiagnostics(
          themeDiagnostics,
          sourceInfos,
        );
        this.chatContainer.addChild(
          new Text(
            `${theme.fg("warning", "[Theme conflicts]")}\n${warningLines}`,
            0,
            0,
          ),
        );
        this.chatContainer.addChild(new Spacer(1));
      }
    }
  }

  /**
   * Initialize the extension system with TUI-based UI context.
   */
  private async bindCurrentSessionExtensions(): Promise<void> {
    const uiContext = this.createExtensionUIContext();
    await this.session.bindExtensions({
      uiContext,
      commandContextActions: {
        waitForIdle: () => this.session.agent.waitForIdle(),
        newSession: async (options) => {
          if (this.loadingAnimation) {
            this.loadingAnimation.stop();
            this.loadingAnimation = undefined;
            this.syncHardwareCursorVisibility();
          }
          this.statusContainer.clear();
          const result = await this.runtimeHost.newSession(options);
          if (!result.cancelled) {
            await this.handleRuntimeSessionChange();
            this.renderCurrentSessionState();
            this.enterStartupHero();
          }
          return result;
        },
        fork: async (entryId) => {
          const result = await this.runtimeHost.fork(entryId);
          if (!result.cancelled) {
            await this.handleRuntimeSessionChange();
            this.renderCurrentSessionState();
            this.editor.setText(result.selectedText ?? "");
            this.showStatus("Forked to new session");
          }
          return { cancelled: result.cancelled };
        },
        navigateTree: async (targetId, options) => {
          const result = await this.session.navigateTree(targetId, {
            summarize: options?.summarize,
            customInstructions: options?.customInstructions,
            replaceInstructions: options?.replaceInstructions,
            label: options?.label,
          });
          if (result.cancelled) {
            return { cancelled: true };
          }

          this.chatContainer.clear();
          this.renderInitialMessages();
          if (result.editorText && !this.editor.getText().trim()) {
            this.editor.setText(result.editorText);
          }
          this.showStatus("Navigated to selected point");
          return { cancelled: false };
        },
        switchSession: async (sessionPath) => {
          await this.handleResumeSession(sessionPath);
          return { cancelled: false };
        },
        reload: async () => {
          await this.handleReloadCommand();
        },
      },
      shutdownHandler: () => {
        this.shutdownRequested = true;
        if (!this.session.isStreaming) {
          void this.shutdown();
        }
      },
      onError: (error) => {
        this.showExtensionError(error.extensionPath, error.error, error.stack);
      },
    });

    setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
    this.setupAutocomplete(this.fdPath);

    const extensionRunner = this.session.extensionRunner;
    if (!extensionRunner) {
      this.showLoadedResources({ extensions: [], force: false });
      return;
    }

    this.setupExtensionShortcuts(extensionRunner);
    this.showLoadedResources({ force: false });
  }

  private syncHardwareCursorVisibility(): void {
    const shouldShow =
      this.settingsManager.getShowHardwareCursor() &&
      !this.loadingAnimation &&
      !this.streamingComponent &&
      !this.startupHeroActive;
    this.ui.setShowHardwareCursor(shouldShow);
  }

  private applyRuntimeSettings(): void {
    this.footer.setSession(this.session);
    this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);
    this.footerDataProvider.setCwd(this.sessionManager.getCwd());
    this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
    this.syncHardwareCursorVisibility();
    this.ui.setHardwareCursorShape(
      this.settingsManager.getHardwareCursorShape(),
    );
    this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
    const editorPaddingX = this.settingsManager.getEditorPaddingX();
    const autocompleteMaxVisible =
      this.settingsManager.getAutocompleteMaxVisible();
    this.defaultEditor.setPaddingX(editorPaddingX);
    this.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
    if (this.editor !== this.defaultEditor) {
      this.editor.setPaddingX?.(editorPaddingX);
      this.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
    }
  }

  private async handleRuntimeSessionChange(): Promise<void> {
    this.resetExtensionUI();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.applyRuntimeSettings();
    await this.bindCurrentSessionExtensions();
    this.subscribeToAgent();
    await this.updateAvailableProviderCount();
    this.updateEditorBorderColor();
    this.updateTerminalTitle();
  }

  private renderCurrentSessionState(): void {
    this.chatContainer.clear();
    this.pendingMessagesContainer.clear();
    this.compactionQueuedMessages = [];
    this.streamingComponent = undefined;
    this.streamingMessage = undefined;
    this.planStreamingComponent = undefined;
    this.planStreamingBuffer = "";
    this.activePlanItemId = undefined;
    this.pendingTools.clear();
    this.renderInitialMessages();
  }

  /**
   * Get a registered tool definition by name (for custom rendering).
   */
  private getRegisteredToolDefinition(toolName: string) {
    return this.session.getToolDefinition(toolName);
  }

  /**
   * Set up keyboard shortcuts registered by extensions.
   */
  private setupExtensionShortcuts(extensionRunner: ExtensionRunner): void {
    const shortcuts = extensionRunner.getShortcuts(
      this.keybindings.getEffectiveConfig(),
    );
    if (shortcuts.size === 0) return;

    // Create a context for shortcut handlers
    const createContext = (): ExtensionContext => ({
      ui: this.createExtensionUIContext(),
      hasUI: true,
      cwd: this.sessionManager.getCwd(),
      sessionManager: this.sessionManager,
      modelRegistry: this.session.modelRegistry,
      model: this.session.model,
      isIdle: () => !this.session.isStreaming,
      signal: this.session.agent.signal,
      abort: () => this.session.abort(),
      hasPendingMessages: () => this.session.pendingMessageCount > 0,
      shutdown: () => {
        this.shutdownRequested = true;
      },
      getContextUsage: () => this.session.getContextUsage(),
      compact: (options) => {
        void (async () => {
          try {
            const result = await this.session.compact(
              options?.customInstructions as any,
            );
            options?.onComplete?.(result);
          } catch (error) {
            const err =
              error instanceof Error ? error : new Error(String(error));
            options?.onError?.(err);
          }
        })();
	      },
	      getSystemPrompt: () => this.session.systemPrompt,
	      getCollaborationMode: () => this.session.collaborationMode,
	      setCollaborationMode: (mode) => this.session.setCollaborationMode(mode),
	      emitPlanUpdate: (update) => this.session.emitPlanUpdate(update),
	      clearPlan: () => this.session.clearPlan(),
	      isRootAgent: () => this.session.isRootAgent(),
	    });

    // Set up the extension shortcut handler on the default editor
    this.defaultEditor.onExtensionShortcut = (data: string) => {
      for (const [shortcutStr, shortcut] of shortcuts) {
        // Cast to KeyId - extension shortcuts use the same format
        if (matchesKey(data, shortcutStr as KeyId)) {
          // Run handler async, don't block input
          Promise.resolve(shortcut.handler(createContext())).catch((err) => {
            this.showError(
              `Shortcut handler error: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
          return true;
        }
      }
      return false;
    };
  }

  /**
   * Set extension status text in the footer.
   */
  private setExtensionStatus(key: string, text: string | undefined): void {
    this.footerDataProvider.setExtensionStatus(key, text);
    this.ui.requestRender();
  }

  private setHiddenThinkingLabel(label?: string): void {
    this.hiddenThinkingLabel = label ?? this.defaultHiddenThinkingLabel;
    for (const child of this.chatContainer.children) {
      if (child instanceof AssistantMessageComponent) {
        child.setHiddenThinkingLabel(this.hiddenThinkingLabel);
      }
    }
    if (this.streamingComponent) {
      this.streamingComponent.setHiddenThinkingLabel(this.hiddenThinkingLabel);
    }
    this.ui.requestRender();
  }

  /**
   * Set an extension widget (string array or custom component).
   */
  private setExtensionWidget(
    key: string,
    content:
      | string[]
      | ((tui: TUI, thm: Theme) => Component & { dispose?(): void })
      | undefined,
    options?: ExtensionWidgetOptions,
  ): void {
    const placement = options?.placement ?? "aboveEditor";
    const removeExisting = (
      map: Map<string, Component & { dispose?(): void }>,
    ) => {
      const existing = map.get(key);
      if (existing?.dispose) existing.dispose();
      map.delete(key);
    };

    removeExisting(this.extensionWidgetsAbove);
    removeExisting(this.extensionWidgetsBelow);

    if (content === undefined) {
      this.renderWidgets();
      return;
    }

    let component: Component & { dispose?(): void };

    if (Array.isArray(content)) {
      // Wrap string array in a Container with Text components
      const container = new Container();
      for (const line of content.slice(0, InteractiveMode.MAX_WIDGET_LINES)) {
        container.addChild(new Text(line, 1, 0));
      }
      if (content.length > InteractiveMode.MAX_WIDGET_LINES) {
        container.addChild(
          new Text(theme.fg("muted", "... (widget truncated)"), 1, 0),
        );
      }
      component = container;
    } else {
      // Factory function - create component
      component = content(this.ui, theme);
    }

    const targetMap =
      placement === "belowEditor"
        ? this.extensionWidgetsBelow
        : this.extensionWidgetsAbove;
    targetMap.set(key, component);
    this.renderWidgets();
  }

  private clearExtensionWidgets(): void {
    for (const widget of this.extensionWidgetsAbove.values()) {
      widget.dispose?.();
    }
    for (const widget of this.extensionWidgetsBelow.values()) {
      widget.dispose?.();
    }
    this.extensionWidgetsAbove.clear();
    this.extensionWidgetsBelow.clear();
    this.renderWidgets();
  }

  private setExtensionSidebar(
    key: string,
    content:
      | string[]
      | ((tui: TUI, thm: Theme) => Component & { dispose?(): void })
      | undefined,
  ): void {
    const existing = this.extensionSidebars.get(key);
    existing?.dispose?.();
    this.extensionSidebars.delete(key);

    if (content === undefined) {
      this.renderSidebar();
      return;
    }

    let component: Component & { dispose?(): void };
    if (Array.isArray(content)) {
      const container = new Container();
      for (const line of content.slice(0, 28)) {
        container.addChild(new Text(line, 0, 0));
      }
      if (content.length > 28) {
        container.addChild(
          new Text(theme.fg("muted", "… (sidebar truncated)"), 0, 0),
        );
      }
      component = container;
    } else {
      component = content(this.ui, theme);
    }
    this.extensionSidebars.set(key, component);
    this.renderSidebar();
  }

  private clearExtensionSidebars(): void {
    for (const sidebar of this.extensionSidebars.values()) {
      sidebar.dispose?.();
    }
    this.extensionSidebars.clear();
    this.renderSidebar();
  }

  private getSidebarMinWidth(): number {
    return this.sidebarMode === "on"
      ? SIDEBAR_FORCE_MIN_TERMINAL_WIDTH
      : SIDEBAR_AUTO_MIN_TERMINAL_WIDTH;
  }

  private shouldRenderSidebarContent(): boolean {
    return this.sidebarMode !== "off" && this.extensionSidebars.size > 0;
  }

  private renderSidebar(): void {
    this.sidebarContainer.clear();
    if (!this.shouldRenderSidebarContent()) {
      this.ui.requestRender();
      return;
    }
    for (const component of this.extensionSidebars.values()) {
      this.sidebarContainer.addChild(component);
    }
    this.ui.requestRender();
  }

  private handleGlobalInput(data: string): { consume?: boolean } | undefined {
    const mouseResult = this.inputLayer.handleRawInput(data);
    if (mouseResult) return mouseResult;
    return this.handleWelcomeInput(data);
  }

  private getMaxChatScrollOffset(): number {
    const ctx = this.ui.getLastRenderContext();
    if (!ctx) return 0;
    return Math.max(0, ctx.totalLines - ctx.height);
  }

  private handleChatWheelScroll(direction: "up" | "down"): void {
    const step = 3;
    const maxOffset = this.getMaxChatScrollOffset();
    const current = this.ui.getViewportScrollOffset();
    if (direction === "up") {
      const next = Math.min(maxOffset, current + step);
      this.ui.setViewportScrollOffset(next);
      this.chatScrollPinned = next === 0;
    } else {
      const next = Math.max(0, current - step);
      this.ui.setViewportScrollOffset(next);
      this.chatScrollPinned = next === 0;
    }
    // TUI owns the sliced viewport redraw. Do not force-reset its render state or
    // clear terminal scrollback for every wheel tick; that causes visible jitter.
    this.ui.requestRender();
  }

  private resetChatScrollIfPinned(): void {
    if (!this.chatScrollPinned) return;
    this.ui.setViewportScrollOffset(0);
  }

  private handleWelcomeInput(data: string): { consume?: boolean } | undefined {
    if (!this.startupHeroActive || !this.startupHero) return undefined;

    if (matchesKey(data, "ctrl+w")) {
      void this.handleWelcomeMenuAction("newSession");
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+s")) {
      void this.handleWelcomeMenuAction("resumeSession");
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+d")) {
      void this.handleWelcomeMenuAction("changelog");
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+q")) {
      void this.handleWelcomeMenuAction("quit");
      return { consume: true };
    }

    return undefined;
  }

  private getMainContentWidth(totalWidth: number): number {
    if (
      !this.shouldRenderSidebarContent() ||
      totalWidth < this.getSidebarMinWidth()
    ) {
      return totalWidth;
    }
    const rightWidth = Math.min(
      SIDEBAR_WIDTH,
      Math.max(28, Math.floor(totalWidth * 0.34)),
    );
    return Math.max(1, totalWidth - rightWidth - 1);
  }

  private enterStartupHero(): void {
    if (this.startupHeroActive) return;
    this.startupHeroActive = true;
    this.editor.setText("");
    this.startupHero = this.createWelcomeBoard();
    this.headerContainer.clear();
    this.headerContainer.addChild(
      new Text(theme.fg("dim", DISPLAY_NAME.toLowerCase()), 1, 0),
    );
    this.builtInHeader = this.startupHero;
    this.headerContainer.addChild(this.startupHero);

    // In hero mode, suppress main content (chat/status) to avoid stray lines/separators leaking
    // under the welcome card. The editor input stays mounted at the bottom.
    this.chatContainer.clear();
    this.pendingMessagesContainer.clear();
    this.statusContainer.clear();

    this.mountEditorContainer();
    this.mountWelcomeTip();
    this.ui.setFocus(this.editor as Component);
    this.syncHardwareCursorVisibility();
    this.ui.requestRender(true);
  }

  private exitStartupHero(): void {
    if (!this.startupHeroActive) return;
    this.startupHeroActive = false;
    this.startupHero = undefined;
    this.clearWelcomeTip();
    this.headerContainer.clear();
    this.headerContainer.addChild(
      new SessionTabsComponent(
        () => this.getSessionTabLabel(),
        () => this.getDisplayName(),
      ),
    );
    this.headerContainer.addChild(new Spacer(1));
    this.builtInHeader = new Text("", 0, 0);
    this.headerContainer.addChild(this.builtInHeader);
    this.mountEditorContainer();
    this.ui.setFocus(this.editor as Component);
    this.syncHardwareCursorVisibility();
    this.ui.requestRender(true);
  }

  private handleSidebarCommand(text: string): void {
    const arg = text.startsWith("/sidebar ")
      ? text.slice(9).trim().toLowerCase()
      : "";
    if (arg === "on" || arg === "off" || arg === "auto") {
      this.sidebarMode = arg;
    } else if (!arg) {
      this.sidebarMode = this.sidebarMode === "off" ? "auto" : "off";
    } else {
      this.showWarning(
        "Usage: /sidebar, /sidebar on, /sidebar off, or /sidebar auto",
      );
      return;
    }
    const minWidth = this.getSidebarMinWidth();
    const visible =
      this.shouldRenderSidebarContent() && this.ui.terminal.columns >= minWidth;
    const suffix =
      this.sidebarMode === "off"
        ? "hidden"
        : visible
          ? "visible"
          : `disabled under ${minWidth} columns; use /checklist`;
    this.showStatus(`Sidebar ${this.sidebarMode} (${suffix})`);
    this.renderSidebar();
  }

  private resetExtensionUI(): void {
    if (this.extensionSelector) {
      this.hideExtensionSelector();
    }
    if (this.extensionInput) {
      this.hideExtensionInput();
    }
    if (this.extensionEditor) {
      this.hideExtensionEditor();
    }
    this.ui.hideOverlay();
    this.clearExtensionTerminalInputListeners();
    this.setExtensionFooter(undefined);
    this.setExtensionHeader(undefined);
    this.clearExtensionWidgets();
    this.clearExtensionSidebars();
    this.footerDataProvider.clearExtensionStatuses();
    this.footer.invalidate();
    this.setCustomEditorComponent(undefined);
    this.defaultEditor.onExtensionShortcut = undefined;

    // Setup attachment cleanup on backspace zamanlamasını düzelttik
    const originalHandleInput = this.defaultEditor.handleInput.bind(
      this.defaultEditor,
    );
    this.defaultEditor.handleInput = (data: string) => {
      const isEmptyBefore = this.defaultEditor.getText().length === 0;
      // Senior level raw detection: backspace often comes as \x7f or \x08
      const isRawBackspace = data === "\x7f" || data === "\x08";

      if (isRawBackspace && isEmptyBefore) {
        if (this.editorImageSlots.size > 0) {
          this.editorImageSlots.clear();
          this.renderAttachmentBar();
        }
      }
      originalHandleInput(data);
    };

    this.updateTerminalTitle();
    if (this.loadingAnimation) {
      this.setAgentWorkingLine(this.defaultWorkingMessage);
    }
    this.setHiddenThinkingLabel();
  }

  // Maximum total widget lines to prevent viewport overflow
  private static readonly MAX_WIDGET_LINES = 10;

  /**
   * Render all extension widgets to the widget container.
   */
  private renderWidgets(): void {
    if (!this.widgetContainerAbove || !this.widgetContainerBelow) return;
    this.renderWidgetContainer(
      this.widgetContainerAbove,
      this.extensionWidgetsAbove,
      true,
      true,
    );
    this.renderWidgetContainer(
      this.widgetContainerBelow,
      this.extensionWidgetsBelow,
      false,
      false,
    );
    this.ui.requestRender();
  }

  private renderWidgetContainer(
    container: Container,
    widgets: Map<string, Component & { dispose?(): void }>,
    spacerWhenEmpty: boolean,
    leadingSpacer: boolean,
  ): void {
    container.clear();

    if (widgets.size === 0) {
      if (spacerWhenEmpty) {
        container.addChild(new Spacer(1));
      }
      return;
    }

    if (leadingSpacer) {
      container.addChild(new Spacer(1));
    }
    for (const component of widgets.values()) {
      container.addChild(component);
    }
  }

  /**
   * Set a custom footer component, or restore the built-in footer.
   */
  private setExtensionFooter(
    factory:
      | ((
          tui: TUI,
          thm: Theme,
          footerData: ReadonlyFooterDataProvider,
        ) => Component & { dispose?(): void })
      | undefined,
  ): void {
    // Dispose existing custom footer
    if (this.customFooter?.dispose) {
      this.customFooter.dispose();
    }

    // Remove current footer from UI
    if (this.customFooter) {
      this.ui.removeChild(this.customFooter);
    } else {
      this.ui.removeChild(this.footer);
    }

    if (factory) {
      // Create and add custom footer, passing the data provider
      this.customFooter = factory(this.ui, theme, this.footerDataProvider);
      this.ui.addChild(this.customFooter);
    } else {
      // Restore built-in footer
      this.customFooter = undefined;
      this.ui.addChild(this.footer);
    }

    this.ui.requestRender();
  }

  /**
   * Set a custom header component, or restore the built-in header.
   */
  private setExtensionHeader(
    factory:
      ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined,
  ): void {
    // Header may not be initialized yet if called during early initialization
    if (!this.builtInHeader) {
      return;
    }

    // Dispose existing custom header
    if (this.customHeader?.dispose) {
      this.customHeader.dispose();
    }

    // Find the index of the current header in the header container
    const currentHeader = this.customHeader || this.builtInHeader;
    const index = this.headerContainer.children.indexOf(currentHeader);

    if (factory) {
      // Create and add custom header
      this.customHeader = factory(this.ui, theme);
      if (index !== -1) {
        this.headerContainer.children[index] = this.customHeader;
      } else {
        // If not found (e.g. builtInHeader was never added), add at the top
        this.headerContainer.children.unshift(this.customHeader);
      }
    } else {
      // Restore built-in header
      this.customHeader = undefined;
      if (index !== -1) {
        this.headerContainer.children[index] = this.builtInHeader;
      }
    }

    this.ui.requestRender();
  }

  private addExtensionTerminalInputListener(
    handler: (data: string) => { consume?: boolean; data?: string } | undefined,
  ): () => void {
    const unsubscribe = this.ui.addInputListener(handler);
    this.extensionTerminalInputUnsubscribers.add(unsubscribe);
    return () => {
      unsubscribe();
      this.extensionTerminalInputUnsubscribers.delete(unsubscribe);
    };
  }

  private clearExtensionTerminalInputListeners(): void {
    for (const unsubscribe of this.extensionTerminalInputUnsubscribers) {
      unsubscribe();
    }
    this.extensionTerminalInputUnsubscribers.clear();
  }

  /**
   * Create the ExtensionUIContext for extensions.
   */
  private reserveIdleStatusLine(): void {
    this.statusContainer.clear();
    this.statusContainer.addChild(this.idleStatusSpacer);
  }

  private clearWorkingMessageHideTimer(): void {
    if (this.workingMessageHideTimer) {
      clearTimeout(this.workingMessageHideTimer);
      this.workingMessageHideTimer = undefined;
    }
  }

  private scheduleWorkingMessageHide(): void {
    this.clearWorkingMessageHideTimer();
    if (!this.loadingAnimation) return;
    this.workingMessageHideTimer = setTimeout(() => {
      if (this.loadingAnimation) {
        this.loadingAnimation.setMessage("");
      }
      this.workingMessageHideTimer = undefined;
    }, 2500);
  }

  /** Updates the status-line “working” text with shimmer; does not auto-clear (unlike extension overrides). */
  private setAgentWorkingLine(detail: string): void {
    if (!this.loadingAnimation) return;
    this.clearWorkingMessageHideTimer();
    this.loadingAnimation.setMessage(
      `${detail.replace(/[.…]+$/g, "")}   ${keyText("app.interrupt")} interrupt`,
    );
  }

  /** Derive working line from streamed assistant content (tools, thinking, text). */
  private syncLoadingMessageFromAssistantStream(
    message: AssistantMessage,
  ): void {
    if (!this.loadingAnimation) return;

    const toolCalls = message.content.filter((c) => c.type === "toolCall");
    if (toolCalls.length > 0) {
      // During assistant streaming a tool call may only be queued; the real
      // execution status is handled by tool_execution_start. Showing the exact
      // tool here makes queued edits look like a frozen running operation.
      this.setAgentWorkingLine("Preparing tool call…");
      return;
    }

    const hasThinking = message.content.some(
      (c) =>
        c.type === "thinking" &&
        String((c as { thinking?: string }).thinking ?? "").trim(),
    );
    const hasText = message.content.some(
      (c) =>
        c.type === "text" && String((c as { text?: string }).text ?? "").trim(),
    );
    if (hasThinking && !hasText) {
      const statusText = this.pendingUserImages?.length
        ? "Reading screenshot…"
        : "Thinking…";
      this.setAgentWorkingLine(statusText);
      return;
    }
    if (hasText) {
      this.setAgentWorkingLine("Writing response…");
      return;
    }

    this.setAgentWorkingLine(this.defaultWorkingMessage);
  }

  private createExtensionUIContext(): ExtensionUIContext {
    return {
      select: (title, options, opts) =>
        this.showExtensionSelector(title, options, opts),
      confirm: (title, message, opts) =>
        this.showExtensionConfirm(title, message, opts),
      input: (title, placeholder, opts) =>
        this.showExtensionInput(title, placeholder, opts),
      notify: (message, type) => this.showExtensionNotify(message, type),
      onTerminalInput: (handler) =>
        this.addExtensionTerminalInputListener(handler),
      setStatus: (key, text) => this.setExtensionStatus(key, text),
      setWorkingMessage: (message) => {
        if (this.loadingAnimation) {
          if (message) {
            this.loadingAnimation.setMessage(message);
            this.scheduleWorkingMessageHide();
          } else {
            this.loadingAnimation.setMessage(
              `${this.defaultWorkingMessage}   ${keyText("app.interrupt")} interrupt`,
            );
            this.scheduleWorkingMessageHide();
          }
        } else {
          // Queue message for when loadingAnimation is created (handles agent_start race)
          this.pendingWorkingMessage = message;
        }
      },
      setHiddenThinkingLabel: (label) => this.setHiddenThinkingLabel(label),
      setWidget: (key, content, options) =>
        this.setExtensionWidget(key, content, options),
      setSidebar: (key, content) => this.setExtensionSidebar(key, content),
      setFooter: (factory) => this.setExtensionFooter(factory),
      setHeader: (factory) => this.setExtensionHeader(factory),
      setTitle: (title) => this.ui.terminal.setTitle(title),
      custom: (factory, options) => this.showExtensionCustom(factory, options),
      pasteToEditor: (text) =>
        this.editor.handleInput(`\x1b[200~${text}\x1b[201~`),
      setEditorText: (text) => this.editor.setText(text),
      getEditorText: () =>
        this.editor.getExpandedText?.() ?? this.editor.getText(),
      editor: (title, prefill) => this.showExtensionEditor(title, prefill),
      setEditorComponent: (factory) => this.setCustomEditorComponent(factory),
      get theme() {
        return theme;
      },
      getAllThemes: () => getAvailableThemesWithPaths(),
      getTheme: (name) => getThemeByName(name),
      setTheme: (themeOrName) => {
        if (themeOrName instanceof Theme) {
          setThemeInstance(themeOrName);
          this.ui.requestRender();
          return { success: true };
        }
        const result = setTheme(themeOrName, true);
        if (result.success) {
          if (this.settingsManager.getTheme() !== themeOrName) {
            this.settingsManager.setTheme(themeOrName);
          }
          this.ui.requestRender();
        }
        return result;
      },
      getToolsExpanded: () => this.toolOutputExpanded,
      setToolsExpanded: (expanded) => this.setToolsExpanded(expanded),
    };
  }

  /**
   * Show a selector for extensions.
   */
  private showExtensionSelector(
    title: string,
    options: string[],
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      if (opts?.signal?.aborted) {
        resolve(undefined);
        return;
      }

      const onAbort = () => {
        this.hideExtensionSelector();
        resolve(undefined);
      };
      opts?.signal?.addEventListener("abort", onAbort, { once: true });

      this.extensionSelector = new ExtensionSelectorComponent(
        title,
        options,
        (option) => {
          opts?.signal?.removeEventListener("abort", onAbort);
          this.hideExtensionSelector();
          resolve(option);
        },
        () => {
          opts?.signal?.removeEventListener("abort", onAbort);
          this.hideExtensionSelector();
          resolve(undefined);
        },
        { tui: this.ui, timeout: opts?.timeout },
      );

      this.editorContainer.clear();
      this.editorContainer.addChild(this.extensionSelector);
      this.ui.setFocus(this.extensionSelector);
      this.ui.requestRender();
    });
  }

  /**
   * Hide the extension selector.
   */
  private hideExtensionSelector(): void {
    this.extensionSelector?.dispose();
    this.mountEditorContainer();
    this.extensionSelector = undefined;
    this.ui.setFocus(this.editor);
    this.ui.requestRender();
  }

  /**
   * Show a confirmation dialog for extensions.
   */
  private async showExtensionConfirm(
    title: string,
    message: string,
    opts?: ExtensionUIDialogOptions,
  ): Promise<boolean> {
    const result = await this.showExtensionSelector(
      `${title}\n${message}`,
      ["Yes", "No"],
      opts,
    );
    return result === "Yes";
  }

  /**
   * Show a text input for extensions.
   */
  private showExtensionInput(
    title: string,
    placeholder?: string,
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      if (opts?.signal?.aborted) {
        resolve(undefined);
        return;
      }

      const onAbort = () => {
        this.hideExtensionInput();
        resolve(undefined);
      };
      opts?.signal?.addEventListener("abort", onAbort, { once: true });

      this.extensionInput = new ExtensionInputComponent(
        title,
        placeholder,
        (value) => {
          opts?.signal?.removeEventListener("abort", onAbort);
          this.hideExtensionInput();
          resolve(value);
        },
        () => {
          opts?.signal?.removeEventListener("abort", onAbort);
          this.hideExtensionInput();
          resolve(undefined);
        },
        { tui: this.ui, timeout: opts?.timeout },
      );

      this.editorContainer.clear();
      this.editorContainer.addChild(this.extensionInput);
      this.ui.setFocus(this.extensionInput);
      this.ui.requestRender();
    });
  }

  /**
   * Hide the extension input.
   */
  private hideExtensionInput(): void {
    this.extensionInput?.dispose();
    this.mountEditorContainer();
    this.extensionInput = undefined;
    this.ui.setFocus(this.editor);
    this.ui.requestRender();
  }

  /**
   * Show a multi-line editor for extensions (with Ctrl+G support).
   */
  private showExtensionEditor(
    title: string,
    prefill?: string,
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      this.extensionEditor = new ExtensionEditorComponent(
        this.ui,
        this.keybindings,
        title,
        prefill,
        (value) => {
          this.hideExtensionEditor();
          resolve(value);
        },
        () => {
          this.hideExtensionEditor();
          resolve(undefined);
        },
      );

      this.editorContainer.clear();
      this.editorContainer.addChild(this.extensionEditor);
      this.ui.setFocus(this.extensionEditor);
      this.ui.requestRender();
    });
  }

  /**
   * Hide the extension editor.
   */
  private hideExtensionEditor(): void {
    this.mountEditorContainer();
    this.extensionEditor = undefined;
    this.ui.setFocus(this.editor);
    this.ui.requestRender();
  }

  /**
   * Set a custom editor component from an extension.
   * Pass undefined to restore the default editor.
   */
  private setCustomEditorComponent(
    factory:
      | ((
          tui: TUI,
          theme: EditorTheme,
          keybindings: KeybindingsManager,
        ) => EditorComponent)
      | undefined,
  ): void {
    // Save text from current editor before switching
    const currentText = this.editor.getText();

    this.editorContainer.clear();

    if (factory) {
      // Create the custom editor with tui, theme, and keybindings
      const newEditor = factory(this.ui, getEditorTheme(), this.keybindings);

      // Wire up callbacks from the default editor
      newEditor.onSubmit = this.defaultEditor.onSubmit;
      newEditor.onChange = this.defaultEditor.onChange;

      // Copy text from previous editor
      newEditor.setText(currentText);

      // Setup attachment cleanup on backspace zamanlamasını düzelttik
      const originalHandleInput = newEditor.handleInput.bind(newEditor);
      newEditor.handleInput = (data: string) => {
        const isEmptyBefore = newEditor.getText().length === 0;
        // Senior level raw detection: backspace often comes as \x7f or \x08
        const isRawBackspace = data === "\x7f" || data === "\x08";

        if (isRawBackspace && isEmptyBefore) {
          if (this.editorImageSlots.size > 0) {
            this.editorImageSlots.clear();
            this.renderAttachmentBar();
          }
        }
        originalHandleInput(data);
      };

      // Copy appearance settings if supported
      if (newEditor.borderColor !== undefined) {
        newEditor.borderColor = this.defaultEditor.borderColor;
      }
      if (newEditor.setPaddingX !== undefined) {
        newEditor.setPaddingX(this.defaultEditor.getPaddingX());
      }

      // Set autocomplete if supported
      if (newEditor.setAutocompleteProvider && this.autocompleteProvider) {
        newEditor.setAutocompleteProvider(this.autocompleteProvider);
      }

      // If extending CustomEditor, copy app-level handlers
      // Use duck typing since instanceof fails across jiti module boundaries
      const customEditor = newEditor as unknown as Record<string, unknown>;
      if (
        "actionHandlers" in customEditor &&
        customEditor.actionHandlers instanceof Map
      ) {
        if (!customEditor.onEscape) {
          customEditor.onEscape = () => this.defaultEditor.onEscape?.();
        }
        if (!customEditor.onCtrlD) {
          customEditor.onCtrlD = () => this.defaultEditor.onCtrlD?.();
        }
        if (!customEditor.onPasteImage) {
          customEditor.onPasteImage = () => this.defaultEditor.onPasteImage?.();
        }
        if (!customEditor.onExtensionShortcut) {
          customEditor.onExtensionShortcut = (data: string) =>
            this.defaultEditor.onExtensionShortcut?.(data);
        }
        // Copy action handlers (clear, suspend, model switching, etc.)
        for (const [action, handler] of this.defaultEditor.actionHandlers) {
          (customEditor.actionHandlers as Map<string, () => void>).set(
            action,
            handler,
          );
        }
      }

      this.editor = newEditor;
    } else {
      // Restore default editor with text from custom editor
      this.defaultEditor.setText(currentText);
      this.editor = this.defaultEditor;
    }

    this.mountEditorContainer();
    this.ui.setFocus(this.editor as Component);
    this.ui.requestRender();
  }

  /**
   * Show a notification for extensions.
   */
  private showExtensionNotify(
    message: string,
    type?: "info" | "warning" | "error",
  ): void {
    if (type === "error") {
      this.showError(message);
    } else if (type === "warning") {
      this.showWarning(message);
    } else {
      this.showStatus(message);
    }
  }

  /** Show a custom component with keyboard focus. Overlay mode renders on top of existing content. */
  private async showExtensionCustom<T>(
    factory: (
      tui: TUI,
      theme: Theme,
      keybindings: KeybindingsManager,
      done: (result: T) => void,
    ) =>
      | (Component & { dispose?(): void })
      | Promise<Component & { dispose?(): void }>,
    options?: {
      overlay?: boolean;
      overlayOptions?: OverlayOptions | (() => OverlayOptions);
      onHandle?: (handle: OverlayHandle) => void;
    },
  ): Promise<T> {
    const savedText = this.editor.getText();
    const isOverlay = options?.overlay ?? false;

    const restoreEditor = () => {
      this.mountEditorContainer();
      this.editor.setText(savedText);
      this.ui.setFocus(this.editor);
      this.ui.requestRender();
    };

    return new Promise((resolve, reject) => {
      let component: Component & { dispose?(): void };
      let closed = false;

      const close = (result: T) => {
        if (closed) return;
        closed = true;
        if (isOverlay) this.ui.hideOverlay();
        else restoreEditor();
        // Note: both branches above already call requestRender
        resolve(result);
        try {
          component?.dispose?.();
        } catch {
          /* ignore dispose errors */
        }
      };

      Promise.resolve(factory(this.ui, theme, this.keybindings, close))
        .then((c) => {
          if (closed) return;
          component = c;
          if (isOverlay) {
            // Resolve overlay options - can be static or dynamic function
            const resolveOptions = (): OverlayOptions | undefined => {
              if (options?.overlayOptions) {
                const opts =
                  typeof options.overlayOptions === "function"
                    ? options.overlayOptions()
                    : options.overlayOptions;
                return {
                  background: (text) => theme.bg("userMessageBg", text),
                  ...opts,
                };
              }
              // Fallback: use component's width property if available
              const w = (component as { width?: number }).width;
              return {
                ...(w ? { width: w } : {}),
                background: (text) => theme.bg("userMessageBg", text),
              };
            };
            const handle = this.ui.showOverlay(component, resolveOptions());
            // Expose handle to caller for visibility control
            options?.onHandle?.(handle);
          } else {
            this.editorContainer.clear();
            this.editorContainer.addChild(component);
            this.ui.setFocus(component);
            this.ui.requestRender();
          }
        })
        .catch((err) => {
          if (closed) return;
          if (!isOverlay) restoreEditor();
          reject(err);
        });
    });
  }

  /**
   * Show an extension error in the UI.
   */
  private showExtensionError(
    extensionPath: string,
    error: string,
    stack?: string,
  ): void {
    const errorMsg = `Extension "${extensionPath}" error: ${error}`;
    const errorText = new Text(theme.fg("error", errorMsg), 1, 0);
    this.chatContainer.addChild(errorText);
    if (stack) {
      // Show stack trace in dim color, indented
      const stackLines = stack
        .split("\n")
        .slice(1) // Skip first line (duplicates error message)
        .map((line) => theme.fg("dim", `  ${line.trim()}`))
        .join("\n");
      if (stackLines) {
        this.chatContainer.addChild(new Text(stackLines, 1, 0));
      }
    }
    this.ui.requestRender();
  }

  // =========================================================================
  // Key Handlers
  // =========================================================================

  private setupKeyHandlers(): void {
    // Set up handlers on defaultEditor - they use this.editor for text access
    // so they work correctly regardless of which editor is active
    this.defaultEditor.onEscape = () => {
      const hasAttachments = this.editorImageSlots.size > 0;
      const now = Date.now();

      if (hasAttachments) {
        if (now - this.lastEscapeTime < 1000) {
          this.clearAttachmentDrafts();
          this.showStatus(theme.fg("accent", "Attachment cleared"));
          this.lastEscapeTime = 0;
          return;
        }
        this.lastEscapeTime = now;
        this.showStatus(
          theme.fg("dim", "Press Esc again or Ctrl+C to remove attachment"),
        );
        this.ui.requestRender();
        // Block other ESC actions if attachments are present
        return;
      }

      if (this.loadingAnimation) {
        this.restoreQueuedMessagesToEditor({ abort: true });
      } else if (this.session.isBashRunning) {
        this.session.abortBash();
      } else if (this.isBashMode) {
        this.editor.setText("");
        this.isBashMode = false;
        this.updateEditorBorderColor();
      } else if (!this.editor.getText().trim()) {
        // Double-escape with empty editor triggers /tree, /fork, or nothing based on setting
        const action = this.settingsManager.getDoubleEscapeAction();
        if (action !== "none") {
          const now = Date.now();
          if (now - this.lastEscapeTime < 500) {
            if (action === "tree") {
              this.showTreeSelector();
            } else {
              this.showUserMessageSelector();
            }
            this.lastEscapeTime = 0;
          } else {
            this.lastEscapeTime = now;
          }
        }
      }
    };

    // Register app action handlers
    this.defaultEditor.onAction("app.clear", () => this.handleCtrlC());
    this.defaultEditor.onCtrlD = () => this.handleCtrlD();
    this.defaultEditor.onAction("app.suspend", () => this.handleCtrlZ());
    this.defaultEditor.onAction("app.thinking.cycle", () =>
      this.cycleThinkingLevel(),
    );
    this.defaultEditor.onAction("app.model.cycleForward", () =>
      this.cycleModel("forward"),
    );
    this.defaultEditor.onAction("app.model.cycleBackward", () =>
      this.cycleModel("backward"),
    );

    // Global debug handler on TUI (works regardless of focus)
    this.ui.onDebug = () => this.handleDebugCommand();
    this.defaultEditor.onAction("app.model.select", () =>
      this.showModelSelector(),
    );
    this.defaultEditor.onAction("app.tools.expand", () =>
      this.toggleToolOutputExpansion(),
    );
    this.defaultEditor.onAction("app.thinking.toggle", () =>
      this.toggleThinkingBlockVisibility(),
    );
    this.defaultEditor.onAction("app.editor.external", () =>
      this.openExternalEditor(),
    );
    this.defaultEditor.onAction("app.message.followUp", () =>
      this.handleFollowUp(),
    );
    this.defaultEditor.onAction("app.message.dequeue", () =>
      this.handleDequeue(),
    );
    this.defaultEditor.onAction("app.session.new", () =>
      this.handleClearCommand(),
    );
    this.defaultEditor.onAction("app.session.tree", () =>
      this.showTreeSelector(),
    );
    this.defaultEditor.onAction("app.session.fork", () =>
      this.showUserMessageSelector(),
    );
    this.defaultEditor.onAction("app.session.resume", () =>
      this.showSessionSelector(),
    );

    this.defaultEditor.onChange = (text: string) => {
      const wasBashMode = this.isBashMode;
      this.isBashMode = text.trimStart().startsWith("!");
      if (wasBashMode !== this.isBashMode) {
        this.updateEditorBorderColor();
      }

      // Do not auto-clear image attachments on empty editor text here.
      // The underlying TUI editor fires onChange("") before onSubmit(...),
      // which would silently delete attachments right before submission.
      // Attachment cleanup happens after successful collection/submission paths.
    };

    // Handle clipboard image paste (triggered on Ctrl+V)
    this.defaultEditor.onPasteImage = () => {
      this.handleClipboardImagePaste();
    };
  }

  private findRecentTempClipboardImage(): {
    bytes: Uint8Array;
    mimeType: string;
  } | null {
    try {
      const tmpDir = os.tmpdir();
      const now = Date.now();
      const candidates = fs
        .readdirSync(tmpDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) =>
          /^(pi-clipboard-|quake-code-clipboard-|quake-clipboard-).+\.(png|jpg|jpeg|webp)$/i.test(
            name,
          ),
        )
        .map((name) => path.join(tmpDir, name))
        .map((filePath) => {
          try {
            const stat = fs.statSync(filePath);
            return { filePath, mtimeMs: stat.mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((item): item is { filePath: string; mtimeMs: number } =>
          Boolean(item),
        )
        .filter((item) => now - item.mtimeMs < 10 * 60 * 1000)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      const recent = candidates[0];
      if (!recent) {
        return null;
      }

      const bytes = fs.readFileSync(recent.filePath);
      const ext = path.extname(recent.filePath).toLowerCase();
      const mimeType =
        ext === ".png"
          ? "image/png"
          : ext === ".webp"
            ? "image/webp"
            : "image/jpeg";
      return { bytes: new Uint8Array(bytes), mimeType };
    } catch {
      return null;
    }
  }

  private currentModelSupportsImages(): boolean {
    const current = this.session.model;
    if (!current) return false;
    if (current.input?.includes("image")) return true;

    // Restored sessions and raw CLI fallback models can retain an older/stale
    // capability snapshot. The registry is the source of truth after models.json
    // overrides are loaded, so consult its canonical entry before warning.
    const registered = this.session.modelRegistry.find(current.provider, current.id);
    return Boolean(registered?.input?.includes("image"));
  }

  private formatBytesCompact(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024)
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private getAttachmentManifest(): {
    count: number;
    totalBytes: number;
    mimeSummary: string;
  } {
    const mimeCounts = new Map<string, number>();
    let totalBytes = 0;
    for (const slot of this.editorImageSlots.values()) {
      mimeCounts.set(slot.mimeType, (mimeCounts.get(slot.mimeType) ?? 0) + 1);
      try {
        totalBytes += fs.statSync(slot.filePath).size;
      } catch {
        // Ignore missing temp files here; submit path will validate explicitly.
      }
    }
    const mimeSummary = Array.from(mimeCounts.entries())
      .map(([mime, count]) => `${count}×${mime.replace("image/", "")}`)
      .join(", ");
    return { count: this.editorImageSlots.size, totalBytes, mimeSummary };
  }

  private getAttachmentCapabilityHint(): string {
    if (this.currentModelSupportsImages()) {
      return "";
    }
    return theme.fg("warning", "(Current model can’t analyze images)");
  }

  private renderAttachmentBar(): void {
    this.widgetContainerAbove.clear();
    if (this.editorImageSlots.size === 0) {
      this.renderWidgets();
      return;
    }

    const bar = new Container();
    const manifest = this.getAttachmentManifest();
    const label = theme.fg("accent", "◇");
    const noun = manifest.count === 1 ? "image" : "images";
    const details = `${label} ${theme.fg("muted", `${manifest.count === 1 ? noun : `${manifest.count} ${noun}`} · ${this.formatBytesCompact(manifest.totalBytes)}`)}`;
    const clearHint = theme.fg("dim", "   ctrl+c remove");
    const capability = this.getAttachmentCapabilityHint();
    bar.addChild(
      new Text(
        `${details}${clearHint}${capability ? ` ${capability}` : ""}`,
        1,
        0,
      ),
    );

    this.widgetContainerAbove.addChild(bar);
    this.ui.requestRender();
  }

  private async handleClipboardImagePaste(): Promise<void> {
    try {
      const image =
        (await readClipboardImage()) ?? this.findRecentTempClipboardImage();
      if (!image) {
        return;
      }

      const id = this.nextEditorImageSlotId++;
      const tmpDir = os.tmpdir();
      const ext = extensionForImageMimeType(image.mimeType) ?? "png";
      const fileName = `qcimg${id}.${ext}`;
      const filePath = path.join(tmpDir, fileName);
      fs.writeFileSync(filePath, Buffer.from(image.bytes));

      this.editorImageSlots.set(id, { filePath, mimeType: image.mimeType });

      // Artık metin içine [i0] eklemiyoruz!
      // Bunun yerine Attachment Bar'ı render ediyoruz.
      this.renderAttachmentBar();
      this.ui.requestRender();
    } catch {
      // Silently ignore clipboard errors
    }
  }

  /**
   * Replace `[iN]` tokens with spaces, read images from temp files, unregister editor markers.
   */
  private stripEditorImageMarkersAndCollectImages(raw: string): {
    cleanedText: string;
    images: ImageContent[];
    failedCount: number;
  } {
    const images: ImageContent[] = [];
    let failedCount = 0;

    for (const [, slot] of this.editorImageSlots.entries()) {
      try {
        const buf = fs.readFileSync(slot.filePath);
        images.push({
          type: "image",
          data: Buffer.from(buf).toString("base64"),
          mimeType: slot.mimeType,
        });
      } catch {
        failedCount++;
      }
    }

    this.editorImageSlots.clear();
    this.renderAttachmentBar();

    return { cleanedText: raw.trim(), images, failedCount };
  }

  private setupEditorSubmitHandler(): void {
    this.defaultEditor.onSubmit = async (raw: string) => {
      if (
        this.editorImageSlots.size > 0 &&
        !this.currentModelSupportsImages()
      ) {
        this.showWarning(
          "Current model does not support vision. Use /model to switch to an image-capable model.",
        );
        this.renderAttachmentBar();
        return;
      }

      const { cleanedText, images, failedCount } =
        this.stripEditorImageMarkersAndCollectImages(raw.trim());
      if (failedCount > 0) {
        this.showWarning(
          `Failed to prepare ${failedCount} image attachment${failedCount === 1 ? "" : "s"}.`,
        );
      }
      if (!cleanedText && images.length === 0) return;

      const text = cleanedText;
      const submitImages = images.length > 0 ? images : undefined;

      // Commands often open selectors/editors that mount into the normal editor
      // container. Leave the startup hero first, otherwise those UIs are mounted
      // off-screen and the viewport can look blank.
      if (text.startsWith("/")) {
        this.exitStartupHero();
      }

      // Handle commands
      if (text === "/init") {
        this.editor.setText("");
        await this.handleInitCommand();
        return;
      }
      if (text === "/settings") {
        this.showSettingsSelector();
        this.editor.setText("");
        return;
      }
      if (text === "/scoped-models") {
        this.editor.setText("");
        await this.showModelsSelector();
        return;
      }
      if (text === "/model" || text.startsWith("/model ")) {
        const searchTerm = text.startsWith("/model ")
          ? text.slice(7).trim()
          : undefined;
        this.editor.setText("");
        await this.handleModelCommand(searchTerm);
        return;
      }
      if (text.startsWith("/export")) {
        await this.handleExportCommand(text);
        this.editor.setText("");
        return;
      }
      if (text.startsWith("/import")) {
        await this.handleImportCommand(text);
        this.editor.setText("");
        return;
      }
      if (text === "/share") {
        await this.handleShareCommand();
        this.editor.setText("");
        return;
      }
      if (text === "/copy") {
        await this.handleCopyCommand();
        this.editor.setText("");
        return;
      }
      if (text === "/name" || text.startsWith("/name ")) {
        this.handleNameCommand(text);
        this.editor.setText("");
        return;
      }
      if (text === "/session") {
        this.handleSessionCommand();
        this.editor.setText("");
        return;
      }
      if (text === "/status") {
        this.handleStatusCommand();
        this.editor.setText("");
        return;
      }
      if (text === "/grok" || text.startsWith("/grok ")) {
        this.editor.setText("");
        await this.handleGrokCommand(text);
        return;
      }
      if (text === "/welcome") {
        this.editor.setText("");
        this.enterStartupHero();
        return;
      }
      if (text === "/sidebar" || text.startsWith("/sidebar ")) {
        this.handleSidebarCommand(text);
        this.editor.setText("");
        return;
      }
      if (text === "/changelog") {
        this.handleChangelogCommand();
        this.editor.setText("");
        return;
      }
      if (text === "/memory" || text.startsWith("/memory ")) {
        this.editor.setText("");
        await this.handleMemoryCommand(text);
        return;
      }
      if (text === "/forget" || text.startsWith("/forget ")) {
        this.editor.setText("");
        await this.handleForgetCommand(text);
        return;
      }
      if (text === "/hotkeys") {
        this.handleHotkeysCommand();
        this.editor.setText("");
        return;
      }
      if (text === "/fork") {
        this.showUserMessageSelector();
        this.editor.setText("");
        return;
      }
      if (text === "/tree") {
        this.showTreeSelector();
        this.editor.setText("");
        return;
      }
      if (text === "/test" || text.startsWith("/test ")) {
        this.editor.setText("");
        await this.handleTestCommand(text);
        return;
      }
      if (text === "/login") {
        this.showOAuthSelector("login");
        this.editor.setText("");
        return;
      }
      if (text === "/logout") {
        this.showOAuthSelector("logout");
        this.editor.setText("");
        return;
      }
      if (text === "/new") {
        this.editor.setText("");
        await this.handleClearCommand();
        return;
      }
      if (text === "/compact" || text.startsWith("/compact ")) {
        const customInstructions = text.startsWith("/compact ")
          ? text.slice(9).trim()
          : undefined;
        this.editor.setText("");
        await this.handleCompactCommand(customInstructions);
        return;
      }
      if (text === "/reload") {
        this.editor.setText("");
        await this.handleReloadCommand();
        return;
      }
      if (text === "/debug") {
        this.handleDebugCommand();
        this.editor.setText("");
        return;
      }
      if (text === "/arminsayshi") {
        this.handleArminSaysHi();
        this.editor.setText("");
        return;
      }
      if (text === "/resume") {
        this.showSessionSelector();
        this.editor.setText("");
        return;
      }
      if (text === "/quit") {
        this.editor.setText("");
        await this.shutdown();
        return;
      }

      // Handle bash command (! for normal, !! for excluded from context)
      if (text.startsWith("!")) {
        const isExcluded = text.startsWith("!!");
        const command = isExcluded
          ? text.slice(2).trim()
          : text.slice(1).trim();
        if (command) {
          if (this.session.isBashRunning) {
            this.showWarning(
              "A bash command is already running. Press Esc to cancel it first.",
            );
            this.editor.setText(text);
            return;
          }
          this.editor.addToHistory?.(text);
          await this.handleBashCommand(command, isExcluded);
          this.isBashMode = false;
          this.updateEditorBorderColor();
          return;
        }
      }

      // Queue input during compaction (extension commands execute immediately)
      if (this.session.isCompacting) {
        if (this.isExtensionCommand(text)) {
          this.editor.addToHistory?.(text);
          this.editor.setText("");
          await this.session.prompt(
            text,
            submitImages?.length ? { images: submitImages } : undefined,
          );
        } else {
          this.queueCompactionMessage(text, "steer", submitImages);
        }
        return;
      }

      // If streaming, use prompt() with steer behavior
      // This handles extension commands (execute immediately), prompt template expansion, and queueing
      if (this.session.isStreaming) {
        this.editor.addToHistory?.(text);
        this.editor.setText("");
        await this.session.prompt(text, {
          streamingBehavior: "steer",
          ...(submitImages?.length ? { images: submitImages } : {}),
        });

        // Auto memory consolidation check
        try {
          const {
            consolidateMemory,
            createMemorySummarizer,
            getMemoryStatus,
            getDefaultAgentName,
          } = await import("../../core/memory-consolidation.js");
          const memCwd = this.sessionManager.getCwd();
          const agent = getDefaultAgentName();
          const summarizer = createMemorySummarizer();
          for (const s of getMemoryStatus(agent, memCwd).scopes) {
            if (s.needsConsolidation) {
              consolidateMemory(agent, s.scope, memCwd, summarizer);
            }
          }
        } catch {}

        this.updatePendingMessagesDisplay();
        this.ui.requestRender();
        return;
      }

      // Normal message submission
      this.exitStartupHero();
      // First, move any pending bash components to chat
      this.flushPendingBashComponents();

      if (this.onInputCallback) {
        this.pendingUserImages = submitImages;
        if (submitImages?.length) {
          this.showStatus(theme.fg("success", "✦ Sending attachment…"));
        }
        this.onInputCallback(text, submitImages);
      }
      this.editor.addToHistory?.(text);
    };
  }

  private subscribeToAgent(): void {
    this.unsubscribe = this.session.subscribe(async (event) => {
      await this.handleEvent(event);
    });
  }

  private async handleEvent(event: AgentSessionEvent): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }

    this.footer.invalidate();

    switch (event.type) {
      case "collaboration_mode_changed":
        this.showStatus(
          event.mode === "plan"
            ? theme.fg("accent", "Plan mode")
            : theme.fg("muted", "Default mode"),
        );
        this.ui.requestRender();
        break;

      case "turn/plan/updated": {
        const lines = [
          `${theme.fg("dim", "•")} ${theme.bold("Updated Plan")}`,
        ];
        if (event.explanation?.trim()) {
          lines.push(`  ${theme.fg("dim", event.explanation.trim())}`);
        }
        for (const item of event.plan) {
          if (item.status === "completed") {
            lines.push(
              `  ${theme.fg("success", "✔")} ${theme.fg("dim", item.step)}`,
            );
          } else if (item.status === "in_progress") {
            lines.push(
              `  ${theme.fg("accent", "□")} ${theme.bold(item.step)}`,
            );
          } else {
            lines.push(`  ${theme.fg("dim", `□ ${item.step}`)}`);
          }
        }
        this.chatContainer.addChild(new Text(lines.join("\n"), 1, 0));
        this.ui.requestRender();
        break;
      }

      case "item/started":
        if (event.item.type === "plan") {
          this.activePlanItemId = event.item.id;
          this.planStreamingBuffer = "";
          this.planStreamingComponent = new Text(
            `${theme.fg("dim", "•")} ${theme.bold("Proposed Plan")}`,
            1,
            0,
          );
          this.chatContainer.addChild(this.planStreamingComponent);
          this.ui.requestRender();
        }
        break;

      case "item/plan/delta":
        if (
          this.planStreamingComponent &&
          this.activePlanItemId === event.itemId
        ) {
          this.planStreamingBuffer += event.delta;
          this.planStreamingComponent.setText(
            `${theme.fg("dim", "•")} ${theme.bold("Proposed Plan")}\n\n${this.planStreamingBuffer}`,
          );
          this.ui.requestRender();
        }
        break;

      case "item/completed":
        if (event.item.type === "plan") {
          const text = `${theme.fg("dim", "•")} ${theme.bold("Proposed Plan")}\n\n${event.item.text}`;
          if (
            this.planStreamingComponent &&
            this.activePlanItemId === event.item.id
          ) {
            this.planStreamingComponent.setText(text);
          } else {
            this.chatContainer.addChild(new Text(text, 1, 0));
          }
          this.planStreamingComponent = undefined;
          this.planStreamingBuffer = "";
          this.activePlanItemId = undefined;
          this.ui.requestRender();
        }
        break;

      case "agent_start":
        // Restore main escape handler if retry handler is still active
        // (retry success event fires later, but we need main handler now)
        if (this.retryEscapeHandler) {
          this.defaultEditor.onEscape = this.retryEscapeHandler;
          this.retryEscapeHandler = undefined;
        }
        if (this.retryLoader) {
          this.retryLoader.stop();
          this.retryLoader = undefined;
        }
        if (this.loadingAnimation) {
          this.loadingAnimation.stop();
        }
        this.statusContainer.clear();

        // Create loading animation with "shimmer" effect support
        this.loadingAnimation = new Loader(
          this.ui,
          (spinner) => theme.fg("accent", spinner),
          (text) => shimmerText(theme, text, "dim", "muted"),
          this.defaultWorkingMessage,
        );

        this.statusContainer.addChild(this.loadingAnimation);
        this.syncHardwareCursorVisibility();
        // Apply any pending working message queued before loader existed
        if (this.pendingWorkingMessage !== undefined) {
          if (this.pendingWorkingMessage) {
            this.loadingAnimation.setMessage(this.pendingWorkingMessage);
            this.scheduleWorkingMessageHide();
          } else {
            this.setAgentWorkingLine(this.defaultWorkingMessage);
          }
          this.pendingWorkingMessage = undefined;
        } else {
          this.setAgentWorkingLine(this.defaultWorkingMessage);
        }
        this.ui.requestRender();
        break;

      case "queue_update":
        this.updatePendingMessagesDisplay();
        this.ui.requestRender();
        break;

      case "message_start":
        if (event.message.role === "custom") {
          this.addMessageToChat(event.message);
          this.ui.requestRender();
        } else if (event.message.role === "user") {
          this.addMessageToChat(event.message);
          if (Array.isArray(event.message.content)) {
            const imageBlocks = event.message.content.filter(
              (c): c is ImageContent => c.type === "image",
            );
            if (imageBlocks.length > 0) {
              const totalBytes = imageBlocks.reduce((sum, img) => {
                try {
                  return sum + Buffer.from(img.data, "base64").length;
                } catch {
                  return sum;
                }
              }, 0);
              const _mimeSummary = Array.from(
                new Set(imageBlocks.map((img) => img.mimeType)),
              ).join(", ");
              this.showStatus(
                theme.fg("success", "✦ Attachment included") +
                  theme.fg("dim", ` • ${this.formatBytesCompact(totalBytes)}`),
              );
            }
          }
          this.updatePendingMessagesDisplay();
          this.ui.requestRender();
        } else if (event.message.role === "assistant") {
          this.ui.setClearOnShrink(false); // Disable aggressive clear during streaming
          this.prependChatTurnSeparator();
          this.streamingComponent = new AssistantMessageComponent(
            undefined,
            this.hideThinkingBlock,
            this.getMarkdownThemeWithSettings(),
            this.hiddenThinkingLabel,
            { requestRender: () => this.ui.requestRender() },
          );
          this.streamingMessage = event.message;
          this.chatContainer.addChild(this.streamingComponent);
          this.streamingComponent.updateContent(this.streamingMessage);
          this.syncLoadingMessageFromAssistantStream(this.streamingMessage);
          this.ui.requestRender();
        }
        break;

      case "message_update":
        if (this.streamingComponent && event.message.role === "assistant") {
          const now = Date.now();
          if (now - this.lastStreamUpdateMs < 32) {
            break;
          }
          this.lastStreamUpdateMs = now;

          // DO NOT HIDE CURSOR - FIXES GHOST SPACES
          this.streamingMessage = event.message;
          this.streamingComponent.updateContent(this.streamingMessage);

          for (const content of this.streamingMessage.content) {
            if (content.type === "toolCall") {
              if (
                content.name === "update_plan" ||
                content.name === "request_user_input"
              ) {
                continue;
              }
              if (!this.pendingTools.has(content.id)) {
                const component = new ToolExecutionComponent(
                  content.name,
                  content.id,
                  content.arguments,
                  this.getToolExecutionOptions(),
                  this.getRegisteredToolDefinition(content.name),
                  this.ui,
                  this.sessionManager.getCwd(),
                );
                component.setExpanded(this.toolOutputExpanded);
                this.chatContainer.addChild(component);
                this.pendingTools.set(content.id, component);
              } else {
                const component = this.pendingTools.get(content.id);
                if (component) {
                  component.updateArgs(content.arguments);
                }
              }
            }
          }
          this.syncLoadingMessageFromAssistantStream(this.streamingMessage);
          this.ui.requestRender();
        }
        break;

      case "message_end":
        if (event.message.role === "user") break;
        if (this.streamingComponent && event.message.role === "assistant") {
          this.streamingMessage = event.message;
          let errorMessage: string | undefined;
          if (this.streamingMessage.stopReason === "aborted") {
            const retryAttempt = this.session.retryAttempt;
            errorMessage =
              retryAttempt > 0
                ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
                : "Operation aborted";
            this.streamingMessage.errorMessage = errorMessage;
          }
          this.streamingComponent.updateContent(this.streamingMessage);

          if (
            this.streamingMessage.stopReason === "aborted" ||
            this.streamingMessage.stopReason === "error"
          ) {
            if (!errorMessage) {
              errorMessage = this.streamingMessage.errorMessage || "Error";
            }
            for (const [, component] of this.pendingTools.entries()) {
              component.updateResult({
                content: [{ type: "text", text: errorMessage }],
                isError: true,
              });
            }
            this.pendingTools.clear();
          } else {
            // Args are now complete - trigger diff computation for edit tools
            for (const [, component] of this.pendingTools.entries()) {
              component.setArgsComplete();
            }
          }
          this.streamingComponent = undefined;
          this.streamingMessage = undefined;
          this.footer.invalidate();

          this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink()); // Restore clear on shrink

          // Re-focus editor and use a normal render to avoid viewport jumps/scroll yank.
          this.ui.setFocus(this.editor);
          this.ui.requestRender();
        }
        this.ui.requestRender();
        break;

      case "tool_execution_start": {
        if (
          event.toolName === "update_plan" ||
          event.toolName === "request_user_input"
        ) {
          break;
        }
        this.activeTerminalTitleState = event.toolName;
        this.updateTerminalTitle();
        if (isEphemeralMemoryTool(event.toolName)) {
          this.hideCompletedMemoryToolCards(event.toolCallId);
        }
        let component = this.pendingTools.get(event.toolCallId);
        if (!component) {
          component = new ToolExecutionComponent(
            event.toolName,
            event.toolCallId,
            event.args,
            this.getToolExecutionOptions(),
            this.getRegisteredToolDefinition(event.toolName),
            this.ui,
            this.sessionManager.getCwd(),
          );
          component.setExpanded(this.toolOutputExpanded);
          this.chatContainer.addChild(component);
          this.pendingTools.set(event.toolCallId, component);
        }
        component.markExecutionStarted();
        this.setAgentWorkingLine(
          getToolWorkingStatusTitle(event.toolName, event.args),
        );
        this.ui.requestRender();
        break;
      }

      case "tool_execution_update": {
        if (
          event.toolName === "update_plan" ||
          event.toolName === "request_user_input"
        ) {
          break;
        }
        const component = this.pendingTools.get(event.toolCallId);
        if (component) {
          component.updateResult(
            { ...event.partialResult, isError: false },
            true,
          );
          this.ui.requestRender();
        }
        break;
      }

      case "tool_execution_end": {
        if (
          event.toolName === "update_plan" ||
          event.toolName === "request_user_input"
        ) {
          break;
        }
        const component = this.pendingTools.get(event.toolCallId);
        if (component) {
          component.updateResult({ ...event.result, isError: event.isError });
          this.pendingTools.delete(event.toolCallId);
          if (this.pendingTools.size === 0) {
            this.activeTerminalTitleState = "writing";
            this.updateTerminalTitle();
          }
          this.ui.requestRender();
        }
        break;
      }

      case "agent_end": {
        this.clearWorkingMessageHideTimer();
        if (this.loadingAnimation) {
          this.loadingAnimation.stop();
          this.loadingAnimation = undefined;
          this.reserveIdleStatusLine();
          this.syncHardwareCursorVisibility();
        }
        if (this.streamingComponent) {
          this.streamingComponent.stopLiveAnimation();
          this.chatContainer.removeChild(this.streamingComponent);
          this.streamingComponent = undefined;
          this.streamingMessage = undefined;
        }
        this.pendingTools.clear();
        this.activeTerminalTitleState = undefined;
        this.updateTerminalTitle();

        await this.checkShutdownRequested();

        this.ui.requestRender();
        break;
      }

      case "compaction_start": {
        // Keep editor active; submissions are queued during compaction.
        this.autoCompactionEscapeHandler = this.defaultEditor.onEscape;
        this.defaultEditor.onEscape = () => {
          this.session.abortCompaction();
        };
        this.statusContainer.clear();
        const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
        const label =
          event.reason === "manual"
            ? `Compacting context... ${cancelHint}`
            : `${event.reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
        this.autoCompactionLoader = new Loader(
          this.ui,
          (spinner) => theme.fg("accent", spinner),
          (text) => theme.fg("muted", text),
          label,
        );
        this.statusContainer.addChild(this.autoCompactionLoader);
        this.ui.requestRender();
        break;
      }

      case "compaction_end": {
        if (this.autoCompactionEscapeHandler) {
          this.defaultEditor.onEscape = this.autoCompactionEscapeHandler;
          this.autoCompactionEscapeHandler = undefined;
        }
        if (this.autoCompactionLoader) {
          this.autoCompactionLoader.stop();
          this.autoCompactionLoader = undefined;
          this.statusContainer.clear();
        }
        if (event.aborted) {
          if (event.reason === "manual") {
            this.showError("Compaction cancelled");
          } else {
            this.showStatus("Auto-compaction cancelled");
          }
        } else if (event.result) {
          this.chatContainer.clear();
          this.rebuildChatFromMessages();
          this.addMessageToChat(
            createCompactionSummaryMessage(
              event.result.summary,
              event.result.tokensBefore,
              new Date().toISOString(),
            ),
          );
          this.footer.invalidate();
        } else if (event.errorMessage) {
          if (event.reason === "manual") {
            this.showError(event.errorMessage);
          } else {
            this.chatContainer.addChild(new Spacer(1));
            this.chatContainer.addChild(
              new Text(theme.fg("error", event.errorMessage), 1, 0),
            );
          }
        }
        void this.flushCompactionQueue({ willRetry: event.willRetry });
        this.ui.requestRender();
        break;
      }

      case "auto_retry_start": {
        // Set up escape to abort retry
        this.retryEscapeHandler = this.defaultEditor.onEscape;
        this.defaultEditor.onEscape = () => {
          this.session.abortRetry();
        };
        // Show retry indicator
        this.statusContainer.clear();
        const delaySeconds = Math.round(event.delayMs / 1000);
        this.retryLoader = new Loader(
          this.ui,
          (spinner) => theme.fg("warning", spinner),
          (text) => theme.fg("muted", text),
          `Retrying (${event.attempt}/${event.maxAttempts}) in ${delaySeconds}s... (${keyText("app.interrupt")} to cancel)`,
        );
        this.statusContainer.addChild(this.retryLoader);
        this.ui.requestRender();
        break;
      }

      case "auto_retry_end": {
        // Restore escape handler
        if (this.retryEscapeHandler) {
          this.defaultEditor.onEscape = this.retryEscapeHandler;
          this.retryEscapeHandler = undefined;
        }
        // Stop loader
        if (this.retryLoader) {
          this.retryLoader.stop();
          this.retryLoader = undefined;
          this.statusContainer.clear();
        }
        // Show error only on final failure (success shows normal response)
        if (!event.success) {
          this.showError(
            `Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`,
          );
        }
        this.ui.requestRender();
        break;
      }
    }
  }

  /** Extract text content from a user message */
  private getUserMessageText(message: Message): string {
    if (message.role !== "user") return "";
    const textBlocks =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content.filter((c: { type: string }) => c.type === "text");
    return textBlocks.map((c) => (c as { text: string }).text).join("");
  }

  private assistantWithText(
    message: AssistantMessage,
    text: string,
  ): AssistantMessage {
    const content: AssistantMessage["content"] = [];
    let inserted = false;
    for (const part of message.content) {
      if (part.type !== "text") {
        content.push(part);
      } else if (!inserted) {
        inserted = true;
        if (text) content.push({ ...part, text });
      }
    }
    if (!inserted && text) content.unshift({ type: "text", text });
    return { ...message, content };
  }

  /** Visual break between transcript turns (Claude Code–style separation). */
  private prependChatTurnSeparator(): void {
    this.chatContainer.addChild(new Spacer(1));
  }

  /**
   * Show a status message in the chat.
   *
   * If multiple status messages are emitted back-to-back (without anything else being added to the chat),
   * we update the previous status line instead of appending new ones to avoid log spam.
   */
  private showStatus(message: string): void {
    const children = this.chatContainer.children;
    const last =
      children.length > 0 ? children[children.length - 1] : undefined;
    const secondLast =
      children.length > 1 ? children[children.length - 2] : undefined;

    if (
      last &&
      secondLast &&
      last === this.lastStatusText &&
      secondLast === this.lastStatusSpacer
    ) {
      this.lastStatusText.setText(theme.fg("dim", `· ${message}`));
      this.ui.requestRender();
      return;
    }

    const spacer = new Spacer(1);
    const text = new Text(theme.fg("dim", `· ${message}`), 1, 0);
    this.chatContainer.addChild(spacer);
    this.chatContainer.addChild(text);
    this.lastStatusSpacer = spacer;
    this.lastStatusText = text;
    this.ui.requestRender();
  }

  private addMessageToChat(
    message: AgentMessage,
    options?: { populateHistory?: boolean },
  ): void {
    this.resetChatScrollIfPinned();
    switch (message.role) {
      case "bashExecution": {
        this.prependChatTurnSeparator();
        const component = new BashExecutionComponent(
          message.command,
          this.ui,
          message.excludeFromContext,
        );
        if (message.output) {
          component.appendOutput(message.output);
        }
        component.setComplete(
          message.exitCode,
          message.cancelled,
          message.truncated
            ? ({ truncated: true } as TruncationResult)
            : undefined,
          message.fullOutputPath,
        );
        this.chatContainer.addChild(component);
        break;
      }
      case "custom": {
        if (message.display) {
          this.prependChatTurnSeparator();
          const renderer = this.session.extensionRunner?.getMessageRenderer(
            message.customType,
          );
          const component = new CustomMessageComponent(
            message,
            renderer,
            this.getMarkdownThemeWithSettings(),
          );
          component.setExpanded(this.toolOutputExpanded);
          this.chatContainer.addChild(component);
        }
        break;
      }
      case "compactionSummary": {
        this.prependChatTurnSeparator();
        const component = new CompactionSummaryMessageComponent(
          message,
          this.getMarkdownThemeWithSettings(),
        );
        component.setExpanded(this.toolOutputExpanded);
        this.chatContainer.addChild(component);
        break;
      }
      case "branchSummary": {
        this.prependChatTurnSeparator();
        const component = new BranchSummaryMessageComponent(
          message,
          this.getMarkdownThemeWithSettings(),
        );
        component.setExpanded(this.toolOutputExpanded);
        this.chatContainer.addChild(component);
        break;
      }
      case "user": {
        const textContent = this.getUserMessageText(message);
        const skillBlock = textContent ? parseSkillBlock(textContent) : null;

        const userOpts = {
          markdownTheme: this.getMarkdownThemeWithSettings(),
          showImages: this.settingsManager.getShowImages(),
          requestRender: () => this.ui.requestRender(),
          showRoleLabel: false,
          timestamp: message.timestamp,
        };

        const imagePartsFromMessage = (): UserRenderablePart[] => {
          if (typeof message.content === "string") return [];
          return message.content
            .filter((c): c is ImageContent => c.type === "image")
            .map((img) => ({ type: "image" as const, image: img }));
        };

        if (!skillBlock) {
          const partsOnly = buildUserRenderablePartsFromMessage(message);
          if (partsOnly.length === 0) {
            break;
          }
        }

        const chatDepthBefore = this.chatContainer.children.length;
        this.prependChatTurnSeparator();

        if (skillBlock) {
          if (chatDepthBefore === 0) {
            this.chatContainer.addChild(new Spacer(1));
          }
          const component = new SkillInvocationMessageComponent(
            skillBlock,
            this.getMarkdownThemeWithSettings(),
          );
          component.setExpanded(this.toolOutputExpanded);
          this.chatContainer.addChild(component);

          const followUpParts: UserRenderablePart[] = [];
          if (skillBlock.userMessage?.trim()) {
            followUpParts.push({
              type: "text",
              text: skillBlock.userMessage.trim(),
            });
          }
          followUpParts.push(...imagePartsFromMessage());
          if (followUpParts.length > 0) {
            this.chatContainer.addChild(
              new UserMessageComponent(followUpParts, userOpts),
            );
          }
        } else {
          const parts = buildUserRenderablePartsFromMessage(message);
          if (parts.length === 0) {
            break;
          }
          this.chatContainer.addChild(
            new UserMessageComponent(parts, userOpts),
          );
        }

        if (options?.populateHistory && textContent) {
          this.editor.addToHistory?.(textContent);
        }
        break;
      }
      case "assistant": {
        this.prependChatTurnSeparator();
        const assistantComponent = new AssistantMessageComponent(
          message,
          this.hideThinkingBlock,
          this.getMarkdownThemeWithSettings(),
          this.hiddenThinkingLabel,
        );
        this.chatContainer.addChild(assistantComponent);
        break;
      }
      case "toolResult": {
        // Tool results are rendered inline with tool calls, handled separately
        break;
      }
      default: {
        const _exhaustive: never = message;
      }
    }
  }

  /**
   * Render session context to chat. Used for initial load and rebuild after compaction.
   * @param sessionContext Session context to render
   * @param options.updateFooter Update footer state
   * @param options.populateHistory Add user messages to editor history
   */
  private renderSessionContext(
    sessionContext: SessionContext,
    options: { updateFooter?: boolean; populateHistory?: boolean } = {},
  ): void {
    this.pendingTools.clear();

    if (options.updateFooter) {
      this.footer.invalidate();
      this.updateEditorBorderColor();
    }

    for (const message of sessionContext.messages) {
      // Assistant messages need special handling for tool calls
      if (message.role === "assistant") {
        const rawText = message.content
          .filter((part): part is { type: "text"; text: string } =>
            part.type === "text",
          )
          .map((part) => part.text)
          .join("");
        const proposedPlan = extractProposedPlanText(rawText);
        const visibleText = stripProposedPlanBlocks(rawText);
        const hasToolCalls = message.content.some(
          (part) => part.type === "toolCall",
        );
        if (visibleText.trim() || hasToolCalls) {
          this.addMessageToChat(this.assistantWithText(message, visibleText));
        }
        if (proposedPlan !== undefined) {
          this.chatContainer.addChild(
            new Text(
              `${theme.fg("dim", "•")} ${theme.bold("Proposed Plan")}\n\n${proposedPlan}`,
              1,
              0,
            ),
          );
        }
        // Render tool call components
        for (const content of message.content) {
          if (content.type === "toolCall") {
            if (
              content.name === "update_plan" ||
              content.name === "request_user_input"
            ) {
              continue;
            }
            const component = new ToolExecutionComponent(
              content.name,
              content.id,
              content.arguments,
              this.getToolExecutionOptions(),
              this.getRegisteredToolDefinition(content.name),
              this.ui,
              this.sessionManager.getCwd(),
            );
            component.setExpanded(this.toolOutputExpanded);
            this.chatContainer.addChild(component);

            if (
              message.stopReason === "aborted" ||
              message.stopReason === "error"
            ) {
              let errorMessage: string;
              if (message.stopReason === "aborted") {
                const retryAttempt = this.session.retryAttempt;
                errorMessage =
                  retryAttempt > 0
                    ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
                    : "Operation aborted";
              } else {
                errorMessage = message.errorMessage || "Error";
              }
              component.updateResult({
                content: [{ type: "text", text: errorMessage }],
                isError: true,
              });
            } else {
              this.pendingTools.set(content.id, component);
            }
          }
        }
      } else if (message.role === "toolResult") {
        // Match tool results to pending tool components
        const component = this.pendingTools.get(message.toolCallId);
        if (component) {
          component.updateResult(message);
          this.pendingTools.delete(message.toolCallId);
        }
      } else {
        // All other messages use standard rendering
        this.addMessageToChat(message, options);
      }
    }

    this.pendingTools.clear();
    this.ui.requestRender();
  }

  renderInitialMessages(): void {
    // Get aligned messages and entries from session context
    const context = this.sessionManager.buildSessionContext();
    this.renderSessionContext(context, {
      updateFooter: true,
      populateHistory: true,
    });

    // Show compaction info if session was compacted
    const allEntries = this.sessionManager.getEntries();
    const compactionCount = allEntries.filter(
      (e) => e.type === "compaction",
    ).length;
    if (compactionCount > 0) {
      const times =
        compactionCount === 1 ? "1 time" : `${compactionCount} times`;
      this.showStatus(`Session compacted ${times}`);
    }
  }

  async getUserInput(): Promise<{ text: string; images?: ImageContent[] }> {
    return new Promise((resolve) => {
      this.onInputCallback = (text: string, images?: ImageContent[]) => {
        this.onInputCallback = undefined;
        resolve({ text, images });
      };
    });
  }

  private rebuildChatFromMessages(): void {
    this.chatContainer.clear();
    const context = this.sessionManager.buildSessionContext();
    this.renderSessionContext(context);
  }

  // =========================================================================
  // Key handlers
  // =========================================================================

  private handleCtrlC(): void {
    if (this.editorImageSlots.size > 0) {
      this.clearAttachmentDrafts();
      this.showStatus(theme.fg("accent", "Attachment cleared"));
      this.lastSigintTime = 0;
      return;
    }

    const now = Date.now();
    if (now - this.lastSigintTime < 500) {
      void this.shutdown();
    } else {
      this.clearEditor();
      this.lastSigintTime = now;
    }
  }

  private handleCtrlD(): void {
    // Only called when editor is empty (enforced by CustomEditor)
    void this.shutdown();
  }

  /**
   * Gracefully shutdown the agent.
   * Emits shutdown event to extensions, then exits.
   */
  private isShuttingDown = false;

  private async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    await this.runtimeHost.dispose();

    // Wait for any pending renders to complete
    // requestRender() uses process.nextTick(), so we wait one tick
    await new Promise((resolve) => process.nextTick(resolve));

    // Drain any in-flight Kitty key release events before stopping.
    // This prevents escape sequences from leaking to the parent shell over slow SSH.
    await this.ui.terminal.drainInput(1000);

    this.stop();
    process.exit(0);
  }

  /**
   * Check if shutdown was requested and perform shutdown if so.
   */
  private async checkShutdownRequested(): Promise<void> {
    if (!this.shutdownRequested) return;
    await this.shutdown();
  }

  private handleCtrlZ(): void {
    // Keep the event loop alive while suspended. Without this, stopping the TUI
    // can leave Node with no ref'ed handles, causing the process to exit on fg
    // before the SIGCONT handler gets a chance to restore the terminal.
    const suspendKeepAlive = setInterval(() => {}, 2 ** 30);

    // Ignore SIGINT while suspended so Ctrl+C in the terminal does not
    // kill the backgrounded process. The handler is removed on resume.
    const ignoreSigint = () => {};
    process.on("SIGINT", ignoreSigint);

    // Set up handler to restore TUI when resumed
    process.once("SIGCONT", () => {
      clearInterval(suspendKeepAlive);
      process.removeListener("SIGINT", ignoreSigint);
      this.ui.start();
      this.ui.requestRender(true);
    });

    try {
      // Stop the TUI (restore terminal to normal mode)
      this.ui.stop();

      // Send SIGTSTP to process group (pid=0 means all processes in group)
      process.kill(0, "SIGTSTP");
    } catch (error) {
      clearInterval(suspendKeepAlive);
      process.removeListener("SIGINT", ignoreSigint);
      throw error;
    }
  }

  private async handleFollowUp(): Promise<void> {
    const raw = this.editor.getExpandedText?.() ?? this.editor.getText();
    if (!raw.trim() && this.editorImageSlots.size === 0) return;

    // Queue input during compaction (extension commands execute immediately)
    if (this.session.isCompacting) {
      if (
        this.editorImageSlots.size > 0 &&
        !this.currentModelSupportsImages()
      ) {
        this.showWarning(
          "Current model does not support vision. Use /model to switch to an image-capable model.",
        );
        this.renderAttachmentBar();
        return;
      }
      const { cleanedText, images, failedCount } =
        this.stripEditorImageMarkersAndCollectImages(raw);
      if (failedCount > 0) {
        this.showWarning(
          `Failed to prepare ${failedCount} image attachment${failedCount === 1 ? "" : "s"}.`,
        );
      }
      const submitImages = images.length > 0 ? images : undefined;
      if (this.isExtensionCommand(cleanedText)) {
        this.editor.addToHistory?.(cleanedText);
        this.editor.setText("");
        await this.session.prompt(
          cleanedText,
          submitImages?.length ? { images: submitImages } : undefined,
        );
      } else {
        this.queueCompactionMessage(cleanedText, "followUp", submitImages);
      }
      return;
    }

    // Alt+Enter queues a follow-up message (waits until agent finishes)
    // This handles extension commands (execute immediately), prompt template expansion, and queueing
    if (this.session.isStreaming) {
      if (
        this.editorImageSlots.size > 0 &&
        !this.currentModelSupportsImages()
      ) {
        this.showWarning(
          "Current model does not support vision. Use /model to switch to an image-capable model.",
        );
        this.renderAttachmentBar();
        return;
      }
      const { cleanedText, images, failedCount } =
        this.stripEditorImageMarkersAndCollectImages(raw);
      if (failedCount > 0) {
        this.showWarning(
          `Failed to prepare ${failedCount} image attachment${failedCount === 1 ? "" : "s"}.`,
        );
      }
      const submitImages = images.length > 0 ? images : undefined;
      this.editor.addToHistory?.(cleanedText);
      this.editor.setText("");
      await this.session.prompt(cleanedText, {
        streamingBehavior: "followUp",
        ...(submitImages?.length ? { images: submitImages } : {}),
      });
      this.updatePendingMessagesDisplay();
      this.ui.requestRender();
      return;
    }
    // If not streaming, Alt+Enter acts like regular Enter (trigger onSubmit)
    if (this.editor.onSubmit) {
      await this.editor.onSubmit(raw);
    }
  }

  private handleDequeue(): void {
    const restored = this.restoreQueuedMessagesToEditor();
    if (restored === 0) {
      this.showStatus("No queued messages to restore");
    } else {
      this.showStatus(
        `Restored ${restored} queued message${restored > 1 ? "s" : ""} to editor`,
      );
    }
  }

  private updateEditorBorderColor(): void {
    if (this.isBashMode) {
      this.editor.borderColor = theme.getBashModeBorderColor();
    } else {
      const level = this.session.thinkingLevel || "off";
      this.editor.borderColor = theme.getThinkingBorderColor(level);
    }
    this.ui.requestRender();
  }

  private cycleThinkingLevel(): void {
    const newLevel = this.session.cycleThinkingLevel();
    if (newLevel === undefined) {
      this.showStatus("Current model does not support thinking");
    } else {
      this.footer.invalidate();
      this.updateEditorBorderColor();
      this.showStatus(`Thinking level: ${newLevel}`);
    }
  }

  private async cycleModel(direction: "forward" | "backward"): Promise<void> {
    try {
      const result = await this.session.cycleModel(direction);
      if (result === undefined) {
        const msg =
          this.session.scopedModels.length > 0
            ? "Only one model in scope"
            : "Only one model available";
        this.showStatus(msg);
      } else {
        this.footer.invalidate();
        this.updateEditorBorderColor();
        const thinkingStr =
          result.model.reasoning && result.thinkingLevel !== "off"
            ? ` (thinking: ${result.thinkingLevel})`
            : "";
        this.showStatus(
          `Switched to ${result.model.name || result.model.id}${thinkingStr}`,
        );
      }
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error));
    }
  }

  private toggleToolOutputExpansion(): void {
    const tools: ToolExecutionComponent[] = this.chatContainer.children.filter(
      (child): child is ToolExecutionComponent =>
        child instanceof ToolExecutionComponent,
    );
    const latest = tools.at(-1);
    if (!latest) {
      this.showStatus("No tool output to inspect");
      return;
    }
    this.toggleToolExpansion(latest);
  }

  private toggleToolExpansion(tool: ToolExecutionComponent): void {
    const tools: Expandable[] = this.chatContainer.children.filter(
      (child): child is Component & Expandable => isExpandable(child),
    );
    const nextExpanded = !(tool.isExpanded?.() ?? false);
    for (const entry of tools) {
      entry.setExpanded(entry === tool ? nextExpanded : false);
    }
    this.showStatus(
      nextExpanded ? "Inspecting tool output" : "Collapsed tool output",
    );
    this.ui.requestRender();
  }

  private setToolsExpanded(expanded: boolean): void {
    // Extension API compatibility: keep broad set behavior for callers that
    // explicitly request it. The user-facing Ctrl+O path above is latest-only.
    this.toolOutputExpanded = expanded;
    for (const child of this.chatContainer.children) {
      if (isExpandable(child)) {
        child.setExpanded(expanded);
      }
    }
    this.ui.requestRender();
  }

  private toggleThinkingBlockVisibility(): void {
    this.hideThinkingBlock = !this.hideThinkingBlock;
    this.settingsManager.setHideThinkingBlock(this.hideThinkingBlock);

    // Rebuild chat from session messages
    this.chatContainer.clear();
    this.rebuildChatFromMessages();

    // If streaming, re-add the streaming component with updated visibility and re-render
    if (this.streamingComponent && this.streamingMessage) {
      this.streamingComponent.setHideThinkingBlock(this.hideThinkingBlock);
      this.streamingComponent.updateContent(this.streamingMessage);
      this.chatContainer.addChild(this.streamingComponent);
    }

    this.showStatus(
      `Thinking blocks: ${this.hideThinkingBlock ? "hidden" : "visible"}`,
    );
  }

  private openExternalEditor(): void {
    // Determine editor (respect $VISUAL, then $EDITOR)
    const editorCmd = process.env.VISUAL || process.env.EDITOR;
    if (!editorCmd) {
      this.showWarning(
        "No editor configured. Set $VISUAL or $EDITOR environment variable.",
      );
      return;
    }

    const currentText =
      this.editor.getExpandedText?.() ?? this.editor.getText();
    const tmpFile = path.join(
      os.tmpdir(),
      `quake-code-editor-${Date.now()}.md`,
    );

    try {
      // Write current content to temp file
      fs.writeFileSync(tmpFile, currentText, "utf-8");

      // Stop TUI to release terminal
      this.ui.stop();

      // Split by space to support editor arguments (e.g., "code --wait")
      const [editor, ...editorArgs] = editorCmd.split(" ");

      // Spawn editor synchronously with inherited stdio for interactive editing
      const result = spawnSync(editor, [...editorArgs, tmpFile], {
        stdio: "inherit",
        shell: process.platform === "win32",
      });

      // On successful exit (status 0), replace editor content
      if (result.status === 0) {
        const newContent = fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, "");
        this.editor.setText(newContent);
      }
      // On non-zero exit, keep original text (no action needed)
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }

      // Restart TUI
      this.ui.start();
      // Force full re-render since external editor uses alternate screen
      this.ui.requestRender(true);
    }
  }

  // =========================================================================
  // UI helpers
  // =========================================================================

  clearEditor(): void {
    this.clearAttachmentDrafts();
    this.editor.setText("");
    this.ui.requestRender();
  }

  private clearAttachmentDrafts(): void {
    this.disposeEditorImageDrafts();
    this.renderAttachmentBar();
  }

  /** Drop pending clipboard images and editor markers (e.g. clear input line). */
  private disposeEditorImageDrafts(): void {
    for (const id of this.editorImageSlots.keys()) {
      (this.editor as CustomEditor).unregisterImageMarker(id);
    }
    this.editorImageSlots.clear();
  }

  showError(errorMessage: string): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new NoticeCard("error", errorMessage));
    this.ui.requestRender();
  }

  showWarning(warningMessage: string): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new NoticeCard("warning", warningMessage));
    this.ui.requestRender();
  }

  showNewVersionNotification(newVersion: string): void {
    const action = theme.fg("accent", "quake update");
    const updateInstruction =
      theme.fg("muted", `Update available: ${newVersion}. Run `) + action;
    const changelogUrl = theme.fg(
      "accent",
      "https://www.npmjs.com/package/@mrquake/quakecode-cli",
    );
    const changelogLine = theme.fg("muted", "Changelog: ") + changelogUrl;

    const cachePath = path.join(getAgentDir(), "update-check.json");
    try {
      let cache: {
        checkedAt?: number;
        latestVersion?: string;
        notifiedVersion?: string;
      } = {};
      if (fs.existsSync(cachePath)) {
        cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      }
      cache.notifiedVersion = newVersion;
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
    } catch {
      // ignore cache write errors
    }

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new DynamicBorder((text) => theme.fg("warning", text)),
    );
    this.chatContainer.addChild(
      new Text(
        `${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction}\n${changelogLine}`,
        1,
        0,
      ),
    );
    this.chatContainer.addChild(
      new DynamicBorder((text) => theme.fg("warning", text)),
    );
    this.ui.requestRender();
  }

  showPackageUpdateNotification(packages: string[]): void {
    const action = theme.fg("accent", `${APP_NAME} update`);
    const updateInstruction =
      theme.fg("muted", "Package updates are available. Run ") + action;
    const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new DynamicBorder((text) => theme.fg("warning", text)),
    );
    this.chatContainer.addChild(
      new Text(
        `${theme.bold(theme.fg("warning", "Package Updates Available"))}\n${updateInstruction}\n${theme.fg("muted", "Packages:")}\n${packageLines}`,
        1,
        0,
      ),
    );
    this.chatContainer.addChild(
      new DynamicBorder((text) => theme.fg("warning", text)),
    );
    this.ui.requestRender();
  }

  /**
   * Get all queued messages (read-only).
   * Combines session queue and compaction queue.
   */
  private formatQueuedPreview(message: CompactionQueuedMessage): string {
    const suffix = message.images?.length
      ? theme.fg(
          "accent",
          ` [${message.images.length} image${message.images.length === 1 ? "" : "s"}]`,
        )
      : "";
    return `${message.text}${suffix}`;
  }

  private getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
    return {
      steering: [
        ...this.session.getSteeringMessages(),
        ...this.compactionQueuedMessages
          .filter((msg) => msg.mode === "steer")
          .map((msg) => this.formatQueuedPreview(msg)),
      ],
      followUp: [
        ...this.session.getFollowUpMessages(),
        ...this.compactionQueuedMessages
          .filter((msg) => msg.mode === "followUp")
          .map((msg) => this.formatQueuedPreview(msg)),
      ],
    };
  }

  /**
   * Clear all queued messages and return their contents.
   * Clears both session queue and compaction queue.
   */
  private clearAllQueues(): { steering: string[]; followUp: string[] } {
    const { steering, followUp } = this.session.clearQueue();
    const compactionSteering = this.compactionQueuedMessages
      .filter((msg) => msg.mode === "steer")
      .map((msg) => msg.text);
    const compactionFollowUp = this.compactionQueuedMessages
      .filter((msg) => msg.mode === "followUp")
      .map((msg) => msg.text);
    this.compactionQueuedMessages = [];
    return {
      steering: [...steering, ...compactionSteering],
      followUp: [...followUp, ...compactionFollowUp],
    };
  }

  private updatePendingMessagesDisplay(): void {
    this.pendingMessagesContainer.clear();
    const { steering: steeringMessages, followUp: followUpMessages } =
      this.getAllQueuedMessages();
    if (steeringMessages.length > 0 || followUpMessages.length > 0) {
      this.pendingMessagesContainer.addChild(new Spacer(1));
      for (const message of steeringMessages) {
        const text = theme.fg("dim", `Steering: ${message}`);
        this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      for (const message of followUpMessages) {
        const text = theme.fg("dim", `Follow-up: ${message}`);
        this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      const dequeueHint = this.getAppKeyDisplay("app.message.dequeue");
      const hintText = theme.fg(
        "dim",
        `↳ ${dequeueHint} to edit all queued messages`,
      );
      this.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
    }
  }

  private restoreQueuedMessagesToEditor(options?: {
    abort?: boolean;
    currentText?: string;
  }): number {
    const { steering, followUp } = this.clearAllQueues();
    const allQueued = [...steering, ...followUp];
    if (allQueued.length === 0) {
      this.updatePendingMessagesDisplay();
      if (options?.abort) {
        this.agent.abort();
      }
      return 0;
    }
    const queuedText = allQueued.join("\n\n");
    const currentText = options?.currentText ?? this.editor.getText();
    const combinedText = [queuedText, currentText]
      .filter((t) => t.trim())
      .join("\n\n");
    this.editor.setText(combinedText);
    this.updatePendingMessagesDisplay();
    if (options?.abort) {
      this.agent.abort();
    }
    return allQueued.length;
  }

  private queueCompactionMessage(
    text: string,
    mode: "steer" | "followUp",
    images?: ImageContent[],
  ): void {
    this.compactionQueuedMessages.push({ text, mode, images });
    this.editor.addToHistory?.(text);
    this.editor.setText("");
    this.updatePendingMessagesDisplay();
    const suffix = images?.length
      ? ` with ${images.length} image${images.length === 1 ? "" : "s"}`
      : "";
    this.showStatus(`Queued message for after compaction${suffix}`);
  }

  private isExtensionCommand(text: string): boolean {
    if (!text.startsWith("/")) return false;

    const extensionRunner = this.session.extensionRunner;
    if (!extensionRunner) return false;

    const spaceIndex = text.indexOf(" ");
    const commandName =
      spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    return !!extensionRunner.getCommand(commandName);
  }

  private async flushCompactionQueue(options?: {
    willRetry?: boolean;
  }): Promise<void> {
    if (this.compactionQueuedMessages.length === 0) {
      return;
    }

    const queuedMessages = [...this.compactionQueuedMessages];
    this.compactionQueuedMessages = [];
    this.updatePendingMessagesDisplay();

    const restoreQueue = (error: unknown) => {
      this.session.clearQueue();
      this.compactionQueuedMessages = queuedMessages;
      this.updatePendingMessagesDisplay();
      this.showError(
        `Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    };

    try {
      if (options?.willRetry) {
        // When retry is pending, queue messages for the retry turn
        for (const message of queuedMessages) {
          if (this.isExtensionCommand(message.text)) {
            await this.session.prompt(
              message.text,
              message.images?.length ? { images: message.images } : undefined,
            );
          } else if (message.mode === "followUp") {
            await this.session.followUp(message.text, message.images);
          } else {
            await this.session.steer(message.text, message.images);
          }
        }
        this.updatePendingMessagesDisplay();
        return;
      }

      // Find first non-extension-command message to use as prompt
      const firstPromptIndex = queuedMessages.findIndex(
        (message) => !this.isExtensionCommand(message.text),
      );
      if (firstPromptIndex === -1) {
        // All extension commands - execute them all
        for (const message of queuedMessages) {
          await this.session.prompt(
            message.text,
            message.images?.length ? { images: message.images } : undefined,
          );
        }
        return;
      }

      // Execute any extension commands before the first prompt
      const preCommands = queuedMessages.slice(0, firstPromptIndex);
      const firstPrompt = queuedMessages[firstPromptIndex];
      const rest = queuedMessages.slice(firstPromptIndex + 1);

      for (const message of preCommands) {
        await this.session.prompt(
          message.text,
          message.images?.length ? { images: message.images } : undefined,
        );
      }

      // Send first prompt (starts streaming)
      const promptPromise = this.session
        .prompt(
          firstPrompt.text,
          firstPrompt.images?.length
            ? { images: firstPrompt.images }
            : undefined,
        )
        .catch((error) => {
          restoreQueue(error);
        });

      // Queue remaining messages
      for (const message of rest) {
        if (this.isExtensionCommand(message.text)) {
          await this.session.prompt(
            message.text,
            message.images?.length ? { images: message.images } : undefined,
          );
        } else if (message.mode === "followUp") {
          await this.session.followUp(message.text, message.images);
        } else {
          await this.session.steer(message.text, message.images);
        }
      }
      this.updatePendingMessagesDisplay();
      void promptPromise;
    } catch (error) {
      restoreQueue(error);
    }
  }

  /** Move pending bash components from pending area to chat */
  private flushPendingBashComponents(): void {
    for (const component of this.pendingBashComponents) {
      this.pendingMessagesContainer.removeChild(component);
      this.chatContainer.addChild(component);
    }
    this.pendingBashComponents = [];
  }

  // =========================================================================
  // Selectors
  // =========================================================================

  private showModalOverlay(
    component: Component & OverlayInteractiveTarget,
    focus: Component,
    options?: OverlayOptions,
  ): () => void {
    let handle: OverlayHandle | undefined;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      this.activeOverlayInteractive = null;
      handle?.hide();
      this.ui.setFocus(this.editor as Component);
      this.inputLayer.syncHoverTracking();
      this.ui.requestRender(true);
    };
    this.activeOverlayInteractive = component;
    this.inputLayer.syncHoverTracking();
    handle = this.ui.showOverlay(component, {
      anchor: "center",
      width: 88,
      minWidth: 64,
      maxHeight: "72%",
      margin: 2,
      background: (text) => theme.bg("userMessageBg", text),
      ...options,
    });
    handle.focus();
    this.ui.setFocus(focus);
    this.ui.requestRender(true);
    return close;
  }

  /**
   * Shows a selector component in place of the editor.
   * @param create Factory that receives a `done` callback and returns the component and focus target
   */
  private showSelector(
    create: (done: () => void) => { component: Component; focus: Component },
    options?: { focusMode?: boolean },
  ): void {
    const headerChildren = options?.focusMode
      ? [...this.headerContainer.children]
      : undefined;
    const widgetAboveChildren = options?.focusMode
      ? [...this.widgetContainerAbove.children]
      : undefined;
    const widgetBelowChildren = options?.focusMode
      ? [...this.widgetContainerBelow.children]
      : undefined;
    const activeFooter = options?.focusMode
      ? this.customFooter || this.footer
      : undefined;

    if (options?.focusMode) {
      this.headerContainer.clear();
      this.widgetContainerAbove.clear();
      this.widgetContainerBelow.clear();
      if (activeFooter) {
        this.ui.removeChild(activeFooter);
      }
    }

    const done = () => {
      if (options?.focusMode) {
        this.headerContainer.clear();
        for (const child of headerChildren ?? [])
          this.headerContainer.addChild(child);
        this.widgetContainerAbove.clear();
        for (const child of widgetAboveChildren ?? [])
          this.widgetContainerAbove.addChild(child);
        this.widgetContainerBelow.clear();
        for (const child of widgetBelowChildren ?? [])
          this.widgetContainerBelow.addChild(child);
        if (activeFooter) {
          this.ui.addChild(activeFooter);
        }
      }
      this.mountEditorContainer();
      this.ui.setFocus(this.editor);
      this.ui.requestRender();
    };
    const { component, focus } = create(done);
    this.editorContainer.clear();
    this.editorContainer.addChild(component);
    this.ui.setFocus(focus);
    this.ui.requestRender();
  }

  private showSettingsSelector(): void {
    let handle: OverlayHandle | undefined;
    let closed = false;
    const returnToHeroOnClose = !this.hasConversationEntries();
    const close = () => {
      if (closed) return;
      closed = true;
      this.activeOverlayInteractive = null;
      handle?.hide();
      if (returnToHeroOnClose && !this.hasConversationEntries()) {
        this.enterStartupHero();
      } else {
        this.ui.setFocus(this.editor as Component);
        this.ui.requestRender(true);
      }
    };
    const selector = new SettingsSelectorComponent(
      {
        autoCompact: this.session.autoCompactionEnabled,
        showImages: this.settingsManager.getShowImages(),
        autoResizeImages: this.settingsManager.getImageAutoResize(),
        blockImages: this.settingsManager.getBlockImages(),
        enableSkillCommands: this.settingsManager.getEnableSkillCommands(),
        steeringMode: this.session.steeringMode,
        followUpMode: this.session.followUpMode,
        transport: this.settingsManager.getTransport(),
        thinkingLevel: this.session.thinkingLevel,
        availableThinkingLevels: this.session.getAvailableThinkingLevels(),
        currentTheme: this.settingsManager.getTheme() || "grok-build",
        availableThemes: getAvailableThemes(),
        hideThinkingBlock: this.hideThinkingBlock,
        collapseChangelog: this.settingsManager.getCollapseChangelog(),
        doubleEscapeAction: this.settingsManager.getDoubleEscapeAction(),
        treeFilterMode: this.settingsManager.getTreeFilterMode(),
        showHardwareCursor: this.settingsManager.getShowHardwareCursor(),
        hardwareCursorShape: this.settingsManager.getHardwareCursorShape(),
        editorPaddingX: this.settingsManager.getEditorPaddingX(),
        autocompleteMaxVisible:
          this.settingsManager.getAutocompleteMaxVisible(),
        quietStartup: this.settingsManager.getQuietStartup(),
        clearOnShrink: this.settingsManager.getClearOnShrink(),
        toolPreviewDensity: this.settingsManager.getToolPreviewDensity(),
      },
      {
        onAutoCompactChange: (enabled) => {
          this.session.setAutoCompactionEnabled(enabled);
          this.footer.setAutoCompactEnabled(enabled);
        },
        onShowImagesChange: (enabled) => {
          this.settingsManager.setShowImages(enabled);
          for (const child of this.chatContainer.children) {
            if (child instanceof ToolExecutionComponent) {
              child.setShowImages(enabled);
            }
          }
        },
        onToolPreviewDensityChange: (density) => {
          this.settingsManager.setToolPreviewDensity(density);
          for (const child of this.chatContainer.children) {
            if (child instanceof ToolExecutionComponent) {
              child.setDensity(density);
            }
          }
          for (const component of this.pendingTools.values()) {
            component.setDensity(density);
          }
        },
        onAutoResizeImagesChange: (enabled) => {
          this.settingsManager.setImageAutoResize(enabled);
        },
        onBlockImagesChange: (blocked) => {
          this.settingsManager.setBlockImages(blocked);
        },
        onEnableSkillCommandsChange: (enabled) => {
          this.settingsManager.setEnableSkillCommands(enabled);
          this.setupAutocomplete(this.fdPath);
        },
        onSteeringModeChange: (mode) => {
          this.session.setSteeringMode(mode);
        },
        onFollowUpModeChange: (mode) => {
          this.session.setFollowUpMode(mode);
        },
        onTransportChange: (transport) => {
          this.settingsManager.setTransport(transport);
          this.session.agent.transport = transport;
        },
        onThinkingLevelChange: (level) => {
          this.session.setThinkingLevel(level);
          this.footer.invalidate();
          this.updateEditorBorderColor();
        },
        onThemeChange: (themeName) => {
          const result = setTheme(themeName, true);
          this.settingsManager.setTheme(themeName);
          this.ui.invalidate();
          if (!result.success) {
            this.showError(
              `Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`,
            );
          }
        },
        onThemePreview: (themeName) => {
          const result = setTheme(themeName, true);
          if (result.success) {
            this.ui.invalidate();
            this.ui.requestRender();
          }
        },
        onHideThinkingBlockChange: (hidden) => {
          this.hideThinkingBlock = hidden;
          this.settingsManager.setHideThinkingBlock(hidden);
          for (const child of this.chatContainer.children) {
            if (child instanceof AssistantMessageComponent) {
              child.setHideThinkingBlock(hidden);
            }
          }
          this.chatContainer.clear();
          this.rebuildChatFromMessages();
        },
        onCollapseChangelogChange: (collapsed) => {
          this.settingsManager.setCollapseChangelog(collapsed);
        },
        onQuietStartupChange: (enabled) => {
          this.settingsManager.setQuietStartup(enabled);
        },
        onDoubleEscapeActionChange: (action) => {
          this.settingsManager.setDoubleEscapeAction(action);
        },
        onTreeFilterModeChange: (mode) => {
          this.settingsManager.setTreeFilterMode(mode);
        },
        onShowHardwareCursorChange: (enabled) => {
          this.settingsManager.setShowHardwareCursor(enabled);
          this.syncHardwareCursorVisibility();
        },
        onHardwareCursorShapeChange: (shape) => {
          this.settingsManager.setHardwareCursorShape(shape);
          this.ui.setHardwareCursorShape(shape);
        },
        onEditorPaddingXChange: (padding) => {
          this.settingsManager.setEditorPaddingX(padding);
          this.defaultEditor.setPaddingX(padding);
          if (
            this.editor !== this.defaultEditor &&
            this.editor.setPaddingX !== undefined
          ) {
            this.editor.setPaddingX(padding);
          }
        },
        onAutocompleteMaxVisibleChange: (maxVisible) => {
          this.settingsManager.setAutocompleteMaxVisible(maxVisible);
          this.defaultEditor.setAutocompleteMaxVisible(maxVisible);
          if (
            this.editor !== this.defaultEditor &&
            this.editor.setAutocompleteMaxVisible !== undefined
          ) {
            this.editor.setAutocompleteMaxVisible(maxVisible);
          }
        },
        onClearOnShrinkChange: (enabled) => {
          this.settingsManager.setClearOnShrink(enabled);
          this.ui.setClearOnShrink(enabled);
        },
        onCancel: () => close(),
      },
    );
    this.activeOverlayInteractive = selector;
    handle = this.ui.showOverlay(selector, {
      anchor: "center",
      width: 88,
      minWidth: 68,
      maxHeight: "78%",
      margin: 2,
      background: (text) => theme.bg("userMessageBg", text),
    });
    handle.focus();
    this.ui.setFocus(selector.getSettingsList() as Component);
    this.ui.requestRender(true);
  }

  private async handleTestCommand(commandText = "/test"): Promise<void> {
    const parsed = parseOsTestCommand(commandText);

    if (parsed.mode === "quick") {
      this.showStatus(
        theme.fg("accent", "✦ Initiating Local OS Sanity Test..."),
      );
      const executor = new OsTestExecutor();
      // We pass the session context for tool execution
      const result = await executor.runNotepadSanityTest(this.session);
      this.showStatus(theme.fg("success", result));
      return;
    }

    const statusText =
      parsed.mode === "autonomous"
        ? "✦ Initiating Autonomous OS Test..."
        : "✦ Initiating Visual UI Audit...";
    this.showStatus(theme.fg("accent", statusText));
    await this.session.sendUserMessage(buildOsTestPrompt(parsed));
  }

  private async handleModelCommand(searchTerm?: string): Promise<void> {
    if (!searchTerm) {
      this.showModelSelector();
      return;
    }

    const model = await this.findExactModelMatch(searchTerm);
    if (model) {
      try {
        await this.session.setModel(model);
        this.footer.invalidate();
        this.updateEditorBorderColor();
        this.showStatus(`Model: ${model.id}`);
        this.checkDaxnutsEasterEgg(model);
      } catch (error) {
        this.showError(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    this.showModelSelector(searchTerm);
  }

  private async findExactModelMatch(
    searchTerm: string,
  ): Promise<Model<any> | undefined> {
    const models = await this.getModelCandidates();
    return findExactModelReferenceMatch(searchTerm, models);
  }

  private async getModelCandidates(): Promise<Model<any>[]> {
    if (this.session.scopedModels.length > 0) {
      return this.session.scopedModels.map((scoped) => scoped.model);
    }

    this.session.modelRegistry.refresh();
    try {
      return await this.session.modelRegistry.getAvailable();
    } catch {
      return [];
    }
  }

  /** Update the footer's available provider count from current model candidates */
  private async updateAvailableProviderCount(): Promise<void> {
    const models = await this.getModelCandidates();
    const uniqueProviders = new Set(models.map((m) => m.provider));
    this.footerDataProvider.setAvailableProviderCount(uniqueProviders.size);
  }

  private showModelSelector(initialSearchInput?: string): void {
    let handle: OverlayHandle | undefined;
    let closed = false;
    const returnToHeroOnClose = !this.hasConversationEntries();
    const close = () => {
      if (closed) return;
      closed = true;
      this.activeOverlayInteractive = null;
      handle?.hide();
      if (returnToHeroOnClose && !this.hasConversationEntries()) {
        this.enterStartupHero();
      } else {
        this.ui.setFocus(this.editor as Component);
        this.ui.requestRender(true);
      }
    };

    const selector = new ModelSelectorComponent(
      this.ui,
      this.session.model,
      this.settingsManager,
      this.session.modelRegistry,
      this.session.scopedModels,
      async (model) => {
        try {
          await this.session.setModel(model);
          this.footer.invalidate();
          this.updateEditorBorderColor();
          close();
          this.showStatus(`Model: ${model.id}`);
          this.checkDaxnutsEasterEgg(model);
        } catch (error) {
          close();
          this.showError(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
      () => close(),
      initialSearchInput,
    );

    this.activeOverlayInteractive = selector;
    handle = this.ui.showOverlay(selector, {
      anchor: "center",
      width: 88,
      minWidth: 64,
      maxHeight: "64%",
      margin: 3,
      background: (text) => theme.bg("userMessageBg", text),
    });
    this.ui.requestRender(true);
  }

  private async showModelsSelector(): Promise<void> {
    // Get all available models
    this.session.modelRegistry.refresh();
    const allModels = this.session.modelRegistry.getAvailable();

    if (allModels.length === 0) {
      this.showStatus("No models available");
      return;
    }

    // Check if session has scoped models (from previous session-only changes or CLI --models)
    const sessionScopedModels = this.session.scopedModels;
    const hasSessionScope = sessionScopedModels.length > 0;

    // Build enabled model IDs from session state or settings
    const enabledModelIds = new Set<string>();
    let hasFilter = false;

    if (hasSessionScope) {
      // Use current session's scoped models
      for (const sm of sessionScopedModels) {
        enabledModelIds.add(`${sm.model.provider}/${sm.model.id}`);
      }
      hasFilter = true;
    } else {
      // Fall back to settings
      const patterns = this.settingsManager.getEnabledModels();
      if (patterns !== undefined && patterns.length > 0) {
        hasFilter = true;
        const scopedModels = await resolveModelScope(
          patterns,
          this.session.modelRegistry,
        );
        for (const sm of scopedModels) {
          enabledModelIds.add(`${sm.model.provider}/${sm.model.id}`);
        }
      }
    }

    // Track current enabled state (session-only until persisted)
    const currentEnabledIds = new Set(enabledModelIds);
    let currentHasFilter = hasFilter;

    // Helper to update session's scoped models (session-only, no persist)
    const updateSessionModels = async (enabledIds: Set<string>) => {
      if (enabledIds.size > 0 && enabledIds.size < allModels.length) {
        const newScopedModels = await resolveModelScope(
          Array.from(enabledIds),
          this.session.modelRegistry,
        );
        this.session.setScopedModels(
          newScopedModels.map((sm) => ({
            model: sm.model,
            thinkingLevel: sm.thinkingLevel,
          })),
        );
      } else {
        // All enabled or none enabled = no filter
        this.session.setScopedModels([]);
      }
      await this.updateAvailableProviderCount();
      this.ui.requestRender();
    };

    let close!: () => void;
    const selector = new ScopedModelsSelectorComponent(
      {
        allModels,
        enabledModelIds: currentEnabledIds,
        hasEnabledModelsFilter: currentHasFilter,
      },
      {
        onModelToggle: async (modelId, enabled) => {
          if (enabled) {
            currentEnabledIds.add(modelId);
          } else {
            currentEnabledIds.delete(modelId);
          }
          currentHasFilter = true;
          await updateSessionModels(currentEnabledIds);
        },
        onEnableAll: async (allModelIds) => {
          currentEnabledIds.clear();
          for (const id of allModelIds) {
            currentEnabledIds.add(id);
          }
          currentHasFilter = false;
          await updateSessionModels(currentEnabledIds);
        },
        onClearAll: async () => {
          currentEnabledIds.clear();
          currentHasFilter = true;
          await updateSessionModels(currentEnabledIds);
        },
        onToggleProvider: async (_provider, modelIds, enabled) => {
          for (const id of modelIds) {
            if (enabled) {
              currentEnabledIds.add(id);
            } else {
              currentEnabledIds.delete(id);
            }
          }
          currentHasFilter = true;
          await updateSessionModels(currentEnabledIds);
        },
        onPersist: (enabledIds) => {
          const newPatterns =
            enabledIds.length === allModels.length ? undefined : enabledIds;
          this.settingsManager.setEnabledModels(newPatterns);
          this.showStatus("Model selection saved to settings");
        },
        onCancel: () => close(),
      },
    );
    close = this.showModalOverlay(selector, selector);
  }

  private showUserMessageSelector(): void {
    const userMessages = this.session.getUserMessagesForForking();

    if (userMessages.length === 0) {
      this.showStatus("No messages to fork from");
      return;
    }

    let close!: () => void;
    const selector = new UserMessageSelectorComponent(
      userMessages.map((m: any) => ({ id: m.entryId, text: m.text })),
      async (entryId) => {
        const result = await this.runtimeHost.fork(entryId);
        if (result.cancelled) {
          close();
          return;
        }
        await this.handleRuntimeSessionChange();
        this.renderCurrentSessionState();
        this.editor.setText(result.selectedText ?? "");
        close();
        this.showStatus("Branched to new session");
      },
      () => close(),
    );
    close = this.showModalOverlay(selector, selector);
  }

  private showTreeSelector(initialSelectedId?: string): void {
    const tree = this.sessionManager.getTree();
    const realLeafId = this.sessionManager.getLeafId();
    const initialFilterMode = this.settingsManager.getTreeFilterMode();

    if (tree.length === 0) {
      this.showStatus("No entries in session");
      return;
    }

    let close!: () => void;
    const selector = new TreeSelectorComponent(
      tree,
      realLeafId,
      this.ui.terminal.rows,
      async (entryId) => {
        if (entryId === realLeafId) {
          close();
          this.showStatus("Already at this point");
          return;
        }

        close();

        let wantsSummary = false;
        let customInstructions: string | undefined;

        if (!this.settingsManager.getBranchSummarySkipPrompt()) {
          while (true) {
            const summaryChoice = await this.showExtensionSelector(
              "Summarize branch?",
              ["No summary", "Summarize", "Summarize with custom prompt"],
            );

            if (summaryChoice === undefined) {
              this.showTreeSelector(entryId);
              return;
            }

            wantsSummary = summaryChoice !== "No summary";

            if (summaryChoice === "Summarize with custom prompt") {
              customInstructions = await this.showExtensionEditor(
                "Custom summarization instructions",
              );
              if (customInstructions === undefined) {
                continue;
              }
            }

            break;
          }
        }

        let summaryLoader: Loader | undefined;
        const originalOnEscape = this.defaultEditor.onEscape;

        if (wantsSummary) {
          this.defaultEditor.onEscape = () => {
            this.session.abortBranchSummary();
          };
          this.chatContainer.addChild(new Spacer(1));
          summaryLoader = new Loader(
            this.ui,
            (spinner) => theme.fg("accent", spinner),
            (text) => theme.fg("muted", text),
            `Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
          );
          this.statusContainer.addChild(summaryLoader);
          this.ui.requestRender();
        }

        try {
          const result = await this.session.navigateTree(entryId, {
            summarize: wantsSummary,
            customInstructions,
          });

          if (result.aborted) {
            this.showStatus("Branch summarization cancelled");
            this.showTreeSelector(entryId);
            return;
          }
          if (result.cancelled) {
            this.showStatus("Navigation cancelled");
            return;
          }

          this.chatContainer.clear();
          this.renderInitialMessages();
          if (result.editorText && !this.editor.getText().trim()) {
            this.editor.setText(result.editorText);
          }
          this.showStatus("Navigated to selected point");
        } catch (error) {
          this.showError(
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          if (summaryLoader) {
            summaryLoader.stop();
            this.statusContainer.clear();
          }
          this.defaultEditor.onEscape = originalOnEscape;
        }
      },
      () => close(),
      (entryId, label) => {
        this.sessionManager.appendLabelChange(entryId, label);
        this.ui.requestRender();
      },
      initialSelectedId,
      initialFilterMode,
    );
    close = this.showModalOverlay(selector, selector);
  }

  private showSessionSelector(): void {
    let handle: OverlayHandle | undefined;
    let closed = false;
    const returnToHeroOnClose = !this.hasConversationEntries();
    const close = (options: { returnToHero?: boolean } = {}) => {
      if (closed) return;
      closed = true;
      this.activeOverlayInteractive = null;
      handle?.hide();
      const shouldReturnToHero = options.returnToHero ?? true;
      if (
        shouldReturnToHero &&
        returnToHeroOnClose &&
        !this.hasConversationEntries()
      ) {
        this.enterStartupHero();
      } else {
        this.ui.setFocus(this.editor as Component);
        this.ui.requestRender(true);
      }
    };

    const selector = new SessionSelectorComponent(
      (onProgress) =>
        SessionManager.list(
          this.sessionManager.getCwd(),
          this.sessionManager.getSessionDir(),
          onProgress,
        ),
      SessionManager.listAll,
      async (sessionPath) => {
        // Do not return to the startup hero while a session switch is in-flight.
        // The resumed session should restore the normal chat/input layout.
        close({ returnToHero: false });
        await this.handleResumeSession(sessionPath);
      },
      () => close(),
      () => {
        void this.shutdown();
      },
      () => this.ui.requestRender(),
      {
        renameSession: async (
          sessionFilePath: string,
          nextName: string | undefined,
        ) => {
          const next = (nextName ?? "").trim();
          if (!next) return;
          const mgr = SessionManager.open(sessionFilePath);
          mgr.appendSessionInfo(next);
        },
        showRenameHint: true,
        keybindings: this.keybindings,
      },

      this.sessionManager.getSessionFile(),
      this.sessionManager.getCwd(),
    );
    this.activeOverlayInteractive = selector;
    handle = this.ui.showOverlay(selector, {
      anchor: "center",
      width: "72%",
      minWidth: 76,
      maxHeight: "78%",
      margin: 2,
      background: (text) => theme.bg("userMessageBg", text),
    });
    this.ui.requestRender(true);
  }

  private async handleResumeSession(sessionPath: string): Promise<void> {
    if (this.loadingAnimation) {
      this.loadingAnimation.stop();
      this.loadingAnimation = undefined;
      this.syncHardwareCursorVisibility();
    }
    this.reserveIdleStatusLine();
    const result = await this.runtimeHost.switchSession(sessionPath);
    if (result.cancelled) {
      this.ui.setFocus(this.editor as Component);
      this.ui.requestRender(true);
      return;
    }
    if (this.startupHeroActive) {
      this.exitStartupHero();
    }
    await this.handleRuntimeSessionChange();
    this.renderCurrentSessionState();
    this.showStatus("Resumed session");
    this.ui.setFocus(this.editor as Component);
    this.ui.requestRender(true);
  }

  private async showOAuthSelector(mode: "login" | "logout"): Promise<void> {
    if (mode === "logout") {
      const providers = this.session.modelRegistry.authStorage.list();
      const loggedInProviders = providers.filter(
        (p) => this.session.modelRegistry.authStorage.get(p)?.type === "oauth",
      );
      if (loggedInProviders.length === 0) {
        this.showStatus("No OAuth providers logged in. Use /login first.");
        return;
      }
    }

    let close!: () => void;
    const selector = new OAuthSelectorComponent(
      mode,
      this.session.modelRegistry.authStorage,
      async (providerId: string) => {
        close();

        if (mode === "login") {
          if (providerId === "openrouter") {
            await this.showApiKeyLoginDialog("openrouter", "OpenRouter");
          } else {
            await this.showLoginDialog(providerId);
          }
        } else {
          const providerInfo = this.session.modelRegistry.authStorage
            .getOAuthProviders()
            .find((p) => p.id === providerId);
          const providerName =
            providerInfo?.name ||
            (providerId === "openrouter" ? "OpenRouter" : providerId);

          try {
            this.session.modelRegistry.authStorage.logout(providerId);
            this.session.modelRegistry.refresh();
            await this.updateAvailableProviderCount();
            this.showStatus(`Logged out of ${providerName}`);
          } catch (error: unknown) {
            this.showError(
              `Logout failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      },
      () => close(),
    );
    close = this.showModalOverlay(selector, selector);
  }

  private async showApiKeyLoginDialog(
    providerId: string,
    providerName: string,
  ): Promise<void> {
    const key = await this.showExtensionEditor(`${providerName} API key`);
    const trimmed = key?.trim();
    if (!trimmed) {
      this.showStatus(`${providerName} login cancelled`);
      return;
    }
    try {
      this.session.modelRegistry.authStorage.set(providerId, {
        type: "api_key",
        key: trimmed,
      });
      this.session.modelRegistry.refresh();
      await this.updateAvailableProviderCount();
      this.showStatus(
        `Saved ${providerName} API key to ${getAuthPath()}\nTry /model and search for qwen, or run: /model openrouter/qwen/qwen3.6-plus:free`,
      );
    } catch (error: unknown) {
      this.showError(
        `Failed to save ${providerName} API key: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async showLoginDialog(providerId: string): Promise<void> {
    const providerInfo = this.session.modelRegistry.authStorage
      .getOAuthProviders()
      .find((p) => p.id === providerId);
    const providerName = providerInfo?.name || providerId;

    // Providers that use callback servers (can paste redirect URL)
    const usesCallbackServer = providerInfo?.usesCallbackServer ?? false;

    // Create login dialog component
    const dialog = new LoginDialogComponent(
      this.ui,
      providerId,
      (_success, _message) => {
        // Completion handled below
      },
    );

    // Show dialog in editor container
    this.editorContainer.clear();
    this.editorContainer.addChild(dialog);
    this.ui.setFocus(dialog);
    this.ui.requestRender();

    // Promise for manual code input (racing with callback server)
    let manualCodeResolve: ((code: string) => void) | undefined;
    let manualCodeReject: ((err: Error) => void) | undefined;
    const manualCodePromise = new Promise<string>((resolve, reject) => {
      manualCodeResolve = resolve;
      manualCodeReject = reject;
    });

    // Restore editor helper
    const restoreEditor = () => {
      this.mountEditorContainer();
      this.ui.setFocus(this.editor);
      this.ui.requestRender();
    };

    try {
      await this.session.modelRegistry.authStorage.login(
        providerId as OAuthProviderId,
        {
          onAuth: (info: { url: string; instructions?: string }) => {
            dialog.showAuth(info.url, info.instructions);

            if (usesCallbackServer) {
              // Show input for manual paste, racing with callback
              dialog
                .showManualInput(
                  "Paste redirect URL below, or complete login in browser:",
                )
                .then((value) => {
                  if (value && manualCodeResolve) {
                    manualCodeResolve(value);
                    manualCodeResolve = undefined;
                  }
                })
                .catch(() => {
                  if (manualCodeReject) {
                    manualCodeReject(new Error("Login cancelled"));
                    manualCodeReject = undefined;
                  }
                });
            } else if (providerId === "github-copilot") {
              // GitHub Copilot polls after onAuth
              dialog.showWaiting("Waiting for browser authentication...");
            }
            // For Anthropic: onPrompt is called immediately after
          },

          onPrompt: async (prompt: {
            message: string;
            placeholder?: string;
          }) => {
            return dialog.showPrompt(prompt.message, prompt.placeholder);
          },

          onProgress: (message: string) => {
            dialog.showProgress(message);
          },

          onManualCodeInput: () => manualCodePromise,

          signal: dialog.signal,
        },
      );

      // Success
      restoreEditor();
      this.session.modelRegistry.refresh();
      await this.updateAvailableProviderCount();
      this.showStatus(
        `Logged in to ${providerName}. Credentials saved to ${getAuthPath()}`,
      );
    } catch (error: unknown) {
      restoreEditor();
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg !== "Login cancelled") {
        this.showError(`Failed to login to ${providerName}: ${errorMsg}`);
      }
    }
  }

  // =========================================================================
  // Command handlers
  // =========================================================================

  private async handleReloadCommand(): Promise<void> {
    if (this.session.isStreaming) {
      this.showWarning(
        "Wait for the current response to finish before reloading.",
      );
      return;
    }
    if (this.session.isCompacting) {
      this.showWarning("Wait for compaction to finish before reloading.");
      return;
    }

    this.resetExtensionUI();

    const loader = new BorderedLoader(
      this.ui,
      theme,
      "Reloading keybindings, extensions, skills, prompts, themes...",
      {
        cancellable: false,
      },
    );
    this.editorContainer.clear();
    this.editorContainer.addChild(loader);
    this.ui.setFocus(loader);
    this.ui.requestRender();

    const dismissLoader = () => {
      loader.dispose();
      this.mountEditorContainer();
      this.ui.setFocus(this.editor);
      this.ui.requestRender();
    };

    try {
      await this.session.reload();
      this.keybindings.reload();
      setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
      this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
      const themeName = this.settingsManager.getTheme();
      const themeResult = themeName
        ? setTheme(themeName, true)
        : { success: true };
      if (!themeResult.success) {
        this.showError(
          `Failed to load theme "${themeName}": ${themeResult.error}\nFell back to dark theme.`,
        );
      }
      const editorPaddingX = this.settingsManager.getEditorPaddingX();
      const autocompleteMaxVisible =
        this.settingsManager.getAutocompleteMaxVisible();
      this.defaultEditor.setPaddingX(editorPaddingX);
      this.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
      if (this.editor !== this.defaultEditor) {
        this.editor.setPaddingX?.(editorPaddingX);
        this.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
      }
      this.ui.setShowHardwareCursor(
        this.settingsManager.getShowHardwareCursor(),
      );
      this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
      this.setupAutocomplete(this.fdPath);
      const runner = this.session.extensionRunner;
      if (runner) {
        this.setupExtensionShortcuts(runner);
      }
      this.rebuildChatFromMessages();
      dismissLoader();
      this.showLoadedResources({
        force: false,
        showDiagnosticsWhenQuiet: true,
      });
      const modelsJsonError = this.session.modelRegistry.getError();
      if (modelsJsonError) {
        this.showError(`models.json error: ${modelsJsonError}`);
      }
      this.showStatus(
        "Reloaded keybindings, extensions, skills, prompts, themes",
      );
    } catch (error) {
      dismissLoader();
      this.showError(
        `Reload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleExportCommand(text: string): Promise<void> {
    const parts = text.split(/\s+/);
    const outputPath = parts.length > 1 ? parts[1] : undefined;

    try {
      if (outputPath?.endsWith(".jsonl")) {
        const filePath = this.session.exportToJsonl(outputPath);
        this.showStatus(`Session exported to: ${filePath}`);
      } else {
        const filePath = await this.session.exportToHtml(outputPath);
        this.showStatus(`Session exported to: ${filePath}`);
      }
    } catch (error: unknown) {
      this.showError(
        `Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private async handleImportCommand(text: string): Promise<void> {
    const parts = text.split(/\s+/);
    if (parts.length < 2 || !parts[1]) {
      this.showError("Usage: /import <path.jsonl>");
      return;
    }
    const inputPath = parts[1];

    const confirmed = await this.showExtensionConfirm(
      "Import session",
      `Replace current session with ${inputPath}?`,
    );
    if (!confirmed) {
      this.showStatus("Import cancelled");
      return;
    }

    try {
      if (this.loadingAnimation) {
        this.loadingAnimation.stop();
        this.loadingAnimation = undefined;
        this.syncHardwareCursorVisibility();
      }
      this.statusContainer.clear();
      const result = await this.runtimeHost.importFromJsonl(inputPath);
      if (result.cancelled) {
        this.showStatus("Import cancelled");
        return;
      }
      await this.handleRuntimeSessionChange();
      this.renderCurrentSessionState();
      this.showStatus(`Session imported from: ${inputPath}`);
    } catch (error: unknown) {
      this.showError(
        `Failed to import session: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private async handleShareCommand(): Promise<void> {
    // Check if gh is available and logged in
    try {
      const authResult = spawnSync("gh", ["auth", "status"], {
        encoding: "utf-8",
      });
      if (authResult.status !== 0) {
        this.showError(
          "GitHub CLI is not logged in. Run 'gh auth login' first.",
        );
        return;
      }
    } catch {
      this.showError(
        "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/",
      );
      return;
    }

    // Export to a temp file
    const tmpFile = path.join(os.tmpdir(), "session.html");
    try {
      await this.session.exportToHtml(tmpFile);
    } catch (error: unknown) {
      this.showError(
        `Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return;
    }

    // Show cancellable loader, replacing the editor
    const loader = new BorderedLoader(this.ui, theme, "Creating gist...");
    this.editorContainer.clear();
    this.editorContainer.addChild(loader);
    this.ui.setFocus(loader);
    this.ui.requestRender();

    const restoreEditor = () => {
      loader.dispose();
      this.mountEditorContainer();
      this.ui.setFocus(this.editor);
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
    };

    // Create a secret gist asynchronously
    let proc: ReturnType<typeof spawn> | null = null;

    loader.onAbort = () => {
      proc?.kill();
      restoreEditor();
      this.showStatus("Share cancelled");
    };

    try {
      const result = await new Promise<{
        stdout: string;
        stderr: string;
        code: number | null;
      }>((resolve) => {
        proc = spawn("gh", ["gist", "create", "--public=false", tmpFile]);
        let stdout = "";
        let stderr = "";
        proc.stdout?.on("data", (data) => {
          stdout += data.toString();
        });
        proc.stderr?.on("data", (data) => {
          stderr += data.toString();
        });
        proc.on("close", (code) => resolve({ stdout, stderr, code }));
      });

      if (loader.signal.aborted) return;

      restoreEditor();

      if (result.code !== 0) {
        const errorMsg = result.stderr?.trim() || "Unknown error";
        this.showError(`Failed to create gist: ${errorMsg}`);
        return;
      }

      // Extract gist ID from the URL returned by gh
      // gh returns something like: https://gist.github.com/username/GIST_ID
      const gistUrl = result.stdout?.trim();
      const gistId = gistUrl?.split("/").pop();
      if (!gistId) {
        this.showError("Failed to parse gist ID from gh output");
        return;
      }

      // Create the preview URL
      const previewUrl = getShareViewerUrl(gistId);
      this.showStatus(`Share URL: ${previewUrl}\nGist: ${gistUrl}`);
    } catch (error: unknown) {
      if (!loader.signal.aborted) {
        restoreEditor();
        this.showError(
          `Failed to create gist: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  }

  private async handleCopyCommand(): Promise<void> {
    const text = this.session.getLastAssistantText();
    if (!text) {
      this.showError("No agent messages to copy yet.");
      return;
    }

    try {
      await copyToClipboard(text);
      this.showStatus("Copied last agent message to clipboard");
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error));
    }
  }

  private handleNameCommand(text: string): void {
    const name = text.replace(/^\/name\s*/, "").trim();
    if (!name) {
      const currentName = this.sessionManager.getSessionName();
      if (currentName) {
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(
          new Text(theme.fg("dim", `Session name: ${currentName}`), 1, 0),
        );
      } else {
        this.showWarning("Usage: /name <name>");
      }
      this.ui.requestRender();
      return;
    }

    this.sessionManager.appendSessionInfo(name);
    this.updateTerminalTitle();
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Text(theme.fg("dim", `Session name set: ${name}`), 1, 0),
    );
    this.ui.requestRender();
  }

  private handleSessionCommand(): void {
    const stats = this.session.getSessionStats();
    const sessionName = this.sessionManager.getSessionName();
    const sessionFile = stats.sessionFile ?? "In-memory session";
    const labelWidth = 13;
    const line = (label: string, value: string | number) => {
      const padded = `${label}:`.padEnd(labelWidth, " ");
      return `${theme.fg("dim", padded)} ${value}`;
    };

    const overview = [
      theme.bold(theme.fg("accent", "Session Overview")),
      sessionName ? line("Name", sessionName) : undefined,
      line("ID", stats.sessionId),
      line("File", sessionFile),
      line("Messages", `${stats.totalMessages} total`),
      line("Tokens", `${stats.tokens.total.toLocaleString()} total`),
    ]
      .filter(Boolean)
      .join("\n");

    const messages = [
      theme.bold(theme.fg("accent", "Messages")),
      line("User", stats.userMessages),
      line("Assistant", stats.assistantMessages),
      line("Tool calls", stats.toolCalls),
      line("Tool results", stats.toolResults),
      line("Total", stats.totalMessages),
    ].join("\n");

    const tokenLines = [
      theme.bold(theme.fg("accent", "Tokens")),
      line("Input", stats.tokens.input.toLocaleString()),
      line("Output", stats.tokens.output.toLocaleString()),
    ];
    if (stats.tokens.cacheRead > 0)
      tokenLines.push(
        line("Cache read", stats.tokens.cacheRead.toLocaleString()),
      );
    if (stats.tokens.cacheWrite > 0)
      tokenLines.push(
        line("Cache write", stats.tokens.cacheWrite.toLocaleString()),
      );
    tokenLines.push(line("Total", stats.tokens.total.toLocaleString()));
    if (stats.cost > 0)
      tokenLines.push(line("Cost", `$${stats.cost.toFixed(4)}`));
    const tokens = tokenLines.join("\n");

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder());
    this.chatContainer.addChild(new Text(overview, 1, 0));
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Text(messages, 1, 0));
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Text(tokens, 1, 0));
    this.chatContainer.addChild(new DynamicBorder());
    this.ui.requestRender();
  }

  private async handleGrokCommand(text: string): Promise<void> {
    const subcommand = text.split(" ").filter(Boolean)[1];
    if (subcommand === "refresh") {
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(new Text(await handleGrokRefresh(), 1, 1));
      this.ui.requestRender();
      return;
    }

    const body = (await buildGrokStatusLines({ forceBilling: true })).join(
      "\n",
    );
    showDismissibleTextOverlay(this.ui, body, this.editor as Component);
  }

  private handleStatusCommand(): void {
    const stats = this.session.getSessionStats();
    const cwd = this.sessionManager.getCwd();
    const branch = this.footerDataProvider.getGitBranch() || "none";
    const model = this.session.model
      ? `${this.session.model.provider}/${this.session.model.id}`
      : "no-model";
    const contextUsage = this.session.getContextUsage();
    const contextWindow =
      contextUsage?.contextWindow ?? this.session.model?.contextWindow ?? 0;
    const contextPercent = contextUsage?.percent ?? 0;
    const line = (label: string, value: string | number) =>
      `${theme.fg("dim", `${label.padEnd(10)} `)}${value}`;
    const body = [
      theme.fg(
        "accent",
        "╭─ Runtime Status ─────────────────────────────────────────╮",
      ),
      "",
      line("cwd", cwd),
      line("branch", branch),
      line("model", model),
      line("think", this.session.thinkingLevel || "off"),
      line(
        "ctx",
        `${contextPercent.toFixed(1)}% / ${contextWindow.toLocaleString()}`,
      ),
      line(
        "tokens",
        `${stats.tokens.input.toLocaleString()} in · ${stats.tokens.output.toLocaleString()} out · ${stats.tokens.cacheRead.toLocaleString()} cache`,
      ),
      line("cost", `$${stats.cost.toFixed(4)}`),
      line(
        "messages",
        `${stats.totalMessages} total · ${stats.toolCalls} tool calls`,
      ),
      "",
      theme.fg("dim", "Esc/q close"),
      theme.fg(
        "borderMuted",
        "╰───────────────────────────────────────────────────────────╯",
      ),
    ].join("\n");
    showDismissibleTextOverlay(this.ui, body, this.editor as Component);
  }

  private handleChangelogCommand(): void {
    const changelogPath = getChangelogPath();
    const allEntries = parseChangelog(changelogPath);

    const changelogMarkdown =
      allEntries.length > 0
        ? allEntries
            .reverse()
            .map((e) => e.content)
            .join("\n\n")
        : "No changelog entries found.";

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder());
    this.chatContainer.addChild(
      new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0),
    );
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Markdown(
        changelogMarkdown,
        1,
        1,
        this.getMarkdownThemeWithSettings(),
      ),
    );
    this.chatContainer.addChild(new DynamicBorder());
    this.ui.requestRender();
  }

  /**
   * Capitalize keybinding for display (e.g., "ctrl+c" -> "Ctrl+C").
   */
  private capitalizeKey(key: string): string {
    return key
      .split("/")
      .map((k) =>
        k
          .split("+")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join("+"),
      )
      .join("/");
  }

  /**
   * Get capitalized display string for an app keybinding action.
   */
  private getAppKeyDisplay(action: AppKeybinding): string {
    return this.capitalizeKey(keyText(action));
  }

  /**
   * Get capitalized display string for an editor keybinding action.
   */
  private getEditorKeyDisplay(action: Keybinding): string {
    return this.capitalizeKey(keyText(action));
  }

  private handleHotkeysCommand(): void {
    // Navigation keybindings
    const cursorUp = this.getEditorKeyDisplay("tui.editor.cursorUp");
    const cursorDown = this.getEditorKeyDisplay("tui.editor.cursorDown");
    const cursorLeft = this.getEditorKeyDisplay("tui.editor.cursorLeft");
    const cursorRight = this.getEditorKeyDisplay("tui.editor.cursorRight");
    const cursorWordLeft = this.getEditorKeyDisplay(
      "tui.editor.cursorWordLeft",
    );
    const cursorWordRight = this.getEditorKeyDisplay(
      "tui.editor.cursorWordRight",
    );
    const cursorLineStart = this.getEditorKeyDisplay(
      "tui.editor.cursorLineStart",
    );
    const cursorLineEnd = this.getEditorKeyDisplay("tui.editor.cursorLineEnd");
    const jumpForward = this.getEditorKeyDisplay("tui.editor.jumpForward");
    const jumpBackward = this.getEditorKeyDisplay("tui.editor.jumpBackward");
    const pageUp = this.getEditorKeyDisplay("tui.editor.pageUp");
    const pageDown = this.getEditorKeyDisplay("tui.editor.pageDown");

    // Editing keybindings
    const submit = this.getEditorKeyDisplay("tui.input.submit");
    const newLine = this.getEditorKeyDisplay("tui.input.newLine");
    const deleteWordBackward = this.getEditorKeyDisplay(
      "tui.editor.deleteWordBackward",
    );
    const deleteWordForward = this.getEditorKeyDisplay(
      "tui.editor.deleteWordForward",
    );
    const deleteToLineStart = this.getEditorKeyDisplay(
      "tui.editor.deleteToLineStart",
    );
    const deleteToLineEnd = this.getEditorKeyDisplay(
      "tui.editor.deleteToLineEnd",
    );
    const yank = this.getEditorKeyDisplay("tui.editor.yank");
    const yankPop = this.getEditorKeyDisplay("tui.editor.yankPop");
    const undo = this.getEditorKeyDisplay("tui.editor.undo");
    const tab = this.getEditorKeyDisplay("tui.input.tab");

    // App keybindings
    const interrupt = this.getAppKeyDisplay("app.interrupt");
    const clear = this.getAppKeyDisplay("app.clear");
    const exit = this.getAppKeyDisplay("app.exit");
    const suspend = this.getAppKeyDisplay("app.suspend");
    const cycleThinkingLevel = this.getAppKeyDisplay("app.thinking.cycle");
    const cycleModelForward = this.getAppKeyDisplay("app.model.cycleForward");
    const selectModel = this.getAppKeyDisplay("app.model.select");
    const expandTools = this.getAppKeyDisplay("app.tools.expand");
    const toggleThinking = this.getAppKeyDisplay("app.thinking.toggle");
    const externalEditor = this.getAppKeyDisplay("app.editor.external");
    const cycleModelBackward = this.getAppKeyDisplay("app.model.cycleBackward");
    const followUp = this.getAppKeyDisplay("app.message.followUp");
    const dequeue = this.getAppKeyDisplay("app.message.dequeue");
    const pasteImage = this.getAppKeyDisplay("app.clipboard.pasteImage");

    let hotkeys = `
**Navigation**
| Key | Action |
|-----|--------|
| \`${cursorUp}\` / \`${cursorDown}\` / \`${cursorLeft}\` / \`${cursorRight}\` | Move cursor / browse history (Up when empty) |
| \`${cursorWordLeft}\` / \`${cursorWordRight}\` | Move by word |
| \`${cursorLineStart}\` | Start of line |
| \`${cursorLineEnd}\` | End of line |
| \`${jumpForward}\` | Jump forward to character |
| \`${jumpBackward}\` | Jump backward to character |
| \`${pageUp}\` / \`${pageDown}\` | Scroll by page |

**Editing**
| Key | Action |
|-----|--------|
| \`${submit}\` | Send message |
| \`${newLine}\` | New line${process.platform === "win32" ? " (Ctrl+Enter on Windows Terminal)" : ""} |
| \`${deleteWordBackward}\` | Delete word backwards |
| \`${deleteWordForward}\` | Delete word forwards |
| \`${deleteToLineStart}\` | Delete to start of line |
| \`${deleteToLineEnd}\` | Delete to end of line |
| \`${yank}\` | Paste the most-recently-deleted text |
| \`${yankPop}\` | Cycle through the deleted text after pasting |
| \`${undo}\` | Undo |

**Other**
| Key | Action |
|-----|--------|
| \`${tab}\` | Path completion / accept autocomplete |
| \`${interrupt}\` | Cancel autocomplete / abort streaming |
| \`${clear}\` | Clear editor (first) / exit (second) |
| \`${exit}\` | Exit (when editor is empty) |
| \`${suspend}\` | Suspend to background |
| \`${cycleThinkingLevel}\` | Cycle thinking level |
| \`${cycleModelForward}\` / \`${cycleModelBackward}\` | Cycle models |
| \`${selectModel}\` | Open model selector |
| \`${expandTools}\` | Toggle tool output expansion |
| \`${toggleThinking}\` | Toggle thinking block visibility |
| \`${externalEditor}\` | Edit message in external editor |
| \`${followUp}\` | Queue follow-up message |
| \`${dequeue}\` | Restore queued messages |
| \`${pasteImage}\` | Paste image from clipboard |
| \`/\` | Slash commands |
| \`!\` | Run bash command |
| \`!!\` | Run bash command (excluded from context) |
`;

    // Add extension-registered shortcuts
    const extensionRunner = this.session.extensionRunner;
    if (extensionRunner) {
      const shortcuts = extensionRunner.getShortcuts(
        this.keybindings.getEffectiveConfig(),
      );
      if (shortcuts.size > 0) {
        hotkeys += `
**Extensions**
| Key | Action |
|-----|--------|
`;
        for (const [key, shortcut] of shortcuts) {
          const description = shortcut.description ?? shortcut.extensionPath;
          const keyDisplay = key.replace(/\b\w/g, (c) => c.toUpperCase());
          hotkeys += `| \`${keyDisplay}\` | ${description} |\n`;
        }
      }
    }

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder());
    this.chatContainer.addChild(
      new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0),
    );
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Markdown(hotkeys.trim(), 1, 1, this.getMarkdownThemeWithSettings()),
    );
    this.chatContainer.addChild(new DynamicBorder());
    this.ui.requestRender();
  }

  private detectPackageManager(): "bun" | "pnpm" | "yarn" | "npm" {
    const cwd = this.sessionManager.getCwd();
    if (
      fs.existsSync(path.join(cwd, "bun.lockb")) ||
      fs.existsSync(path.join(cwd, "bun.lock"))
    )
      return "bun";
    if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
    if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
    return "npm";
  }

  private scriptCommand(
    scriptName: string,
    packageManager: "bun" | "pnpm" | "yarn" | "npm",
  ): string {
    switch (packageManager) {
      case "bun":
        return scriptName === "test" ? "bun test" : `bun run ${scriptName}`;
      case "pnpm":
        return scriptName === "test" ? "pnpm test" : `pnpm ${scriptName}`;
      case "yarn":
        return scriptName === "test" ? "yarn test" : `yarn ${scriptName}`;
      default:
        return scriptName === "test" ? "npm test" : `npm run ${scriptName}`;
    }
  }

  private detectProjectCommands(): {
    build?: string;
    test?: string;
    lint?: string;
    dev?: string;
    type?: string;
  } {
    const cwd = this.sessionManager.getCwd();
    const packageManager = this.detectPackageManager();
    const pkgPath = path.join(cwd, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
          scripts?: Record<string, string>;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
          workspaces?: unknown;
        };
        const deps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        };
        let type = "Node.js project";
        if (pkg.workspaces || fs.existsSync(path.join(cwd, "turbo.json")))
          type = "JavaScript/TypeScript monorepo";
        else if (deps.next) type = "Next.js application";
        else if (deps.vite) type = "Vite application";
        else if (deps.react) type = "React application";
        else if (deps.vue) type = "Vue application";
        else if (deps.express) type = "Express server";
        else if (deps.typescript) type = "TypeScript package";
        return {
          build: pkg.scripts?.build
            ? this.scriptCommand("build", packageManager)
            : undefined,
          test: pkg.scripts?.test
            ? this.scriptCommand("test", packageManager)
            : undefined,
          lint: pkg.scripts?.lint
            ? this.scriptCommand("lint", packageManager)
            : undefined,
          dev: pkg.scripts?.dev
            ? this.scriptCommand("dev", packageManager)
            : undefined,
          type,
        };
      } catch {
        // ignore
      }
    }
    if (fs.existsSync(path.join(cwd, "pyproject.toml"))) {
      return {
        test: "pytest",
        lint: "ruff check .",
        build: "python -m build",
        type: "Python project",
      };
    }
    if (fs.existsSync(path.join(cwd, "Cargo.toml"))) {
      return {
        build: "cargo build",
        test: "cargo test",
        lint: "cargo clippy",
        type: "Rust project",
      };
    }
    return { type: "Software project" };
  }

  private detectImportantPaths(): string[] {
    const cwd = this.sessionManager.getCwd();
    const candidates = [
      "src",
      "app",
      "pages",
      "components",
      "packages",
      "apps",
      "server",
      "api",
      "tests",
      "test",
      "docs",
      "scripts",
    ];
    return candidates
      .filter((name) => fs.existsSync(path.join(cwd, name)))
      .map((name) => `\`${name}/\``);
  }

  private buildQuakeInitTemplate(): string {
    const cwd = this.sessionManager.getCwd();
    const projectName = path.basename(cwd);

    return [
      `# QUAKE.md — ${projectName}`,
      "",
      "## Build & Test",
      "- Build: `npm run build`",
      "- Test: `npm test`",
      "",
      "## Project Context",
      "- Add your architecture, conventions, and workflows here.",
      "- Use @path/to/file.md to import supplementary files.",
      "",
      "## Memory",
      "- Quake Code has persistent auto memory in .quake-code/agent-memory/.",
      "- The agent writes learnings automatically from your corrections.",
      "- Use /memory to view, /forget to clear.",
      "",
      "## Rules",
      "- Path-scoped rules go in .quake-code/rules/.",
      "- typescript.ts.md applies to .ts files, all.md applies everywhere.",
    ].join("\n");
  }

  private buildAgentsInitTemplate(): string {
    const cwd = this.sessionManager.getCwd();
    const commands = this.detectProjectCommands();
    const projectName = path.basename(cwd);
    const importantPaths = this.detectImportantPaths();
    const lines = [
      `# AGENTS.md`,
      "",
      `Instructions for Quake when working in \`${projectName}\`.`,
      "",
      "## Project overview",
      `- Type: ${commands.type ?? "Software project"}`,
      `- Root: \`${cwd}\``,
      "- Replace this with a 1-2 sentence description of the project and its main purpose.",
      importantPaths.length > 0
        ? `- Important paths: ${importantPaths.join(", ")}`
        : "- Important paths: _fill me in_",
      "",
      "## Working agreement",
      "- Keep changes small, focused, and reviewable.",
      "- Fix root causes instead of layering temporary patches.",
      "- Preserve existing style and conventions unless there is a strong reason to change them.",
      "- Do not change unrelated files while fixing a focused issue.",
      "- When the task is ambiguous, inspect nearby files and existing patterns before editing.",
      "",
      "## Commands",
      `- Build: ${commands.build ? `\`${commands.build}\`` : "_fill me in_"}`,
      `- Test: ${commands.test ? `\`${commands.test}\`` : "_fill me in_"}`,
      `- Lint: ${commands.lint ? `\`${commands.lint}\`` : "_fill me in_"}`,
      `- Dev: ${commands.dev ? `\`${commands.dev}\`` : "_fill me in_"}`,
      "",
      "## Architecture notes",
      "- Document the main entrypoints, core modules, and ownership boundaries here.",
      "- Call out any fragile areas, generated files, or parts that require extra caution.",
      "",
      "## Validation strategy",
      "- Run the smallest relevant checks first.",
      "- Prefer targeted verification before broad full-project checks.",
      "- If a task changes behavior, note the exact command or flow used to verify it.",
      "",
      "## Review expectations",
      "- Mention any required screenshots, rollout notes, migrations, or follow-up checks here.",
      "- Note whether changes should include tests, docs, or changelog updates.",
    ];
    return lines.filter(Boolean).join("\n");
  }

  private async handleInitCommand(): Promise<void> {
    const cwd = this.sessionManager.getCwd();
    const quakePath = path.join(cwd, "QUAKE.md");
    const agentsPath = path.join(cwd, "AGENTS.md");

    // Prefer QUAKE.md over AGENTS.md
    const targetPath = quakePath;
    const label = "QUAKE.md";

    if (fs.existsSync(targetPath)) {
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Text(
          `${theme.fg("warning", `${label} already exists`)}\n${theme.fg("muted", targetPath)}`,
          1,
          1,
        ),
      );
      this.ui.requestRender();
      return;
    }

    const template =
      label === "QUAKE.md"
        ? this.buildQuakeInitTemplate()
        : this.buildAgentsInitTemplate();
    fs.writeFileSync(targetPath, template, "utf-8");

    // Also init rules directory
    try {
      const { initRulesDirectory } = await import("../../core/quake-rules.js");
      initRulesDirectory(cwd);
    } catch {
      // rules module not available
    }

    await this.session.resourceLoader.reload();
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Text(
        `${theme.fg("accent", `✓ Created ${label}`)}\n${theme.fg("muted", targetPath)}`,
        1,
        1,
      ),
    );
    this.ui.requestRender();
  }

  private showMemoryPanel(): void {
    const cwd = this.sessionManager.getCwd();
    let close!: () => void;
    const panel = new MemoryPanelComponent(cwd, (action, entry) => {
      if (action === "forget" && entry) {
        this.showStatus(`Deleted memory ${entry.scope}/${entry.name}`);
      }
      if (action === "consolidate") {
        this.showStatus("Memory consolidated");
      }
      if (action === "close") {
        close();
      }
    });
    close = this.showModalOverlay(panel, panel);
  }

  private async handleMemoryCommand(text: string = "/memory"): Promise<void> {
    const parts = text.split(" ").filter(Boolean);
    const subcommand = parts[1] || "panel";

    if (subcommand === "consolidate") {
      const {
        consolidateMemory,
        createMemorySummarizer,
        getMemoryStatus,
        getDefaultAgentName,
      } = await import("../../core/memory-consolidation.js");
      const cwd = this.sessionManager.getCwd();
      const agent = getDefaultAgentName();
      const summarizer = createMemorySummarizer();
      let count = 0;
      for (const s of getMemoryStatus(agent, cwd).scopes) {
        if (s.needsConsolidation) {
          const r = consolidateMemory(agent, s.scope, cwd, summarizer);
          if (r.consolidated) count += r.archivedCount;
        }
      }
      this.showStatus(
        count > 0
          ? `Consolidated ${count} archived entries`
          : "Memory does not need consolidation",
      );
      return;
    }

    this.showMemoryPanel();
  }

  private async handleForgetCommand(text: string): Promise<void> {
    const { clearAllMemory, forgetEntry, getDefaultAgentName } =
      await import("../../core/memory/memory-store.js");
    const cwd = this.sessionManager.getCwd();
    const agent = getDefaultAgentName();
    const parts = text.split(" ").filter(Boolean);

    if (parts.length > 1 && parts[1] === "--yes") {
      clearAllMemory(agent, cwd);
      this.showStatus("All memory scopes cleared");
      return;
    }

    if (parts.length > 1) {
      const entryName = parts.slice(1).join(" ");
      const ok = forgetEntry(agent, cwd, entryName);
      this.showStatus(
        ok ? `Deleted memory "${entryName}"` : `No entry "${entryName}" found`,
      );
      return;
    }

    this.showWarning("Clear ALL memory? /forget --yes  ·  or /forget <name>");
  }

  private async handleClearCommand(): Promise<void> {
    if (this.loadingAnimation) {
      this.loadingAnimation.stop();
      this.loadingAnimation = undefined;
      this.syncHardwareCursorVisibility();
    }
    this.statusContainer.clear();
    const result = await this.runtimeHost.newSession();
    if (result.cancelled) {
      return;
    }
    await this.handleRuntimeSessionChange();
    this.disposeEditorImageDrafts();
    this.renderCurrentSessionState();
    this.enterStartupHero();
  }

  private handleDebugCommand(): void {
    const width = this.ui.terminal.columns;
    const height = this.ui.terminal.rows;
    const allLines = this.ui.render(width);

    const debugLogPath = getDebugLogPath();
    const debugData = [
      `Debug output at ${new Date().toISOString()}`,
      `Terminal: ${width}x${height}`,
      `Total lines: ${allLines.length}`,
      "",
      "=== All rendered lines with visible widths ===",
      ...allLines.map((line, idx) => {
        const vw = visibleWidth(line);
        const escaped = JSON.stringify(line);
        return `[${idx}] (w=${vw}) ${escaped}`;
      }),
      "",
      "=== Agent messages (JSONL) ===",
      ...this.session.messages.map((msg) => JSON.stringify(msg)),
      "",
    ].join("\n");

    fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
    fs.writeFileSync(debugLogPath, debugData);

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Text(
        `${theme.fg("accent", "✓ Debug log written")}\n${theme.fg("muted", debugLogPath)}`,
        1,
        1,
      ),
    );
    this.ui.requestRender();
  }

  private handleArminSaysHi(): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new ArminComponent(this.ui));
    this.ui.requestRender();
  }

  private handleDaxnuts(): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DaxnutsComponent(this.ui));
    this.ui.requestRender();
  }

  private checkDaxnutsEasterEgg(model: { provider: string; id: string }): void {
    if (
      model.provider === "opencode" &&
      model.id.toLowerCase().includes("kimi-k2.5")
    ) {
      this.handleDaxnuts();
    }
  }

  private async handleBashCommand(
    command: string,
    excludeFromContext = false,
  ): Promise<void> {
    const extensionRunner = this.session.extensionRunner;

    // Emit user_bash event to let extensions intercept
    const eventResult = extensionRunner
      ? await extensionRunner.emitUserBash({
          type: "user_bash",
          command,
          excludeFromContext,
          cwd: this.sessionManager.getCwd(),
        })
      : undefined;

    // If extension returned a full result, use it directly
    if (eventResult?.result) {
      const result = eventResult.result;

      // Create UI component for display
      this.bashComponent = new BashExecutionComponent(
        command,
        this.ui,
        excludeFromContext,
      );
      if (this.session.isStreaming) {
        this.pendingMessagesContainer.addChild(this.bashComponent);
        this.pendingBashComponents.push(this.bashComponent);
      } else {
        this.chatContainer.addChild(this.bashComponent);
      }

      // Show output and complete
      if (result.output) {
        this.bashComponent.appendOutput(result.output);
      }
      this.bashComponent.setComplete(
        result.exitCode,
        result.cancelled,
        result.truncated
          ? ({ truncated: true, content: result.output } as TruncationResult)
          : undefined,
        result.fullOutputPath,
      );

      // Record the result in session
      this.session.recordBashResult(command, result, { excludeFromContext });
      this.bashComponent = undefined;
      this.ui.requestRender();
      return;
    }

    // Normal execution path (possibly with custom operations)
    const isDeferred = this.session.isStreaming;
    this.bashComponent = new BashExecutionComponent(
      command,
      this.ui,
      excludeFromContext,
    );

    if (isDeferred) {
      // Show in pending area when agent is streaming
      this.pendingMessagesContainer.addChild(this.bashComponent);
      this.pendingBashComponents.push(this.bashComponent);
    } else {
      // Show in chat immediately when agent is idle
      this.chatContainer.addChild(this.bashComponent);
    }
    this.ui.requestRender();

    try {
      const result = await this.session.executeBash(
        command,
        (chunk) => {
          if (this.bashComponent) {
            this.bashComponent.appendOutput(chunk);
            this.ui.requestRender();
          }
        },
        { excludeFromContext, operations: eventResult?.operations },
      );

      if (this.bashComponent) {
        this.bashComponent.setComplete(
          result.exitCode,
          result.cancelled,
          result.truncated
            ? ({ truncated: true, content: result.output } as TruncationResult)
            : undefined,
          result.fullOutputPath,
        );
      }
    } catch (error) {
      if (this.bashComponent) {
        this.bashComponent.setComplete(undefined, false);
      }
      this.showError(
        `Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    this.bashComponent = undefined;
    this.ui.requestRender();
  }

  private async handleCompactCommand(
    customInstructions?: string,
  ): Promise<void> {
    const entries = this.sessionManager.getEntries();
    const messageCount = entries.filter((e) => e.type === "message").length;

    if (messageCount < 2) {
      this.showWarning("Nothing to compact (no messages yet)");
      return;
    }

    if (this.loadingAnimation) {
      this.loadingAnimation.stop();
      this.loadingAnimation = undefined;
      this.syncHardwareCursorVisibility();
    }
    this.statusContainer.clear();

    try {
      await this.session.compact(customInstructions as any);
    } catch {
      // Ignore, will be emitted as an event
    }
  }

  stop(): void {
    this.inputLayer.dispose();
    this.afterRenderUnsub?.();
    this.afterRenderUnsub = undefined;
    this.clearWorkingMessageHideTimer();
    if (this.loadingAnimation) {
      this.loadingAnimation.stop();
      this.loadingAnimation = undefined;
      this.syncHardwareCursorVisibility();
    }
    this.clearExtensionTerminalInputListeners();
    this.footer.dispose();
    this.footerDataProvider.dispose();
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    if (this.isInitialized) {
      this.ui.stop();
      this.isInitialized = false;
    }
  }
}
