type ComposerPlanShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "repeat" | "isComposing" | "target"
>;

export function isComposerPlanShortcut(
  event: ComposerPlanShortcutEvent,
  composer: HTMLTextAreaElement | null,
): boolean {
  if (
    event.key !== "Tab"
    || !event.shiftKey
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.repeat
    || event.isComposing
  ) return false;
  return Boolean(
    composer
    && event.target === composer
    && composer.ownerDocument.activeElement === composer,
  );
}
