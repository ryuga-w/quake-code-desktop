import { homedir } from "node:os";
import { join } from "node:path";

function resolveDesktopConfigRoot() {
  const override = process.env.QUAKE_DESKTOP_CONFIG_ROOT?.trim();
  if (override) return override;

  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Quake Code");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Quake Code");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "Quake Code");
}

// Desktop development must mirror the packaged app and must not inherit a
// legacy CLI's QUAKE_CODE_CODING_AGENT_DIR (for example ~/.grok/agent).
process.env.QUAKE_CODE_CODING_AGENT_DIR = join(resolveDesktopConfigRoot(), "agent");

await import("../src/server/index.ts");
