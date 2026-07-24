export const LEFT_SIDEBAR_CLOSE_THRESHOLD = 240;
export const LEFT_SIDEBAR_MIN_WIDTH = 280;
export const LEFT_SIDEBAR_DEFAULT_WIDTH = 340;
export const LEFT_SIDEBAR_MAX_WIDTH = 500;

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
  return Math.max(LEFT_SIDEBAR_MAX_WIDTH, Math.round(safeViewportWidth * 0.5));
}

/** Resolves the compact and expanded left-nav stops against the current app window. */
export function getLeftSidebarSnapWidth(size: LeftSidebarSize, viewportWidth = DEFAULT_VIEWPORT_WIDTH): number {
  const safeViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0
    ? Math.round(viewportWidth)
    : DEFAULT_VIEWPORT_WIDTH;
  const ratio = size === "quarter" ? 0.25 : 0.5;
  const targetWidth = Math.round(safeViewportWidth * ratio);
  return clampLeftSidebarWidth(targetWidth, Math.max(getLeftSidebarMaximumWidth(safeViewportWidth), targetWidth));
}

/** Returns the nearest stop after a pointer resize. */
export function nearestLeftSidebarSize(width: number, viewportWidth = DEFAULT_VIEWPORT_WIDTH): LeftSidebarSize {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : LEFT_SIDEBAR_DEFAULT_WIDTH;
  return LEFT_SIDEBAR_SIZES.reduce((closest, candidate) => {
    const candidateDistance = Math.abs(getLeftSidebarSnapWidth(candidate, viewportWidth) - safeWidth);
    const closestDistance = Math.abs(getLeftSidebarSnapWidth(closest, viewportWidth) - safeWidth);
    return candidateDistance < closestDistance ? candidate : closest;
  }, LEFT_SIDEBAR_SIZES[0]);
}

export function nextLeftSidebarSize(size: LeftSidebarSize): LeftSidebarSize {
  const index = LEFT_SIDEBAR_SIZES.indexOf(size);
  return LEFT_SIDEBAR_SIZES[(index + 1) % LEFT_SIDEBAR_SIZES.length];
}

export function leftSidebarSizeLabel(size: LeftSidebarSize): string {
  if (size === "quarter") return "Çeyrek";
  return "Yarım";
}
