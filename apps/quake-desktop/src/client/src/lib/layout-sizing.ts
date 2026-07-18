export const LEFT_SIDEBAR_CLOSE_THRESHOLD = 240;
export const LEFT_SIDEBAR_MIN_WIDTH = 280;
export const LEFT_SIDEBAR_DEFAULT_WIDTH = 340;
export const LEFT_SIDEBAR_MAX_WIDTH = 420;

/** Keep the navigation rail adjustable without letting it dominate the workspace. */
export function clampLeftSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return LEFT_SIDEBAR_DEFAULT_WIDTH;
  return Math.round(Math.min(LEFT_SIDEBAR_MAX_WIDTH, Math.max(LEFT_SIDEBAR_MIN_WIDTH, value)));
}
