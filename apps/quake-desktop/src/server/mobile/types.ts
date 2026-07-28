export type MobilePlatform = "android" | "ios";
export type MobileTargetStatus = "unavailable" | "offline" | "unauthorized" | "locked" | "disconnected" | "ready" | "busy" | "error";

export interface MobileProjectProfile {
  id: string;
  name: string;
  root: string;
  frameworks: string[];
  languages: string[];
  targets: MobilePlatform[];
  buildSystems: string[];
  configurable: boolean;
}

export interface MobileDevice {
  id: string;
  platform: MobilePlatform;
  name: string;
  kind: "emulator" | "simulator" | "physical" | "remote";
  status: MobileTargetStatus;
  osVersion?: string;
  model?: string;
  architecture?: string;
  remote?: boolean;
  connection?: "usb" | "wireless" | "emulator";
  message?: string;
  resolution?: { width: number; height: number };
  sdkLevel?: number;
}

export interface AndroidToolchain {
  sdkRoot?: string;
  adb?: { executable: string; version?: string };
  emulator?: { executable: string; version?: string };
  sdkManager?: { executable: string; version?: string };
  avdManager?: { executable: string; version?: string };
  buildTools: string[];
}

export interface MobileHostCapability {
  platform: MobilePlatform;
  available: boolean;
  mode: "local" | "remote-required" | "remote";
  executable?: string;
  message?: string;
  toolchain?: AndroidToolchain;
}

export interface AndroidVirtualDevice {
  name: string;
  running: boolean;
  status: "stopped" | "booting" | "ready" | "offline";
  deviceId?: string;
}

export interface MobileRuntimeLog {
  timestamp?: string;
  level: "verbose" | "debug" | "info" | "warning" | "error" | "fatal";
  tag?: string;
  pid?: number;
  message: string;
  event?: "crash" | "anr";
}

export interface MobileBuildProfile {
  id: string;
  applicationId: string;
  name: string;
  platform: MobilePlatform;
  source: "automatic" | "custom";
  command: string;
  workingDirectory: string;
  artifact?: string;
  appId?: string;
  adapter?: string;
  variant?: string;
  artifactGlob?: string;
  capabilities?: Array<"build" | "clean" | "install" | "launch" | "hot-reload" | "sync">;
  environment?: Record<string, string>;
}

export type MobileJobStatus = "queued" | "preparing" | "building" | "packaging" | "installing" | "launching" | "completed" | "failed" | "cancelled";

export interface MobileBuildJob {
  id: string;
  profileId: string;
  platform: MobilePlatform;
  status: MobileJobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  deviceId?: string;
  result?: MobileBuildResult;
  error?: string;
  log: string;
  timeoutMs?: number;
}

export interface MobileDiagnostic {
  code: string;
  level: "info" | "warning" | "error";
  message: string;
  action?: string;
}

export interface MobileBuildResult {
  profileId: string;
  platform: MobilePlatform;
  success: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  artifact?: string;
  installed?: boolean;
  launched?: boolean;
}

export interface MobileStudioStatus {
  version: 1;
  workspace: string;
  projects: MobileProjectProfile[];
  buildProfiles: MobileBuildProfile[];
  capabilities: MobileHostCapability[];
  devices: MobileDevice[];
  androidVirtualDevices: AndroidVirtualDevice[];
  foregroundApps: Partial<Record<MobilePlatform, Record<string, string | undefined>>>;
  targets: Array<{
    platform: MobilePlatform;
    status: MobileTargetStatus;
    deviceId?: string;
    message?: string;
  }>;
  diagnostics: MobileDiagnostic[];
  buildJobs: MobileBuildJob[];
  refreshedAt: string;
}

export interface MobileElementNode {
  index: number;
  ref: string;
  fingerprint: string;
  parentFingerprint?: string;
  text?: string;
  resourceId?: string;
  className?: string;
  packageName?: string;
  contentDescription?: string;
  clickable: boolean;
  enabled: boolean;
  focused: boolean;
  bounds?: { left: number; top: number; right: number; bottom: number };
}

export interface MobileSemanticSnapshot {
  platform: MobilePlatform;
  deviceId: string;
  snapshotId: string;
  revision: number;
  capturedAt: string;
  nodes: MobileElementNode[];
  raw?: string;
}

export type MobileAction =
  | { type: "tap_element"; ref?: string; resourceId?: string; text?: string; contentDescription?: string; snapshotId?: string; revision?: number; nodeIndex?: number }
  | { type: "tap"; x: number; y: number }
  | { type: "long_press"; x: number; y: number; durationMs?: number }
  | { type: "swipe"; fromX: number; fromY: number; toX: number; toY: number; durationMs?: number }
  | { type: "type"; text: string; mode?: "append" | "replace"; submit?: boolean }
  | { type: "clear_text" }
  | { type: "paste"; text: string }
  | { type: "key"; key: "back" | "home" | "app-switch" | "power" | "volume-up" | "volume-down" | "enter" | "tab" }
  | { type: "rotate"; orientation: "portrait" | "landscape" | "auto" }
  | { type: "launch"; appId: string }
  | { type: "terminate"; appId: string };
