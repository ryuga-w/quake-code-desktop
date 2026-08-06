import { contextBridge, ipcRenderer } from "electron";

// Sandbox:true altinda calisir — yalniz contextBridge + ipcRenderer kullanilabilir.
// Renderer'a guvenli, dar bir masaustu API'si acar (custom titlebar + tema senkronu).
contextBridge.exposeInMainWorld("quakeDesktop", {
  isDesktop: true,
  platform: process.platform,
  minimize: () => ipcRenderer.send("window:minimize"),
  maximizeToggle: () => ipcRenderer.send("window:maximizeToggle"),
  close: () => ipcRenderer.send("window:close"),
  // Windows/Linux WCO (Window Controls Overlay) renklerini aktif temaya gore guncelle.
  setOverlay: (color: string, symbolColor: string) =>
    ipcRenderer.send("titlebar:setOverlay", { color, symbolColor }),
  /** Keep native browser pages' prefers-color-scheme aligned with Quake. */
  setResolvedTheme: (theme: "light" | "dark") =>
    ipcRenderer.send("theme:setResolved", theme),
  /** Keep native app menus aligned with the renderer's resolved locale. */
  setNativeLocale: (locale: "tr" | "en") =>
    ipcRenderer.send("locale:setNative", locale),
  /** Native klasör seçici (Create Project → Add Folder). */
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("workspace:pickFolder"),
  /** Native çoklu klasör seçici (multi-root workspace). */
  pickFolders: (): Promise<string[]> => ipcRenderer.invoke("workspace:pickFolders"),
  /** Persist the window's root set and active root for the next launch. */
  rememberWorkspaceRoots: (roots: string[], activeRoot: string): Promise<void> =>
    ipcRenderer.invoke("workspace:rememberRoots", roots, activeRoot),
  /** Native application menu selected a workspace root. */
  onWorkspaceSelected: (callback: (path: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, path: string) => callback(path);
    ipcRenderer.on("workspace:selected", listener);
    return () => ipcRenderer.removeListener("workspace:selected", listener);
  },
  /** Quick Start: Documents/QuakeProjects/<slug> oluştur. */
  createQuickProject: (): Promise<string | null> => ipcRenderer.invoke("workspace:createQuickProject"),
  /** No Project scratch dizini. */
  noProjectDir: (): Promise<string | null> => ipcRenderer.invoke("workspace:noProjectDir"),
  /** Open a local path with the OS default app / file manager (worktree klasörü). */
  openPath: (targetPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("shell:openPath", targetPath),
  /** Reveal a local path in the system file manager. */
  showItemInFolder: (targetPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("shell:showItemInFolder", targetPath),
  /** Native OS notification (QuakeCode desktop parity). Main also re-checks focus. */
  showNotification: (title: string, body?: string, force?: boolean) =>
    ipcRenderer.send("notification:show", { title, body: body || "", force: Boolean(force) }),
  /**
   * True when the desktop window is minimized, hidden, or unfocused —
   * used so completion toasts do not fire while the user is in the app.
   */
  isWindowInBackground: (): Promise<boolean> => ipcRenderer.invoke("window:isInBackground"),
  /** Prevent app suspension while an unattended Goal is active. */
  setGoalUnattendedActive: (active: boolean) => ipcRenderer.send("goal:set-unattended-active", Boolean(active)),
  /** S-PUB.2 auto-update status / prefs (no-op friendly when feed missing). */
  updater: {
    getStatus: (): Promise<{
      feedConfigured: boolean;
      enabled: boolean;
      envForced: boolean;
      willCheck: boolean;
      currentVersion: string;
      lastCheckAt?: string;
      lastError?: string;
      updateAvailable?: boolean;
      updateVersion?: string;
      updateFeedUrl?: string;
      feedUrlMasked?: string;
      prefsFeedUrl?: string;
      feedSource: "env" | "prefs" | "embedded" | "none";
      statusMessage: string;
    }> => ipcRenderer.invoke("updater:getStatus"),
    setEnabled: (enabled: boolean): Promise<{
      feedConfigured: boolean;
      enabled: boolean;
      envForced: boolean;
      willCheck: boolean;
      currentVersion: string;
      lastCheckAt?: string;
      lastError?: string;
      updateAvailable?: boolean;
      updateVersion?: string;
      updateFeedUrl?: string;
      feedUrlMasked?: string;
      prefsFeedUrl?: string;
      feedSource: "env" | "prefs" | "embedded" | "none";
      statusMessage: string;
    }> => ipcRenderer.invoke("updater:setEnabled", Boolean(enabled)),
    setFeedUrl: (url: string): Promise<{
      feedConfigured: boolean;
      enabled: boolean;
      envForced: boolean;
      willCheck: boolean;
      currentVersion: string;
      lastCheckAt?: string;
      lastError?: string;
      updateAvailable?: boolean;
      updateVersion?: string;
      updateFeedUrl?: string;
      feedUrlMasked?: string;
      prefsFeedUrl?: string;
      feedSource: "env" | "prefs" | "embedded" | "none";
      statusMessage: string;
    }> => ipcRenderer.invoke("updater:setFeedUrl", url),
    check: (): Promise<{
      feedConfigured: boolean;
      enabled: boolean;
      envForced: boolean;
      willCheck: boolean;
      currentVersion: string;
      lastCheckAt?: string;
      lastError?: string;
      updateAvailable?: boolean;
      updateVersion?: string;
      updateFeedUrl?: string;
      feedUrlMasked?: string;
      prefsFeedUrl?: string;
      feedSource: "env" | "prefs" | "embedded" | "none";
      statusMessage: string;
    }> => ipcRenderer.invoke("updater:check"),
  },
  mcpSecrets: {
    list: (): Promise<string[]> => ipcRenderer.invoke("mcp-secrets:list"),
    set: (name: string, value: string): Promise<string[]> => ipcRenderer.invoke("mcp-secrets:set", name, value),
    remove: (name: string): Promise<string[]> => ipcRenderer.invoke("mcp-secrets:remove", name),
  },
  // ===== Embedded Browser (WebContentsView) API =====
  // BrowserPanel uses these to control the WebContentsView instead of <webview>.
  // WebContentsView is a top-level webContents, visible to Playwright CDP,
  // which allows the agent's browser tools to find and interact with it.
  browser: {
    /** Position the WebContentsView over the BrowserPanel viewport */
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.send("browser:setBounds", bounds),
    /** Navigate to URL. Returns true on success. */
    navigate: (url: string): Promise<boolean> => ipcRenderer.invoke("browser:navigate", url),
    /** Reload current page */
    reload: () => ipcRenderer.send("browser:reload"),
    /** Go back in history */
    back: () => ipcRenderer.send("browser:back"),
    /** Go forward in history */
    forward: () => ipcRenderer.send("browser:forward"),
    /** Get current URL */
    getUrl: (): Promise<string> => ipcRenderer.invoke("browser:getUrl"),
    getNavigationState: () => ipcRenderer.invoke("browser:get-navigation-state"),
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke("browser:open-external", url),
    startElementPicker: () => ipcRenderer.invoke("browser:start-element-picker"),
    cancelElementPicker: (): Promise<void> => ipcRenderer.invoke("browser:cancel-element-picker"),
    highlightTarget: (target: unknown): Promise<boolean> => ipcRenderer.invoke("browser:highlight-target", target),
    /** Hide the browser view (when panel unmounts) */
    hide: () => ipcRenderer.send("browser:hide"),
    inspectElementAt: (x: number, y: number) =>
      ipcRenderer.invoke("browser:inspect-at", x, y),
    highlightElement: (selector: string): Promise<void> =>
      ipcRenderer.invoke("browser:highlight-element", selector),
    clearHighlight: (): Promise<void> =>
      ipcRenderer.invoke("browser:clear-highlight"),
    captureElementScreenshot: (selector: string): Promise<string> =>
      ipcRenderer.invoke("browser:capture-element-screenshot", selector),
    captureElementTarget: (target: unknown): Promise<string> =>
      ipcRenderer.invoke("browser:capture-element-target", target),
    captureViewportScreenshot: (): Promise<string> =>
      ipcRenderer.invoke("browser:capture-viewport-screenshot"),
    captureFullpageScreenshot: (): Promise<string> =>
      ipcRenderer.invoke("browser:capture-fullpage-screenshot"),
    /** Listen for loading state changes */
    onDidStartLoading: (callback: () => void) => {
      ipcRenderer.on("browser:didStartLoading", callback);
      return () => ipcRenderer.removeListener("browser:didStartLoading", callback);
    },
    onDidStopLoading: (callback: () => void) => {
      ipcRenderer.on("browser:didStopLoading", callback);
      return () => ipcRenderer.removeListener("browser:didStopLoading", callback);
    },
    /** Listen for navigation (URL changes) */
    onDidNavigate: (callback: (url: string) => void) => {
      const handler = (_event: any, url: string) => callback(url);
      ipcRenderer.on("browser:didNavigate", handler);
      return () => ipcRenderer.removeListener("browser:didNavigate", handler);
    },
    /** Listen for cursor events (agent / page) */
    onCursor: (callback: (cursor: { x: number; y: number; kind: string }) => void) => {
      const handler = (_event: any, cursor: any) => callback(cursor);
      ipcRenderer.on("browser:cursor", handler);
      return () => ipcRenderer.removeListener("browser:cursor", handler);
    },
    /** Agent bridge session started/ended — open Tarayıcı tab */
    onAgentSession: (callback: (state: { active: boolean }) => void) => {
      const handler = (_event: unknown, state: { active: boolean }) => callback(state);
      ipcRenderer.on("browser:agent-session", handler);
      return () => ipcRenderer.removeListener("browser:agent-session", handler);
    },
  },
  computerUse: {
    onCursor: (
      callback: (cursor: { x: number; y: number; kind: string; label?: string; at: number }) => void,
    ) => {
      const handler = (_event: unknown, cursor: { x: number; y: number; kind: string; label?: string; at: number }) =>
        callback(cursor);
      ipcRenderer.on("computer-use:cursor", handler);
      return () => ipcRenderer.removeListener("computer-use:cursor", handler);
    },
    onSession: (callback: (state: { active: boolean }) => void) => {
      const handler = (_event: unknown, state: { active: boolean }) => callback(state);
      ipcRenderer.on("computer-use:session", handler);
      return () => ipcRenderer.removeListener("computer-use:session", handler);
    },
  },
});
