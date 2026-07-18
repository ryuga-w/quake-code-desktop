import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import type { MobileDeviceDriver } from "./driver.js";
import type { AndroidToolchain, AndroidVirtualDevice, MobileAction, MobileDevice, MobileElementNode, MobileHostCapability, MobileRuntimeLog, MobileSemanticSnapshot } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 4 * 1024 * 1024;

function executableName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function candidateAdbPaths(): string[] {
  const executable = executableName("adb");
  const sdkRoots = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    join(homedir(), "AppData", "Local", "Android", "Sdk"),
    join(homedir(), "Library", "Android", "sdk"),
    join(homedir(), "Android", "Sdk"),
  ].filter((value): value is string => Boolean(value));
  const fromPath = (process.env.PATH || "").split(delimiter).map((directory) => join(directory, executable));
  return [...sdkRoots.map((root) => join(root, "platform-tools", executable)), ...fromPath];
}

export function resolveAdbExecutable(): string | undefined {
  return candidateAdbPaths().find((candidate) => existsSync(candidate));
}

export function resolveAndroidSdkRoot(): string | undefined {
  const adbExecutable = resolveAdbExecutable();
  if (!adbExecutable) return undefined;
  return join(adbExecutable, "..", "..");
}

function sdkTool(name: string): string | undefined {
  const sdkRoot = resolveAndroidSdkRoot();
  if (!sdkRoot) return undefined;
  const executable = executableName(name);
  const candidates = [join(sdkRoot, "cmdline-tools", "latest", "bin", executable), join(sdkRoot, "tools", "bin", executable)];
  return candidates.find((candidate) => existsSync(candidate));
}

export function resolveEmulatorExecutable(): string | undefined {
  const sdkRoot = resolveAndroidSdkRoot();
  if (!sdkRoot) return undefined;
  const executable = join(sdkRoot, "emulator", executableName("emulator"));
  return existsSync(executable) ? executable : undefined;
}

async function adb(args: string[], options?: { encoding?: "buffer" }): Promise<string | Buffer> {
  const executable = resolveAdbExecutable();
  if (!executable) throw new Error("Android SDK platform-tools (adb) bulunamadı");
  const result = await execFileAsync(executable, args, {
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: MAX_OUTPUT,
    encoding: options?.encoding === "buffer" ? "buffer" : "utf8",
  });
  return result.stdout;
}

async function executableVersion(executable: string | undefined, args: string[]): Promise<string | undefined> {
  if (!executable) return undefined;
  try { return (await execFileAsync(executable, args, { windowsHide: true, timeout: 5_000, maxBuffer: 128_000, encoding: "utf8" })).stdout.split(/\r?\n/).find(Boolean)?.trim(); } catch { return undefined; }
}

