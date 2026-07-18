import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { MobilePlatform, MobileProjectProfile } from "./types.js";

const IGNORED = new Set(["node_modules", ".git", "dist", "build", ".gradle", ".dart_tool", "Pods", "vendor"]);
const MARKERS = new Set(["settings.gradle", "settings.gradle.kts", "pubspec.yaml", "package.json", "capacitor.config.ts", "capacitor.config.json", "project.godot", ".quake-code"]);

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function safeRead(path: string): string { try { return readFileSync(path, "utf8"); } catch { return ""; } }

function candidateRoots(root: string, maxDepth = 4): string[] {
  const roots = new Set<string>([root]);
  function walk(directory: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true, encoding: "utf8" }); } catch { return; }
    if (entries.some((entry) => MARKERS.has(entry.name) || /\.xcodeproj$|\.xcworkspace$/.test(entry.name))) roots.add(directory);
    for (const entry of entries) if (entry.isDirectory() && !IGNORED.has(entry.name) && !entry.name.startsWith(".")) walk(join(directory, entry.name), depth + 1);
  }
  walk(root, 0);
  return [...roots];
}

function packageSignals(root: string): { frameworks: string[]; mobile: boolean } {
  const path = join(root, "package.json");
  if (!existsSync(path)) return { frameworks: [], mobile: false };
  try {
    const pkg = JSON.parse(safeRead(path));
    const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const frameworks = [dependencies["react-native"] && "React Native", dependencies.expo && "Expo", dependencies["@capacitor/core"] && "Capacitor", dependencies["@nativescript/core"] && "NativeScript"].filter(Boolean) as string[];
    return { frameworks, mobile: frameworks.length > 0 };
  } catch { return { frameworks: [], mobile: false }; }
}

function gradleApplications(root: string): Array<{ root: string; name: string; applicationId?: string; variants: string[] }> {
  const settings = safeRead(join(root, existsSync(join(root, "settings.gradle.kts")) ? "settings.gradle.kts" : "settings.gradle"));
  const modules = [...settings.matchAll(/include\s*\(?\s*["'](:[^"']+)["']/g)].map((match) => match[1]!.slice(1).replace(/:/g, "/"));
  if (!modules.length && existsSync(join(root, "app"))) modules.push("app");
  return modules.flatMap((module) => {
    const moduleRoot = join(root, module);
    const script = safeRead(join(moduleRoot, existsSync(join(moduleRoot, "build.gradle.kts")) ? "build.gradle.kts" : "build.gradle"));
    if (!/com\.android\.application|id\s*\(?["']com\.android\.application/.test(script)) return [];
    const applicationId = script.match(/applicationId\s*[=( ]\s*["']([^"']+)/)?.[1];
    const buildTypes = [...script.matchAll(/(?:create\s*\(\s*)?["'](debug|release|staging|benchmark)["']/g)].map((match) => match[1]!);
    return [{ root: moduleRoot, name: `${basename(root)}:${module}`, applicationId, variants: unique(buildTypes.length ? buildTypes : ["debug", "release"]) }];
  });
}

export function detectMobileProjects(workspace: string): MobileProjectProfile[] {
  const projects: MobileProjectProfile[] = [];
  for (const root of candidateRoots(workspace)) {
    const pkg = packageSignals(root);
    const flutter = existsSync(join(root, "pubspec.yaml"));
    const capacitor = existsSync(join(root, "capacitor.config.ts")) || existsSync(join(root, "capacitor.config.json"));
    const godot = existsSync(join(root, "project.godot")) && (/android|ios/i.test(safeRead(join(root, "export_presets.cfg"))) || existsSync(join(root, "android")));
    const gradleApps = gradleApplications(root);
    for (const app of gradleApps) projects.push({
      id: `android:${relative(workspace, app.root).replace(/\\/g, "/") || "app"}`,
      name: app.name,
      root: app.root,
      frameworks: pkg.frameworks,
      languages: ["Kotlin/Java", ...(pkg.mobile ? ["JavaScript/TypeScript"] : [])],
      targets: ["android"],
      buildSystems: ["Gradle"],
      configurable: existsSync(join(root, ".quake-code", "mobile.json")),
    });
    if (!gradleApps.length && (pkg.mobile || flutter || capacitor || godot)) {
      const frameworks = unique([...pkg.frameworks, flutter ? "Flutter" : "", capacitor ? "Capacitor" : "", godot ? "Godot" : ""].filter(Boolean));
      const targets: MobilePlatform[] = ["android", ...(existsSync(join(root, "ios")) || flutter || pkg.mobile ? ["ios" as const] : [])];
      projects.push({ id: `mobile:${relative(workspace, root).replace(/\\/g, "/") || "root"}`, name: basename(root), root, frameworks, languages: flutter ? ["Dart"] : godot ? ["GDScript/C#"] : ["JavaScript/TypeScript"], targets: unique(targets), buildSystems: flutter ? ["Flutter"] : godot ? ["Godot"] : capacitor ? ["Capacitor"] : ["Metro"], configurable: existsSync(join(root, ".quake-code", "mobile.json")) || existsSync(join(workspace, ".quake-code", "mobile.json")) });
    }
  }
  const byRoot = new Map<string, MobileProjectProfile>();
  for (const project of projects) if (!byRoot.has(project.root)) byRoot.set(project.root, project);
  return [...byRoot.values()];
}
