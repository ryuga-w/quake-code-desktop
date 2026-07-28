import type { RenderContext } from "@mrquake/quakecode-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.js";
import { InteractiveInputLayer } from "../src/modes/interactive/input-layer.js";
import { MouseLayoutBuilder } from "../src/modes/interactive/mouse-layout.js";

function createLayer(
  overrides: Partial<
    ConstructorParameters<typeof InteractiveInputLayer>[0]
  > = {},
) {
  const builder = new MouseLayoutBuilder({ getContentWidth: () => 60 });
  const ctx: RenderContext = {
    width: 80,
    height: 24,
    totalLines: 10,
    viewportStart: 0,
    viewportScrollOffset: 0,
    mouseRegions: [
      {
        id: "welcome:newSession",
        contentLineStart: 2,
        contentLineEnd: 3,
        xStart: 10,
        xEnd: 40,
        target: {},
      },
    ],
    overlayMouseRegions: [],
    overlayContentRegions: [],
  };
  builder.rebuild(ctx);

  const callbacks = {
    isOverlayActive: () => false,
    isStartupHeroActive: () => false,
    getLayoutBuilder: () => builder,
    getContentWidth: () => 60,
    getTerminal: () => ({ write: () => {} }),
    requestRender: vi.fn(),
    onToolClick: vi.fn(),
    onWelcomeAction: vi.fn(),
    onWheelScroll: vi.fn(),
    onToolHover: vi.fn(),
    onWelcomeHover: vi.fn(),
    onAutocompleteHover: vi.fn(),
    onAutocompleteClick: vi.fn(),
    getMaxScrollOffset: () => 100,
    getScrollOffset: () => 0,
    setScrollOffset: vi.fn(),
    ...overrides,
  };

  return { layer: new InteractiveInputLayer(callbacks), callbacks, builder };
}