export async function inspectAndroidToolchain(): Promise<AndroidToolchain> {
  const sdkRoot = resolveAndroidSdkRoot();
  const adbExecutable = resolveAdbExecutable();
  const emulatorExecutable = resolveEmulatorExecutable();
  const sdkManagerExecutable = sdkTool("sdkmanager");
  const avdManagerExecutable = sdkTool("avdmanager");
  const buildToolsRoot = sdkRoot ? join(sdkRoot, "build-tools") : "";
  let buildTools: string[] = [];
  if (buildToolsRoot && existsSync(buildToolsRoot)) {
    const { readdirSync } = await import("node:fs");
    buildTools = readdirSync(buildToolsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  }
  return {
    sdkRoot,
    adb: adbExecutable ? { executable: adbExecutable, version: await executableVersion(adbExecutable, ["version"]) } : undefined,
    emulator: emulatorExecutable ? { executable: emulatorExecutable, version: await executableVersion(emulatorExecutable, ["-version"]) } : undefined,
    sdkManager: sdkManagerExecutable ? { executable: sdkManagerExecutable, version: await executableVersion(sdkManagerExecutable, ["--version"]) } : undefined,
    avdManager: avdManagerExecutable ? { executable: avdManagerExecutable, version: await executableVersion(avdManagerExecutable, ["--version"]) } : undefined,
    buildTools,
  };
}

export async function getAndroidCapability(): Promise<MobileHostCapability> {
  const toolchain = await inspectAndroidToolchain();
  if (!toolchain.adb) return {
    platform: "android",
    available: false,
    mode: "local",
    message: "Android SDK platform-tools kurulmalı veya ANDROID_SDK_ROOT ayarlanmalı.",
    toolchain,
  };
  const missing = [!toolchain.emulator && "Emulator", !toolchain.sdkManager && "sdkmanager", !toolchain.avdManager && "avdmanager", !toolchain.buildTools.length && "build-tools"].filter(Boolean);
  return { platform: "android", available: true, mode: "local", executable: toolchain.adb.executable, toolchain, message: missing.length ? `İsteğe bağlı Android araçları eksik: ${missing.join(", ")}` : undefined };
}

function requireAvdName(name: string): string {
  if (!/^[a-zA-Z0-9._ -]+$/.test(name)) throw new Error("Geçersiz Android sanal cihaz adı");
  return name;
}

export async function listAndroidVirtualDevices(): Promise<AndroidVirtualDevice[]> {
  const executable = resolveEmulatorExecutable();
  if (!executable) return [];
  const result = await execFileAsync(executable, ["-list-avds"], { windowsHide: true, timeout: 10_000, maxBuffer: MAX_OUTPUT, encoding: "utf8" });
  const devices = (await listAndroidDevices()).filter((device) => device.kind === "emulator");
  const avdNames = result.stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  const running = new Map<string, string>();
  await Promise.all(devices.map(async (device) => {
    try {
      const output = String(await adb(["-s", device.id, "emu", "avd", "name"]));
      const name = output.split(/\r?\n/).map((line) => line.trim()).find((line) => line && line !== "OK");
      if (name && avdNames.includes(name)) running.set(name, device.id);
    } catch { /* offline emulators cannot answer console commands */ }
  }));
  const unresolvedDevices = devices.filter((device) => ![...running.values()].includes(device.id));
  const unresolvedNames = avdNames.filter((name) => !running.has(name));
  if (unresolvedDevices.length === 1 && unresolvedNames.length === 1) {
    running.set(unresolvedNames[0]!, unresolvedDevices[0]!.id);
  }
  return avdNames.map((name) => {
    const deviceId = running.get(name);
    const device = devices.find((candidate) => candidate.id === deviceId);
    return {
      name,
      running: Boolean(deviceId),
      status: !deviceId ? "stopped" as const : device?.status === "ready" ? "ready" as const : device?.status === "offline" ? "offline" as const : "booting" as const,
      deviceId,
    };
  });
}

export function getAndroidEmulatorLaunchArgs(name: string, options: { coldBoot?: boolean; wipeData?: boolean; headless?: boolean } = {}): string[] {
  return [
    "-avd",
    requireAvdName(name),
    ...(options.headless === false ? [] : ["-no-window", "-no-audio"]),
    ...(options.coldBoot === false ? [] : ["-no-snapshot-load"]),
    ...(options.wipeData ? ["-wipe-data"] : []),
    "-no-boot-anim",
  ];
}

export async function startAndroidVirtualDevice(name: string, options?: { coldBoot?: boolean; wipeData?: boolean; headless?: boolean }): Promise<void> {
  const executable = resolveEmulatorExecutable();
  if (!executable) throw new Error("Android Emulator bulunamadı");
  const child = spawn(executable, getAndroidEmulatorLaunchArgs(name, options), {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  child.unref();
}

export async function stopAndroidVirtualDevice(deviceId: string): Promise<void> {
  await adb(["-s", requireDeviceId(deviceId), "emu", "kill"]);
}

export interface AndroidAvdCatalog {
  systemImages: Array<{ id: string; installed: boolean }>;
  devicePresets: Array<{ id: string; name: string }>;
}

export async function getAndroidAvdCatalog(): Promise<AndroidAvdCatalog> {
  const sdkManager = sdkTool("sdkmanager");
  const avdManager = sdkTool("avdmanager");
  const systemImages: AndroidAvdCatalog["systemImages"] = [];
  const devicePresets: AndroidAvdCatalog["devicePresets"] = [];
  if (sdkManager) {
    const output = (await execFileAsync(sdkManager, ["--list"], { windowsHide: true, timeout: 30_000, maxBuffer: MAX_OUTPUT, encoding: "utf8" })).stdout;
    let installed = true;
    for (const line of output.split(/\r?\n/)) {
      if (/Available Packages/.test(line)) installed = false;
      const id = line.match(/^\s*(system-images;[^|\s]+)\s*\|/)?.[1];
      if (id) systemImages.push({ id, installed });
    }
  }
  if (avdManager) {
    const output = (await execFileAsync(avdManager, ["list", "device", "-c"], { windowsHide: true, timeout: 15_000, maxBuffer: MAX_OUTPUT, encoding: "utf8" })).stdout;
    for (const id of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) devicePresets.push({ id, name: id });
  }
  return { systemImages, devicePresets };
}

export async function installAndroidSystemImage(image: string): Promise<void> {
  if (!/^system-images;android-\d+;(google_apis|google_apis_playstore|default);[a-zA-Z0-9_]+$/.test(image)) throw new Error("Geçersiz Android system image");
  const executable = sdkTool("sdkmanager");
  if (!executable) throw new Error("sdkmanager bulunamadı");
  await execFileAsync(executable, [image], { windowsHide: true, timeout: 20 * 60_000, maxBuffer: MAX_OUTPUT, encoding: "utf8" });
}

export async function createAndroidVirtualDevice(name: string, image: string, devicePreset?: string): Promise<void> {
  requireAvdName(name);
  if (!/^system-images;/.test(image)) throw new Error("Geçersiz Android system image");
  const executable = sdkTool("avdmanager");
  if (!executable) throw new Error("avdmanager bulunamadı");
  const args = ["create", "avd", "--force", "--name", name, "--package", image];
  if (devicePreset && /^[a-zA-Z0-9._ -]+$/.test(devicePreset)) args.push("--device", devicePreset);
  await execFileAsync(executable, args, { windowsHide: true, timeout: 30_000, maxBuffer: MAX_OUTPUT, encoding: "utf8", input: "no\n" } as Parameters<typeof execFileAsync>[2]);
}

export async function deleteAndroidVirtualDevice(name: string): Promise<void> {
  const executable = sdkTool("avdmanager");
  if (!executable) throw new Error("avdmanager bulunamadı");
  await execFileAsync(executable, ["delete", "avd", "--name", requireAvdName(name)], { windowsHide: true, timeout: 15_000, maxBuffer: MAX_OUTPUT, encoding: "utf8" });
}

export async function snapshotAndroidVirtualDevice(deviceId: string, operation: "save" | "load", name: string): Promise<void> {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error("Geçersiz snapshot adı");
  await adb(["-s", requireDeviceId(deviceId), "emu", "avd", "snapshot", operation, name]);
}

export async function setAndroidEmulatorState(deviceId: string, state: { latitude?: number; longitude?: number; network?: "full" | "edge" | "lte" | "none"; battery?: number; locale?: string; timezone?: string; darkMode?: boolean; fontScale?: number }): Promise<void> {
  const serial = requireDeviceId(deviceId);
  if (state.latitude !== undefined && state.longitude !== undefined) await adb(["-s", serial, "emu", "geo", "fix", String(state.longitude), String(state.latitude)]);
  if (state.network) await adb(["-s", serial, "emu", "network", "speed", state.network === "none" ? "gsm" : state.network]);
  if (state.battery !== undefined) await adb(["-s", serial, "emu", "power", "capacity", String(Math.min(100, Math.max(0, Math.round(state.battery))))]);
  const prefix = ["-s", serial, "shell"];
  if (state.darkMode !== undefined) await adb([...prefix, "cmd", "uimode", "night", state.darkMode ? "yes" : "no"]);
  if (state.fontScale !== undefined) await adb([...prefix, "settings", "put", "system", "font_scale", String(Math.min(2, Math.max(0.5, state.fontScale)))]);
  if (state.locale && /^[a-z]{2}(-[A-Z]{2})?$/.test(state.locale)) await adb([...prefix, "cmd", "locale", "set-app-locales", "--user", "0", "android", state.locale]);
  if (state.timezone && /^[A-Za-z_]+\/[A-Za-z_]+$/.test(state.timezone)) await adb([...prefix, "setprop", "persist.sys.timezone", state.timezone]);
}

export async function listAndroidDevices(): Promise<MobileDevice[]> {
  if (!resolveAdbExecutable()) return [];
  const output = String(await adb(["devices", "-l"]));
  const entries = output.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [id = "", state = "unknown", ...parts] = line.split(/\s+/);
    const properties = Object.fromEntries(parts.map((part) => part.split(":", 2)).filter((entry) => entry.length === 2));
    return { id, state, properties };
  });
  return Promise.all(entries.map(async ({ id, state, properties }) => {
    const emulator = id.startsWith("emulator-");
    let status: MobileDevice["status"] = state === "offline" ? "offline" : state === "unauthorized" ? "unauthorized" : state === "disconnected" ? "disconnected" : "unavailable";
    if (state === "device") {
      const bootCompleted = await adb(["-s", id, "shell", "getprop", "sys.boot_completed"]).then((value) => String(value).trim() === "1").catch(() => false);
      status = bootCompleted ? "ready" : "busy";
    }
    let sdkLevel: number | undefined;
    let resolution: { width: number; height: number } | undefined;
    if (status === "ready") {
      sdkLevel = Number(String(await adb(["-s", id, "shell", "getprop", "ro.build.version.sdk"])).trim()) || undefined;
      const size = String(await adb(["-s", id, "shell", "wm", "size"])).match(/Physical size:\s*(\d+)x(\d+)/);
      if (size) resolution = { width: Number(size[1]), height: Number(size[2]) };
    }
    const connection = emulator ? "emulator" as const : id.includes(":") ? "wireless" as const : "usb" as const;
    const message = status === "unauthorized" ? "Cihazdaki USB debugging RSA onayını kabul edin." : status === "offline" ? "ADB bağlantısını yeniden kurun veya cihazı yeniden bağlayın." : status === "busy" ? "Android açılışının tamamlanması bekleniyor." : undefined;
    return {
      id,
      platform: "android" as const,
      name: properties.model?.replace(/_/g, " ") || properties.device?.replace(/_/g, " ") || id,
      kind: emulator ? "emulator" as const : "physical" as const,
      status,
      model: properties.model,
      architecture: properties.product,
      connection,
      message,
      sdkLevel,
      resolution,
    };
  }));
}

function requireDeviceId(deviceId: string): string {
  if (!/^[a-zA-Z0-9._:-]+$/.test(deviceId)) throw new Error("Geçersiz Android cihaz kimliği");
  return deviceId;
}

export async function getAndroidForegroundApp(deviceId: string): Promise<Record<string, string | undefined>> {
  const serial = requireDeviceId(deviceId);
  const output = String(await adb(["-s", serial, "shell", "dumpsys", "window", "windows"]));
  const focus = output.match(/mCurrentFocus=Window\{[^}]*\s([a-zA-Z0-9._]+)\/([^}\s]+)[^}]*\}/)
    || output.match(/mFocusedApp=.*\s([a-zA-Z0-9._]+)\/([^}\s]+)[^}]*/);
  return { packageName: focus?.[1], activity: focus?.[2] };
}

