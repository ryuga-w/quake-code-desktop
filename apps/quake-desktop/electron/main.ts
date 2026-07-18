import { app, BrowserWindow, Menu, dialog, shell, ipcMain, WebContentsView, Notification, nativeImage, nativeTheme, powerSaveBlocker } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getFreePort, waitUntilListening } from "./ports";
import { startServer, stopServer } from "./serverHandle";
import { listMcpSecretNames, loadMcpSecrets, removeMcpSecret, setMcpSecret } from "./mcp-secret-vault";
import { resolveWorkspaceCwd, getWorkspaceRoots, rememberWorkspaceRoots, setLastWorkspace, pickWorkspace, pickWorkspaces, createQuickProject, resolveNoProjectDir } from "./workspace";
import { buildMenu } from "./menu";
import {
  forceEndComputerUseSession,
  setComputerUseBridgeHooks,
  startComputerUseBridge,
  stopComputerUseBridge,
} from "./computer-use-bridge";
import {
  flashComputerUseEdgePulse,
  hideComputerUseEdgePulse,
  showComputerUseEdgePulse,
} from "./computer-use-overlay";
import { stopDesktopHost } from "./desktop-host-client";
import {
  EMBEDDED_UA_MARKER,
  setBrowserBridgeHost,
  startBrowserBridge,
  stopBrowserBridge,
} from "./browser-bridge";
import {
  buildResolveNodeParams,
  cancelElementPicker,
  captureElementTarget,
  clearElementHighlight,
  highlightElementTarget,
  renderElementCaptureOverlay,
  startElementPicker,
  validateSelectorPath,
} from "./browser-inspector";
import type { BrowserElementTarget, BrowserNodeReference } from "./browser-inspector";
import { maybeStartAutoUpdater, registerAutoUpdateIpc } from "./auto-update";

const APP_DISPLAY_NAME = "Quake Code";
const APP_USER_MODEL_ID = "com.mrquake.quake-desktop";
let goalPowerSaveBlockerId: number | undefined;

app.commandLine.appendSwitch("remote-debugging-port", "9222");
process.env.QUAKE_BROWSER_EMBEDDED = process.env.QUAKE_BROWSER_EMBEDDED || "1";
process.env.QUAKE_BROWSER_BRIDGE_PORT = process.env.QUAKE_BROWSER_BRIDGE_PORT || "9223";
process.env.QUAKE_COMPUTER_USE_BRIDGE_PORT = process.env.QUAKE_COMPUTER_USE_BRIDGE_PORT || "9224";

// Brand app early so OS toasts / taskbar do not show bare "Electron".
try {
  app.setName(APP_DISPLAY_NAME);
} catch {
  /* ignore */
}
if (process.platform === "win32") {
  try {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  } catch {
    /* ignore */
  }
}

/** Resolve Quake Code logo/icon for window + toast (dev + packaged). */
function resolveBrandingAsset(...names: string[]): string | undefined {
  const roots = [
    path.join(process.resourcesPath || "", "resources"),
    path.join(process.resourcesPath || ""),
    path.join(app.getAppPath(), "resources"),
    // dist/electron → ../../resources
    path.join(__dirname, "..", "..", "resources"),
    path.join(__dirname, "..", "..", "src", "client", "public"),
  ];
  for (const root of roots) {
    if (!root) continue;
    for (const name of names) {
      const full = path.join(root, name);
      if (existsSync(full)) return full;
    }
  }
  return undefined;
}

function resolveAppIconPath(): string | undefined {
  return resolveBrandingAsset("icon.png", "icon-128.png", "quake-code-q.png", "icon.ico");
}

function resolveNotificationIconPath(): string | undefined {
  // Prefer square app icon for toast logo; fallback to Q mark.
  return resolveBrandingAsset("icon.png", "icon-128.png", "quake-code-q.png");
}

function resolveShortcutIconPath(): string | undefined {
  // .ico preferred for Start Menu / toast app identity on Windows.
  return resolveBrandingAsset("icon.ico", "icon.png", "icon-128.png");
}

/**
 * Windows shows toast *app name* from the Start Menu shortcut that matches
 * AppUserModelID — not from app.setName alone. Without this, dev (`electron.exe`)
 * always says "Electron" in the toast header.
 */
