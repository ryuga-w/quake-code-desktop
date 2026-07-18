const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

function getGlobalNodeModuleRoots() {
	const roots = new Set();

	if (process.platform === "win32" && process.env.APPDATA) {
		roots.add(path.join(process.env.APPDATA, "npm", "node_modules"));
	}

	for (const prefix of [process.env.npm_config_prefix, process.env.PREFIX]) {
		if (!prefix) continue;
		roots.add(process.platform === "win32" ? path.join(prefix, "node_modules") : path.join(prefix, "lib", "node_modules"));
	}

	try {
		const npmRoot = childProcess.execSync("npm root -g", {
			stdio: ["ignore", "pipe", "ignore"],
			encoding: "utf8",
		}).trim();
		if (npmRoot) roots.add(npmRoot);
	} catch {}

	return [...roots].filter((root) => root && fs.existsSync(root));
}

function loadClipboardModule() {
	const candidateModules = [
		"@mariozechner/clipboard",
		path.resolve(__dirname, "..", "..", "node_modules", "@mariozechner", "clipboard"),
		path.resolve(__dirname, "..", "..", "node_modules", "@mrquake", "quakecode-cli", "node_modules", "@mariozechner", "clipboard"),
		...getGlobalNodeModuleRoots().flatMap((root) => [
			path.join(root, "@mariozechner", "clipboard"),
			path.join(root, "@mrquake", "quakecode-cli", "node_modules", "@mariozechner", "clipboard"),
		]),
	];

	let lastError;
	for (const candidate of candidateModules) {
		try {
			return require(candidate);
		} catch (error) {
			lastError = error;
		}
	}

	const wrapped = new Error(
		"@mrquake/quakecode-clipboard could not load @mariozechner/clipboard from local or global npm locations. Run a clean install so the native clipboard dependency is present.",
	);
	wrapped.cause = lastError;
	throw wrapped;
}

const clipboard = loadClipboardModule();

module.exports = clipboard;
module.exports.default = clipboard;
