import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { MobileBuildProfile } from "./types.js";

function packageJson(root: string): Record<string, unknown> {
  try { return JSON.parse(readFileSync(join(root, "package.json"), "utf8")); } catch { return {}; }
}
function profile(root: string, adapter: string, name: string, command: string, artifact?: string, appId?: string): MobileBuildProfile {
  return { id: `auto-${adapter}-${Buffer.from(root).toString("base64url").slice(-10)}`, applicationId: `app-${basename(root)}`, name, platform: "android", source: "automatic", command, workingDirectory: root, artifact, appId, adapter, variant: "debug", capabilities: ["build", "clean", "install", "launch"] };
}

export function discoverAdapterProfiles(root: string): MobileBuildProfile[] {
  const profiles: MobileBuildProfile[] = [];
  const pkg = packageJson(root) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (existsSync(join(root, "pubspec.yaml"))) profiles.push({ ...profile(root, "flutter", "Flutter Android Debug", "flutter build apk --debug", join(root, "build", "app", "outputs", "flutter-apk", "app-debug.apk")), capabilities: ["build", "clean", "install", "launch", "hot-reload"] });
  if (dependencies.expo) profiles.push({ ...profile(root, "expo", "Expo Android Debug", "npx expo run:android --no-bundler", undefined), capabilities: ["build", "clean", "install", "launch", "hot-reload"] });
  else if (dependencies["react-native"]) profiles.push({ ...profile(root, "react-native", "React Native Android", "npx react-native build-android --mode debug", join(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk")), capabilities: ["build", "clean", "install", "launch", "hot-reload"] });
  if (dependencies["@capacitor/core"] || existsSync(join(root, "capacitor.config.ts")) || existsSync(join(root, "capacitor.config.json"))) profiles.push({ ...profile(root, "capacitor", "Capacitor Android", "npx cap sync android && npx cap build android", join(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk")), capabilities: ["build", "clean", "install", "launch", "sync"] });
  if (dependencies["@nativescript/core"]) profiles.push({ ...profile(root, "nativescript", "NativeScript Android", "npx ns build android --env.debug", join(root, "platforms", "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk")), capabilities: ["build", "clean", "install", "launch", "hot-reload"] });
  if (existsSync(join(root, "project.godot"))) profiles.push(profile(root, "godot", "Godot Android Debug", "godot --headless --export-debug Android build/app.apk", join(root, "build", "app.apk")));
  return profiles;
}