function logLevel(priority: string): MobileRuntimeLog["level"] {
  return priority === "V" ? "verbose" : priority === "D" ? "debug" : priority === "W" ? "warning" : priority === "E" ? "error" : priority === "F" ? "fatal" : "info";
}

export async function getAndroidLogs(deviceId: string, lines = 120, options?: { packageName?: string; pid?: number }): Promise<MobileRuntimeLog[]> {
  const serial = requireDeviceId(deviceId);
  const safeLines = Math.min(500, Math.max(1, Math.round(lines)));
  let pid = options?.pid;
  if (!pid && options?.packageName) {
    pid = Number(String(await adb(["-s", serial, "shell", "pidof", options.packageName])).trim()) || undefined;
  }
  const args = ["-s", serial, "logcat", "-d", "-t", String(safeLines), "-v", "threadtime"];
  if (pid) args.push("--pid", String(pid));
  const output = String(await adb(args));
  return output.split(/\r?\n/).map((line) => line.match(/^(\d\d-\d\d\s+\d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+\d+\s+([VDIWEF])\s+([^:]+):\s?(.*)$/)).filter((match): match is RegExpMatchArray => Boolean(match)).map((match) => ({
    timestamp: match[1],
    pid: Number(match[2]),
    level: logLevel(match[3] || "I"),
    tag: match[4]?.trim(),
    message: match[5] || "",
    event: /FATAL EXCEPTION|AndroidRuntime/.test(match[5] || "") ? "crash" as const : /ANR in |Application Not Responding/.test(match[5] || "") ? "anr" as const : undefined,
  }));
}

function requirePackageName(packageName: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(packageName)) throw new Error("Geçersiz Android package adı");
  return packageName;
}

