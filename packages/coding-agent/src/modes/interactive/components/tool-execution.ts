import {
  type Component,
  Container,
  getCapabilities,
  type HitRegion,
  Image,
  type MouseCollectContext,
  type MouseTarget,
  Spacer,
  Text,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@mrquake/quakecode-tui";
import type {
  ToolDefinition,
  ToolRenderContext,
} from "../../../core/extensions/types.js";
import { allToolDefinitions } from "../../../core/tools/index.js";
import {
  getTextOutput as getRenderedTextOutput,
  getToolExecutionStatus,
  getToolPreviewLineCount,
  pickToolTextPreview,
  summarizeToolTextOutput,
  type ToolExecutionStatus,
  type ToolPreviewDensity,
} from "../../../core/tools/render-utils.js";
import {
  type CompactToolLogPresentation,
  getCompactToolLogPresentation,
  TOOL_STATUS_GLYPHS,
} from "../../../core/tools/tool-log-line.js";
import { convertToPng } from "../../../utils/image-convert.js";
import { richGlyphsEnabled } from "../glyphs.js";
import { theme } from "../theme/theme.js";
import { keyHint } from "./keybinding-hints.js";

type ChatDensity = ToolPreviewDensity;

export interface ToolExecutionOptions {
  showImages?: boolean;
  /** Internal-only for now; settings binding is intentionally deferred. */
  density?: ChatDensity;
}

const DEFAULT_CHAT_DENSITY: ChatDensity = "comfortable";

/** Memory tool cards auto-fade then hide to avoid flooding the chat log. */
export const MEMORY_EPHEMERAL_FADE_MS = 1200;
export const MEMORY_EPHEMERAL_HIDE_MS = 2000;

export function isEphemeralMemoryTool(toolName: string): boolean {
  return toolName.startsWith("memory_");
}

type GenericToolIntent = {
  title: string;
  subtitle?: string;
  prefersHeadPreview?: boolean;
  rawArgs?: string;
};

function humanizeToolName(toolName: string): string {
  // Remove "default_api:" or "default-api:" prefix if present
  const cleanName = toolName.replace(/^default[-_]api:/i, "");

  return cleanName
    .split(/[-_:]/g)
    .filter(Boolean)
    .filter((part) => !["default", "api"].includes(part.toLowerCase()))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function firstPathArg(args: any): string | undefined {
  return firstString(
    args?.path,
    args?.filePath,
    args?.cwd,
    args?.dir,
    args?.directory,
  );
}

function inferGenericToolIntent(
  toolName: string,
  args: any,
): GenericToolIntent {
  const pathArg = firstPathArg(args);
  const queryArg = firstString(
    args?.pattern,
    args?.query,
    Array.isArray(args?.queries) ? args.queries[0] : undefined,
  );
  const urlArg = firstString(
    args?.url,
    Array.isArray(args?.urls) ? args.urls[0] : undefined,
  );
  const commandArg = firstString(args?.command);
  const rawArgs =
    args && Object.keys(args).length > 0
      ? JSON.stringify(args, null, 2)
      : undefined;

  if (toolName === "read") {
    const memoryPath = pathArg?.replace(/\\/g, "/").toLowerCase();
    if (
      memoryPath?.includes("agent-memory") &&
      memoryPath.endsWith("memory.md")
    ) {
      return {
        title: "Memory read",
        subtitle: pathArg ?? "Use memory_recall instead",
        prefersHeadPreview: true,
        rawArgs,
      };
    }
    return {
      title: pathArg ? `Reading ${pathArg}` : "Reading file",
      subtitle: "Pulling source details into context",
      prefersHeadPreview: true,
      rawArgs,
    };
  }
  if (toolName === "grep") {
    return {
      title: queryArg ? `Searching for '${queryArg}'` : "Searching workspace",
      subtitle: pathArg
        ? `Looking through ${pathArg}`
        : "Looking for matching content",
      prefersHeadPreview: true,
      rawArgs,
    };
  }
  if (toolName === "find") {
    return {
      title: pathArg
        ? `Scanning files under ${pathArg}`
        : "Scanning workspace files",
      subtitle: "Listing candidate files before narrowing scope",
      prefersHeadPreview: true,
      rawArgs,
    };
  }
  if (toolName === "ls") {
    return {
      title: pathArg ? `Listing ${pathArg}` : "Listing directory contents",
      subtitle: "Inspecting available files and folders",
      prefersHeadPreview: true,
      rawArgs,
    };
  }
  if (toolName === "edit") {
    const memoryPath = pathArg?.replace(/\\/g, "/").toLowerCase();
    if (
      memoryPath?.includes("agent-memory") &&
      memoryPath.endsWith("memory.md")
    ) {
      return {
        title: "Memory update",
        subtitle: pathArg ?? "Use memory_remember instead",
        prefersHeadPreview: true,
        rawArgs,
      };
    }
    return {
      title: pathArg ? `Editing ${pathArg}` : "Editing file",
      subtitle: "Applying a targeted source change",
      prefersHeadPreview: true,
      rawArgs,
    };
  }
  if (toolName === "write") {
    return {
      title: pathArg ? `Writing ${pathArg}` : "Writing file",
      subtitle: "Creating or replacing file content",
      prefersHeadPreview: true,
      rawArgs,
    };
  }
  if (toolName === "memory_remember" || toolName === "memory_write") {
    const scope = firstString(args?.scope) ?? "project";
    const entryName = firstString(args?.name);
    return {
      title: entryName
        ? `Memory save · ${scope} · ${entryName}`
        : "Memory save",
      subtitle: firstString(args?.description) ?? "Persisting layered memory",
      prefersHeadPreview: true,
      rawArgs,
    };
  }
  if (toolName === "memory_recall" || toolName === "memory_read") {
    const entryName = firstString(args?.name);
    const query = firstString(args?.query);
    const scope = firstString(args?.scope);
    const target = entryName
      ? scope
        ? `${entryName} · ${scope}`
        : entryName
      : query
        ? `"${query}"`
        : undefined;
    return {
      title: target ? `Memory recall · ${target}` : "Memory recall",
      subtitle: "Searching layered memory",
      prefersHeadPreview: true,
      rawArgs,
    };
  }
  if (toolName === "memory_forget" || toolName === "memory_delete") {
    const entryName = firstString(args?.name);
    return {
      title: entryName ? `Memory forget · ${entryName}` : "Memory forget",
      subtitle: "Removing memory entry",
      rawArgs,
    };
  }
  if (urlArg) {
    return {
      title: `Fetching ${urlArg}`,
      subtitle: humanizeToolName(toolName),
      prefersHeadPreview: true,
      rawArgs,
    };
  }
  if (queryArg) {
    return {
      title: `Running ${humanizeToolName(toolName)}`,
      subtitle: `Query: ${queryArg}`,
      prefersHeadPreview: true,
      rawArgs,
    };
  }
  if (commandArg) {
    return {
      title: `Running ${humanizeToolName(toolName)}`,
      subtitle: commandArg,
      rawArgs,
    };
  }
  if (pathArg) {
    return {
      title: `Running ${humanizeToolName(toolName)}`,
      subtitle: pathArg,
      prefersHeadPreview: true,
      rawArgs,
    };
  }
  return { title: `Running ${humanizeToolName(toolName)}`, rawArgs };
}

const MAX_WORKING_STATUS_VIS = 96;

/**
 * One-line status for the loading / working shimmer (tool + path or command).
 */
export function getToolWorkingStatusTitle(
  toolName: string,
  args: unknown,
): string {
  const raw = args as any;
  const intent = inferGenericToolIntent(toolName, raw);
  const cmd = firstString(raw?.command);
  if (cmd) {
    const c = cmd.length > 78 ? `${cmd.slice(0, 75)}...` : cmd;
    let line = `${intent.title}: ${c}`;
    if (visibleWidth(line) > MAX_WORKING_STATUS_VIS) {
      line = truncateToWidth(line, MAX_WORKING_STATUS_VIS, "...");
    }
    return line;
  }
  let line = intent.title;
  if (visibleWidth(line) > MAX_WORKING_STATUS_VIS) {
    line = truncateToWidth(line, MAX_WORKING_STATUS_VIS, "...");
  }
  return line;
}

function formatGenericToolDetails(details: unknown): string | undefined {
  if (details == null) return undefined;
  try {
    const text =
      typeof details === "string" ? details : JSON.stringify(details, null, 2);
    const trimmed = text.trim();
    if (!trimmed || trimmed === "{}") return undefined;
    const maxChars = 1600;
    return trimmed.length > maxChars
      ? `${trimmed.slice(0, maxChars)}\n... metadata truncated`
      : trimmed;
  } catch {
    return String(details);
  }
}

export class ToolExecutionComponent extends Container implements MouseTarget {
  private compactText: Text;
  private compactPresentation!: CompactToolLogPresentation;
  private compactRenderedLine?: string;
  private detailContainer: Container;
  private callRendererComponent?: Component;
  private resultRendererComponent?: Component;
  private rendererState: any = {};
  private imageComponents: Image[] = [];
  private imageSpacers: Spacer[] = [];
  private toolName: string;
  private toolCallId: string;
  private args: any;
  private expanded = false;
  private showImages: boolean;
  private isPartial = true;
  private toolDefinition?: ToolDefinition<any, any>;
  private builtInToolDefinition?: ToolDefinition<any, any>;
  private ui: TUI;
  private cwd: string;
  private executionStarted = false;
  private argsComplete = false;
  private stopAnimation?: () => void;
  private result?: {
    content: Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    isError: boolean;
    details?: any;
  };
  private convertedImages: Map<number, { data: string; mimeType: string }> =
    new Map();
  private hideComponent = false;
  private density: ChatDensity = DEFAULT_CHAT_DENSITY;
  private ephemeralFaded = false;
  private ephemeralFadeTimer?: ReturnType<typeof setTimeout>;
  private ephemeralHideTimer?: ReturnType<typeof setTimeout>;
  private renderedLineCount = 0;
  private mouseHovered = false;

  constructor(
    toolName: string,
    toolCallId: string,
    args: any,
    options: ToolExecutionOptions = {},
    toolDefinition: ToolDefinition<any, any> | undefined,
    ui: TUI,
    cwd: string = process.cwd(),
  ) {
    super();
    this.toolName = toolName;
    this.toolCallId = toolCallId;
    this.args = args;
    this.toolDefinition = toolDefinition;
    this.builtInToolDefinition =
      allToolDefinitions[toolName as keyof typeof allToolDefinitions];
    this.showImages = options.showImages ?? true;
    this.density = options.density ?? DEFAULT_CHAT_DENSITY;
    this.ui = ui;
    this.cwd = cwd;

    this.compactText = new Text("", 0, 0);
    this.detailContainer = new Container();
    this.addChild(this.compactText);
    this.addChild({
      invalidate: () => this.detailContainer.invalidate(),
      render: (width: number) => this.renderDetailFrame(width),
    });

    this.updateDisplay();
    this.startBlinking();
  }

  private getCallRenderer():
    ToolDefinition<any, any>["renderCall"] | undefined {
    if (!this.builtInToolDefinition) {
      return this.toolDefinition?.renderCall;
    }
    if (!this.toolDefinition) {
      return this.builtInToolDefinition.renderCall;
    }
    return (
      this.toolDefinition.renderCall ?? this.builtInToolDefinition.renderCall
    );
  }

  private getResultRenderer():
    ToolDefinition<any, any>["renderResult"] | undefined {
    if (!this.builtInToolDefinition) {
      return this.toolDefinition?.renderResult;
    }
    if (!this.toolDefinition) {
      return this.builtInToolDefinition.renderResult;
    }
    return (
      this.toolDefinition.renderResult ??
      this.builtInToolDefinition.renderResult
    );
  }

  private hasRendererDefinition(): boolean {
    return (
      this.builtInToolDefinition !== undefined ||
      this.toolDefinition !== undefined
    );
  }

  private getRenderContext(
    lastComponent: Component | undefined,
  ): ToolRenderContext {
    return {
      args: this.args,
      toolCallId: this.toolCallId,
      invalidate: () => {
        this.invalidate();
        this.ui.requestRender();
      },
      lastComponent,
      state: { ...this.rendererState, ephemeralFaded: this.ephemeralFaded },
      cwd: this.cwd,
      executionStarted: this.executionStarted,
      argsComplete: this.argsComplete,
      isPartial: this.isPartial,
      expanded: this.expanded,
      showImages: this.showImages,
      isError: this.result?.isError ?? false,
    };
  }

  private getDisplayStatus(): ToolExecutionStatus {
    if (this.result?.isError) return "error";
    if (this.result && !this.isPartial) return "done";
    if (this.executionStarted) return this.result ? "streaming" : "running";
    return "queued";
  }

  private renderCompactLine(width: number): string {
    if (width <= 0) return "";
    const status = this.getDisplayStatus();
    const isActive = status === "running" || status === "streaming";
    const glyph =
      status === "error"
        ? TOOL_STATUS_GLYPHS.error
        : isActive
          ? TOOL_STATUS_GLYPHS.active
          : status === "done"
            ? TOOL_STATUS_GLYPHS.done
            : TOOL_STATUS_GLYPHS.queued;
    const glyphColor =
      status === "error"
        ? "error"
        : isActive
          ? "accent"
          : status === "done"
            ? "success"
            : "dim";
    const labelColor = this.ephemeralFaded
      ? "dim"
      : status === "error"
        ? "error"
        : isActive || this.mouseHovered
          ? "accent"
          : "muted";
    const subjectColor = this.ephemeralFaded
      ? "dim"
      : this.mouseHovered && !this.expanded
        ? "accent"
        : "text";
    const metaColor = this.ephemeralFaded
      ? "dim"
      : status === "error"
        ? "error"
        : isActive
          ? "accent"
          : "dim";
    const disclosure = this.expanded
      ? richGlyphsEnabled
        ? "⌄"
        : "v"
      : richGlyphsEnabled
        ? "›"
        : ">";
    const labelWidth = width >= 36 ? 8 : 6;
    const label = truncateToWidth(
      this.compactPresentation.label.toUpperCase(),
      labelWidth,
      "",
    );
    const paddedLabel = `${label}${" ".repeat(Math.max(0, labelWidth - visibleWidth(label)))}`;
    const prefixPlain = `${glyph}  ${paddedLabel}  `;
    const metaTailPlain = `${this.compactPresentation.meta} ${disclosure}`;
    const availableAfterPrefix = Math.max(1, width - visibleWidth(prefixPlain));
    const showMeta =
      availableAfterPrefix >= visibleWidth(metaTailPlain) + 10;
    const reservedTailWidth = showMeta
      ? visibleWidth(metaTailPlain) + 2
      : visibleWidth(disclosure) + 1;
    const subject = truncateToWidth(
      this.compactPresentation.subject,
      Math.max(1, availableAfterPrefix - reservedTailWidth),
      richGlyphsEnabled ? "…" : "...",
    );
    const styledLeft = `${theme.fg(glyphColor, glyph)}  ${theme.fg(labelColor, theme.bold(paddedLabel))}  ${theme.fg(subjectColor, subject)}`;

    if (!showMeta) {
      return `${styledLeft} ${theme.fg(this.mouseHovered ? "accent" : "dim", disclosure)}`;
    }

    const leftWidth = visibleWidth(`${prefixPlain}${subject}`);
    const gap = " ".repeat(
      Math.max(2, width - leftWidth - visibleWidth(metaTailPlain)),
    );
    return `${styledLeft}${gap}${theme.fg(metaColor, this.compactPresentation.meta)} ${theme.fg(this.mouseHovered ? "accent" : "dim", disclosure)}`;
  }

  private renderDetailFrame(width: number): string[] {
    if (!this.expanded || width <= 0) return [];
    const railWidth = 3;
    const lines = this.detailContainer.render(Math.max(1, width - railWidth));
    if (lines.length === 0) return [];
    const track = richGlyphsEnabled ? "│ " : "| ";
    const end = richGlyphsEnabled ? "╰─" : "\\-";
    return lines.map(
      (line, index) =>
        `${theme.fg("borderMuted", index === lines.length - 1 ? end : track)} ${line}`,
    );
  }

  private populateExpandedDetail(): void {
    if (this.hasRendererDefinition()) {
      const shouldShowCall =
        !this.result || (this.isPartial && this.getTextOutput().trim().length === 0);
      if (shouldShowCall) {
        const callRenderer = this.getCallRenderer();
        if (!callRenderer) {
          this.detailContainer.addChild(this.createCallFallback());
        } else {
          try {
            const component = callRenderer(
              this.args,
              theme,
              this.getRenderContext(this.callRendererComponent),
            );
            this.callRendererComponent = component;
            this.detailContainer.addChild(component);
          } catch {
            this.callRendererComponent = undefined;
            this.detailContainer.addChild(this.createCallFallback());
          }
        }
      }

      if (this.result) {
        const resultRenderer = this.getResultRenderer();
        if (!resultRenderer) {
          const component = this.createResultFallback();
          if (component) this.detailContainer.addChild(component);
        } else {
          try {
            const component = resultRenderer(
              {
                content: this.result.content as any,
                details: this.result.details,
              },
              { expanded: true, isPartial: this.isPartial },
              theme,
              this.getRenderContext(this.resultRendererComponent),
            );
            this.resultRendererComponent = component;
            this.detailContainer.addChild(component);
          } catch {
            this.resultRendererComponent = undefined;
            const component = this.createResultFallback();
            if (component) this.detailContainer.addChild(component);
          }
        }
      }
      return;
    }

    this.detailContainer.addChild(new Text(this.formatToolExecution(), 0, 0));
  }

  private startBlinking(): void {
    // Compact log lines use a static ".." suffix while active; no periodic re-renders.
  }

  private stopBlinking(): void {
    this.stopAnimation?.();
    this.stopAnimation = undefined;
  }

  private createCallFallback(): Component {
    const intent = inferGenericToolIntent(this.toolName, this.args);
    const lines = [
      theme.fg("toolTitle", theme.bold(intent.title)),
      theme.fg("dim", this.toolName),
    ];
    if (intent.subtitle) {
      lines.push(theme.fg("muted", intent.subtitle));
    }
    return new Text(lines.join("\n"), 0, 0);
  }

  private createResultFallback(): Component | undefined {
    const output = this.getTextOutput();
    if (!output) {
      return undefined;
    }
    return new Text(theme.fg("toolOutput", output), 0, 0);
  }

  updateArgs(args: any): void {
    this.args = args;
    this.updateDisplay();
  }

  markExecutionStarted(): void {
    this.executionStarted = true;
    this.startBlinking();
    this.updateDisplay();
    this.ui.requestRender();
  }

  setArgsComplete(): void {
    this.argsComplete = true;
    this.updateDisplay();
    this.ui.requestRender();
  }

  updateResult(
    result: {
      content: Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
      }>;
      details?: any;
      isError: boolean;
    },
    isPartial = false,
  ): void {
    this.result = result;
    this.isPartial = isPartial;
    if (isPartial) this.startBlinking();
    else this.stopBlinking();
    this.updateDisplay();
    this.maybeConvertImagesForKitty();
    if (!isPartial && isEphemeralMemoryTool(this.toolName) && !result.isError) {
      this.scheduleEphemeralAutoHide();
    }
  }

  private clearEphemeralTimers(): void {
    if (this.ephemeralFadeTimer) {
      clearTimeout(this.ephemeralFadeTimer);
      this.ephemeralFadeTimer = undefined;
    }
    if (this.ephemeralHideTimer) {
      clearTimeout(this.ephemeralHideTimer);
      this.ephemeralHideTimer = undefined;
    }
  }

  /** Hide completed memory tool cards (success only). */
  hideEphemeral(): void {
    if (!isEphemeralMemoryTool(this.toolName)) return;
    this.clearEphemeralTimers();
    this.ephemeralFaded = false;
    this.hideComponent = true;
    this.stopBlinking();
    this.ui.requestRender();
  }

  private scheduleEphemeralAutoHide(
    fadeMs: number = MEMORY_EPHEMERAL_FADE_MS,
    hideMs: number = MEMORY_EPHEMERAL_HIDE_MS,
  ): void {
    if (!isEphemeralMemoryTool(this.toolName)) return;
    if (this.result?.isError) return;
    this.clearEphemeralTimers();
    this.ephemeralFaded = false;
    this.ephemeralFadeTimer = setTimeout(() => {
      this.ephemeralFadeTimer = undefined;
      if (this.hideComponent) return;
      this.ephemeralFaded = true;
      this.updateDisplay();
      this.ui.requestRender();
    }, fadeMs);
    this.ephemeralHideTimer = setTimeout(() => {
      this.ephemeralHideTimer = undefined;
      this.hideEphemeral();
    }, hideMs);
  }

  isEphemeralMemoryToolCard(): boolean {
    return isEphemeralMemoryTool(this.toolName);
  }

  isEphemeralHidden(): boolean {
    return this.hideComponent;
  }

  getToolCallId(): string {
    return this.toolCallId;
  }

  private maybeConvertImagesForKitty(): void {
    const caps = getCapabilities();
    if (caps.images !== "kitty") return;
    if (!this.result) return;

    const imageBlocks = this.result.content.filter((c) => c.type === "image");
    for (let i = 0; i < imageBlocks.length; i++) {
      const img = imageBlocks[i];
      if (!img.data || !img.mimeType) continue;
      if (img.mimeType === "image/png") continue;
      if (this.convertedImages.has(i)) continue;

      const index = i;
      convertToPng(img.data, img.mimeType).then((converted) => {
        if (converted) {
          this.convertedImages.set(index, converted);
          this.updateDisplay();
          this.ui.requestRender();
        }
      });
    }
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.updateDisplay();
  }

  isExpanded(): boolean {
    return this.expanded;
  }

  setShowImages(show: boolean): void {
    this.showImages = show;
    this.updateDisplay();
  }

  setDensity(density: ChatDensity): void {
    if (this.density === density) return;
    this.density = density;
    this.updateDisplay();
  }

  override invalidate(): void {
    super.invalidate();
    this.updateDisplay();
  }

  collectMouseRegions(ctx: MouseCollectContext): HitRegion[] {
    if (this.hideComponent || ctx.lineCount === 0) return [];
    return [
      {
        id: `tool:${this.toolCallId}`,
        contentLineStart: ctx.startLine,
        contentLineEnd: ctx.startLine + 1,
        target: this,
      },
    ];
  }

  isMouseLineClickable(localLine: number): boolean {
    return !this.hideComponent && localLine === 0 && this.renderedLineCount > 0;
  }

  setMouseHovered(hovered: boolean): void {
    if (this.mouseHovered === hovered) return;
    this.mouseHovered = hovered;
    this.updateDisplay();
  }

  /** @deprecated Use isMouseLineClickable */
  handleMouseClick(localLine: number): boolean {
    return this.isMouseLineClickable(localLine);
  }

  override render(width: number): string[] {
    if (this.hideComponent) {
      this.renderedLineCount = 0;
      return [];
    }
    const compactLine = this.renderCompactLine(width);
    if (compactLine !== this.compactRenderedLine) {
      this.compactRenderedLine = compactLine;
      this.compactText.setText(compactLine);
    }
    const lines = super.render(width);
    this.renderedLineCount = lines.length;
    return lines;
  }

  private updateDisplay(): void {
    this.hideComponent = false;
    const status = this.getDisplayStatus();
    this.compactPresentation = getCompactToolLogPresentation({
      toolName: this.toolName,
      args: this.args,
      result: this.result,
      status,
      cwd: this.cwd,
      showImages: this.showImages,
    });

    this.detailContainer.clear();
    if (this.expanded) {
      this.populateExpandedDetail();
    }

    for (const img of this.imageComponents) {
      this.removeChild(img);
    }
    this.imageComponents = [];
    for (const spacer of this.imageSpacers) {
      this.removeChild(spacer);
    }
    this.imageSpacers = [];

    if (this.expanded && this.result) {
      const imageBlocks = this.result.content.filter((c) => c.type === "image");
      const caps = getCapabilities();
      for (let i = 0; i < imageBlocks.length; i++) {
        const img = imageBlocks[i];
        if (caps.images && this.showImages && img.data && img.mimeType) {
          const converted = this.convertedImages.get(i);
          const imageData = converted?.data ?? img.data;
          const imageMimeType = converted?.mimeType ?? img.mimeType;
          if (caps.images === "kitty" && imageMimeType !== "image/png")
            continue;

          const spacer = new Spacer(1);
          this.addChild(spacer);
          this.imageSpacers.push(spacer);
          const imageComponent = new Image(
            imageData,
            imageMimeType,
            { fallbackColor: (s: string) => theme.fg("toolOutput", s) },
            { maxWidthCells: 60 },
          );
          this.imageComponents.push(imageComponent);
          this.addChild(imageComponent);
        }
      }
    }
  }

  private getTextOutput(): string {
    return getRenderedTextOutput(this.result, this.showImages);
  }

  private formatToolExecution(): string {
    const intent = inferGenericToolIntent(this.toolName, this.args);
    const output = this.getTextOutput();
    const status: ToolExecutionStatus = getToolExecutionStatus({
      executionStarted: this.executionStarted,
      isPartial: this.result ? this.isPartial : true,
      isError: this.result?.isError ?? false,
    });
    const normalizedStatus: ToolExecutionStatus =
      this.executionStarted && !this.result ? "running" : status;
    const summary = summarizeToolTextOutput(output, normalizedStatus);
    const previewLineCount = getToolPreviewLineCount(
      normalizedStatus,
      this.density,
    );
    const preview = pickToolTextPreview(output, {
      expanded: this.expanded,
      prefersHeadPreview: intent.prefersHeadPreview ?? false,
      maxPreviewLines: previewLineCount,
      maxExpandedLines: previewLineCount * 4,
    });

    const statusForDisplay = normalizedStatus;
    const isExecuting =
      statusForDisplay === "running" || statusForDisplay === "streaming";
    const detailTitle =
      statusForDisplay === "queued" || isExecuting
        ? intent.title
        : humanizeToolName(this.toolName) || "Tool";
    const titleText =
      statusForDisplay === "error"
        ? theme.fg("error", theme.bold(detailTitle))
        : theme.fg("toolTitle", theme.bold(detailTitle));
    const statusText =
      statusForDisplay === "queued"
        ? "queued"
        : statusForDisplay === "running"
          ? "running"
          : statusForDisplay === "streaming"
            ? "streaming"
            : statusForDisplay === "done"
              ? "done"
              : "failed";
    const sections: string[] = [
      `${titleText}${theme.fg("dim", ` · ${statusText}`)}`,
    ];
    if (intent.subtitle && (isExecuting || statusForDisplay === "error"))
      sections.push(theme.fg("muted", intent.subtitle));
    if (summary && statusForDisplay !== "done")
      sections.push(
        theme.fg(statusForDisplay === "error" ? "error" : "muted", summary),
      );

    if (this.expanded && intent.rawArgs) {
      sections.push(
        `${theme.fg("dim", "args")}\n${theme.fg("toolOutput", intent.rawArgs)}`,
      );
    }
    if (this.expanded && statusForDisplay === "error") {
      const details = formatGenericToolDetails(this.result?.details);
      if (details) {
        sections.push(
          `${theme.fg("error", "metadata")}\n${theme.fg("toolOutput", details)}`,
        );
      }
    }

    const shouldShowPreview =
      this.expanded ||
      statusForDisplay === "running" ||
      statusForDisplay === "streaming" ||
      statusForDisplay === "error";
    if (
      shouldShowPreview &&
      preview.lines.length > 0 &&
      preview.lines.some((line) => line.length > 0)
    ) {
      sections.push(theme.fg("toolOutput", preview.lines.join("\n")));
    }

    const hints: string[] = [];
    if (!this.expanded && intent.rawArgs) {
      hints.push(theme.fg("dim", keyHint("app.tools.expand", "details")));
    }
    if (preview.hiddenLineCount > 0) {
      hints.push(
        this.expanded
          ? `${theme.fg("muted", `... ${preview.hiddenLineCount} more lines hidden`)} (${keyHint("app.tools.expand", "to collapse")})`
          : `${theme.fg("muted", `... ${preview.hiddenLineCount} more lines`)} (${keyHint("app.tools.expand", "to expand")})`,
      );
    }
    if (hints.length > 0) {
      sections.push(hints.join("\n"));
    }

    return sections.join("\n\n");
  }
}
