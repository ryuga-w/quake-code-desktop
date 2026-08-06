export const LEFT_SIDEBAR_CLOSE_THRESHOLD = 240;
export const LEFT_SIDEBAR_MIN_WIDTH = 280;
// Keep the navigation rail compact like the reference shell. The rail may be
// dragged, but it must never consume half of a desktop window.
export const LEFT_SIDEBAR_DEFAULT_WIDTH = 320;
// Give the compact rail a little extra breathing room while keeping it well
// short of the half-window layout shown in the reference shell.
export const LEFT_SIDEBAR_MAX_WIDTH = 360;

export const LEFT_SIDEBAR_SIZES = ["quarter", "half"] as const;
export type LeftSidebarSize = (typeof LEFT_SIDEBAR_SIZES)[number];

const DEFAULT_VIEWPORT_WIDTH = 1440;

/** Keep the navigation rail adjustable without letting it dominate the workspace. */
export function clampLeftSidebarWidth(value: number, maxWidth = LEFT_SIDEBAR_MAX_WIDTH): number {
  if (!Number.isFinite(value)) return LEFT_SIDEBAR_DEFAULT_WIDTH;
  const upperBound = Math.max(LEFT_SIDEBAR_MIN_WIDTH, Math.round(maxWidth));
  return Math.round(Math.min(upperBound, Math.max(LEFT_SIDEBAR_MIN_WIDTH, value)));
}

export function isLeftSidebarSize(value: unknown): value is LeftSidebarSize {
  return typeof value === "string" && (LEFT_SIDEBAR_SIZES as readonly string[]).includes(value);
}

export function getLeftSidebarMaximumWidth(viewportWidth = DEFAULT_VIEWPORT_WIDTH): number {
  const safeViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0
    ? Math.round(viewportWidth)
    : DEFAULT_VIEWPORT_WIDTH;
  return LEFT_SIDEBAR_MAX_WIDTH;
}

/** Resolves the compact and expanded left-nav stops against the current app window. */
export function getLeftSidebarSnapWidth(size: LeftSidebarSize, viewportWidth = DEFAULT_VIEWPORT_WIDTH): number {
  const safeViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0
    ? Math.round(viewportWidth)
    : DEFAULT_VIEWPORT_WIDTH;
  const ratio = size === "quarter" ? 0.25 : 0.5;
  const targetWidth = Math.round(safeViewportWidth * ratio);
  return clampLeftSidebarWidth(targetWidth, getLeftSidebarMaximumWidth(safeViewportWidth));
}

/** Returns the nearest stop after a pointer resize. */
export function nearestLeftSidebarSize(width: number, viewportWidth = DEFAULT_VIEWPORT_WIDTH): LeftSidebarSize {
  if (LEFT_SIDEBAR_MAX_WIDTH <= LEFT_SIDEBAR_DEFAULT_WIDTH) return "quarter";
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : LEFT_SIDEBAR_DEFAULT_WIDTH;
  return LEFT_SIDEBAR_SIZES.reduce((closest, candidate) => {
    const candidateDistance = Math.abs(getLeftSidebarSnapWidth(candidate, viewportWidth) - safeWidth);
    const closestDistance = Math.abs(getLeftSidebarSnapWidth(closest, viewportWidth) - safeWidth);
    return candidateDistance < closestDistance ? candidate : closest;
  }, LEFT_SIDEBAR_SIZES[0]);
}

export function nextLeftSidebarSize(size: LeftSidebarSize): LeftSidebarSize {
  // The rail intentionally has one compact open state. Keep the legacy
  // `half` enum readable for stored settings, but never navigate into it.
  void size;
  return "quarter";
}

export function leftSidebarSizeLabel(size: LeftSidebarSize): string {
  if (size === "quarter") return "Çeyrek";
  return "Yarım";
}
