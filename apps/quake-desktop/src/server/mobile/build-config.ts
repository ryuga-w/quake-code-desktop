import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { MobileBuildProfile, MobilePlatform } from "./types.js";
import { discoverAdapterProfiles } from "./build-adapters.js";
import { detectMobileProjects } from "./project-detector.js";

interface CustomTargetConfig {
  build?: string;
  clean?: string;
  artifact?: string;
  artifactGlob?: string;
  appId?: string;
  variant?: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
  preBuild?: string;
  postBuild?: string;
  install?: string;
  launch?: string;
}

interface CustomMobileConfig {
  version?: number;
  applications?: Array<{
    id?: string;
    name?: string;
    android?: CustomTargetConfig;
    ios?: CustomTargetConfig;
  }>;
}

function insideWorkspace(workspace: string, input: string): string {
  const target = resolve(workspace, input || ".");
  const rel = relative(workspace, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Mobil yapılandırma çalışma alanı dışına çıkamaz");
  return target;
}

export interface MobileConfigDiagnostic { code: string; message: string; path?: string }

export function readMobileConfig(workspace: string): { config?: CustomMobileConfig; diagnostics: MobileConfigDiagnostic[] } {
  const configPath = join(workspace, ".quake-code", "mobile.json");
  if (!existsSync(configPath)) return { diagnostics: [] };
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as CustomMobileConfig;
    const diagnostics: MobileConfigDiagnostic[] = [];
    if (config.version !== undefined && config.version !== 1) diagnostics.push({ code: "UNSUPPORTED_VERSION", message: "Desteklenmeyen mobile.json sürümü", path: "version" });
    const ids = new Set<string>();
    for (const [index, application] of (config.applications || []).entries()) {
      if (!application.id) diagnostics.push({ code: "MISSING_ID", message: "Uygulama id alanı gerekli", path: `applications[${index}].id` });
      else if (ids.has(application.id)) diagnostics.push({ code: "DUPLICATE_ID", message: `Tekrarlanan uygulama id: ${application.id}`, path: `applications[${index}].id` });
      else ids.add(application.id);
      if (application.android?.appId && !/^[a-zA-Z][a-zA-Z0-9_.]+$/.test(application.android.appId)) diagnostics.push({ code: "INVALID_APP_ID", message: "Geçersiz Android applicationId", path: `applications[${index}].android.appId` });
    }
    return { config, diagnostics };
  } catch (reason) { return { diagnostics: [{ code: "INVALID_JSON", message: reason instanceof Error ? reason.message : "mobile.json okunamadı" }] }; }
}

function customProfiles(workspace: string): MobileBuildProfile[] {
  const { config, diagnostics } = readMobileConfig(workspace);
  if (!config || diagnostics.some((diagnostic) => ["INVALID_JSON", "UNSUPPORTED_VERSION", "DUPLICATE_ID"].includes(diagnostic.code))) return [];
  const profiles: MobileBuildProfile[] = [];
  for (const [applicationIndex, application] of (config.applications || []).entries()) {
    for (const platform of ["android", "ios"] as const) {
      const target = application[platform];
      if (!target?.build) continue;
      if (target.build.length > 4_000) throw new Error("Mobil build komutu çok uzun");
      const id = application.id || `application-${applicationIndex + 1}`;
      profiles.push({
        id: `${id}:${platform}`,
        applicationId: id,
        name: application.name || id,
        platform,
        source: "custom",
        command: target.build,
        workingDirectory: insideWorkspace(workspace, target.workingDirectory || "."),
        artifact: target.artifact ? insideWorkspace(workspace, target.artifact) : undefined,
        appId: target.appId,
        adapter: "custom",
        variant: target.variant,
        artifactGlob: target.artifactGlob,
        environment: target.environment,
        capabilities: ["build", ...(target.clean ? ["clean" as const] : []), ...(target.artifact || target.artifactGlob ? ["install" as const] : []), ...(target.appId || target.launch ? ["launch" as const] : [])],
      });
    }
  }
  return profiles;
}

function automaticProfiles(workspace: string): MobileBuildProfile[] {
  const profiles: MobileBuildProfile[] = detectMobileProjects(workspace).flatMap((project) => discoverAdapterProfiles(project.root));
  const windows = process.platform === "win32";
  const gradleRoot = existsSync(join(workspace, "android")) ? join(workspace, "android") : workspace;
  const gradleWrapper = join(gradleRoot, windows ? "gradlew.bat" : "gradlew");
  if (existsSync(gradleWrapper)) profiles.push({
    id: "auto-android-gradle",
    applicationId: "workspace-mobile-app",
    name: "Android Debug",
    platform: "android",
    source: "automatic",
    command: windows ? "gradlew.bat assembleDebug" : "./gradlew assembleDebug",
    workingDirectory: gradleRoot,
    artifact: join(gradleRoot, "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
    adapter: "gradle",
    variant: "debug",
    capabilities: ["build", "clean", "install", "launch"],
  });
  const uniqueProfiles = new Map<string, MobileBuildProfile>();
  for (const profile of profiles) uniqueProfiles.set(`${profile.adapter || profile.id}:${profile.workingDirectory}:${profile.platform}`, profile);
  return [...uniqueProfiles.values()];
}

export function loadMobileBuildProfiles(workspace: string): MobileBuildProfile[] {
  const custom = customProfiles(workspace);
  const customPlatforms = new Set(custom.map((profile) => profile.platform));
  return [...custom, ...automaticProfiles(workspace).filter((profile) => !customPlatforms.has(profile.platform))];
}

export function requireBuildProfile(workspace: string, profileId: string, platform?: MobilePlatform): MobileBuildProfile {
  const profile = loadMobileBuildProfiles(workspace).find((candidate) => candidate.id === profileId && (!platform || candidate.platform === platform));
  if (!profile) throw new Error("Mobil build profili bulunamadı");
  return profile;
}
