/**
 * Minimal TUI implementation with differential rendering
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isKeyRelease, matchesKey } from "./keys.js";
import { MouseLayoutCollector } from "./mouse-layout-collector.js";
import {
  type HitRegion,
  isOverlayChromeTarget,
  isOverlayInteractiveTarget,
  type OverlayChromeTarget,
  type OverlayInteractiveTarget,
} from "./spatial-index.js";
import type { HardwareCursorShape, Terminal } from "./terminal.js";
import {
  getCapabilities,
  isImageLine,
  setCellDimensions,
} from "./terminal-image.js";
import {
  extractSegments,
  sliceByColumn,
  sliceWithWidth,
  visibleWidth,
} from "./utils.js";

/**
 * Component interface - all components must implement this
 */
export interface Component {
  /**
   * Render the component to lines for the given viewport width
   * @param width - Current viewport width
   * @returns Array of strings, each representing a line
   */
  render(width: number, layout?: MouseLayoutCollector): string[];

  /**
   * Optional handler for keyboard input when component has focus
   */
  handleInput?(data: string): void;

  /**
   * If true, component receives key release events (Kitty protocol).
   * Default is false - release events are filtered out.
   */
  wantsKeyRelease?: boolean;

  /**
   * Invalidate any cached rendering state.
   * Called when theme changes or when component needs to re-render from scratch.
   */
  invalidate(): void;
}

type InputListenerResult = { consume?: boolean; data?: string } | undefined;
type InputListener = (data: string) => InputListenerResult;

/** Snapshot emitted after each completed render pass. */
export interface RenderContext {
  width: number;
  height: number;
  totalLines: number;
  viewportStart: number;
  viewportScrollOffset: number;
  /** Hit regions collected during the render pass (empty when mouse collection is disabled). */
  mouseRegions: HitRegion[];
  /** Screen-relative regions for composited overlays (close buttons, etc.). */
  overlayMouseRegions: HitRegion[];
  /** Screen-relative regions for interactive overlay lists. */
  overlayContentRegions: HitRegion[];
}

type AfterRenderListener = (ctx: RenderContext) => void;

/**
 * Interface for components that can receive focus and display a hardware cursor.
 * When focused, the component should emit CURSOR_MARKER at the cursor position
 * in its render output. TUI will find this marker and position the hardware
 * cursor there for proper IME candidate window positioning.
 */
export interface Focusable {
  /** Set by TUI when focus changes. Component should emit CURSOR_MARKER when true. */
  focused: boolean;
}

/** Type guard to check if a component implements Focusable */
export function isFocusable(
  component: Component | null,
): component is Component & Focusable {
  return component !== null && "focused" in component;
}

/**
 * Cursor position marker - APC (Application Program Command) sequence.
 * This is a zero-width escape sequence that terminals ignore.
 * Components emit this at the cursor position when focused.
 * TUI finds and strips this marker, then positions the hardware cursor there.
 */
export const CURSOR_MARKER = "\x1b_pi:c\x07";

export { visibleWidth };

/**
 * Anchor position for overlays
 */
export type OverlayAnchor =
  | "center"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top-center"
  | "bottom-center"
  | "left-center"
  | "right-center";

/**
 * Margin configuration for overlays
 */
export interface OverlayMargin {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Value that can be absolute (number) or percentage (string like "50%") */
export type SizeValue = number | `${number}%`;

/** Parse a SizeValue into absolute value given a reference size */
function parseSizeValue(
  value: SizeValue | undefined,
  referenceSize: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  // Parse percentage string like "50%"
  const match = value.match(/^(\d+(?:\.\d+)?)%$/);
  if (match) {
    return Math.floor((referenceSize * parseFloat(match[1])) / 100);
  }
  return undefined;
}

function isTermuxSession(): boolean {
  return Boolean(process.env.TERMUX_VERSION);
}

/**
 * Options for overlay positioning and sizing.
 * Values can be absolute numbers or percentage strings (e.g., "50%").
 */
export interface OverlayOptions {
  // === Sizing ===
  /** Width in columns, or percentage of terminal width (e.g., "50%") */
  width?: SizeValue;
  /** Minimum width in columns */
  minWidth?: number;
  /** Maximum height in rows, or percentage of terminal height (e.g., "50%") */
  maxHeight?: SizeValue;

  // === Positioning - anchor-based ===
  /** Anchor point for positioning (default: 'center') */
  anchor?: OverlayAnchor;
  /** Horizontal offset from anchor position (positive = right) */
  offsetX?: number;
  /** Vertical offset from anchor position (positive = down) */
  offsetY?: number;

  // === Positioning - percentage or absolute ===
  /** Row position: absolute number, or percentage (e.g., "25%" = 25% from top) */
  row?: SizeValue;
  /** Column position: absolute number, or percentage (e.g., "50%" = centered horizontally) */
  col?: SizeValue;

  // === Margin from terminal edges ===
  /** Margin from terminal edges. Number applies to all sides. */
  margin?: OverlayMargin | number;

  // === Visibility ===
  /**
   * Control overlay visibility based on terminal dimensions.
   * If provided, overlay is only rendered when this returns true.
   * Called each render cycle with current terminal dimensions.
   */
  visible?: (termWidth: number, termHeight: number) => boolean;
  /** If true, don't capture keyboard focus when shown */
  nonCapturing?: boolean;
  /** Optional background painter applied to the overlay rectangle. */
  background?: (text: string) => string;
}

/**
 * Handle returned by showOverlay for controlling the overlay
 */
export interface OverlayHandle {
  /** Permanently remove the overlay (cannot be shown again) */
  hide(): void;
  /** Temporarily hide or show the overlay */
  setHidden(hidden: boolean): void;
  /** Check if overlay is temporarily hidden */
  isHidden(): boolean;
  /** Focus this overlay and bring it to the visual front */
  focus(): void;
  /** Release focus to the previous target */
  unfocus(): void;
  /** Check if this overlay currently has focus */
  isFocused(): boolean;
}

/**
 * Container - a component that contains other components
 */
export class Container implements Component {
  children: Component[] = [];

  addChild(component: Component): void {
    this.children.push(component);
  }

  removeChild(component: Component): void {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  clear(): void {
    this.children = [];
  }

  /** Find the first descendant that exposes overlay chrome hit regions. */
  findOverlayChromeTarget(): OverlayChromeTarget | undefined {
    for (const child of this.children) {
      if (isOverlayChromeTarget(child)) {
        return child;
      }
      if (child instanceof Container) {
        const found = child.findOverlayChromeTarget();
        if (found) return found;
      }
    }
    return undefined;
  }

  /** Find the first descendant that exposes overlay list interaction. */
  findOverlayInteractiveTarget(): OverlayInteractiveTarget | undefined {
    for (const child of this.children) {
      if (isOverlayInteractiveTarget(child)) {
        return child;
      }
      if (child instanceof Container) {
        const found = child.findOverlayInteractiveTarget();
        if (found) return found;
      }
    }
    return undefined;
  }

  invalidate(): void {
    for (const child of this.children) {
      child.invalidate?.();
    }
  }

  render(width: number, layout?: MouseLayoutCollector): string[] {
    const lines: string[] = [];
    for (const child of this.children) {
      if (layout) {
        lines.push(...layout.collectChild(child, width));
      } else {
        lines.push(...child.render(width));
      }
    }
    return lines;
  }
}

/**
 * TUI - Main class for managing terminal UI with differential rendering
 */
export class TUI extends Container {
  public terminal: Terminal;
  private previousLines: string[] = [];
  private previousWidth = 0;
  private previousHeight = 0;
  private focusedComponent: Component | null = null;
  private inputListeners = new Set<InputListener>();
  private afterRenderListeners = new Set<AfterRenderListener>();
  private viewportScrollOffset = 0;
  private lastRenderContext: RenderContext | null = null;

