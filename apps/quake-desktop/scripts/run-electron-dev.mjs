/**
 * Launch branded QuakeCode.exe (Windows) so OS toasts say "Quake Code" not "Electron".
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function resolveExe() {
  try {
    const out = execFileSync(process.execPath, [join(__dirname, "ensure-branded-electron.mjs")], {
      encoding: "utf8",
      cwd: root,
    }).trim();
    const line = out.split(/\r?\n/).filter(Boolean).pop();
    if (line && existsSync(line)) return line;
  } catch (err) {
    console.error("[run-electron-dev] branded electron failed, falling back", err);
  }
  try {
    const p = require("electron");
    if (typeof p === "string") return p;
  } catch {
    /* ignore */
  }
  throw new Error("Cannot resolve electron binary");
}

const exe = resolveExe();
const args = [root, "--dev", ...process.argv.slice(2)];
console.error(`[run-electron-dev] ${exe} ${args.join(" ")}`);

// cwd must be electron dist when using QuakeCode.exe so ICU/pak load; still pass app path as arg.
const exeDir = dirname(exe);
const child = spawn(exe, args, {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
  },
  windowsHide: false,
});
void exeDir;

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
