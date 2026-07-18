const CHUNK_RELOAD_STORAGE_KEY = "quake-web:chunk-reload-at";
export const CHUNK_RELOAD_COOLDOWN_MS = 15_000;

const installedWindows = new WeakSet<Window>();

export function shouldReloadAfterChunkFailure(lastReloadAt: string | null, now = Date.now()): boolean {
  if (!lastReloadAt) return true;
  const timestamp = Number(lastReloadAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return true;
  return now - timestamp >= CHUNK_RELOAD_COOLDOWN_MS;
}

/**
 * Vite emits `vite:preloadError` when an open client references a hashed lazy
 * chunk removed by a newer build. Reload once so the client receives the new
 * HTML manifest; keep a short session marker to prevent a broken deployment
 * from causing an infinite reload loop.
 */
export function installChunkLoadRecovery(target: Window = window): () => void {
  if (installedWindows.has(target)) return () => undefined;
  installedWindows.add(target);

  const clearRecoveryMarker = target.setTimeout(() => {
    try {
      target.sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in hardened browser contexts.
    }
  }, CHUNK_RELOAD_COOLDOWN_MS);

  const handlePreloadError = (event: VitePreloadErrorEvent) => {
    let lastReloadAt: string | null = null;
    try {
      lastReloadAt = target.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY);
    } catch {
      // Continue with one best-effort reload when storage is unavailable.
    }

    if (!shouldReloadAfterChunkFailure(lastReloadAt)) return;

    event.preventDefault();
    try {
      target.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(Date.now()));
    } catch {
      // Reload still gives the current build a chance to recover.
    }
    console.warn("[quake-web] Eski istemci parçası algılandı; güncel build yeniden yükleniyor.", event.payload);
    target.location.reload();
  };

  target.addEventListener("vite:preloadError", handlePreloadError);
  return () => {
    target.clearTimeout(clearRecoveryMarker);
    target.removeEventListener("vite:preloadError", handlePreloadError);
    installedWindows.delete(target);
  };
}
