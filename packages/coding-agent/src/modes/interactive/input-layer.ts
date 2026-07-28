import {
  isOverlayChromeTarget,
  isOverlayInteractiveTarget,
  type MouseEvent,
  type PointerShape,
  parseSgrMouse,
  setHoverMouseMode,
  setPointerShape,
  type Terminal,
} from "@mrquake/quakecode-tui";
import type { ToolExecutionComponent } from "./components/tool-execution.js";
import type { WelcomeMenuAction } from "./components/welcome-board.js";
import { DragTracker } from "./drag-tracker.js";
import type { MouseLayoutBuilder } from "./mouse-layout.js";

const HOVER_THROTTLE_MS = 80;

export interface InteractiveInputCallbacks {
  isOverlayActive: () => boolean;
  isAutocompleteActive?: () => boolean;
  isStartupHeroActive: () => boolean;
  hasHoverTargets?: () => boolean;
  getLayoutBuilder: () => MouseLayoutBuilder;
  getContentWidth: (totalWidth: number) => number;
  getTerminal: () => Terminal;
  requestRender: (full?: boolean) => void;
  onToolClick: (tool: ToolExecutionComponent) => void;
  onWelcomeAction: (action: WelcomeMenuAction) => void;
  onWheelScroll: (direction: "up" | "down") => void;
  onAutocompleteWheelScroll?: (direction: "up" | "down") => void;
  onOverlayWheelScroll?: (direction: "up" | "down") => void;
  onOverlayItemHover?: (index: number | null) => void;
  onOverlayItemClick?: (index: number) => void;
  onToolHover: (tool: ToolExecutionComponent | undefined) => void;
  onWelcomeHover: (action: WelcomeMenuAction | null) => void;
  onAutocompleteHover: (filteredIndex: number | null) => void;
  onAutocompleteClick: (filteredIndex: number) => void;
  onDragStart?: (x: number, y: number) => void;
  onDrag?: (x: number, y: number) => void;
  onDragEnd?: (x: number, y: number) => void;
  getMaxScrollOffset: () => number;
  getScrollOffset: () => number;
  setScrollOffset: (offset: number) => void;
}

export class InteractiveInputLayer {
  private readonly dragTracker: DragTracker;
  private lastHoverAt = 0;
  private hoverModeEnabled = false;
  private activePointerShape: PointerShape | null = null;
  private hoveredTool: ToolExecutionComponent | undefined;
  private hoveredWelcomeAction: WelcomeMenuAction | null = null;
  private hoveredAutocompleteIndex: number | null = null;
  private hoveredOverlayIndex: number | null = null;

  constructor(private readonly callbacks: InteractiveInputCallbacks) {
    this.dragTracker = new DragTracker({
      onDragStart: (session) =>
        this.callbacks.onDragStart?.(session.start.x, session.start.y),
      onDrag: (session) =>
        this.callbacks.onDrag?.(session.current.x, session.current.y),
      onDragEnd: (session) =>
        this.callbacks.onDragEnd?.(session.current.x, session.current.y),
      onClick: (point) => {
        void this.dispatchClick(point.x, point.y);
      },
    });
  }

  handleRawInput(data: string): { consume?: boolean } | undefined {
    const mouse = parseSgrMouse(data);
    if (!mouse) return undefined;
    // Eagerly sync hover mode on any mouse input. This helps bootstrap 1003
    // mode even if afterRender timing or hasHoverTargets was not sufficient.
    this.syncHoverTracking();
    return this.handleMouse(mouse);
  }

  /**
   * Proactively enable/disable xterm mode 1003 (all-motion / hover).
   * Terminals never send hover motion until 1003 is already on — enabling only
   * after the first motion event is a chicken-and-egg bug.
   */
  syncHoverTracking(): void {
    const shouldEnable =
      this.shouldKeepHoverMode() || this.callbacks.hasHoverTargets?.() === true;
    const terminal = this.callbacks.getTerminal();
    if (shouldEnable && !this.hoverModeEnabled) {
      setHoverMouseMode(terminal, true);
      this.hoverModeEnabled = true;
    }
    // Do not auto-disable here. Keep 1003 on for reliable hover once enabled.
    // Disable only on dispose to avoid chicken-egg for pure motion events.
  }

