import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const result = spawnSync("npm", ["run", "mouse:smoke"], {
	cwd: join(root, "packages/coding-agent"),
	stdio: "inherit",
	shell: true,
});

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}