export async function inspectAndroidSandbox(deviceId: string, packageName: string, relativePath = "."): Promise<{ available: boolean; entries: string[] }> {
  const serial = requireDeviceId(deviceId);
  const appId = requirePackageName(packageName);
  if (relativePath.includes("..") || relativePath.startsWith("/")) throw new Error("Sandbox yolu relative olmalı");
  try {
    const output = String(await adb(["-s", serial, "shell", "run-as", appId, "find", relativePath, "-maxdepth", "2", "-type", "f"]));
    return { available: true, entries: output.split(/\r?\n/).filter(Boolean).slice(0, 1000) };
  } catch { return { available: false, entries: [] }; }
}

export async function readAndroidSandboxFile(deviceId: string, packageName: string, relativePath: string): Promise<string> {
  if (relativePath.includes("..") || relativePath.startsWith("/")) throw new Error("Sandbox yolu relative olmalı");
  return String(await adb(["-s", requireDeviceId(deviceId), "shell", "run-as", requirePackageName(packageName), "cat", relativePath]));
}

export async function queryAndroidDatabase(deviceId: string, packageName: string, database: string, query: string): Promise<string> {
  if (!/^[a-zA-Z0-9._-]+$/.test(database)) throw new Error("Geçersiz veritabanı adı");
  if (!/^\s*(select|pragma)\b/i.test(query) || /;\s*\S/.test(query)) throw new Error("Yalnızca tek read-only SELECT veya PRAGMA sorgusu desteklenir");
  return String(await adb(["-s", requireDeviceId(deviceId), "shell", "run-as", requirePackageName(packageName), "sqlite3", `databases/${database}`, query]));
}

