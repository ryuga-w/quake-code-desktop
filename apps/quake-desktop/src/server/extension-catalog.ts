import { basename, dirname, extname } from "node:path";

export type ExtensionCategory = "featured" | "productivity" | "education";

export const OPT_IN_EXTENSION_IDS = new Set([
	"quake-computer-use",
	"quake-chrome",
	"quake-latex",
]);

export type ExtensionCatalogEntry = {
	id: string;
	name: string;
	description: string;
	featured?: boolean;
	category: ExtensionCategory;
};

export const EXTENSION_CATALOG: ExtensionCatalogEntry[] = [
	{
		id: "quake-mobile-tools",
		name: "Mobile Studio",
		description: "Build, inspect, and control Android/iOS apps with semantic mobile tools.",
		featured: true,
		category: "featured",
	},
	{
		id: "quake-computer-use",
		name: "Computer Use",
		description: "Control Windows apps with screenshots and mouse/keyboard tools.",
		featured: true,
		category: "featured",
	},
	{
		id: "quake-chrome",
		name: "Chrome",
		description: "Control Chrome with tabs, navigation, and page interaction tools.",
		featured: true,
		category: "featured",
	},
	{
		id: "quake-latex",
		name: "LaTeX",
		description: "Compile LaTeX with Tectonic or TeX Live in your workspace.",
		category: "education",
	},
];

export function extensionIdFromPath(extensionPath: string): string {
	const file = basename(extensionPath);
	if (file === "index.ts" || file === "index.js") {
		return basename(dirname(extensionPath));
	}
	return basename(extensionPath, extname(extensionPath));
}

export function resolveExtensionEnabled(
	id: string,
	enabledMap: Record<string, boolean | undefined>,
): boolean {
	if (OPT_IN_EXTENSION_IDS.has(id)) {
		return enabledMap[id] === true;
	}
	return enabledMap[id] !== false;
}

export function catalogEntryForId(id: string): ExtensionCatalogEntry | undefined {
	return EXTENSION_CATALOG.find((entry) => entry.id === id);
}