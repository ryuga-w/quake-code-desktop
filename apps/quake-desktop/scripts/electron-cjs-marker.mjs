// dist/electron/ içine CommonJS işaretçisi yazar; paket kökü "type":"module" olsa da
// derlenmiş main.js'in CommonJS olarak yüklenmesini sağlar.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist", "electron"), { recursive: true });
writeFileSync(
	join(root, "dist", "electron", "package.json"),
	`${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
);

// Persistent desktop host script for computer-use
const srcHost = join(root, "electron", "desktop-host");
const destHost = join(root, "dist", "electron", "desktop-host");
if (existsSync(srcHost)) {
	mkdirSync(destHost, { recursive: true });
	cpSync(srcHost, destHost, { recursive: true });
	console.log("[electron-cjs-marker] copied desktop-host -> dist/electron/desktop-host");
}