  dispose(): void {
    if (this.hoverModeEnabled) {
      setHoverMouseMode(this.callbacks.getTerminal(), false);
      this.hoverModeEnabled = false;
    }
    this.setPointerShapeIfNeeded(null);
    this.dragTracker.reset();
    this.setHoveredTool(undefined);
    this.setHoveredWelcome(null);
    this.setHoveredAutocomplete(null);
    this.setHoveredOverlayItem(null);
  }

  private handleMouse(event: MouseEvent): { consume?: boolean } | undefined {
    if (this.callbacks.isOverlayActive()) {
      return this.handleOverlayMouse(event);
    }

    // Logical separation:
    // - Pure hover motion (no button pressed, button===35 after strip): ALWAYS process for UI hover feedback (underlines, pointer shapes).
    //   Modifiers do not bypass hover; hover is app's responsibility.
    // - Button events (clicks, drags: down, up, motion-with-button): if shift/ctrl, BYPASS to allow terminal native text selection.
    //   This fixes user needing Ctrl for hover, while still supporting modifier+drag for selection.
    const isPureHoverMotion = event.type === "motion" && event.button === 35;
    const isButtonRelated = !isPureHoverMotion;

    if (isButtonRelated && (event.shift || event.ctrl)) {
      return undefined;
    }

    if (event.type === "wheel") {
      return this.handleWheel(event);
    }

    if (event.type === "motion") {
      if (this.dragTracker.onPointerMove({ x: event.x, y: event.y })) {
        return { consume: true };
      }
      return this.handleHoverMotion(event);
    }

    if (event.type === "down" || event.type === "up") {
      // Mouse clicks are intentionally inert. Keep consuming their escape
      // sequences so they cannot leak into the editor; wheel scrolling and
      // hover feedback remain available.
      this.dragTracker.reset();
      return { consume: true };
    }

    return undefined;
  }

  private handleWheel(event: MouseEvent): { consume?: boolean } | undefined {
    if (event.type !== "wheel") return undefined;

    if (this.callbacks.isAutocompleteActive?.()) {
      this.callbacks.onAutocompleteWheelScroll?.(event.direction);
      return { consume: true };
    }

    const hit = this.callbacks.getLayoutBuilder().hitTest(event.x, event.y);
    if (hit?.region.id.startsWith("editor:")) {
      return { consume: true };
    }

    this.callbacks.onWheelScroll(event.direction);
    return { consume: true };
  }

  private handleOverlayMouse(
    event: MouseEvent,
  ): { consume?: boolean } | undefined {
    // Same logical rule as main handleMouse for overlays:
    // Pure hover motions always processed (for list hover, X highlight).
    // Button events with modifier bypassed for native terminal selection.
    const isPureHoverMotion = event.type === "motion" && event.button === 35;
    const isButtonRelated = !isPureHoverMotion;

    if (isButtonRelated && (event.shift || event.ctrl)) {
      return undefined;
    }

    if (event.type === "wheel") {
      this.callbacks.onOverlayWheelScroll?.(event.direction);
      return { consume: true };
    }

    if (event.type === "motion") {
      const hit = this.callbacks.getLayoutBuilder().hitTest(event.x, event.y);
      // Track pointer for consistent drag/click classification even inside overlays.
      this.dragTracker.onPointerMove({ x: event.x, y: event.y });
      if (hit?.region.id.startsWith("overlay-item:")) {
        const index = this.parseOverlayItemIndex(hit.region.id);
        this.setHoveredOverlayItem(index);
        this.updateHoverChrome(true);
        return { consume: true };
      }
      this.setHoveredOverlayItem(null);
      this.updateHoverChrome(hit?.region.id === "overlay:close");
      return { consume: true };
    }

    if (event.type === "down" || event.type === "up") {
      // Overlay controls are keyboard-only as well; mouse clicks must not
      // close dialogs or select list items.
      this.dragTracker.reset();
      return { consume: true };
    }

    return { consume: true };
  }

