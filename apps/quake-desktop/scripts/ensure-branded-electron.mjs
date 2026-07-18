/**
 * Copy Electron runtime to QuakeCode.exe (same folder as electron.exe so
 * icudtl.dat / .pak files resolve) and stamp ProductName + icon for Windows toasts.
 *
 * Prints absolute path to branded exe on stdout.
 */
import { copyFileSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function resolveElectronExe() {
  try {
    const p = require("electron");
    if (typeof p === "string" && existsSync(p)) return p;
  } catch {
    /* ignore */
  }
  const candidates = [
    join(root, "node_modules", "electron", "dist", "electron.exe"),
    join(root, "..", "..", "node_modules", "electron", "dist", "electron.exe"),
    join(root, "..", "node_modules", "electron", "dist", "electron.exe"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error("electron.exe not found — run npm install");
}

async function main() {
  if (process.platform !== "win32") {
    process.stdout.write(resolveElectronExe());
    return;
  }

  const electronExe = resolveElectronExe();
  // MUST stay next to electron.exe so ICU/pak/ffmpeg load.
  const distDir = dirname(electronExe);
  const branded = join(distDir, "QuakeCode.exe");
  const icon = join(root, "resources", "icon.ico");

  const needsCopy =
    !existsSync(branded) || statSync(electronExe).mtimeMs > statSync(branded).mtimeMs;

  if (needsCopy) {
    copyFileSync(electronExe, branded);
    try {
      const rceditMod = await import("rcedit");
      const rcedit = rceditMod.rcedit || rceditMod.default;
      if (typeof rcedit === "function") {
        await rcedit(branded, {
          icon: existsSync(icon) ? icon : undefined,
          "version-string": {
            ProductName: "Quake Code",
            FileDescription: "Quake Code",
            CompanyName: "Quake Code",
            InternalName: "QuakeCode",
            OriginalFilename: "QuakeCode.exe",
            LegalCopyright: "Quake Code",
          },
          "product-version": "0.1.0",
          "file-version": "0.1.0",
        });
        console.error("[branded-electron] stamped QuakeCode.exe (ProductName=Quake Code)");
      }
    } catch (err) {
      console.error(
        "[branded-electron] rcedit skipped:",
        err && err.message ? err.message : err,
      );
    }
  }

  process.stdout.write(branded);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
