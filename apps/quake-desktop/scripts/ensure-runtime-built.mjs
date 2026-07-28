import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(appRoot, "..", "..");
const requiredOutputs = [
  "packages/tui/dist/index.js",
  "packages/ai/dist/index.js",
  "packages/agent/dist/index.js",
  "packages/jiti/dist/index.js",
  "packages/coding-agent/dist/index.js",
];

if (requiredOutputs.every((path) => existsSync(join(repositoryRoot, path)))) {
  process.exit(0);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["run", "desktop:build:runtime"], {
  cwd: appRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