function ensureWindowsAppIdentity(): void {
  if (process.platform !== "win32") return;
  try {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  } catch {
    /* ignore */
  }
  try {
    app.setName(APP_DISPLAY_NAME);
  } catch {
    /* ignore */
  }

  try {
    const programsDir = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
    const shortcutPath = path.join(programsDir, `${APP_DISPLAY_NAME}.lnk`);
    const iconPath = resolveShortcutIconPath();
    // Prefer branded QuakeCode.exe (sibling of electron.exe in dist); else current process.
    const brandedSibling = path.join(path.dirname(process.execPath), "QuakeCode.exe");
    const brandedInApp = path.join(app.getAppPath(), "resources", "bin", "QuakeCode.exe");
    const brandedExe = existsSync(brandedSibling)
      ? brandedSibling
      : existsSync(brandedInApp)
        ? brandedInApp
        : undefined;
    const target = !app.isPackaged && brandedExe ? brandedExe : process.execPath;
    // Dev: QuakeCode.exe + app path (+ --dev). Packaged: just the app exe.
    let args = "";
    if (!app.isPackaged) {
      const appPath = app.getAppPath();
      const extra = process.argv.includes("--dev") ? " --dev" : "";
      args = `"${appPath}"${extra}`;
    }
    const link: Electron.ShortcutDetails = {
      target,
      args,
      cwd: app.isPackaged ? path.dirname(process.execPath) : app.getAppPath(),
      description: APP_DISPLAY_NAME,
      appUserModelId: APP_USER_MODEL_ID,
      ...(iconPath ? { icon: iconPath, iconIndex: 0 } : {}),
    };
    const op: "create" | "update" | "replace" = existsSync(shortcutPath) ? "update" : "create";
    const ok = shell.writeShortcutLink(shortcutPath, op, link);
    if (!ok) {
      shell.writeShortcutLink(shortcutPath, "replace", link);
    }
    console.log(`[branding] Start Menu shortcut ready: ${shortcutPath} (AUMID=${APP_USER_MODEL_ID})`);
  } catch (err) {
    console.error("[branding] failed to register Start Menu shortcut", err);
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function showBrandedNotification(title: string, body: string) {
  if (!Notification.isSupported()) return;

  const iconPath = resolveNotificationIconPath();
  const focusWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  };

  // Windows: toast with logo; app name comes from AUMID Start Menu shortcut ("Quake Code").
  if (process.platform === "win32" && iconPath) {
    try {
      const iconUrl = pathToFileURL(iconPath).href;
      const toastXml = `<?xml version="1.0" encoding="utf-8"?>
<toast activationType="foreground">
  <visual>
    <binding template="ToastGeneric">
      <text>${escapeXml(title || APP_DISPLAY_NAME)}</text>
      ${body ? `<text>${escapeXml(body)}</text>` : ""}
      <image placement="appLogoOverride" hint-crop="circle" src="${escapeXml(iconUrl)}"/>
    </binding>
  </visual>
  <audio silent="true"/>
</toast>`;
      const n = new Notification({ toastXml });
      n.on("click", focusWindow);
      n.show();
      return;
    } catch (err) {
      console.error("[notification] toastXml failed, falling back", err);
    }
  }

  const opts: Electron.NotificationConstructorOptions = {
    title: title || APP_DISPLAY_NAME,
    body,
    silent: true,
  };
  if (iconPath) {
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) opts.icon = img;
      else opts.icon = iconPath;
    } catch {
      opts.icon = iconPath;
    }
  }
  const n = new Notification(opts);
  n.on("click", focusWindow);
  n.show();
}

// Ajan runtime'i bir tarayici (ikinci bir Chromium) baslattiginda Electron'un GPU
// sureciyle cakisip STATUS_BREAKPOINT (0x80000003) ile cokmesi onenmek icin
// donanim ivmesi kapatildi (yazilimsal render). Boylece iki Chromium GPU cakismasi
// ortadan kalkar; uygulama kararli calisir. (Monaco/xterm yazilimmla calisir.)
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");

// The branded QuakeCode.exe reports itself as packaged even when launched by
// run-electron-dev.mjs. An explicit --dev flag must still select the Vite stack.
const isDevFlag = process.argv.includes("--dev");
const HOST = "127.0.0.1";
const DEV_VITE_PORT = 5173;
const DEV_SERVER_PORT = 3737;

