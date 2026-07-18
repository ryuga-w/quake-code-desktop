// Electron masaustu kabugu ile guvenli kopru. preload.ts `window.quakeDesktop`
// expose eder; web (tarayici) build'inde tanimsizdir -> isDesktop=false, UI native
// browser chrome'unu korur.

export interface QuakeBrowserApi {
  setBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
  navigate: (url: string) => Promise<boolean>;
  reload: () => void;
  back: () => void;
  forward: () => void;
  getUrl: () => Promise<string>;
  getNavigationState: () => Promise<BrowserNavigationState>;
  openExternal: (url: string) => Promise<boolean>;
  startElementPicker: () => Promise<BrowserPickerResult>;
  cancelElementPicker: () => Promise<void>;
  highlightTarget: (target: ElementInspectResult) => Promise<boolean>;
  hide: () => void;
  inspectElementAt: (x: number, y: number) => Promise<ElementInspectResult | null>;
  highlightElement: (selector: string) => Promise<void>;
  clearHighlight: () => Promise<void>;
  captureElementScreenshot: (selector: string) => Promise<string>;
  captureElementTarget: (target: ElementInspectResult) => Promise<string>;
  captureViewportScreenshot: () => Promise<string>;
  captureFullpageScreenshot: () => Promise<string>;
  onDidStartLoading: (callback: () => void) => () => void;
  onDidStopLoading: (callback: () => void) => () => void;
  onDidNavigate: (callback: (url: string) => void) => () => void;
  onCursor: (callback: (cursor: { x: number; y: number; kind: string }) => void) => () => void;
  /** Agent embedded-browser session lifecycle (open Tarayıcı panel). */
  onAgentSession?: (callback: (state: { active: boolean }) => void) => () => void;
}

export type BrowserNavigationState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
};

export type BrowserPickerResult =
  | {
      status: "completed";
      annotations: Array<{ target: ElementInspectResult; comment: string; number: number }>;
      documentTitle: string;
      screenshot?: string;
    }
  | { status: "cancelled"; reason?: string }
  | { status: "error"; message: string };

export interface ElementInspectResult {
  selectorPath: string[];
  frameUrl: string;
  documentUrl: string;
  role: string;
  accessibleName: string;
  tag: string;
  id: string;
  classes: string[];
  text: string;
  selector: string;
  xpath: string;
  outerHTML: string;
  rect: { x: number; y: number; width: number; height: number };
  attributes: Record<string, string>;
  styles: {
    font: string;
    color: string;
    background: string;
    display: string;
    position: string;
    margin: string;
    padding: string;
    width: string;
    height: string;
  };
}

export interface QuakeComputerUseApi {
  onCursor: (
    callback: (cursor: { x: number; y: number; kind: string; label?: string; at: number }) => void,
  ) => () => void;
  /** Computer-use ajan oturumu bittiğinde panel kapatmak için. */
  onSession?: (callback: (state: { active: boolean }) => void) => () => void;
}

/** S-PUB.2 electron-updater status exposed via preload. */
export type UpdaterFeedSource = "env" | "prefs" | "embedded" | "none";

export type UpdaterStatus = {
  feedConfigured: boolean;
  enabled: boolean;
  envForced: boolean;
  willCheck: boolean;
  currentVersion: string;
  lastCheckAt?: string;
  lastError?: string;
  updateAvailable?: boolean;
  updateVersion?: string;
  /** Effective feed URL when not embedded. */
  updateFeedUrl?: string;
  /** Masked feed for display in Settings. */
  feedUrlMasked?: string;
  /** User-saved feed from prefs (editable). */
  prefsFeedUrl?: string;
  feedSource: UpdaterFeedSource;
  statusMessage: string;
};

export interface QuakeUpdaterApi {
  getStatus: () => Promise<UpdaterStatus>;
  setEnabled: (enabled: boolean) => Promise<UpdaterStatus>;
  /** Persist update feed URL to userData prefs (empty string clears). */
  setFeedUrl: (url: string) => Promise<UpdaterStatus>;
  check: () => Promise<UpdaterStatus>;
}

export interface QuakeDesktopApi {
  isDesktop: true;
  platform: string;
  minimize: () => void;
  maximizeToggle: () => void;
  close: () => void;
  setOverlay: (color: string, symbolColor: string) => void;
  /** Sync Chromium prefers-color-scheme with Quake's resolved theme. */
  setResolvedTheme?: (theme: "light" | "dark") => void;
  /** Native klasör seçici (Add Folder). */
  pickFolder?: () => Promise<string | null>;
  /** Native multi-folder picker (multi-root workspace). */
  pickFolders?: () => Promise<string[]>;
  /** Persist open roots + active root in Electron desktop state. */
  rememberWorkspaceRoots?: (roots: string[], activeRoot: string) => Promise<void>;
  /** Subscribe to File → Open Folder selections from Electron's native menu. */
  onWorkspaceSelected?: (callback: (path: string) => void) => () => void;
  /** Quick Start: rastgele isimli proje klasörü oluştur. */
  createQuickProject?: () => Promise<string | null>;
  /** No Project scratch path. */
  noProjectDir?: () => Promise<string | null>;
  /** Open a local filesystem path (folder/file) via OS shell. */
  openPath?: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
  /** Reveal a local path in the system file manager. */
  showItemInFolder?: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
  /** Native OS notification (Electron Notification). force skips background-only gate. */
  showNotification?: (title: string, body?: string, force?: boolean) => void;
  /** True when minimized / unfocused / hidden (background-only notifications). */
  isWindowInBackground?: () => Promise<boolean>;
  /** Prevent app suspension while unattended Goal work is active. */
  setGoalUnattendedActive?: (active: boolean) => void;
  /** Optional auto-update (S-PUB.2); missing feed keeps status disabled. */
  updater?: QuakeUpdaterApi;
  mcpSecrets?: {
    list: () => Promise<string[]>;
    set: (name: string, value: string) => Promise<string[]>;
    remove: (name: string) => Promise<string[]>;
  };
  browser: QuakeBrowserApi;
  computerUse?: QuakeComputerUseApi;
}

declare global {
  interface Window {
    quakeDesktop?: QuakeDesktopApi;
  }
}

export const desktop: QuakeDesktopApi | undefined =
  typeof window !== "undefined" ? window.quakeDesktop : undefined;

export const isDesktop = Boolean(desktop?.isDesktop);
