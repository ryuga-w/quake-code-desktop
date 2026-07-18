import { app, dialog, type BrowserWindow } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface DesktopState {
  lastWorkspace?: string;
  workspaceRoots?: string[];
}

export function getWorkspaceRoots(): string[] {
  const state = readState();
  const candidates = [state.lastWorkspace, ...(state.workspaceRoots || [])];
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const normalized = path.resolve(candidate);
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(normalized);
  }
  return roots;
}

function stateFile(): string {
  return path.join(app.getPath("userData"), "desktop-state.json");
}

function readState(): DesktopState {
  try {
    return (JSON.parse(fs.readFileSync(stateFile(), "utf8")) as DesktopState) || {};
  } catch {
    return {};
  }
}

function writeState(state: DesktopState): void {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
  } catch {
    /* yazılamazsa sessizce geç */
  }
}

export function getLastWorkspace(): string | undefined {
  const dir = readState().lastWorkspace;
  return dir && fs.existsSync(dir) ? dir : undefined;
}

export function setLastWorkspace(dir: string): void {
  rememberWorkspaceRoots([dir], dir);
}

export function rememberWorkspaceRoots(roots: string[], activeRoot?: string): void {
  const state = readState();
  const existing = getWorkspaceRoots();
  const normalizedRoots = roots.filter(Boolean).map((root) => path.resolve(root));
  const active = activeRoot ? path.resolve(activeRoot) : normalizedRoots.at(-1);
  const seen = new Set<string>();
  state.workspaceRoots = [...(active ? [active] : []), ...normalizedRoots, ...existing].filter((root) => {
    const key = process.platform === "win32" ? root.toLowerCase() : root;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (active) state.lastWorkspace = active;
  writeState(state);
}

/** Açılışta kullanılacak çalışma dizini: env → son kullanılan → Belgeler/home. Asla kurulum dizini değil. */
export function resolveWorkspaceCwd(): string {
  const env = process.env.QUAKE_WEB_CWD;
  if (env && fs.existsSync(env)) return path.resolve(env);
  const last = getLastWorkspace();
  if (last) return last;
  try {
    return app.getPath("documents");
  } catch {
    return os.homedir();
  }
}

/** Native klasör seçici; seçilen dizini kalıcı yapar. */
export async function pickWorkspace(parent?: BrowserWindow): Promise<string | undefined> {
  const options: Electron.OpenDialogOptions = {
    properties: ["openDirectory"],
    title: "Çalışma klasörünü seç",
    defaultPath: (() => {
      try {
        return app.getPath("documents");
      } catch {
        return os.homedir();
      }
    })(),
  };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return undefined;
  setLastWorkspace(result.filePaths[0]);
  return result.filePaths[0];
}

/** Native multi-folder picker used by Create Project → Add Folder. */
export async function pickWorkspaces(parent?: BrowserWindow): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    properties: ["openDirectory", "multiSelections"],
    title: "Çalışma klasörlerini seç",
    defaultPath: getLastWorkspace() || (() => {
      try {
        return app.getPath("documents");
      } catch {
        return os.homedir();
      }
    })(),
  };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (result.canceled) return [];
  const roots = result.filePaths.filter(Boolean).map((entry) => path.resolve(entry));
  if (roots.length === 0) return [];
  rememberWorkspaceRoots(roots, roots[roots.length - 1]);
  return roots;
}

const QUICK_ADJECTIVES = [
  "swift", "bright", "calm", "bold", "quiet", "eager", "gentle", "keen",
  "lucid", "noble", "rapid", "serene", "vivid", "warm", "crisp", "fair",
  "grand", "happy", "ideal", "jolly", "kind", "lively", "merry", "nimble",
  "open", "proud", "quick", "radiant", "solid", "tender", "upbeat", "vital",
  "wise", "young", "zesty", "peaceful", "excited", "curious", "brave", "clear",
];
const QUICK_NOUNS = [
  "nova", "orbit", "river", "summit", "harbor", "cedar", "falcon", "maple",
  "pixel", "quartz", "ridge", "spark", "tide", "valley", "wave", "zenith",
  "atlas", "beacon", "comet", "delta", "ember", "forge", "grove", "haven",
  "iris", "jade", "kite", "lotus", "meadow", "nexus", "oak", "prism",
  "quill", "reef", "stone", "torch", "umbra", "vista", "willow", "archimedes",
  "volta", "carson", "newton", "curie", "tesla", "hopper", "turing", "lovelace",
];

function randomSlug(): string {
  const a = QUICK_ADJECTIVES[Math.floor(Math.random() * QUICK_ADJECTIVES.length)];
  const n = QUICK_NOUNS[Math.floor(Math.random() * QUICK_NOUNS.length)];
  return `${a}-${n}`;
}

/** Antigravity-style Quick Start: Documents/QuakeProjects/<slug> oluştur. */
export function createQuickProject(): string {
  let docs: string;
  try {
    docs = app.getPath("documents");
  } catch {
    docs = os.homedir();
  }
  const root = path.join(docs, "QuakeProjects");
  fs.mkdirSync(root, { recursive: true });
  let dir = path.join(root, randomSlug());
  let tries = 0;
  while (fs.existsSync(dir) && tries < 12) {
    dir = path.join(root, `${randomSlug()}-${Date.now().toString(36).slice(-3)}`);
    tries += 1;
  }
  fs.mkdirSync(dir, { recursive: true });
  setLastWorkspace(dir);
  return dir;
}

/** No Project scratch dizini (workspace seçili değil hissi). */
export function resolveNoProjectDir(): string {
  const dir = path.join(app.getPath("userData"), "no-project");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