  private handleHoverMotion(
    event: MouseEvent,
  ): { consume?: boolean } | undefined {
    const now = Date.now();
    const isThrottled = now - this.lastHoverAt < HOVER_THROTTLE_MS;

    const layout = this.callbacks.getLayoutBuilder();
    const hit = layout.hitTest(event.x, event.y);

    // Always update pointer shape immediately (cheap OSC 22 write).
    // Throttle only expensive hover state changes + requestRender.
    if (this.callbacks.isStartupHeroActive()) {
      if (hit?.region.id.startsWith("welcome:")) {
        this.setPointerShapeIfNeeded("pointer");
      } else {
        this.setPointerShapeIfNeeded(null);
      }
    } else if (hit?.region.id.startsWith("editor:")) {
      this.setPointerShapeIfNeeded(null); // default (normal arrow) over input too; blinking fake caret indicates editing
    } else if (
      hit?.region.id.startsWith("autocomplete:") ||
      hit?.region.id.startsWith("welcome:") ||
      hit?.region.id === "overlay:close"
    ) {
      this.setPointerShapeIfNeeded("pointer");
    } else {
      const tool = layout.hitTestTool(event.x, event.y);
      this.setPointerShapeIfNeeded(tool ? "pointer" : null);
    }

    if (isThrottled) {
      return { consume: true };
    }
    this.lastHoverAt = now;

    // Full state updates (may request render) only when not throttled
    if (this.callbacks.isStartupHeroActive()) {
      if (hit?.region.id.startsWith("welcome:")) {
        const action = hit.region.id.slice(
          "welcome:".length,
        ) as WelcomeMenuAction;
        this.setHoveredTool(undefined);
        this.setHoveredAutocomplete(null);
        this.setHoveredOverlayItem(null);
        this.setHoveredWelcome(action);
        this.updateHoverChrome(true, "pointer"); // shape already set above
        return { consume: true };
      }
      this.setHoveredAutocomplete(null);
      this.setHoveredWelcome(null);
      this.setHoveredOverlayItem(null);
      this.setHoveredTool(undefined);
      this.updateHoverChrome(false);
      return { consume: true };
    }

    if (hit?.region.id.startsWith("editor:")) {
      this.setHoveredTool(undefined);
      this.setHoveredWelcome(null);
      this.setHoveredOverlayItem(null);
      this.setHoveredAutocomplete(null);
      this.updateHoverChrome(false); // default shape (normal cursor)
      return { consume: true };
    }

    if (hit?.region.id.startsWith("autocomplete:")) {
      const index = Number.parseInt(
        hit.region.id.slice("autocomplete:".length),
        10,
      );
      this.setHoveredTool(undefined);
      this.setHoveredWelcome(null);
      this.setHoveredOverlayItem(null);
      this.setHoveredAutocomplete(Number.isFinite(index) ? index : null);
      this.updateHoverChrome(true, "pointer");
      return { consume: true };
    }

    if (hit?.region.id.startsWith("welcome:")) {
      const action = hit.region.id.slice(
        "welcome:".length,
      ) as WelcomeMenuAction;
      this.setHoveredTool(undefined);
      this.setHoveredAutocomplete(null);
      this.setHoveredOverlayItem(null);
      this.setHoveredWelcome(action);
      this.updateHoverChrome(true, "pointer");
      return { consume: true };
    }

    const tool = layout.hitTestTool(event.x, event.y);
    this.setHoveredAutocomplete(null);
    this.setHoveredWelcome(null);
    this.setHoveredOverlayItem(null);
    this.setHoveredTool(tool);
    this.updateHoverChrome(Boolean(tool));
    return { consume: true };
  }