  /** Global callback for debug key (Shift+Ctrl+D). Called before input is forwarded to focused component. */
  public onDebug?: () => void;
  private renderRequested = false;
  private cursorRow = 0; // Logical cursor row (end of rendered content)
  private hardwareCursorRow = 0; // Actual terminal cursor row (may differ due to IME positioning)
  private hardwareCursorCol = 0; // Actual terminal cursor column
  private hardwareCursorVisible = false;
  private showHardwareCursor = process.env.PI_HARDWARE_CURSOR === "1";
  private hardwareCursorShape: HardwareCursorShape = "block";
  private clearOnShrink = process.env.PI_CLEAR_ON_SHRINK === "1"; // Clear empty rows when content shrinks (default: off)
  private maxLinesRendered = 0; // Track terminal's working area (max lines ever rendered)
  private previousViewportTop = 0; // Track previous viewport top for resize-aware cursor moves
  private previousViewportScrollOffset = 0;
  private previousRenderTotalLines = 0;
  private screenFrame: string[] = [];
  private screenFrameActive = false;
  private readonly useScreenFrame = process.env.QUAKE_LEGACY_RENDERER !== "1";
  private fullRedrawCount = 0;
  private stopped = false;

  // Overlay stack for modal components rendered on top of base content
  private focusOrderCounter = 0;
  private overlayStack: {
    component: Component;
    options?: OverlayOptions;
    preFocus: Component | null;
    hidden: boolean;
    focusOrder: number;
  }[] = [];

  constructor(terminal: Terminal, showHardwareCursor?: boolean) {
    super();
    this.terminal = terminal;
    if (showHardwareCursor !== undefined) {
      this.showHardwareCursor = showHardwareCursor;
    }
  }

  get fullRedraws(): number {
    return this.fullRedrawCount;
  }

  getShowHardwareCursor(): boolean {
    return this.showHardwareCursor;
  }

  setShowHardwareCursor(enabled: boolean): void {
    if (this.showHardwareCursor === enabled) return;
    this.showHardwareCursor = enabled;
    if (!enabled) {
      this.terminal.hideCursor();
    }
    this.requestRender();
  }

  getHardwareCursorShape(): HardwareCursorShape {
    return this.hardwareCursorShape;
  }

  setHardwareCursorShape(shape: HardwareCursorShape): void {
    if (this.hardwareCursorShape === shape) return;
    this.hardwareCursorShape = shape;
    if (this.hardwareCursorVisible && this.showHardwareCursor) {
      this.terminal.showCursor(shape);
    }
    this.requestRender();
  }

  getClearOnShrink(): boolean {
    return this.clearOnShrink;
  }

  /**
   * Set whether to trigger full re-render when content shrinks.
   * When true (default), empty rows are cleared when content shrinks.
   * When false, empty rows remain (reduces redraws on slower terminals).
   */
  setClearOnShrink(enabled: boolean): void {
    this.clearOnShrink = enabled;
  }

  setFocus(component: Component | null): void {
    // Clear focused flag on old component
    if (isFocusable(this.focusedComponent)) {
      this.focusedComponent.focused = false;
    }

    this.focusedComponent = component;

    // Set focused flag on new component
    if (isFocusable(component)) {
      component.focused = true;
    }
  }

  /**
   * Show an overlay component with configurable positioning and sizing.
   * Returns a handle to control the overlay's visibility.
   */
  showOverlay(component: Component, options?: OverlayOptions): OverlayHandle {
    this.setViewportScrollOffset(0);
    const entry = {
      component,
      options,
      preFocus: this.focusedComponent,
      hidden: false,
      focusOrder: ++this.focusOrderCounter,
    };
    this.overlayStack.push(entry);
    // Only focus if overlay is actually visible
    if (!options?.nonCapturing && this.isOverlayVisible(entry)) {
      this.setFocus(component);
    }
    this.terminal.hideCursor();
    this.requestRender();

    // Return handle for controlling this overlay
    return {
      hide: () => {
        const index = this.overlayStack.indexOf(entry);
        if (index !== -1) {
          this.overlayStack.splice(index, 1);
          // Restore focus if this overlay had focus
          if (this.focusedComponent === component) {
            const topVisible = this.getTopmostVisibleOverlay();
            this.setFocus(topVisible?.component ?? entry.preFocus);
          }
          if (this.overlayStack.length === 0) this.terminal.hideCursor();
          this.requestRender();
        }
      },
      setHidden: (hidden: boolean) => {
        if (entry.hidden === hidden) return;
        entry.hidden = hidden;
        // Update focus when hiding/showing
        if (hidden) {
          // If this overlay had focus, move focus to next visible or preFocus
          if (this.focusedComponent === component) {
            const topVisible = this.getTopmostVisibleOverlay();
            this.setFocus(topVisible?.component ?? entry.preFocus);
          }
        } else {
          // Restore focus to this overlay when showing (if it's actually visible)
          if (!options?.nonCapturing && this.isOverlayVisible(entry)) {
            entry.focusOrder = ++this.focusOrderCounter;
            this.setFocus(component);
          }
        }
        this.requestRender();
      },
      isHidden: () => entry.hidden,
      focus: () => {
        if (!this.overlayStack.includes(entry) || !this.isOverlayVisible(entry))
          return;
        if (this.focusedComponent !== component) {
          this.setFocus(component);
        }
        entry.focusOrder = ++this.focusOrderCounter;
        this.requestRender();
      },
      unfocus: () => {
        if (this.focusedComponent !== component) return;
        const topVisible = this.getTopmostVisibleOverlay();
        this.setFocus(
          topVisible && topVisible !== entry
            ? topVisible.component
            : entry.preFocus,
        );
        this.requestRender();
      },
      isFocused: () => this.focusedComponent === component,
    };
  }

  /** Hide the topmost overlay and restore previous focus. */
  hideOverlay(): void {
    const overlay = this.overlayStack.pop();
    if (!overlay) return;
    if (this.focusedComponent === overlay.component) {
      // Find topmost visible overlay, or fall back to preFocus
      const topVisible = this.getTopmostVisibleOverlay();
      this.setFocus(topVisible?.component ?? overlay.preFocus);
    }
    if (this.overlayStack.length === 0) this.terminal.hideCursor();
    this.requestRender();
  }

  /** Check if there are any visible overlays */
  hasOverlay(): boolean {
    return this.overlayStack.some((o) => this.isOverlayVisible(o));
  }

  /** Check if an overlay entry is currently visible */
  private isOverlayVisible(entry: (typeof this.overlayStack)[number]): boolean {
    if (entry.hidden) return false;
    if (entry.options?.visible) {
      return entry.options.visible(this.terminal.columns, this.terminal.rows);
    }
    return true;
  }