export async function configureAndroidProxy(deviceId: string, proxy: string | undefined, confirmed: boolean): Promise<void> {
  if (!confirmed) throw new Error("Proxy değişikliği açık kullanıcı onayı gerektirir");
  if (proxy && !/^[a-zA-Z0-9.-]+:\d{1,5}$/.test(proxy)) throw new Error("Geçersiz proxy adresi");
  await adb(["-s", requireDeviceId(deviceId), "shell", "settings", "put", "global", "http_proxy", proxy || ":0"]);
}

export async function configureAndroidPort(deviceId: string, direction: "reverse" | "forward", localPort: number, remotePort: number, remove = false): Promise<void> {
  const serial = requireDeviceId(deviceId);
  for (const port of [localPort, remotePort]) if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Geçersiz port");
  await adb(["-s", serial, direction, ...(remove ? ["--remove"] : []), `tcp:${localPort}`, ...(remove ? [] : [`tcp:${remotePort}`])]);
}

export async function triggerAndroidDevelopmentAction(deviceId: string, adapter: string, action: "reload" | "dev-menu" | "hot-reload" | "hot-restart"): Promise<void> {
  const serial = requireDeviceId(deviceId);
  const prefix = ["-s", serial, "shell"];
  if ((adapter === "react-native" || adapter === "expo") && action === "reload") { await adb([...prefix, "input", "text", "rr"]); return; }
  if ((adapter === "react-native" || adapter === "expo") && action === "dev-menu") { await adb([...prefix, "input", "keyevent", "KEYCODE_MENU"]); return; }
  if (adapter === "flutter" && (action === "hot-reload" || action === "hot-restart")) throw new Error("Flutter hot reload aktif flutter run job oturumu üzerinden tetiklenmelidir");
  throw new Error("Bu framework geliştirme aksiyonunu desteklemiyor");
}

