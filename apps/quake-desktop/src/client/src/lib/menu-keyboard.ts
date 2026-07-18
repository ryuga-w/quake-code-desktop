const MENU_ITEM_SELECTOR = [
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
].join(",");

export type MenuNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

type MenuKeyboardEvent = {
  key: string;
  currentTarget: HTMLElement;
  target: EventTarget | null;
  preventDefault: () => void;
  stopPropagation: () => void;
};

type MenuKeyboardOptions = {
  onEscape?: () => void;
};

function isDisabledMenuItem(item: HTMLElement): boolean {
  return item.getAttribute("aria-disabled") === "true"
    || ("disabled" in item && Boolean((item as HTMLButtonElement).disabled));
}

/**
 * Returns only actionable items owned by this menu. Items from a nested submenu
 * are deliberately excluded so each open menu keeps an independent focus loop.
 */
export function getMenuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)).filter((item) => (
    item.closest<HTMLElement>('[role="menu"]') === menu && !isDisabledMenuItem(item)
  ));
}

/** Pure index resolver kept separate so keyboard behavior is easy to unit test. */
export function resolveMenuNavigationIndex(
  key: MenuNavigationKey,
  currentIndex: number,
  itemCount: number,
): number | null {
  if (itemCount <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowDown") return currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount;
  return currentIndex < 0 ? itemCount - 1 : (currentIndex - 1 + itemCount) % itemCount;
}

export function focusFirstMenuItem(menu: HTMLElement | null): boolean {
  const firstItem = menu ? getMenuItems(menu)[0] : undefined;
  if (!firstItem) return false;
  firstItem.focus({ preventScroll: true });
  return true;
}

/** Restore focus after the menu has unmounted, without depending on React. */
export function restoreMenuTriggerFocus(trigger: HTMLElement | null): void {
  if (!trigger) return;
  const focus = () => trigger.focus({ preventScroll: true });
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(focus);
  else setTimeout(focus, 0);
}

/**
 * Shared vertical menu keyboard contract. Native buttons retain Enter/Space and
 * click behavior; this helper only owns roving focus plus Escape dismissal.
 */
export function handleMenuKeyDown(
  event: MenuKeyboardEvent,
  options: MenuKeyboardOptions = {},
): boolean {
  if (event.key === "Escape") {
    if (!options.onEscape) return false;
    event.preventDefault();
    event.stopPropagation();
    options.onEscape();
    return true;
  }

  if (
    event.key !== "ArrowDown"
    && event.key !== "ArrowUp"
    && event.key !== "Home"
    && event.key !== "End"
  ) {
    return false;
  }

  const items = getMenuItems(event.currentTarget);
  const target = event.target as Node | null;
  const currentIndex = items.findIndex((item) => item === target || Boolean(target && item.contains(target)));
  const nextIndex = resolveMenuNavigationIndex(event.key, currentIndex, items.length);
  if (nextIndex === null) return false;

  event.preventDefault();
  event.stopPropagation();
  items[nextIndex]?.focus({ preventScroll: true });
  return true;
}