  /** Find the topmost visible capturing overlay, if any */
  private getTopmostVisibleOverlay():
    (typeof this.overlayStack)[number] | undefined {
    for (let i = this.overlayStack.length - 1; i >= 0; i--) {
      if (this.overlayStack[i].options?.nonCapturing) continue;
      if (this.isOverlayVisible(this.overlayStack[i])) {
        return this.overlayStack[i];
      }
    }
    return undefined;
  }

  override invalidate(): void {
    super.invalidate();
    for (const overlay of this.overlayStack) overlay.component.invalidate?.();
  }

  start(): void {
    this.stopped = false;
    if (this.useScreenFrame && !this.screenFrameActive) {
      // Own a fixed terminal-sized surface. Mixing terminal-native scrollback with
      // an application viewport is what caused streaming content to move a
      // manually scrolled chat and made wheel redraws visibly jump.
      // Disable xterm alternate-scroll mode inside the application screen. If
      // mouse reporting is unavailable even briefly, mode 1007 otherwise turns
      // wheel ticks into cursor-up/down keys and the editor recalls prompt history.
      this.terminal.write("\x1b[?1007s\x1b[?1049h\x1b[?1007l\x1b[2J\x1b[H");
      this.screenFrameActive = true;
      this.screenFrame = [];
    }
    try {
      // Start input after entering the alternate screen. Some terminals scope or
      // reset mouse-reporting modes during a 1049 transition, so enabling SGR
      // mouse tracking first can leave the application without wheel events.
      this.terminal.start(
        (data) => this.handleInput(data),
        () => this.requestRender(),
      );
    } catch (error) {
      if (this.screenFrameActive) {
        this.terminal.write("\x1b[?1049l\x1b[?1007r");
        this.screenFrameActive = false;
        this.screenFrame = [];
      }
      throw error;
    }
    this.terminal.hideCursor();
    this.queryCellSize();
    this.requestRender();
  }

  addInputListener(listener: InputListener): () => void {
    this.inputListeners.add(listener);
    return () => {
      this.inputListeners.delete(listener);
    };
  }

  removeInputListener(listener: InputListener): void {
    this.inputListeners.delete(listener);
  }

  addAfterRenderListener(listener: AfterRenderListener): () => void {
    this.afterRenderListeners.add(listener);
    return () => {
      this.afterRenderListeners.delete(listener);
    };
  }

  getLastRenderContext(): RenderContext | null {
    return this.lastRenderContext;
  }

  getViewportScrollOffset(): number {
    return this.viewportScrollOffset;
  }

  setViewportScrollOffset(offset: number): void {
    this.viewportScrollOffset = Math.max(0, offset);
  }

  private emitAfterRender(ctx: RenderContext): void {
    this.lastRenderContext = ctx;
    for (const listener of this.afterRenderListeners) {
      listener(ctx);
    }
  }

  private buildRenderContext(
    width: number,
    height: number,
    totalLines: number,
    mouseRegions: HitRegion[],
    overlayMouseRegions: HitRegion[],
    overlayContentRegions: HitRegion[],
  ): RenderContext {
    const bufferLength = Math.max(height, totalLines);
    const viewportStart = Math.max(
      0,
      bufferLength - height - this.viewportScrollOffset,
    );
    return {
      width,
      height,
      totalLines,
      viewportStart,
      viewportScrollOffset: this.viewportScrollOffset,
      mouseRegions,
      overlayMouseRegions,
      overlayContentRegions,
    };
  }

  private queryCellSize(): void {
    // Only query if terminal supports images (cell size is only used for image rendering)
    if (!getCapabilities().images) {
      return;
    }
    // Query terminal for cell size in pixels: CSI 16 t
    // Response format: CSI 6 ; height ; width t
    this.terminal.write("\x1b[16t");
  }

  stop(): void {
    this.stopped = true;
    if (this.screenFrameActive) {
      // Disable mouse/input modes while the alternate screen where they were
      // enabled is still active, then restore the primary screen.
      this.terminal.write("\x1b[?2026l");
      try {
        this.terminal.stop();
      } finally {
        this.terminal.write("\x1b[?1049l\x1b[?1007r");
        this.screenFrameActive = false;
        this.screenFrame = [];
        this.terminal.showCursor();
      }
      return;
    }
    // Move cursor to the end of the content to prevent overwriting/artifacts on exit
    if (this.previousLines.length > 0) {
      const targetRow = this.previousLines.length; // Line after the last content
      const lineDiff = targetRow - this.hardwareCursorRow;
      if (lineDiff > 0) {
        this.terminal.write(`\x1b[${lineDiff}B`);
      } else if (lineDiff < 0) {
        this.terminal.write(`\x1b[${-lineDiff}A`);
      }
      this.terminal.write("\r\n");
    }

    this.terminal.showCursor();
    this.terminal.stop();
  }

  requestRender(force = false): void {
    if (force) {
      this.previousLines = [];
      this.previousWidth = -1; // -1 triggers widthChanged, forcing a full clear
      this.previousHeight = -1; // -1 triggers heightChanged, forcing a full clear
      this.cursorRow = 0;
      this.hardwareCursorRow = 0;
      this.maxLinesRendered = 0;
      this.previousViewportTop = 0;
      this.previousViewportScrollOffset = 0;
      this.previousRenderTotalLines = 0;
      this.screenFrame = [];
    }
    if (this.renderRequested) return;
    this.renderRequested = true;
    process.nextTick(() => {
      this.renderRequested = false;
      this.doRender();
    });
  }

  private handleInput(data: string): void {
    if (this.inputListeners.size > 0) {
      let current = data;
      for (const listener of this.inputListeners) {
        const result = listener(current);
        if (result?.consume) {
          return;
        }
        if (result?.data !== undefined) {
          current = result.data;
        }
      }
      if (current.length === 0) {
        return;
      }
      data = current;
    }

    // Consume terminal cell size responses without blocking unrelated input.
    if (this.consumeCellSizeResponse(data)) {
      return;
    }

    // Global debug key handler (Shift+Ctrl+D)
    if (matchesKey(data, "shift+ctrl+d") && this.onDebug) {
      this.onDebug();
      return;
    }

    // If focused component is an overlay, verify it's still visible
    // (visibility can change due to terminal resize or visible() callback)
    const focusedOverlay = this.overlayStack.find(
      (o) => o.component === this.focusedComponent,
    );
    if (focusedOverlay && !this.isOverlayVisible(focusedOverlay)) {
      // Focused overlay is no longer visible, redirect to topmost visible overlay
      const topVisible = this.getTopmostVisibleOverlay();
      if (topVisible) {
        this.setFocus(topVisible.component);
      } else {
        // No visible overlays, restore to preFocus
        this.setFocus(focusedOverlay.preFocus);
      }
    }

    // Pass input to focused component (including Ctrl+C)
    // The focused component can decide how to handle Ctrl+C
    if (this.focusedComponent?.handleInput) {
      // Filter out key release events unless component opts in
      if (isKeyRelease(data) && !this.focusedComponent.wantsKeyRelease) {
        return;
      }
      this.focusedComponent.handleInput(data);
      this.requestRender();
    }
  }

