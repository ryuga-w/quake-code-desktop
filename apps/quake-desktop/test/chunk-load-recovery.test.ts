import { describe, expect, it, vi } from "vitest";
import {
  CHUNK_RELOAD_COOLDOWN_MS,
  installChunkLoadRecovery,
  shouldReloadAfterChunkFailure,
} from "../src/client/src/lib/chunk-load-recovery";
import { staticCacheControl } from "../src/server/static-cache";

function fakeWindow(lastReloadAt?: string) {
  const storage = new Map<string, string>();
  if (lastReloadAt) storage.set("quake-web:chunk-reload-at", lastReloadAt);
  let preloadErrorListener: ((event: VitePreloadErrorEvent) => void) | undefined;
  const reload = vi.fn();
  const target = {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    location: { reload },
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
    addEventListener: vi.fn((name: string, listener: (event: VitePreloadErrorEvent) => void) => {
      if (name === "vite:preloadError") preloadErrorListener = listener;
    }),
    removeEventListener: vi.fn(),
  } as unknown as Window;
  return { target, reload, dispatch: (event: VitePreloadErrorEvent) => preloadErrorListener?.(event) };
}

describe("stale Vite chunk recovery", () => {
  it("reloads once when an old dynamic chunk is missing", () => {
    const { target, reload, dispatch } = fakeWindow();
    const preventDefault = vi.fn();
    installChunkLoadRecovery(target);

    dispatch({ preventDefault, payload: new TypeError("Failed to fetch dynamically imported module") } as unknown as VitePreloadErrorEvent);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not enter a reload loop after a recent recovery", () => {
    const { target, reload, dispatch } = fakeWindow(String(Date.now()));
    const preventDefault = vi.fn();
    installChunkLoadRecovery(target);

    dispatch({ preventDefault, payload: new Error("still missing") } as unknown as VitePreloadErrorEvent);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("allows recovery again after the cooldown", () => {
    const now = 50_000;
    expect(shouldReloadAfterChunkFailure(String(now - CHUNK_RELOAD_COOLDOWN_MS), now)).toBe(true);
    expect(shouldReloadAfterChunkFailure(String(now - 1), now)).toBe(false);
  });

  it("keeps entry HTML fresh while caching hashed assets", () => {
    expect(staticCacheControl("/index.html")).toBe("no-store");
    expect(staticCacheControl("/assets/FilesPanel-abc123.js")).toBe("public, max-age=31536000, immutable");
    expect(staticCacheControl("/quake-code-q.png")).toBe("no-cache");
  });
});
