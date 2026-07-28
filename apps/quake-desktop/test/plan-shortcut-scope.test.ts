import { describe, expect, it } from "vitest";
import { isComposerPlanShortcut } from "../src/client/src/app/plan-shortcut";

type ShortcutEvent = Parameters<typeof isComposerPlanShortcut>[0];

function createComposer(active = true) {
  const ownerDocument = { activeElement: null as unknown };
  const composer = { ownerDocument } as HTMLTextAreaElement;
  ownerDocument.activeElement = active ? composer : {};
  return composer;
}

function createEvent(target: EventTarget | null, overrides: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return {
    key: "Tab",
    shiftKey: true,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    target,
    ...overrides,
  };
}

describe("composer plan shortcut scope", () => {
  it("accepts Shift+Tab only from the focused composer textarea", () => {
    const composer = createComposer();

    expect(isComposerPlanShortcut(createEvent(composer), composer)).toBe(true);
    expect(isComposerPlanShortcut(createEvent({} as EventTarget), composer)).toBe(false);
    expect(isComposerPlanShortcut(createEvent(composer), createComposer(false))).toBe(false);
    expect(isComposerPlanShortcut(createEvent(composer), null)).toBe(false);
  });

  it("preserves modified, repeated, composing, and ordinary Tab behavior", () => {
    const composer = createComposer();

    expect(isComposerPlanShortcut(createEvent(composer, { shiftKey: false }), composer)).toBe(false);
    expect(isComposerPlanShortcut(createEvent(composer, { ctrlKey: true }), composer)).toBe(false);
    expect(isComposerPlanShortcut(createEvent(composer, { metaKey: true }), composer)).toBe(false);
    expect(isComposerPlanShortcut(createEvent(composer, { altKey: true }), composer)).toBe(false);
    expect(isComposerPlanShortcut(createEvent(composer, { repeat: true }), composer)).toBe(false);
    expect(isComposerPlanShortcut(createEvent(composer, { isComposing: true }), composer)).toBe(false);
  });
});