  private consumeCellSizeResponse(data: string): boolean {
    // Response format: ESC [ 6 ; height ; width t
    const match = data.match(/^\x1b\[6;(\d+);(\d+)t$/);
    if (!match) {
      return false;
    }

    const heightPx = parseInt(match[1], 10);
    const widthPx = parseInt(match[2], 10);
    if (heightPx <= 0 || widthPx <= 0) {
      return true;
    }

    setCellDimensions({ widthPx, heightPx });
    // Invalidate all components so images re-render with correct dimensions.
    this.invalidate();
    this.requestRender();
    return true;
  }

  /**
   * Resolve overlay layout from options.
   * Returns { width, row, col, maxHeight } for rendering.
   */
  private resolveOverlayLayout(
    options: OverlayOptions | undefined,
    overlayHeight: number,
    termWidth: number,
    termHeight: number,
  ): {
    width: number;
    row: number;
    col: number;
    maxHeight: number | undefined;
  } {
    const opt = options ?? {};

    // Parse margin (clamp to non-negative)
    const margin =
      typeof opt.margin === "number"
        ? {
            top: opt.margin,
            right: opt.margin,
            bottom: opt.margin,
            left: opt.margin,
          }
        : (opt.margin ?? {});
    const marginTop = Math.max(0, margin.top ?? 0);
    const marginRight = Math.max(0, margin.right ?? 0);
    const marginBottom = Math.max(0, margin.bottom ?? 0);
    const marginLeft = Math.max(0, margin.left ?? 0);

    // Available space after margins
    const availWidth = Math.max(1, termWidth - marginLeft - marginRight);
    const availHeight = Math.max(1, termHeight - marginTop - marginBottom);

    // === Resolve width ===
    let width =
      parseSizeValue(opt.width, termWidth) ?? Math.min(80, availWidth);
    // Apply minWidth
    if (opt.minWidth !== undefined) {
      width = Math.max(width, opt.minWidth);
    }
    // Clamp to available space
    width = Math.max(1, Math.min(width, availWidth));

    // === Resolve maxHeight ===
    let maxHeight = parseSizeValue(opt.maxHeight, termHeight);
    // Clamp to available space
    if (maxHeight !== undefined) {
      maxHeight = Math.max(1, Math.min(maxHeight, availHeight));
    }

    // Effective overlay height (may be clamped by maxHeight)
    const effectiveHeight =
      maxHeight !== undefined
        ? Math.min(overlayHeight, maxHeight)
        : overlayHeight;

    // === Resolve position ===
    let row: number;
    let col: number;

    if (opt.row !== undefined) {
      if (typeof opt.row === "string") {
        // Percentage: 0% = top, 100% = bottom (overlay stays within bounds)
        const match = opt.row.match(/^(\d+(?:\.\d+)?)%$/);
        if (match) {
          const maxRow = Math.max(0, availHeight - effectiveHeight);
          const percent = parseFloat(match[1]) / 100;
          row = marginTop + Math.floor(maxRow * percent);
        } else {
          // Invalid format, fall back to center
          row = this.resolveAnchorRow(
            "center",
            effectiveHeight,
            availHeight,
            marginTop,
          );
        }
      } else {
        // Absolute row position
        row = opt.row;
      }
    } else {
      // Anchor-based (default: center)
      const anchor = opt.anchor ?? "center";
      row = this.resolveAnchorRow(
        anchor,
        effectiveHeight,
        availHeight,
        marginTop,
      );
    }

    if (opt.col !== undefined) {
      if (typeof opt.col === "string") {
        // Percentage: 0% = left, 100% = right (overlay stays within bounds)
        const match = opt.col.match(/^(\d+(?:\.\d+)?)%$/);
        if (match) {
          const maxCol = Math.max(0, availWidth - width);
          const percent = parseFloat(match[1]) / 100;
          col = marginLeft + Math.floor(maxCol * percent);
        } else {
          // Invalid format, fall back to center
          col = this.resolveAnchorCol("center", width, availWidth, marginLeft);
        }
      } else {
        // Absolute column position
        col = opt.col;
      }
    } else {
      // Anchor-based (default: center)
      const anchor = opt.anchor ?? "center";
      col = this.resolveAnchorCol(anchor, width, availWidth, marginLeft);
    }

    // Apply offsets
    if (opt.offsetY !== undefined) row += opt.offsetY;
    if (opt.offsetX !== undefined) col += opt.offsetX;

    // Clamp to terminal bounds (respecting margins)
    row = Math.max(
      marginTop,
      Math.min(row, termHeight - marginBottom - effectiveHeight),
    );
    col = Math.max(marginLeft, Math.min(col, termWidth - marginRight - width));

    return { width, row, col, maxHeight };
  }

  private resolveAnchorRow(
    anchor: OverlayAnchor,
    height: number,
    availHeight: number,
    marginTop: number,
  ): number {
    switch (anchor) {
      case "top-left":
      case "top-center":
      case "top-right":
        return marginTop;
      case "bottom-left":
      case "bottom-center":
      case "bottom-right":
        return marginTop + availHeight - height;
      case "left-center":
      case "center":
      case "right-center":
        return marginTop + Math.floor((availHeight - height) / 2);
    }
  }

  private resolveAnchorCol(
    anchor: OverlayAnchor,
    width: number,
    availWidth: number,
    marginLeft: number,
  ): number {
    switch (anchor) {
      case "top-left":
      case "left-center":
      case "bottom-left":
        return marginLeft;
      case "top-right":
      case "right-center":
      case "bottom-right":
        return marginLeft + availWidth - width;
      case "top-center":
      case "center":
      case "bottom-center":
        return marginLeft + Math.floor((availWidth - width) / 2);
    }
  }

  /** Composite all overlays into content lines (sorted by focusOrder, higher = on top). */
  private compositeOverlays(
    lines: string[],
    termWidth: number,
    termHeight: number,
  ): {
    lines: string[];
    overlayMouseRegions: HitRegion[];
    overlayContentRegions: HitRegion[];
  } {
    if (this.overlayStack.length === 0)
      return { lines, overlayMouseRegions: [], overlayContentRegions: [] };
    const result = [...lines];
    const overlayMouseRegions: HitRegion[] = [];
    const overlayContentRegions: HitRegion[] = [];

    // Pre-render all visible overlays and calculate positions
    const rendered: {
      overlayLines: string[];
      row: number;
      col: number;
      w: number;
      background?: (text: string) => string;
    }[] = [];
    let minLinesNeeded = result.length;

    const visibleEntries = this.overlayStack.filter((e) =>
      this.isOverlayVisible(e),
    );
    visibleEntries.sort((a, b) => a.focusOrder - b.focusOrder);
    for (const entry of visibleEntries) {
      const { component, options } = entry;

      // Get layout with height=0 first to determine width and maxHeight
      // (width and maxHeight don't depend on overlay height)
      const { width, maxHeight } = this.resolveOverlayLayout(
        options,
        0,
        termWidth,
        termHeight,
      );

      // Render component at calculated width
      let overlayLines = component.render(width);

      // Apply maxHeight if specified
      if (maxHeight !== undefined && overlayLines.length > maxHeight) {
        overlayLines = overlayLines.slice(0, maxHeight);
      }

      // Get final row/col with actual overlay height
      const { row, col } = this.resolveOverlayLayout(
        options,
        overlayLines.length,
        termWidth,
        termHeight,
      );

      rendered.push({
        overlayLines,
        row,
        col,
        w: width,
        background: options?.background,
      });

      const chrome = isOverlayChromeTarget(component)
        ? component
        : component instanceof Container
          ? component.findOverlayChromeTarget()
          : undefined;
      if (chrome) {
        for (const region of chrome.collectOverlayMouseRegions(width)) {
          overlayMouseRegions.push({
            ...region,
            contentLineStart: row + region.contentLineStart,
            contentLineEnd: row + region.contentLineEnd,
            xStart: (region.xStart ?? 0) + col,
            xEnd: (region.xEnd ?? width) + col,
            screenRelative: true,
          });
        }
      }

      const interactive = isOverlayInteractiveTarget(component)
        ? component
        : component instanceof Container
          ? component.findOverlayInteractiveTarget()
          : undefined;
      if (interactive) {
        for (const region of interactive.collectOverlayContentRegions(width)) {
          overlayContentRegions.push({
            ...region,
            contentLineStart: row + region.contentLineStart,
            contentLineEnd: row + region.contentLineEnd,
            xStart: (region.xStart ?? 0) + col,
            xEnd: (region.xEnd ?? width) + col,
            screenRelative: true,
          });
        }
      }

      minLinesNeeded = Math.max(minLinesNeeded, row + overlayLines.length);
    }

    // Pad to at least terminal height so overlays have screen-relative positions.
    // Excludes maxLinesRendered: the historical high-water mark caused self-reinforcing
    // inflation that pushed content into scrollback on terminal widen.
    const workingHeight = Math.max(result.length, termHeight, minLinesNeeded);

    // Extend result with empty lines if content is too short for overlay placement or working area
    while (result.length < workingHeight) {
      result.push("");
    }

    const viewportStart = Math.max(0, workingHeight - termHeight);

    // Composite each overlay
    for (const { overlayLines, row, col, w, background } of rendered) {
      for (let i = 0; i < overlayLines.length; i++) {
        const idx = viewportStart + row + i;
        if (idx >= 0 && idx < result.length) {
          // Defensive: truncate overlay line to declared width before compositing
          // (components should already respect width, but this ensures it)
          const truncatedOverlayLine =
            visibleWidth(overlayLines[i]) > w
              ? sliceByColumn(overlayLines[i], 0, w, true)
              : overlayLines[i];
          const paintedOverlayLine = background
            ? background(
                truncatedOverlayLine +
                  " ".repeat(
                    Math.max(0, w - visibleWidth(truncatedOverlayLine)),
                  ),
              )
            : truncatedOverlayLine;
          result[idx] = this.compositeLineAt(
            result[idx],
            paintedOverlayLine,
            col,
            w,
            termWidth,
          );
        }
      }
    }

    return { lines: result, overlayMouseRegions, overlayContentRegions };
  }

  private static readonly SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

  private applyLineResets(lines: string[]): string[] {
    const reset = TUI.SEGMENT_RESET;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!isImageLine(line)) {
        lines[i] = line + reset;
      }
    }
    return lines;
  }