describe("InteractiveInputLayer", () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });

  test("consumes wheel events and scrolls chat", () => {
    const { layer, callbacks } = createLayer();
    const result = layer.handleRawInput("\x1b[<64;1;1M");
    expect(result?.consume).toBe(true);
    expect(callbacks.onWheelScroll).toHaveBeenCalledWith("up");
  });

  test("consumes welcome menu clicks without dispatching actions", () => {
    const { layer, callbacks } = createLayer();
    const down = layer.handleRawInput("\x1b[<0;11;3M");
    const up = layer.handleRawInput("\x1b[<0;11;3m");
    expect(down?.consume).toBe(true);
    expect(up?.consume).toBe(true);
    expect(callbacks.onWelcomeAction).not.toHaveBeenCalled();
  });

  test("does not close overlays when the close button is clicked", () => {
    const invokeClose = vi.fn();
    const builder = new MouseLayoutBuilder({ getContentWidth: () => 80 });
    builder.rebuild({
      width: 80,
      height: 24,
      totalLines: 24,
      viewportStart: 0,
      viewportScrollOffset: 0,
      mouseRegions: [],
      overlayMouseRegions: [
        {
          id: "overlay:close",
          contentLineStart: 5,
          contentLineEnd: 6,
          xStart: 70,
          xEnd: 80,
          screenRelative: true,
          target: { collectOverlayMouseRegions: () => [], invokeClose },
        },
      ],
      overlayContentRegions: [],
    });
    const { layer } = createLayer({
      isOverlayActive: () => true,
      getLayoutBuilder: () => builder,
    });
    layer.handleRawInput("\x1b[<0;75;6M");
    layer.handleRawInput("\x1b[<0;75;6m");
    expect(invokeClose).not.toHaveBeenCalled();
  });

  test("routes wheel to autocomplete when dropdown is open", () => {
    const onAutocompleteWheelScroll = vi.fn();
    const onWheelScroll = vi.fn();
    const { layer } = createLayer({
      isAutocompleteActive: () => true,
      onAutocompleteWheelScroll,
      onWheelScroll,
    });
    layer.handleRawInput("\x1b[<65;1;1M");
    expect(onAutocompleteWheelScroll).toHaveBeenCalledWith("down");
    expect(onWheelScroll).not.toHaveBeenCalled();
  });

  test("ignores wheel over editor input region", () => {
    const builder = new MouseLayoutBuilder({ getContentWidth: () => 80 });
    builder.rebuild({
      width: 80,
      height: 24,
      totalLines: 30,
      viewportStart: 6,
      viewportScrollOffset: 0,
      mouseRegions: [
        {
          id: "editor:input",
          contentLineStart: 24,
          contentLineEnd: 30,
          target: {},
        },
      ],
      overlayMouseRegions: [],
      overlayContentRegions: [],
    });
    const onWheelScroll = vi.fn();
    const { layer } = createLayer({
      getLayoutBuilder: () => builder,
      onWheelScroll,
    });
    layer.handleRawInput("\x1b[<65;11;19M");
    expect(onWheelScroll).not.toHaveBeenCalled();
  });

  test("proactively enables 1003 when hover targets exist", () => {
    const terminalWrites: string[] = [];
    const builder = new MouseLayoutBuilder({ getContentWidth: () => 80 });
    builder.rebuild({
      width: 80,
      height: 24,
      totalLines: 10,
      viewportStart: 0,
      viewportScrollOffset: 0,
      mouseRegions: [
        {
          id: "tool:1",
          contentLineStart: 2,
          contentLineEnd: 3,
          target: {},
        },
      ],
      overlayMouseRegions: [],
      overlayContentRegions: [],
    });
    const { layer } = createLayer({
      hasHoverTargets: () => builder.hasHoverTargets(),
      getLayoutBuilder: () => builder,
      getTerminal: () => ({
        write: (data: string) => terminalWrites.push(data),
      }),
    });
    layer.syncHoverTracking();
    expect(terminalWrites.some((w) => w.includes("?1003h"))).toBe(true);
  });

  test("startup hero enables motion tracking on non-menu hover", () => {
    const terminalWrites: string[] = [];
    const { layer } = createLayer({
      isStartupHeroActive: () => true,
      getTerminal: () => ({
        write: (data: string) => terminalWrites.push(data),
      }),
    });
    const result = layer.handleRawInput("\x1b[<35;20;5M");
    vi.advanceTimersByTime(100);
    expect(result?.consume).toBe(true);
    expect(terminalWrites.some((w) => w.includes("?1003h"))).toBe(true);
  });

  test("throttles hover motion events", () => {
    const { layer } = createLayer();
    expect(layer.handleRawInput("\x1b[<35;5;5M")?.consume).toBe(true);
    expect(layer.handleRawInput("\x1b[<35;6;5M")?.consume).toBe(true);
  });

  // === Modifier bypass logic tests (Shift/Ctrl for native selection) ===
  // Pure hover motions (button=35) must ALWAYS be processed for UI hover feedback,
  // even with modifiers. Only button events (click/drag) bypass when modifier held.

  test("pure hover motion with ctrl is still processed (hover feedback works without forcing modifier for UI)", () => {
    const terminalWrites: string[] = [];
    const builder = new MouseLayoutBuilder({ getContentWidth: () => 80 });
    builder.rebuild({
      width: 80,
      height: 24,
      totalLines: 10,
      viewportStart: 0,
      viewportScrollOffset: 0,
      mouseRegions: [
        { id: "tool:1", contentLineStart: 2, contentLineEnd: 3, target: {} },
      ],
      overlayMouseRegions: [],
      overlayContentRegions: [],
    });
    const { layer } = createLayer({
      hasHoverTargets: () => builder.hasHoverTargets(),
      getLayoutBuilder: () => builder,
      getTerminal: () => ({
        write: (data: string) => terminalWrites.push(data),
      }),
    });
    // 35 (hover) + 16 (ctrl) = 51
    const result = layer.handleRawInput("\x1b[<51;20;5M");
    expect(result?.consume).toBe(true); // should process hover (not bypass pure motion)
    expect(terminalWrites.some((w) => w.includes("?1003h"))).toBe(true);
  });

  test("pure hover motion with shift is still processed", () => {
    const { layer } = createLayer();
    // 35 + 4 (shift) = 39
    const result = layer.handleRawInput("\x1b[<39;5;5M");
    expect(result?.consume).toBe(true);
  });

  test("button events with ctrl are bypassed (return undefined to allow terminal native selection)", () => {
    const { layer, callbacks } = createLayer();
    // down with ctrl: 0 + 16 = 16
    const downResult = layer.handleRawInput("\x1b[<16;11;3M");
    expect(downResult).toBeUndefined();

    // up with ctrl
    const upResult = layer.handleRawInput("\x1b[<16;11;3m");
    expect(upResult).toBeUndefined();

    // should NOT dispatch welcome action
    expect(callbacks.onWelcomeAction).not.toHaveBeenCalled();
  });

  // Note on shift+left: raw=4 collides with wheel-up in parser (see mouse.ts wheel check before strip).
  // Ctrl + left (raw=16) and Alt+left (raw=8) parse correctly as button+mod.
  // We support shift||ctrl for bypass (shift may go through wheel path in collision case).

  test("normal button clicks are inert", () => {
    const { layer, callbacks } = createLayer();
    expect(layer.handleRawInput("\x1b[<0;11;3M")?.consume).toBe(true);
    expect(layer.handleRawInput("\x1b[<0;11;3m")?.consume).toBe(true);
    expect(callbacks.onWelcomeAction).not.toHaveBeenCalled();
  });
});
