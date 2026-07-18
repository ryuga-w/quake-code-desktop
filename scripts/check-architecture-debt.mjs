import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

function read(relativePath) {
	return readFileSync(join(root, relativePath), "utf-8");
}

function assertNoPattern(relativePath, patterns) {
	const content = read(relativePath);
	for (const pattern of patterns) {
		if (pattern.test(content)) {
			failures.push(`${relativePath} still matches ${pattern}`);
		}
	}
}

assertNoPattern("packages/coding-agent/src/core/agent-session.ts", [
	/MRQUAKE_MODE/,
	/MRQUAKE_APPWRITE_WORKSPACE/,
	/APPWRITE_API_KEY/,
	/Founder Mode/,
	/mutsapp/,
]);

assertNoPattern("packages/coding-agent/src/modes/interactive/interactive-mode.ts", [
	/isMrQuakeModeActive/,
	/Founder fallback/,
	/rewriteFounderAssistantText/,
	/shapeFounderAssistantMessage/,
]);

if (!existsSync(join(root, "packages/agent/src/agent.ts"))) {
	failures.push("packages/agent/src/agent.ts is missing; agent source must be TypeScript");
}

for (const generatedSource of [
	"packages/agent/src/agent.js",
	"packages/agent/src/agent.d.ts",
	"packages/agent/src/agent.js.map",
	"packages/agent/src/agent.d.ts.map",
]) {
	if (existsSync(join(root, generatedSource))) {
		failures.push(`${generatedSource} should not be committed under src`);
	}
}

const rootPackage = JSON.parse(read("package.json"));
if (rootPackage.scripts?.check?.includes("--write")) {
	failures.push("package.json scripts.check must be non-mutating and must not include --write");
}

const obsoleteScriptPatterns = [/vscode-fork/, /desktop/];
const obsoleteScripts = Object.keys(rootPackage.scripts ?? {}).filter((name) =>
	obsoleteScriptPatterns.some((pattern) => pattern.test(name)),
);
if (obsoleteScripts.length > 0) {
	failures.push(`package.json still has obsolete scripts: ${obsoleteScripts.join(", ")}`);
}

for (const workflow of [".github/workflows/vscode-fork-gate.yml"]) {
	if (existsSync(join(root, workflow))) {
		failures.push(`${workflow} points at the removed VS Code fork workspace`);
	}
}

if (existsSync(join(root, "restart-desktop.ps1"))) {
	failures.push("restart-desktop.ps1 should be removed with quake-desktop");
}

if (existsSync(join(root, "apps/quake-desktop"))) {
	failures.push("apps/quake-desktop should not exist in the workspace");
}

const lockfile = read("package-lock.json");
for (const stalePattern of [/apps\/quake-desktop/, /@mrquake\/quakecode-desktop/]) {
	if (stalePattern.test(lockfile)) {
		failures.push(`package-lock.json still references removed quake-desktop workspace (${stalePattern})`);
	}
}

if (failures.length > 0) {
	console.error("Architecture debt check failed:");
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exit(1);
}

console.log("Architecture debt check passed.");