  /** Splice overlay content into a base line at a specific column. Single-pass optimized. */
  private compositeLineAt(
    baseLine: string,
    overlayLine: string,
    startCol: number,
    overlayWidth: number,
    totalWidth: number,
  ): string {
    if (isImageLine(baseLine)) return baseLine;

    // Single pass through baseLine extracts both before and after segments
    const afterStart = startCol + overlayWidth;
    const base = extractSegments(
      baseLine,
      startCol,
      afterStart,
      totalWidth - afterStart,
      true,
    );

    // Extract overlay with width tracking (strict=true to exclude wide chars at boundary)
    const overlay = sliceWithWidth(overlayLine, 0, overlayWidth, true);

    // Pad segments to target widths
    const beforePad = Math.max(0, startCol - base.beforeWidth);
    const overlayPad = Math.max(0, overlayWidth - overlay.width);
    const actualBeforeWidth = Math.max(startCol, base.beforeWidth);
    const actualOverlayWidth = Math.max(overlayWidth, overlay.width);
    const afterTarget = Math.max(
      0,
      totalWidth - actualBeforeWidth - actualOverlayWidth,
    );
    const afterPad = Math.max(0, afterTarget - base.afterWidth);

    // Compose result
    const r = TUI.SEGMENT_RESET;
    const result =
      base.before +
      " ".repeat(beforePad) +
      r +
      overlay.text +
      " ".repeat(overlayPad) +
      r +
      base.after +
      " ".repeat(afterPad);

    // CRITICAL: Always verify and truncate to terminal width.
    // This is the final safeguard against width overflow which would crash the TUI.
    // Width tracking can drift from actual visible width due to:
    // - Complex ANSI/OSC sequences (hyperlinks, colors)
    // - Wide characters at segment boundaries
    // - Edge cases in segment extraction
    const resultWidth = visibleWidth(result);
    if (resultWidth <= totalWidth) {
      return result;
    }
    // Truncate with strict=true to ensure we don't exceed totalWidth
    return sliceByColumn(result, 0, totalWidth, true);
  }

  /**
   * Find and extract cursor position from rendered lines.
   * Searches for CURSOR_MARKER, calculates its position, and strips it from the output.
   * Only scans the bottom terminal height lines (visible viewport).
   * @param lines - Rendered lines to search
   * @param height - Terminal height (visible viewport size)
   * @returns Cursor position { row, col } or null if no marker found
   */
  private extractCursorPosition(
    lines: string[],
    height: number,
  ): { row: number; col: number } | null {
    // Only scan the bottom `height` lines (visible viewport)
    const viewportTop = Math.max(0, lines.length - height);
    for (let row = lines.length - 1; row >= viewportTop; row--) {
      const line = lines[row];
      const markerIndex = line.indexOf(CURSOR_MARKER);
      if (markerIndex !== -1) {
        // Calculate visual column (width of text before marker)
        const beforeMarker = line.slice(0, markerIndex);
        const col = visibleWidth(beforeMarker);

        // Strip marker from the line
        lines[row] =
          line.slice(0, markerIndex) +
          line.slice(markerIndex + CURSOR_MARKER.length);

        return { row, col };
      }
    }
    return null;
  }