export async function manageAndroidApplication(deviceId: string, operation: "uninstall" | "launch" | "terminate" | "restart" | "clear-data" | "clear-cache" | "grant" | "revoke" | "deep-link", packageName: string, value?: string): Promise<void> {
  const serial = requireDeviceId(deviceId);
  const appId = requirePackageName(packageName);
  const prefix = ["-s", serial, "shell"];
  if (operation === "uninstall") { await adb(["-s", serial, "uninstall", appId]); return; }
  if (operation === "launch") { await performAndroidAction(serial, { type: "launch", appId }); return; }
  if (operation === "terminate") { await performAndroidAction(serial, { type: "terminate", appId }); return; }
  if (operation === "restart") { await performAndroidAction(serial, { type: "terminate", appId }); await performAndroidAction(serial, { type: "launch", appId }); return; }
  if (operation === "clear-data") { await adb([...prefix, "pm", "clear", appId]); return; }
  if (operation === "clear-cache") { await adb([...prefix, "pm", "trim-caches", "999G"]); return; }
  if ((operation === "grant" || operation === "revoke") && value && /^[a-zA-Z0-9._]+$/.test(value)) { await adb([...prefix, "pm", operation, appId, value]); return; }
  if (operation === "deep-link" && value && /^(https?|[a-zA-Z][a-zA-Z0-9+.-]*):/.test(value)) { await adb([...prefix, "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", value, appId]); return; }
  throw new Error("Geçersiz veya eksik uygulama operasyon parametresi");
}

export async function installAndroidArtifact(deviceId: string, artifactPath: string): Promise<void> {
  const result = await adb(["-s", requireDeviceId(deviceId), "install", "-r", artifactPath]);
  if (!String(result).includes("Success")) throw new Error(`APK kurulamadı: ${String(result).trim()}`);
}