/** Vite (5173) + API (3737) ayakta mi? --dev olmasa bile dev stack varsa Vite kullan. */
async function isDevStackRunning(timeoutMs = 1500): Promise<boolean> {
  try {
    await waitUntilListening(HOST, DEV_SERVER_PORT, timeoutMs);
    await waitUntilListening(HOST, DEV_VITE_PORT, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

let mainWindow: BrowserWindow | undefined;
let browserView: WebContentsView | undefined;
let browserViewBounds = { x: 0, y: 0, width: 1280, height: 800 };
let currentUrl = "";
let currentCwd = "";
let serverPort = 0;
let quitting = false;
let usingViteDev = false;

/** Safe send to renderer (avoids "Object has been destroyed" if window/webContents is gone) */
function safeSend(channel: string, ...args: any[]) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  } catch {
    // ignore
  }
}

/** dist/electron/main.js → ../server/index.js (= dist/server/index.js) */
function serverEntry(): string {
  return path.resolve(__dirname, "..", "server", "index.js");
}

/**
 * Production Desktop owns its agent configuration. Never let a legacy/global
 * Quake CLI installation decide which models, credentials, or extensions the
 * packaged application loads.
 */
function serverAgentDir(): string | undefined {
  return app.isPackaged ? path.join(app.getPath("userData"), "agent") : undefined;
}

async function startBackend(cwd: string): Promise<string> {
  // A packaged app must always own its built backend. Reusing an unrelated local
  // dev stack would couple production startup to whichever repo happens to use
  // ports 3737/5173 on the machine.
  const devStackUp = app.isPackaged && !isDevFlag ? false : await isDevStackRunning(isDevFlag ? 60000 : 1500);
  usingViteDev = isDevFlag || devStackUp;
  if (usingViteDev) {
    // HMR icin Vite sart: 3737 ham .tsx verir, React calismaz.
    if (!devStackUp) {
      await waitUntilListening(HOST, DEV_SERVER_PORT, 60000);
      await waitUntilListening(HOST, DEV_VITE_PORT, 60000);
    }
    return `http://${HOST}:${DEV_VITE_PORT}`;
  }
  serverPort = await getFreePort();
  const child = startServer({
    serverEntry: serverEntry(),
    port: serverPort,
    cwd,
    workspaceRoots: getWorkspaceRoots(),
    host: HOST,
    secrets: loadMcpSecrets(),
    agentDir: serverAgentDir(),
  });
  ipcMain.handle("workspace:pickFolders", async () => pickWorkspaces(mainWindow ?? undefined));
  ipcMain.handle("workspace:rememberRoots", (_event, roots: unknown, activeRoot: unknown) => {
    const safeRoots = Array.isArray(roots) ? roots.filter((entry): entry is string => typeof entry === "string") : [];
    rememberWorkspaceRoots(safeRoots, typeof activeRoot === "string" ? activeRoot : undefined);
  });
  child.on("exit", (code: number) => {
    if (quitting) return;
    dialog.showErrorBox("Sunucu durdu", `Arka uç beklenmedik şekilde kapandı (kod ${code}). Uygulama yeniden başlatılıyor.`);
    app.relaunch();
    app.exit(0);
  });
  await waitUntilListening(HOST, serverPort, 30000);
  return `http://${HOST}:${serverPort}`;
}

function registerCrashListeners() {
  // Gercek cokme nedenini (renderer / GPU / webview / native) yakala.
  // Cikis kodu 0x80000003 tek basina yetersiz; bu eventler reason/exitCode verir.
  process.on("uncaughtException", (err) => {
    console.error("[crash-diag] uncaughtException:", err?.stack || err);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[crash-diag] unhandledRejection:", reason);
  });
  app.on("child-process-gone" as any, (_event: any, details: any) => {
    console.error(
      `[crash-diag] child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });
  app.on("render-process-gone" as any, (_event: any, wc: any, details: any) => {
    console.error(
      `[crash-diag] render-process-gone wcId=${wc.id} reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.on("render-process-gone" as any, (_e: any, details: any) => {
      console.error(
        `[crash-diag] wc(${contents.id}) render-process-gone reason=${details.reason} exitCode=${details.exitCode}`,
      );
    });
    contents.on("crashed" as any, () => {
      console.error(`[crash-diag] wc(${contents.id}) crashed`);
    });
  });
}

function registerWindowIpc() {
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:maximizeToggle", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window:close", () => mainWindow?.close());
  // Tema degisince WCO (Windows/Linux pencere kontrol overlay) renklerini guncelle.
  ipcMain.on("titlebar:setOverlay", (_event, payload: { color?: string; symbolColor?: string }) => {
    if (process.platform !== "win32" && process.platform !== "linux") return;
    try {
      mainWindow?.setTitleBarOverlay?.({
        color: payload?.color || "#0a0a0a",
        symbolColor: payload?.symbolColor || "#ffffff",
        height: 36,
      });
    } catch {
      /* setTitleBarOverlay tum platform/surumlerde yok — sessizce gec. */
    }
  });

  // Quake's resolved appearance is the source of truth for Chromium media
  // queries too. "System" is resolved by the renderer before reaching here.
  ipcMain.on("theme:setResolved", (_event, theme: unknown) => {
    if (theme !== "light" && theme !== "dark") return;
    nativeTheme.themeSource = theme;
  });

  // Project picker: native folder dialog + quick start
  ipcMain.handle("workspace:pickFolder", async () => {
    const dir = await pickWorkspace(mainWindow ?? undefined);
    return dir ?? null;
  });
  ipcMain.handle("workspace:createQuickProject", async () => {
    try {
      return createQuickProject();
    } catch (err) {
      console.error("[workspace] createQuickProject failed", err);
      return null;
    }
  });
  // Double-check: never surface OS toast while the main window is focused & visible.
  // Renderer already gates via isWindowInBackground; this is a hard safety net.
  ipcMain.handle("window:isInBackground", () => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return true;
      if (mainWindow.isMinimized()) return true;
      if (!mainWindow.isVisible()) return true;
      if (!mainWindow.isFocused()) return true;
      return false;
    } catch {
      return true;
    }
  });

  ipcMain.on("goal:set-unattended-active", (_event, active: boolean) => {
    try {
      if (active) {
        if (goalPowerSaveBlockerId === undefined || !powerSaveBlocker.isStarted(goalPowerSaveBlockerId)) {
          goalPowerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
        }
        return;
      }
      if (goalPowerSaveBlockerId !== undefined && powerSaveBlocker.isStarted(goalPowerSaveBlockerId)) {
        powerSaveBlocker.stop(goalPowerSaveBlockerId);
      }
      goalPowerSaveBlockerId = undefined;
    } catch (error) {
      console.warn("[goal] power save blocker update failed", error);
    }
  });

  ipcMain.handle("mcp-secrets:list", () => listMcpSecretNames());
  ipcMain.handle("mcp-secrets:set", (_event, name: string, value: string) => {
    setMcpSecret(String(name || ""), String(value || ""));
    return listMcpSecretNames();
  });
  ipcMain.handle("mcp-secrets:remove", (_event, name: string) => {
    removeMcpSecret(String(name || ""));
    return listMcpSecretNames();
  });

  ipcMain.on("notification:show", (_event, payload: { title?: string; body?: string; force?: boolean }) => {
    try {
      if (!payload?.force) {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            const focused =
              mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused();
            if (focused) {
              // User is looking at the app — drop OS toast.
              return;
            }
          }
        } catch {
          /* ignore focus probe errors */
        }
      }
      const title = String(payload?.title || APP_DISPLAY_NAME).trim() || APP_DISPLAY_NAME;
      const body = String(payload?.body || "").trim();
      showBrandedNotification(title, body);
    } catch (err) {
      console.error("[notification] show failed", err);
    }
  });

  ipcMain.handle("workspace:noProjectDir", async () => {
    try {
      return resolveNoProjectDir();
    } catch {
      return null;
    }
  });

  /**
   * Reveal / open a local filesystem path (worktree folder, file, …).
   * openPath opens the item with the OS default; showItemInFolder selects it in the file manager.
   */
  ipcMain.handle("shell:openPath", async (_event, targetPath: string) => {
    if (typeof targetPath !== "string") return { ok: false, error: "Geçersiz yol" };
    const p = targetPath.trim();
    if (!p || p.length > 4096) return { ok: false, error: "Geçersiz yol" };
    // Only local absolute paths — no URLs / protocol handlers.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p) && !/^[a-zA-Z]:[\\/]/.test(p)) {
      return { ok: false, error: "Yalnızca yerel yollar açılabilir" };
    }
    try {
      if (!existsSync(p)) return { ok: false, error: "Yol bulunamadı" };
      const err = await shell.openPath(p);
      // Electron returns empty string on success, error message otherwise.
      if (err) return { ok: false, error: err };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("shell:showItemInFolder", async (_event, targetPath: string) => {
    if (typeof targetPath !== "string") return { ok: false, error: "Geçersiz yol" };
    const p = targetPath.trim();
    if (!p || p.length > 4096) return { ok: false, error: "Geçersiz yol" };
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p) && !/^[a-zA-Z]:[\\/]/.test(p)) {
      return { ok: false, error: "Yalnızca yerel yollar açılabilir" };
    }
    try {
      if (!existsSync(p)) return { ok: false, error: "Yol bulunamadı" };
      shell.showItemInFolder(p);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

/**
 * Create the embedded browser WebContentsView and register IPC handlers.
 *
 * WebContentsView is a TOP-LEVEL webContents (unlike <webview> guest webContents).
 * This means Playwright connecting via CDP can find it in context.pages(),
 * allowing the agent's browser tools to interact with the embedded browser
 * without launching a separate Chromium instance (which caused STATUS_BREAKPOINT crashes).
 */
function createBrowserView() {
  browserView = new WebContentsView();
  // Hidden initially — renderer sends bounds when BrowserPanel mounts
  browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  // Ajan embedded tarayıcıyı UA marker ile tanır (CDP fallback path).
  try {
    const baseUa = browserView.webContents.getUserAgent();
    if (!baseUa.includes(EMBEDDED_UA_MARKER)) {
      browserView.webContents.setUserAgent(`${baseUa} ${EMBEDDED_UA_MARKER}`);
    }
  } catch {
    /* non-fatal */
  }
  mainWindow?.contentView.addChildView(browserView);

  // Forward loading state to renderer
  browserView.webContents.on("did-start-loading", () => {
    void cancelElementPicker(browserView!.webContents, "navigated");
    safeSend("browser:didStartLoading");
  });
  browserView.webContents.on("did-stop-loading", () => {
    safeSend("browser:didStopLoading");
  });

  // Forward navigation events to renderer (URL changes)
  browserView.webContents.on("did-navigate", (_event, url) => {
    safeSend("browser:didNavigate", url);
  });
  browserView.webContents.on("did-navigate-in-page", (_event, url) => {
    safeSend("browser:didNavigate", url);
  });

  // IPC: Position the WebContentsView over the BrowserPanel viewport
  ipcMain.on("browser:setBounds", (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    if (!browserView) return;
    browserViewBounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    };
    browserView.setBounds(browserViewBounds);
  });

  // IPC: Navigate to URL
  ipcMain.handle("browser:navigate", async (_event, url: string) => {
    if (!browserView) return false;
    try {
      await browserView.webContents.loadURL(url);
      return true;
    } catch {
      return false;
    }
  });

  // IPC: Reload
  ipcMain.on("browser:reload", () => {
    browserView?.webContents.reload();
  });

  // IPC: Back
  ipcMain.on("browser:back", () => {
    if (browserView?.webContents.navigationHistory.canGoBack()) {
      browserView.webContents.navigationHistory.goBack();
    }
  });

  // IPC: Forward
  ipcMain.on("browser:forward", () => {
    if (browserView?.webContents.navigationHistory.canGoForward()) {
      browserView.webContents.navigationHistory.goForward();
    }
  });

  // IPC: Get current URL
  ipcMain.handle("browser:getUrl", () => {
    return browserView?.webContents.getURL() || "";
  });

  ipcMain.handle("browser:get-navigation-state", () => {
    const history = browserView?.webContents.navigationHistory;
    return {
      url: browserView?.webContents.getURL() || "",
      title: browserView?.webContents.getTitle() || "",
      canGoBack: Boolean(history?.canGoBack()),
      canGoForward: Boolean(history?.canGoForward()),
      loading: Boolean(browserView?.webContents.isLoading()),
    };
  });

  ipcMain.handle("browser:open-external", async (_event, url: string) => {
    if (typeof url !== "string" || url.length > 8_192) return false;
    let parsed: URL;
    try { parsed = new URL(url); } catch { return false; }
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) return false;
    await shell.openExternal(parsed.toString());
    return true;
  });

  ipcMain.handle("browser:start-element-picker", async () => {
    if (!browserView) return { status: "error", message: "Tarayıcı görünümü hazır değil" };
    const result = await startElementPicker(browserView.webContents);
    if (result.status !== "completed") return result;
    await renderElementCaptureOverlay(browserView.webContents, result.annotations);
    const image = await browserView.webContents.capturePage().catch(() => null);
    await clearElementHighlight(browserView.webContents);
    return {
      ...result,
      screenshot: image?.toPNG().toString("base64") || "",
    };
  });

  ipcMain.handle("browser:cancel-element-picker", async () => {
    if (browserView) await cancelElementPicker(browserView.webContents);
  });

  ipcMain.handle("browser:highlight-target", async (_event, target: BrowserElementTarget) => {
    if (!browserView || !target || typeof target !== "object") return false;
    validateSelectorPath(target.selectorPath, target.selector);
    return highlightElementTarget(browserView.webContents, target);
  });

  // IPC: Hide the browser view (when panel unmounts or tab switches)
  ipcMain.on("browser:hide", () => {
    if (!browserView) return;
    // Boyutu 0x0 yapmak Chromium viewport'unu da sıfırlıyordu. Donmuş inspector
    // yüzeyi ikinci elementi CDP koordinatıyla sorguladığında sayfa artık 0x0
    // olduğu için seçim kilitleniyordu. Görünümü ekran dışına taşı ama viewport
    // ölçüsünü koru; böylece DOM hit-test ve screenshot oturum boyunca çalışır.
    browserView.setBounds({
      x: -browserViewBounds.width - 100,
      y: -browserViewBounds.height - 100,
      width: browserViewBounds.width,
      height: browserViewBounds.height,
    });
  });

  ipcMain.handle("browser:inspect-at", async (_event, x: number, y: number) => {
    const node = await getNodeForLocation(x, y);
    if (!node) return null;
    return inspectNode(node);
  });

  ipcMain.handle("browser:highlight-element", async (_event, selector: string) => {
    const node = await getNodeForSelector(selector);
    const dbg = await enableBrowserInspectorDomains();
    if (!node?.nodeId || !dbg) return;
    await dbg.sendCommand("Overlay.highlightNode", {
      highlightConfig: {
        contentColor: { r: 59, g: 130, b: 246, a: 0.25 },
        paddingColor: { r: 59, g: 130, b: 246, a: 0.18 },
        borderColor: { r: 147, g: 51, b: 234, a: 0.95 },  // stronger purple border
        marginColor: { r: 59, g: 130, b: 246, a: 0.12 },
        showInfo: false,
        showStyles: false,
      },
      nodeId: node.nodeId,
    }).catch(() => {});
  });

  ipcMain.handle("browser:clear-highlight", async () => {
    if (browserView) await clearElementHighlight(browserView.webContents);
    const dbg = browserDebuggerAttached ? await getBrowserDebugger() : null;
    if (dbg) await dbg.sendCommand("Overlay.hideHighlight").catch(() => {});
  });

  ipcMain.handle("browser:capture-element-target", async (_event, target: BrowserElementTarget) => {
    if (!browserView || !target || typeof target !== "object") return "";
    return captureElementTarget(browserView.webContents, target).catch(() => "");
  });

  // Legacy selector endpoint; yeni UI kararlı target endpoint'ini kullanır.
  ipcMain.handle("browser:capture-element-screenshot", async (_event, selector: string) => {
    if (!browserView || typeof selector !== "string") return "";
    const target = { selector, selectorPath: [selector] } as BrowserElementTarget;
    return captureElementTarget(browserView.webContents, target).catch(() => "");
  });

  ipcMain.handle("browser:capture-viewport-screenshot", async () => {
    if (!browserView || browserView.webContents.isDestroyed()) return "";
    const image = await browserView.webContents.capturePage().catch(() => null);
    return image?.toPNG().toString("base64") || "";
  });

  ipcMain.handle("browser:capture-fullpage-screenshot", async () => {
    const dbg = await enableBrowserInspectorDomains();
    if (!dbg) return "";
    const screenshot = await dbg.sendCommand("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    }).catch(() => null);
    return screenshot?.data || "";
  });

  // Handle unexpected debugger detach (e.g. page crash, process kill)
  browserView.webContents.debugger.on("detach", () => {
    console.log("[browser-debugger] Debugger detached unexpectedly");
    browserDebuggerAttached = false;
  });
}

let browserDebuggerAttached = false;

type BrowserDebugger = Electron.Debugger;

type BrowserInspectResult = BrowserElementTarget;

async function getBrowserDebugger(): Promise<BrowserDebugger | null> {
  if (!browserView) return null;
  if (!browserDebuggerAttached) {
    await attachBrowserDebugger();
  }
  return browserDebuggerAttached ? browserView.webContents.debugger : null;
}

async function enableBrowserInspectorDomains(): Promise<BrowserDebugger | null> {
  const dbg = await getBrowserDebugger();
  if (!dbg) return null;
  try {
    await dbg.sendCommand("DOM.enable").catch(() => {});
    await dbg.sendCommand("CSS.enable").catch(() => {});
    await dbg.sendCommand("Overlay.enable").catch(() => {});
    await dbg.sendCommand("Runtime.enable").catch(() => {});
    await dbg.sendCommand("Page.enable").catch(() => {});
    return dbg;
  } catch {
    return null;
  }
}

async function getNodeForLocation(x: number, y: number): Promise<BrowserNodeReference | null> {
  const dbg = await enableBrowserInspectorDomains();
  if (!dbg) return null;
  try {
    const result = await dbg.sendCommand("DOM.getNodeForLocation", {
      x: Math.round(x),
      y: Math.round(y),
      includeUserAgentShadowDOM: true,
      ignorePointerEventsNone: true,
    });
    const reference: BrowserNodeReference = {
      nodeId: result.nodeId,
      backendNodeId: result.backendNodeId,
    };
    return buildResolveNodeParams(reference) ? reference : null;
  } catch {
    return null;
  }
}

async function getNodeForSelector(selector: string): Promise<BrowserNodeReference | null> {
  const dbg = await enableBrowserInspectorDomains();
  if (!dbg || !selector) return null;
  try {
    const documentNode = await dbg.sendCommand("DOM.getDocument", {
      depth: -1,
      pierce: true,
    }).catch(() => null);
    const rootNodeId = documentNode?.root?.nodeId;
    if (!rootNodeId) return null;
    const result = await dbg.sendCommand("DOM.querySelector", {
      nodeId: rootNodeId,
      selector,
    }).catch(() => null);
    if (!result?.nodeId) return null;
    return { nodeId: result.nodeId };
  } catch {
    return null;
  }
}

async function inspectNode(reference: BrowserNodeReference): Promise<BrowserInspectResult | null> {
  const dbg = await enableBrowserInspectorDomains();
  const resolveNodeParams = buildResolveNodeParams(reference);
  if (!dbg || !resolveNodeParams) return null;
  try {
    const resolved = await dbg.sendCommand("DOM.resolveNode", resolveNodeParams).catch(() => null);
    const objectId = resolved?.object?.objectId;
    if (!objectId) return null;
    const details = await dbg.sendCommand("Runtime.callFunctionOn", {
      objectId,
      returnByValue: true,
      functionDeclaration: `function () {
        const element = this;
        if (!(element instanceof Element)) return null;
        const rect = element.getBoundingClientRect();
        const computed = window.getComputedStyle(element);
        const attrs = {};
        for (const attr of Array.from(element.attributes || [])) {
          const key = attr.name.toLowerCase();
          attrs[attr.name] = /password|secret|token|authorization/.test(key)
            ? '[gizlendi]'
            : String(attr.value).slice(0, 500);
        }
        const classes = Array.from(element.classList || []).slice(0, 20);
        const escapeCss = (value) => {
          try {
            if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
          } catch {}
          return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
        };
        const selector = (() => {
          if (element.id) return '#' + escapeCss(element.id);
          // Prefer stable test / aria attrs for robust selectors
          const stableAttr = ['data-testid', 'data-test', 'data-cy', 'aria-label', 'role', 'name', 'placeholder'];
          for (const attr of stableAttr) {
            const v = element.getAttribute(attr);
            if (v) {
              const val = escapeCss(v);
              const tag = element.tagName.toLowerCase();
              if (attr === 'aria-label') return tag + '[aria-label="' + val + '"]';
              if (attr === 'role') return tag + '[role="' + val + '"]';
              return tag + '[' + attr + '="' + val + '"]';
            }
          }
          const parts = [];
          let current = element;
          while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
            let part = current.tagName.toLowerCase();
            if (current.id) {
              part += '#' + escapeCss(current.id);
              parts.unshift(part);
              break;
            }
            const classNames = Array.from(current.classList || []).slice(0, 2).map(escapeCss);
            if (classNames.length) part += '.' + classNames.join('.');
            const parent = current.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
              if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
            }
            parts.unshift(part);
            current = parent;
          }
          return parts.join(' > ');
        })();
        const xpath = (() => {
          const segments = [];
          let current = element;
          while (current && current.nodeType === Node.ELEMENT_NODE) {
            let index = 1;
            let sibling = current.previousElementSibling;
            while (sibling) {
              if (sibling.tagName === current.tagName) index += 1;
              sibling = sibling.previousElementSibling;
            }
            segments.unshift(current.tagName.toLowerCase() + '[' + index + ']');
            current = current.parentElement;
          }
          return '/' + segments.join('/');
        })();
        const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 1000);
        const role = element.getAttribute('role') || '';
        const accessibleName = element.getAttribute('aria-label')
          || element.getAttribute('alt')
          || element.getAttribute('title')
          || text.slice(0, 160);
        return {
          selectorPath: [selector],
          frameUrl: location.href,
          documentUrl: location.href,
          role,
          accessibleName,
          tag: element.tagName.toLowerCase(),
          id: element.id || '',
          classes,
          text,
          selector,
          xpath,
          outerHTML: String(element.outerHTML || '').slice(0, 12000),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          attributes: attrs,
          styles: {
            font: computed.font || '',
            color: computed.color || '',
            background: computed.backgroundColor || '',
            display: computed.display || '',
            position: computed.position || '',
            margin: computed.margin || '',
            padding: computed.padding || '',
            width: computed.width || '',
            height: computed.height || '',
          },
        };
      }`,
    }).catch(() => null);
    return (details?.result?.value as BrowserInspectResult | null) || null;
  } catch {
    return null;
  }
}

/**
 * Attach CDP debugger for inspector (DOM/screenshot) — sürekli screencast YOK.
 * Canlı görüntü native WebContentsView; ajan imleci sayfa içi enjekte.
 */
async function attachBrowserDebugger() {
  if (!browserView || browserDebuggerAttached) return;

  try {
    const dbg = browserView.webContents.debugger;
    dbg.attach("1.3");
    browserDebuggerAttached = true;
    await dbg.sendCommand("Page.enable");
    await dbg.sendCommand("Runtime.enable").catch(() => {});
    console.log("[browser-debugger] Inspector debugger aktif");
  } catch (err) {
    console.error("[browser-debugger] Failed to attach:", err);
    browserDebuggerAttached = false;
  }
}

async function detachBrowserDebugger() {
  if (!browserView || !browserDebuggerAttached) return;
  try {
    browserView.webContents.debugger.detach();
    browserDebuggerAttached = false;
    console.log("[browser-debugger] Debugger kapatıldı");
  } catch { /* already detached */ }
}

function createWindow(url: string) {
  const isWinLinux = process.platform === "win32" || process.platform === "linux";
  const iconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    // show:false + ready-to-show → white flash yok; splash HTML/React paint olur.
    show: false,
    backgroundColor: "#0a0a0a",
    title: APP_DISPLAY_NAME,
    ...(iconPath ? { icon: iconPath } : {}),
    // Frameless: OS native titlebar gizli, kendi kompakt titlebar'imizi cizeriz.
    // Windows/Linux'ta titleBarOverlay ile OS min/max/close butonlarini sag-uste
    // cizer (snap + a11y korunur); macOS'ta titleBarStyle:'hidden' trafik isiklarini
    // inset gosterir. Menubar win/linux'ta gizli (kisayollar korunur, Alt ile acilir).
    autoHideMenuBar: process.platform !== "darwin",
    titleBarStyle: "hidden",
    ...(isWinLinux
      ? { titleBarOverlay: { color: "#0a0a0a", symbolColor: "#ffffff", height: 36 } }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  // Dış linkler harici tarayıcıda açılsın; pencere yalnızca yerel sunucuda gezsin.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, navUrl) => {
    if (!navUrl.startsWith(`http://${HOST}:`)) {
      event.preventDefault();
      if (/^https?:/i.test(navUrl)) shell.openExternal(navUrl);
    }
  });
  mainWindow.on("unresponsive", () => {
    console.error("[crash-diag] mainWindow unresponsive");
  });

  mainWindow.on("closed", () => {
    // Window (and its contentView) is being / has been destroyed.
    // Calling methods like removeChildView here can throw "Object has been destroyed".
    // Just drop references; the OS will clean up native resources.
    browserView = undefined;
    mainWindow = undefined;
  });
  if (isDevFlag) {
    mainWindow.webContents.openDevTools();
  }
  if (usingViteDev) {
    void mainWindow.webContents.session.clearCache().finally(() => {
      void mainWindow?.loadURL(url);
    });
  } else {
    void mainWindow.loadURL(url);
  }

  // Create the embedded browser WebContentsView (for BrowserPanel)
  createBrowserView();
}

async function changeWorkspace() {
  const dir = await pickWorkspace(mainWindow);
  if (!dir) return;
  currentCwd = dir;
  setLastWorkspace(dir);
  // Renderer activates the root through the existing authenticated command API.
  // The backend process stays alive so other roots' chats and agents keep running.
  safeSend("workspace:selected", dir);
}

function registerComputerUseBridgeHooks() {
  // Edge pulse while CU session is active (visual "ajan masaüstünde").
  // Fake agent cursor stays off — real OS mouse moves via SendInput.
  setComputerUseBridgeHooks({
    onCursor: (cursor) => {
      safeSend("computer-use:cursor", cursor);
    },
    onSessionStart: () => {
      showComputerUseEdgePulse();
      safeSend("computer-use:session", { active: true });
    },
    onSessionEnd: () => {
      hideComputerUseEdgePulse();
      safeSend("computer-use:session", { active: false });
    },
    onActuate: () => {
      flashComputerUseEdgePulse();
    },
  });
}

function registerBrowserBridgeHost() {
  setBrowserBridgeHost({
    getWebContents: () => browserView?.webContents,
    preparePlaywrightCdp: async () => {
      // Playwright CDP ile yan yana çalışırken in-process debugger'ı bırak.
      await detachBrowserDebugger().catch(() => {});
    },
    onSessionStart: () => {
      // Computer-use açıksa kapat + full-screen overlay'i kaldır
      forceEndComputerUseSession();
      hideComputerUseEdgePulse();
      // Renderer: sağ paneli Tarayıcı sekmesine aç.
      safeSend("browser:agent-session", { active: true });
      // navigate ile yarışmasın diye burada loadURL yapmıyoruz
    },
    onSessionEnd: () => {
      safeSend("browser:agent-session", { active: false });
    },
    onCursor: (cursor) => safeSend("browser:cursor", cursor),
    onNavigate: (url) => safeSend("browser:didNavigate", url),
  });
}

async function boot() {
  // Before any toast: register Windows AUMID + Start Menu shortcut so OS shows "Quake Code" not "Electron".
  ensureWindowsAppIdentity();
  registerCrashListeners();
  registerWindowIpc();
  registerAutoUpdateIpc();
  registerComputerUseBridgeHooks();
  registerBrowserBridgeHost();
  await startBrowserBridge().catch((err) => {
    console.error("[browser-bridge] failed to start:", err);
  });
  await startComputerUseBridge().catch((err) => {
    console.error("[computer-use-bridge] failed to start:", err);
  });
  currentCwd = resolveWorkspaceCwd();
  currentUrl = await startBackend(currentCwd);
  createWindow(currentUrl);
  Menu.setApplicationMenu(buildMenu({ onOpenFolder: () => void changeWorkspace() }));
  // S-PUB.2: optional electron-updater — no-op without feed; never blocks boot.
  maybeStartAutoUpdater();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady()
    .then(boot)
    .catch((err: unknown) => {
      dialog.showErrorBox("Başlatma hatası", String((err as Error)?.stack || err));
      app.exit(1);
    });

  app.on("window-all-closed", () => {
    stopServer();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    quitting = true;
    hideComputerUseEdgePulse();
    stopDesktopHost();
    void stopBrowserBridge();
    void stopComputerUseBridge();
    stopServer();
  });

  app.on("activate", () => {
    if (!mainWindow && currentUrl) createWindow(currentUrl);
  });
}