  private doRender(): void {
    if (this.stopped) return;
    const width = this.terminal.columns;
    const height = this.terminal.rows;
    let renderTotalLines = this.previousLines.length;
    let overlayMouseRegions: HitRegion[] = [];
    let overlayContentRegions: HitRegion[] = [];
    const mouseCollector = new MouseLayoutCollector();
    try {
      const widthChanged =
        this.previousWidth !== 0 && this.previousWidth !== width;
      const heightChanged =
        this.previousHeight !== 0 && this.previousHeight !== height;
      const previousBufferLength =
        this.previousHeight > 0
          ? this.previousViewportTop + this.previousHeight
          : height;
      let prevViewportTop = heightChanged
        ? Math.max(0, previousBufferLength - height)
        : this.previousViewportTop;
      let viewportTop = prevViewportTop;
      let hardwareCursorRow = this.hardwareCursorRow;
      const computeLineDiff = (targetRow: number): number => {
        const currentScreenRow = hardwareCursorRow - prevViewportTop;
        const targetScreenRow = targetRow - viewportTop;
        return targetScreenRow - currentScreenRow;
      };

      // Render all components to get new lines (single-pass mouse region collection)
      let newLines = this.render(width, mouseCollector);
      renderTotalLines = newLines.length;

      // Composite overlays into the rendered lines (before differential compare)
      if (this.overlayStack.length > 0) {
        const composited = this.compositeOverlays(newLines, width, height);
        newLines = composited.lines;
        overlayMouseRegions = composited.overlayMouseRegions;
        overlayContentRegions = composited.overlayContentRegions;
        renderTotalLines = newLines.length;
      }

      // Keep a manually scrolled viewport anchored to the same content while new
      // lines stream in below it. An offset is measured from the bottom, so leaving
      // it unchanged would make the visible viewport drift downward on every append.
      if (
        this.viewportScrollOffset > 0 &&
        this.previousViewportScrollOffset > 0 &&
        this.previousRenderTotalLines > 0
      ) {
        const lineDelta = renderTotalLines - this.previousRenderTotalLines;
        if (lineDelta !== 0) {
          const maxOffset = Math.max(0, renderTotalLines - height);
          this.viewportScrollOffset = Math.min(
            maxOffset,
            Math.max(0, this.viewportScrollOffset + lineDelta),
          );
        }
      }

      // Extract cursor position before applying line resets (marker must be found first)
      const cursorPos = this.extractCursorPosition(newLines, height);

      newLines = this.applyLineResets(newLines);

      if (this.useScreenFrame) {
        this.renderFixedScreenFrame(
          newLines,
          renderTotalLines,
          width,
          height,
          cursorPos,
        );
        return;
      }

      const getDisplayLines = (): string[] => {
        if (this.viewportScrollOffset <= 0 || renderTotalLines <= height) {
          return newLines;
        }
        const bufferLength = Math.max(height, renderTotalLines);
        const start = Math.max(
          0,
          bufferLength - height - this.viewportScrollOffset,
        );
        const slice = newLines.slice(start, start + height);
        while (slice.length < height) {
          slice.unshift("");
        }
        return slice;
      };

      // Helper to clear scrollback and viewport and render all new lines
      const fullRender = (clear: boolean, clearScrollback = clear): void => {
        const displayLines = getDisplayLines();
        this.fullRedrawCount += 1;
        let buffer = "\x1b[?2026h"; // Begin synchronized output
        if (clear) {
          // Viewport scrolling redraws the visible screen only. Clearing scrollback on
          // every wheel tick makes terminals jump between scroll positions and flicker.
          buffer += "\x1b[2J\x1b[H";
          if (clearScrollback) buffer += "\x1b[3J";
        }
        for (let i = 0; i < displayLines.length; i++) {
          if (i > 0) buffer += "\r\n";
          buffer += displayLines[i];
        }
        buffer += "\x1b[?2026l"; // End synchronized output
        this.terminal.write(buffer);
        this.cursorRow = Math.max(0, displayLines.length - 1);
        this.hardwareCursorRow = this.cursorRow;
        // Reset max lines when clearing, otherwise track growth
        if (clear) {
          this.maxLinesRendered = displayLines.length;
        } else {
          this.maxLinesRendered = Math.max(
            this.maxLinesRendered,
            displayLines.length,
          );
        }
        const bufferLength = Math.max(height, renderTotalLines);
        this.previousViewportTop = Math.max(
          0,
          bufferLength - height - this.viewportScrollOffset,
        );
        this.previousViewportScrollOffset = this.viewportScrollOffset;
        this.previousRenderTotalLines = renderTotalLines;
        this.positionHardwareCursor(cursorPos, displayLines.length);
        this.previousLines = displayLines;
        this.previousWidth = width;
        this.previousHeight = height;
      };

      const debugRedraw = process.env.PI_DEBUG_REDRAW === "1";
      const logRedraw = (reason: string): void => {
        if (!debugRedraw) return;
        const logPath = path.join(os.homedir(), ".pi", "agent", "pi-debug.log");
        const msg = `[${new Date().toISOString()}] fullRender: ${reason} (prev=${this.previousLines.length}, new=${newLines.length}, height=${height})\n`;
        fs.appendFileSync(logPath, msg);
      };

      // Viewport scroll uses a sliced full redraw to keep differential logic stable.
      // Also redraw when returning to offset 0 because previousLines contains the
      // formerly sliced viewport rather than the complete rendered content.
      if (
        (this.viewportScrollOffset > 0 && renderTotalLines > height) ||
        this.previousViewportScrollOffset > 0
      ) {
        const displayLines = getDisplayLines();
        const viewportUnchanged =
          this.previousWidth === width &&
          this.previousHeight === height &&
          displayLines.length === this.previousLines.length &&
          displayLines.every(
            (line, index) => line === this.previousLines[index],
          );
        if (viewportUnchanged) {
          const bufferLength = Math.max(height, renderTotalLines);
          this.previousViewportTop = Math.max(
            0,
            bufferLength - height - this.viewportScrollOffset,
          );
          this.previousViewportScrollOffset = this.viewportScrollOffset;
          this.previousRenderTotalLines = renderTotalLines;
          return;
        }
        logRedraw("viewport scroll offset");
        fullRender(true, false);
        return;
      }

      // First render - just output everything without clearing (assumes clean screen)
      if (this.previousLines.length === 0 && !widthChanged && !heightChanged) {
        logRedraw("first render");
        fullRender(false);
        return;
      }

      // Width changes always need a full re-render because wrapping changes.
      if (widthChanged) {
        logRedraw(`terminal width changed (${this.previousWidth} -> ${width})`);
        fullRender(true);
        return;
      }

      // Height changes normally need a full re-render to keep the visible viewport aligned,
      // but Termux changes height when the software keyboard shows or hides.
      // In that environment, a full redraw causes the entire history to replay on every toggle.
      if (heightChanged && !isTermuxSession()) {
        logRedraw(
          `terminal height changed (${this.previousHeight} -> ${height})`,
        );
        fullRender(true);
        return;
      }

      // Content shrunk below the working area and no overlays - re-render to clear empty rows
      // (overlays need the padding, so only do this when no overlays are active)
      // Configurable via setClearOnShrink() or PI_CLEAR_ON_SHRINK=0 env var
      if (
        this.clearOnShrink &&
        newLines.length < this.maxLinesRendered &&
        this.overlayStack.length === 0
      ) {
        logRedraw(`clearOnShrink (maxLinesRendered=${this.maxLinesRendered})`);
        fullRender(true);
        return;
      }

      // Find first and last changed lines
      let firstChanged = -1;
      let lastChanged = -1;
      const maxLines = Math.max(newLines.length, this.previousLines.length);
      for (let i = 0; i < maxLines; i++) {
        const oldLine =
          i < this.previousLines.length ? this.previousLines[i] : "";
        const newLine = i < newLines.length ? newLines[i] : "";

        if (oldLine !== newLine) {
          if (firstChanged === -1) {
            firstChanged = i;
          }
          lastChanged = i;
        }
      }
      const appendedLines = newLines.length > this.previousLines.length;
      if (appendedLines) {
        if (firstChanged === -1) {
          firstChanged = this.previousLines.length;
        }
        lastChanged = newLines.length - 1;
      }
      const appendStart =
        appendedLines &&
        firstChanged === this.previousLines.length &&
        firstChanged > 0;

      // No changes - but still need to update hardware cursor position if it moved
      if (firstChanged === -1) {
        // Important: do NOT reposition the hardware cursor on no-op renders.
        // On Windows Terminal / scrollback this can yank the viewport back down,
        // which feels like jitter/trembling when the user scrolls up.
        this.previousViewportTop = prevViewportTop;
        this.previousHeight = height;
        this.previousWidth = width;
        return;
      }

      // All changes are in deleted lines (nothing to render, just clear)
      if (firstChanged >= newLines.length) {
        if (this.previousLines.length > newLines.length) {
          let buffer = "\x1b[?2026h";
          // Move to end of new content (clamp to 0 for empty content)
          const targetRow = Math.max(0, newLines.length - 1);
          if (targetRow < prevViewportTop) {
            logRedraw(
              `deleted lines moved viewport up (${targetRow} < ${prevViewportTop})`,
            );
            fullRender(true);
            return;
          }
          const lineDiff = computeLineDiff(targetRow);
          if (lineDiff > 0) buffer += `\x1b[${lineDiff}B`;
          else if (lineDiff < 0) buffer += `\x1b[${-lineDiff}A`;
          buffer += "\r";
          // Clear extra lines without scrolling
          const extraLines = this.previousLines.length - newLines.length;
          if (extraLines > height) {
            logRedraw(`extraLines > height (${extraLines} > ${height})`);
            fullRender(true);
            return;
          }
          if (extraLines > 0) {
            buffer += "\x1b[1B";
          }
          for (let i = 0; i < extraLines; i++) {
            buffer += "\r\x1b[2K";
            if (i < extraLines - 1) buffer += "\x1b[1B";
          }
          if (extraLines > 0) {
            buffer += `\x1b[${extraLines}A`;
          }
          buffer += "\x1b[?2026l";
          this.terminal.write(buffer);
          this.cursorRow = targetRow;
          this.hardwareCursorRow = targetRow;
        }
        this.positionHardwareCursor(cursorPos, newLines.length);
        this.previousLines = newLines;
        this.previousWidth = width;
        this.previousHeight = height;
        this.previousViewportTop = prevViewportTop;
        return;
      }

      // Differential rendering can only touch what was actually visible.
      // If the first changed line is above the previous viewport, we need a full redraw.
      if (firstChanged < prevViewportTop) {
        logRedraw(
          `firstChanged < viewportTop (${firstChanged} < ${prevViewportTop})`,
        );
        fullRender(true);
        return;
      }

      // Render from first changed line to end
      // Build buffer with all updates wrapped in synchronized output
      let buffer = "\x1b[?2026h"; // Begin synchronized output
      const prevViewportBottom = prevViewportTop + height - 1;
      const moveTargetRow = appendStart ? firstChanged - 1 : firstChanged;
      if (moveTargetRow > prevViewportBottom) {
        const currentScreenRow = Math.max(
          0,
          Math.min(height - 1, hardwareCursorRow - prevViewportTop),
        );
        const moveToBottom = height - 1 - currentScreenRow;
        if (moveToBottom > 0) {
          buffer += `\x1b[${moveToBottom}B`;
        }
        const scroll = moveTargetRow - prevViewportBottom;
        buffer += "\r\n".repeat(scroll);
        prevViewportTop += scroll;
        viewportTop += scroll;
        hardwareCursorRow = moveTargetRow;
      }

      // Move cursor to first changed line (use hardwareCursorRow for actual position)
      const lineDiff = computeLineDiff(moveTargetRow);
      if (lineDiff > 0) {
        buffer += `\x1b[${lineDiff}B`; // Move down
      } else if (lineDiff < 0) {
        buffer += `\x1b[${-lineDiff}A`; // Move up
      }

      buffer += appendStart ? "\r\n" : "\r"; // Move to column 0

      // Only render changed lines (firstChanged to lastChanged), not all lines to end
      // This reduces flicker when only a single line changes (e.g., spinner animation)
      const renderEnd = Math.min(lastChanged, newLines.length - 1);
      for (let i = firstChanged; i <= renderEnd; i++) {
        if (i > firstChanged) buffer += "\r\n";
        buffer += "\x1b[2K"; // Clear current line
        const line = newLines[i];
        const isImage = isImageLine(line);
        if (!isImage && visibleWidth(line) > width) {
          // Log all lines to crash file for debugging
          const crashLogPath = path.join(
            os.homedir(),
            ".pi",
            "agent",
            "pi-crash.log",
          );
          const crashData = [
            `Crash at ${new Date().toISOString()}`,
            `Terminal width: ${width}`,
            `Line ${i} visible width: ${visibleWidth(line)}`,
            "",
            "=== All rendered lines ===",
            ...newLines.map((l, idx) => `[${idx}] (w=${visibleWidth(l)}) ${l}`),
            "",
          ].join("\n");
          fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
          fs.writeFileSync(crashLogPath, crashData);

          // Clean up terminal state before throwing
          this.stop();

          const errorMsg = [
            `Rendered line ${i} exceeds terminal width (${visibleWidth(line)} > ${width}).`,
            "",
            "This is likely caused by a custom TUI component not truncating its output.",
            "Use visibleWidth() to measure and truncateToWidth() to truncate lines.",
            "",
            `Debug log written to: ${crashLogPath}`,
          ].join("\n");
          throw new Error(errorMsg);
        }
        buffer += line;
      }

      // Track where cursor ended up after rendering
      let finalCursorRow = renderEnd;

      // If we had more lines before, clear them and move cursor back
      if (this.previousLines.length > newLines.length) {
        // Move to end of new content first if we stopped before it
        if (renderEnd < newLines.length - 1) {
          const moveDown = newLines.length - 1 - renderEnd;
          buffer += `\x1b[${moveDown}B`;
          finalCursorRow = newLines.length - 1;
        }
        const extraLines = this.previousLines.length - newLines.length;
        for (let i = newLines.length; i < this.previousLines.length; i++) {
          buffer += "\r\n\x1b[2K";
        }
        // Move cursor back to end of new content
        buffer += `\x1b[${extraLines}A`;
      }

      buffer += "\x1b[?2026l"; // End synchronized output

      if (process.env.PI_TUI_DEBUG === "1") {
        const debugDir = "/tmp/tui";
        fs.mkdirSync(debugDir, { recursive: true });
        const debugPath = path.join(
          debugDir,
          `render-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
        );
        const debugData = [
          `firstChanged: ${firstChanged}`,
          `viewportTop: ${viewportTop}`,
          `cursorRow: ${this.cursorRow}`,
          `height: ${height}`,
          `lineDiff: ${lineDiff}`,
          `hardwareCursorRow: ${hardwareCursorRow}`,
          `renderEnd: ${renderEnd}`,
          `finalCursorRow: ${finalCursorRow}`,
          `cursorPos: ${JSON.stringify(cursorPos)}`,
          `newLines.length: ${newLines.length}`,
          `previousLines.length: ${this.previousLines.length}`,
          "",
          "=== newLines ===",
          JSON.stringify(newLines, null, 2),
          "",
          "=== previousLines ===",
          JSON.stringify(this.previousLines, null, 2),
          "",
          "=== buffer ===",
          JSON.stringify(buffer),
        ].join("\n");
        fs.writeFileSync(debugPath, debugData);
      }

      // Write entire buffer at once
      this.terminal.write(buffer);

      // Track cursor position for next render
      // cursorRow tracks end of content (for viewport calculation)
      // hardwareCursorRow tracks actual terminal cursor position (for movement)
      this.cursorRow = Math.max(0, newLines.length - 1);
      this.hardwareCursorRow = finalCursorRow;
      // Track terminal's working area (grows but doesn't shrink unless cleared)
      this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
      this.previousViewportTop = Math.max(
        prevViewportTop,
        finalCursorRow - height + 1,
      );
      this.previousViewportScrollOffset = this.viewportScrollOffset;
      this.previousRenderTotalLines = renderTotalLines;

      // Position hardware cursor for IME
      this.positionHardwareCursor(cursorPos, newLines.length);

      this.previousLines = newLines;
      this.previousWidth = width;
      this.previousHeight = height;
    } finally {
      this.emitAfterRender(
        this.buildRenderContext(
          width,
          height,
          renderTotalLines,
          mouseCollector.takeRegions(),
          overlayMouseRegions,
          overlayContentRegions,
        ),
      );
    }
  }

  private renderFixedScreenFrame(
    newLines: string[],
    renderTotalLines: number,
    width: number,
    height: number,
    cursorPos: { row: number; col: number } | null,
  ): void {
    const widthChanged = this.previousWidth > 0 && this.previousWidth !== width;
    const heightChanged =
      this.previousHeight > 0 && this.previousHeight !== height;
    const dimensionsChanged =
      widthChanged || (heightChanged && !isTermuxSession());
    const contentShrank =
      this.previousRenderTotalLines > 0 &&
      renderTotalLines < this.previousRenderTotalLines;
    if (dimensionsChanged) {
      this.terminal.write("\x1b[2J\x1b[H");
      this.screenFrame = [];
      this.fullRedrawCount += 1;
    } else if (heightChanged) {
      // Termux resizes with the software keyboard. Rebuild the frame cache but
      // avoid counting/issuing a destructive full clear.
      this.screenFrame = [];
    } else if (contentShrank && this.clearOnShrink) {
      this.fullRedrawCount += 1;
    }

    const maxOffset = Math.max(0, renderTotalLines - height);
    this.viewportScrollOffset = Math.min(this.viewportScrollOffset, maxOffset);
    const viewportStart = Math.max(
      0,
      renderTotalLines - height - this.viewportScrollOffset,
    );
    const nextFrame = newLines.slice(viewportStart, viewportStart + height);
    while (nextFrame.length < height) nextFrame.push("");

    const frameChanged =
      nextFrame.length !== this.screenFrame.length ||
      nextFrame.some((line, index) => line !== this.screenFrame[index]);
    if (frameChanged) {
      let buffer = "\x1b[?2026h";
      const maxLines = Math.max(nextFrame.length, this.screenFrame.length);
      for (let row = 0; row < maxLines; row++) {
        const next = nextFrame[row] ?? "";
        if (next === (this.screenFrame[row] ?? "")) continue;
        buffer += `\x1b[${row + 1};1H${next}\x1b[K`;
      }
      buffer += "\x1b[?2026l";
      this.terminal.write(buffer);
      this.screenFrame = nextFrame;
    }

    this.previousLines = newLines;
    this.previousWidth = width;
    this.previousHeight = height;
    this.previousViewportTop = viewportStart;
    this.previousViewportScrollOffset = this.viewportScrollOffset;
    this.previousRenderTotalLines = renderTotalLines;
    this.maxLinesRendered = renderTotalLines;
    this.cursorRow = Math.max(0, renderTotalLines - 1);

    const visibleCursor =
      cursorPos &&
      cursorPos.row >= viewportStart &&
      cursorPos.row < viewportStart + height
        ? { row: cursorPos.row - viewportStart, col: cursorPos.col }
        : null;
    this.positionFixedScreenCursor(visibleCursor);
  }

  private positionFixedScreenCursor(
    cursorPos: { row: number; col: number } | null,
  ): void {
    if (
      !cursorPos ||
      !this.showHardwareCursor ||
      this.viewportScrollOffset > 0
    ) {
      if (this.hardwareCursorVisible) {
        this.terminal.hideCursor();
        this.hardwareCursorVisible = false;
      }
      return;
    }
    this.terminal.write(`\x1b[${cursorPos.row + 1};${cursorPos.col + 1}H`);
    this.hardwareCursorRow = cursorPos.row;
    this.hardwareCursorCol = cursorPos.col;
    if (!this.hardwareCursorVisible) {
      this.terminal.showCursor(this.hardwareCursorShape);
      this.hardwareCursorVisible = true;
    }
  }

  /**
   * Position the hardware cursor for IME candidate window.
   * @param cursorPos The cursor position extracted from rendered output, or null
   * @param totalLines Total number of rendered lines
   */
  private positionHardwareCursor(
    cursorPos: { row: number; col: number } | null,
    totalLines: number,
  ): void {
    if (!cursorPos || totalLines <= 0) {
      if (this.hardwareCursorVisible) {
        this.terminal.hideCursor();
        this.hardwareCursorVisible = false;
      }
      return;
    }

    const targetRow = Math.max(0, Math.min(cursorPos.row, totalLines - 1));
    const targetCol = Math.max(0, cursorPos.col);
    const targetVisible = this.showHardwareCursor;

    // When the hardware cursor is hidden (agent/tool streaming, loaders, etc.),
    // do not move it to the editor marker. Moving a hidden terminal cursor can
    // still scroll the viewport as chat/tool output grows, which makes the input
    // area visually follow the latest message instead of staying docked.
    if (!targetVisible) {
      if (this.hardwareCursorVisible) {
        this.terminal.hideCursor();
        this.hardwareCursorVisible = false;
      }
      return;
    }

    if (
      targetRow === this.hardwareCursorRow &&
      targetCol === this.hardwareCursorCol &&
      targetVisible === this.hardwareCursorVisible
    ) {
      return;
    }

    const rowDelta = targetRow - this.hardwareCursorRow;
    let buffer = "";
    if (rowDelta > 0) {
      buffer += `\x1b[${rowDelta}B`;
    } else if (rowDelta < 0) {
      buffer += `\x1b[${-rowDelta}A`;
    }
    if (rowDelta !== 0 || targetCol !== this.hardwareCursorCol) {
      buffer += `\x1b[${targetCol + 1}G`;
    }

    if (buffer) {
      this.terminal.write(buffer);
    }

    this.hardwareCursorRow = targetRow;
    this.hardwareCursorCol = targetCol;
    if (targetVisible !== this.hardwareCursorVisible) {
      if (targetVisible) {
        this.terminal.showCursor(this.hardwareCursorShape);
      } else {
        this.terminal.hideCursor();
      }
      this.hardwareCursorVisible = targetVisible;
    }
  }
}