export async function captureAndroidScreenshot(deviceId: string): Promise<Buffer> {
  const output = await adb(["-s", requireDeviceId(deviceId), "exec-out", "screencap", "-p"], { encoding: "buffer" });
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

function decodeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function attribute(source: string, name: string): string | undefined {
  const match = source.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decodeXml(match[1] || "") : undefined;
}

export async function getAndroidSemanticSnapshot(deviceId: string): Promise<MobileSemanticSnapshot> {
  const serial = requireDeviceId(deviceId);
  await adb(["-s", serial, "shell", "uiautomator", "dump", "/sdcard/quake-window.xml"]);
  const raw = String(await adb(["-s", serial, "shell", "cat", "/sdcard/quake-window.xml"]));
  const seenFingerprints = new Map<string, number>();
  const nodes: MobileElementNode[] = [...raw.matchAll(/<node\s+([^>]+?)\/?\s*>/g)].map((match, index) => {
    const source = match[1] || "";
    const bounds = attribute(source, "bounds")?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    const identity = [attribute(source, "resource-id"), attribute(source, "content-desc"), attribute(source, "text"), attribute(source, "class"), bounds?.slice(1).join(",")].filter(Boolean).join("|");
    const baseFingerprint = createHash("sha256").update(identity || `node:${index}`).digest("hex").slice(0, 12);
    const occurrence = seenFingerprints.get(baseFingerprint) || 0;
    seenFingerprints.set(baseFingerprint, occurrence + 1);
    const fingerprint = `${baseFingerprint}.${occurrence}`;
    return {
      index,
      ref: `m:${fingerprint}`,
      fingerprint,
      text: attribute(source, "text") || undefined,
      resourceId: attribute(source, "resource-id") || undefined,
      className: attribute(source, "class") || undefined,
      packageName: attribute(source, "package") || undefined,
      contentDescription: attribute(source, "content-desc") || undefined,
      clickable: attribute(source, "clickable") === "true",
      enabled: attribute(source, "enabled") !== "false",
      focused: attribute(source, "focused") === "true",
      bounds: bounds ? { left: Number(bounds[1]), top: Number(bounds[2]), right: Number(bounds[3]), bottom: Number(bounds[4]) } : undefined,
    };
  });
  const revision = Date.now();
  const fingerprint = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return { platform: "android", deviceId: serial, snapshotId: `${serial}:${fingerprint}:${randomUUID().slice(0, 8)}`, revision, capturedAt: new Date(revision).toISOString(), nodes, raw };
}

export async function performAndroidAction(deviceId: string, action: MobileAction): Promise<void> {
  const serial = requireDeviceId(deviceId);
  if (action.type === "tap_element") {
    const snapshot = await getAndroidSemanticSnapshot(serial);
    const matches = snapshot.nodes.filter((candidate) =>
      (!action.ref || candidate.ref === action.ref) &&
      (!action.resourceId || candidate.resourceId === action.resourceId) &&
      (!action.text || candidate.text === action.text) &&
      (!action.contentDescription || candidate.contentDescription === action.contentDescription));
    if (matches.length > 1) throw new Error("Mobil hedef belirsiz; güncel snapshot içinden benzersiz ref kullanın");
    const node = matches[0];
    if (!node?.bounds) throw new Error("Hedef mobil element stale, bulunamadı veya koordinatı yok");
    await adb(["-s", serial, "shell", "input", "tap", String(Math.round((node.bounds.left + node.bounds.right) / 2)), String(Math.round((node.bounds.top + node.bounds.bottom) / 2))]);
    return;
  }
  const prefix = ["-s", serial, "shell"];
  if (action.type === "tap") {
    await adb([...prefix, "input", "tap", String(Math.round(action.x)), String(Math.round(action.y))]);
    return;
  }
  if (action.type === "long_press") {
    await adb([...prefix, "input", "swipe", String(Math.round(action.x)), String(Math.round(action.y)), String(Math.round(action.x)), String(Math.round(action.y)), String(action.durationMs || 650)]);
    return;
  }
  if (action.type === "swipe") {
    await adb([...prefix, "input", "swipe", String(Math.round(action.fromX)), String(Math.round(action.fromY)), String(Math.round(action.toX)), String(Math.round(action.toY)), String(action.durationMs || 300)]);
    return;
  }
  if (action.type === "clear_text") {
    await adb([...prefix, "input", "keyevent", "KEYCODE_MOVE_END"]);
    await adb([...prefix, "input", "keyevent", "--longpress", "KEYCODE_SHIFT_LEFT"]);
    await adb([...prefix, "input", "keyevent", "KEYCODE_MOVE_HOME"]);
    await adb([...prefix, "input", "keyevent", "KEYCODE_DEL"]);
    return;
  }
  if (action.type === "type" || action.type === "paste") {
    if (action.type === "type" && action.mode === "replace") await performAndroidAction(serial, { type: "clear_text" });
    const encoded = Buffer.from(action.text, "utf8").toString("base64");
    // Prefer the optional Quake IME companion: it receives UTF-8 as base64 and commits through InputConnection.
    const receivers = String(await adb([...prefix, "cmd", "package", "query-receivers", "-a", "com.mrquake.input.COMMIT_TEXT"])).trim();
    if (receivers.includes("com.mrquake.input")) {
      await adb([...prefix, "am", "broadcast", "-a", "com.mrquake.input.COMMIT_TEXT", "--es", "text_base64", encoded]);
    } else {
      // Clipboard service preserves Unicode on modern Android; KEYCODE_PASTE commits it to the focused editor.
      await adb([...prefix, "cmd", "clipboard", "set", action.text]).catch(async () => {
        const asciiSafe = action.text.replace(/%/g, "%25").replace(/\s/g, "%s").replace(/[^\x20-\x7E]/g, "?");
        await adb([...prefix, "input", "text", asciiSafe]);
      });
      await adb([...prefix, "input", "keyevent", "KEYCODE_PASTE"]).catch(() => undefined);
    }
    if (action.type === "type" && action.submit) await adb([...prefix, "input", "keyevent", "KEYCODE_ENTER"]);
    return;
  }
  if (action.type === "key") {
    const keyCodes = { back: "KEYCODE_BACK", home: "KEYCODE_HOME", "app-switch": "KEYCODE_APP_SWITCH", power: "KEYCODE_POWER", "volume-up": "KEYCODE_VOLUME_UP", "volume-down": "KEYCODE_VOLUME_DOWN", enter: "KEYCODE_ENTER", tab: "KEYCODE_TAB" } as const;
    await adb([...prefix, "input", "keyevent", keyCodes[action.key]]);
    return;
  }
  if (action.type === "rotate") {
    if (action.orientation === "auto") {
      await adb([...prefix, "settings", "put", "system", "accelerometer_rotation", "1"]);
    } else {
      await adb([...prefix, "settings", "put", "system", "accelerometer_rotation", "0"]);
      await adb([...prefix, "settings", "put", "system", "user_rotation", action.orientation === "landscape" ? "1" : "0"]);
    }
    return;
  }
  if (!/^[a-zA-Z0-9._]+$/.test(action.appId)) throw new Error("Geçersiz Android uygulama kimliği");
  if (action.type === "launch") {
    await adb([...prefix, "monkey", "-p", action.appId, "-c", "android.intent.category.LAUNCHER", "1"]);
    return;
  }
  await adb([...prefix, "am", "force-stop", action.appId]);
}

export class AndroidDeviceDriver implements MobileDeviceDriver {
  readonly platform = "android" as const;
  capability = getAndroidCapability;
  devices = listAndroidDevices;
  virtualDevices = listAndroidVirtualDevices;
  foregroundApp = getAndroidForegroundApp;
  screenshot = captureAndroidScreenshot;
  snapshot = getAndroidSemanticSnapshot;
  perform = performAndroidAction;
  stopVirtualDevice = stopAndroidVirtualDevice;
  async startVirtualDevice(name: string, options?: { coldBoot?: boolean; wipeData?: boolean; headless?: boolean }): Promise<void> { await startAndroidVirtualDevice(name, options); }
  async logs(deviceId: string, options?: { lines?: number; packageName?: string; pid?: number }): Promise<MobileRuntimeLog[]> { return getAndroidLogs(deviceId, options?.lines, options); }
  async install(deviceId: string, artifactPath: string, options?: { reinstall?: boolean; downgrade?: boolean }): Promise<void> {
    const flags = ["-s", requireDeviceId(deviceId), "install", ...(options?.reinstall === false ? [] : ["-r"]), ...(options?.downgrade ? ["-d"] : []), artifactPath];
    const result = await adb(flags);
    if (!String(result).includes("Success")) throw new Error(`APK kurulamadı: ${String(result).trim()}`);
  }
}