  private dispatchClick(
    x: number,
    y: number,
  ): { consume?: boolean } | undefined {
    if (this.callbacks.isOverlayActive()) {
      return this.dispatchOverlayClick(x, y);
    }

    const layout = this.callbacks.getLayoutBuilder();
    const hit = layout.hitTest(x, y);

    if (hit?.region.id.startsWith("autocomplete:")) {
      const index = Number.parseInt(
        hit.region.id.slice("autocomplete:".length),
        10,
      );
      if (Number.isFinite(index)) {
        this.callbacks.onAutocompleteClick(index);
      }
      return { consume: true };
    }

    if (hit?.region.id.startsWith("welcome:")) {
      const action = hit.region.id.slice(
        "welcome:".length,
      ) as WelcomeMenuAction;
      this.callbacks.onWelcomeAction(action);
      return { consume: true };
    }

    const tool = layout.hitTestTool(x, y);
    if (tool) {
      this.callbacks.onToolClick(tool);
      return { consume: true };
    }

    return undefined;
  }

  private dispatchOverlayClick(
    x: number,
    y: number,
  ): { consume?: boolean } | undefined {
    const hit = this.callbacks.getLayoutBuilder().hitTest(x, y);
    if (!hit) return { consume: true };

    if (hit.region.id === "overlay:close") {
      const target = hit.region.target;
      if (isOverlayChromeTarget(target)) {
        target.invokeClose();
      }
      return { consume: true };
    }

    if (hit.region.id.startsWith("overlay-item:")) {
      const index = this.parseOverlayItemIndex(hit.region.id);
      if (index !== null) {
        this.callbacks.onOverlayItemClick?.(index);
      }
      return { consume: true };
    }

    return { consume: true };
  }

  private parseOverlayItemIndex(regionId: string): number | null {
    const parts = regionId.split(":");
    const index = Number.parseInt(parts[2] ?? "", 10);
    return Number.isFinite(index) ? index : null;
  }

  private setHoveredOverlayItem(index: number | null): void {
    if (this.hoveredOverlayIndex === index) return;
    this.hoveredOverlayIndex = index;
    this.callbacks.onOverlayItemHover?.(index);
    this.callbacks.requestRender();
  }

  private setHoveredWelcome(action: WelcomeMenuAction | null): void {
    if (this.hoveredWelcomeAction === action) return;
    this.hoveredWelcomeAction = action;
    this.callbacks.onWelcomeHover(action);
    this.callbacks.requestRender();
  }

  private setHoveredAutocomplete(index: number | null): void {
    if (this.hoveredAutocompleteIndex === index) return;
    this.hoveredAutocompleteIndex = index;
    this.callbacks.onAutocompleteHover(index);
    this.callbacks.requestRender();
  }

  private setHoveredTool(tool: ToolExecutionComponent | undefined): void {
    if (this.hoveredTool === tool) return;
    if (this.hoveredTool) {
      this.hoveredTool.setMouseHovered(false);
    }
    this.hoveredTool = tool;
    if (tool) {
      tool.setMouseHovered(true);
    }
    this.callbacks.onToolHover(tool);
    this.callbacks.requestRender();
  }

  private shouldKeepHoverMode(): boolean {
    return (
      this.callbacks.isOverlayActive() ||
      this.callbacks.isAutocompleteActive?.() === true ||
      this.callbacks.isStartupHeroActive() ||
      this.hoveredTool !== undefined ||
      this.hoveredWelcomeAction !== null
    );
  }

  private updateHoverChrome(
    showPointer: boolean,
    shape: PointerShape = "pointer",
  ): void {
    this.syncHoverTracking();
    this.setPointerShapeIfNeeded(showPointer ? shape : null);
  }

  private setPointerShapeIfNeeded(shape: PointerShape | null): void {
    if (this.activePointerShape === shape) return;
    const terminal = this.callbacks.getTerminal();
    if (shape === null) {
      setPointerShape(terminal, "default");
    } else {
      setPointerShape(terminal, shape);
    }
    this.activePointerShape = shape;
  }
}
