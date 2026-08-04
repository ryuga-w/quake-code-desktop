import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { AndroidDeviceDriver, configureAndroidPort, configureAndroidProxy, createAndroidVirtualDevice, deleteAndroidVirtualDevice, getAndroidAvdCatalog, inspectAndroidSandbox, installAndroidSystemImage, manageAndroidApplication, queryAndroidDatabase, readAndroidSandboxFile, setAndroidEmulatorState, snapshotAndroidVirtualDevice, triggerAndroidDevelopmentAction } from "./android-driver.js";
import { AndroidDeviceRegistry } from "./device-registry.js";
import { MobileArtifactStore, type MobileArtifactKind } from "./artifacts.js";
import { maestroCapability, MobileTestRuntime } from "./test-runtime.js";
import { accessibilityAudit, runtimeQuality, ScreenshotBaselines } from "./quality-lab.js";
import { loadMobileBuildProfiles, readMobileConfig, requireBuildProfile } from "./build-config.js";
import { detectMobileProjects } from "./project-detector.js";
import { TerminalPolicy } from "../terminal-policy.js";
import { WebTerminalService } from "../terminal.js";
import type { MobileAction, MobileBuildJob, MobileBuildResult, MobileHostCapability, MobileStudioStatus } from "./types.js";

function getIosCapability(): MobileHostCapability {
  if (process.platform === "darwin") return {
    platform: "ios",
    available: true,
    mode: "local",
    executable: "xcrun",
    message: "Yerel Xcode/Simulator adaptörü bağlanmaya hazır.",
  };
  return {
    platform: "ios",
    available: false,
    mode: "remote-required",
    message: "iOS için macOS üzerinde Quake Mobile Runner bağlantısı gerekiyor.",
  };
}

export class MobileRuntime {
  private readonly android: AndroidDeviceDriver;
  private readonly androidRegistry: AndroidDeviceRegistry;
  private readonly buildJobs = new Map<string, MobileBuildJob>();
  private readonly snapshots = new Map<string, Awaited<ReturnType<AndroidDeviceDriver["snapshot"]>>>();
  private activeBuildJobs = 0;
  private readonly buildQueue: MobileBuildJob[] = [];
  private readonly maxConcurrentBuilds = Math.max(1, Number(process.env.QUAKE_MOBILE_BUILD_CONCURRENCY || 2));
  private readonly artifacts: MobileArtifactStore;
  private readonly tests = new MobileTestRuntime();
  private readonly baselines: ScreenshotBaselines;

  constructor(
    private workspace: string,
    options: { android?: AndroidDeviceDriver; startRegistry?: boolean } = {},
  ) {
    this.android = options.android ?? new AndroidDeviceDriver();
    this.androidRegistry = new AndroidDeviceRegistry(this.android);
    this.artifacts = new MobileArtifactStore(workspace);
    this.baselines = new ScreenshotBaselines(workspace);
    if (options.startRegistry !== false) this.androidRegistry.start();
  }

  setWorkspace(workspace: string): void {
    this.workspace = workspace;
    this.artifacts.setWorkspace(workspace);
    this.baselines.setWorkspace(workspace);
  }

  auditAccessibility(snapshot: Awaited<ReturnType<AndroidDeviceDriver["snapshot"]>>) { return accessibilityAudit(snapshot); }
  qualityFromLogs(logs: Awaited<ReturnType<AndroidDeviceDriver["logs"]>>) { return runtimeQuality(logs); }
  updateBaseline(name: string, image: Buffer, confirmed: boolean) { return this.baselines.update(name, image, confirmed); }
  compareBaseline(name: string, image: Buffer) { return this.baselines.compare(name, image); }
  removeBaseline(name: string, confirmed: boolean) { return this.baselines.remove(name, confirmed); }

  testCapability() { return maestroCapability(); }
  createTestJob(deviceId: string, flow: string) { return this.tests.create(deviceId, flow); }
  listTestJobs() { return this.tests.list(); }
  getTestJob(id: string) { return this.tests.get(id); }

  saveArtifact(sessionKey: string, kind: MobileArtifactKind, name: string, data: Buffer | string, sensitive?: boolean) { return this.artifacts.save(sessionKey, kind, name, data, sensitive); }
  listArtifacts(sessionKey: string) { return this.artifacts.list(sessionKey); }
  clearArtifacts(sessionKey: string) { this.artifacts.clear(sessionKey); }

  async getStatus(): Promise<MobileStudioStatus> {
    await this.androidRegistry.refresh();
    const [androidCapability, androidVirtualDevices] = await Promise.all([
      this.android.capability(),
      this.android.virtualDevices(),
    ]);
    const devices = this.androidRegistry.list();
    const iosCapability = getIosCapability();
    const androidDevice = devices.find((device) => device.status === "ready");
    const foregroundApps: MobileStudioStatus["foregroundApps"] = {};
    const configDiagnostics = readMobileConfig(this.workspace).diagnostics;
    if (androidDevice) foregroundApps.android = await this.android.foregroundApp(androidDevice.id).catch(() => ({}));
    return {
      version: 1,
      workspace: this.workspace,
      projects: detectMobileProjects(this.workspace),
      buildProfiles: loadMobileBuildProfiles(this.workspace),
      capabilities: [androidCapability, iosCapability],
      devices,
      androidVirtualDevices,
      foregroundApps,
      diagnostics: [
        ...[...this.buildJobs.values()].filter((job) => ["preparing", "building", "installing", "launching"].includes(job.status) && job.startedAt && Date.now() - Date.parse(job.startedAt) > (job.timeoutMs || 15 * 60_000)).map((job) => ({ code: "MOBILE_BUILD_JOB_ORPHAN", level: "warning" as const, message: `Build job yanıt vermiyor: ${job.id}`, action: "Job'u iptal edin veya eski senkron build fallback'ini kullanın." })),
        ...(!androidCapability.available ? [{ code: "ANDROID_ADB_MISSING", level: "error" as const, message: androidCapability.message || "ADB bulunamadı", action: "Android SDK platform-tools kurun ve yeniden kontrol edin." }] : []),
        ...(androidCapability.message && androidCapability.available ? [{ code: "ANDROID_TOOLCHAIN_PARTIAL", level: "warning" as const, message: androidCapability.message, action: "Android SDK Manager üzerinden eksik bileşenleri kurun." }] : []),
        ...devices.filter((device) => device.message).map((device) => ({ code: `ANDROID_DEVICE_${device.status.toUpperCase()}`, level: "warning" as const, message: `${device.name}: ${device.message}` })),
        ...configDiagnostics.map((diagnostic) => ({ code: `MOBILE_CONFIG_${diagnostic.code}`, level: "error" as const, message: `${diagnostic.path ? `${diagnostic.path}: ` : ""}${diagnostic.message}`, action: "mobile.json dosyasını JSON Schema ile doğrulayın." })),
      ],
      buildJobs: [...this.buildJobs.values()].slice(-30),
      targets: [
        {
          platform: "android",
          status: androidDevice ? "ready" : androidCapability.available ? "offline" : "unavailable",
          deviceId: androidDevice?.id,
          message: androidDevice ? undefined : androidCapability.message || "Bağlı Android cihazı veya çalışan emülatör bulunamadı.",
        },
        {
          platform: "ios",
          status: iosCapability.available ? "offline" : "unavailable",
          message: iosCapability.message,
        },
      ],
      refreshedAt: new Date().toISOString(),
    };
  }

  async build(profileId: string, deviceId?: string): Promise<MobileBuildResult> {
    const profile = requireBuildProfile(this.workspace, profileId);
    if (profile.platform === "ios" && process.platform !== "darwin") throw new Error("iOS build için Quake Mobile Runner gerekiyor");
    const terminal = new WebTerminalService(profile.workingDirectory, new TerminalPolicy("safe"));
    const result = await terminal.run(profile.command, { timeoutMs: 120_000 });
    const response: MobileBuildResult = {
      profileId: profile.id,
      platform: profile.platform,
      success: result.exitCode === 0 && !result.timedOut,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      artifact: profile.artifact,
    };
    if (!response.success) return response;
    if (profile.platform === "android" && deviceId && profile.artifact) {
      if (!existsSync(profile.artifact)) throw new Error(`Build tamamlandı fakat artifact bulunamadı: ${profile.artifact}`);
      await this.android.install(deviceId, profile.artifact);
      response.installed = true;
      if (profile.appId) {
        await this.android.perform(deviceId, { type: "launch", appId: profile.appId });
        response.launched = true;
      }
    }
    return response;
  }

  async createBuildJob(profileId: string, deviceId?: string): Promise<MobileBuildJob> {
    const profile = requireBuildProfile(this.workspace, profileId);
    const job: MobileBuildJob = { id: randomUUID(), profileId, platform: profile.platform, deviceId, status: "queued", createdAt: new Date().toISOString(), log: "", timeoutMs: Number(process.env.QUAKE_MOBILE_BUILD_TIMEOUT_MS || 15 * 60_000) };
    this.buildJobs.set(job.id, job);
    this.buildQueue.push(job);
    void this.drainBuildQueue();
    return job;
  }

  getBuildJob(jobId: string): MobileBuildJob | undefined { return this.buildJobs.get(jobId); }
  listBuildJobs(): MobileBuildJob[] { return [...this.buildJobs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)); }

  private async drainBuildQueue(): Promise<void> {
    while (this.activeBuildJobs < this.maxConcurrentBuilds) {
      const job = this.buildQueue.shift();
      if (!job) return;
      if (job.status === "cancelled") continue;
      this.activeBuildJobs++;
      void this.runBuildJob(job).finally(() => { this.activeBuildJobs--; void this.drainBuildQueue(); });
    }
  }

  cancelBuildJob(jobId: string): boolean {
    const job = this.buildJobs.get(jobId);
    if (!job || ["completed", "failed", "cancelled"].includes(job.status)) return false;
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    return true;
  }

  private async runBuildJob(job: MobileBuildJob): Promise<void> {
    job.status = "preparing";
    job.startedAt = new Date().toISOString();
    try {
      job.status = "building";
      job.log += `[${new Date().toISOString()}] Build başlatıldı\n`;
      const result = await this.build(job.profileId, job.deviceId);
      job.log = `${job.log}${result.stdout}${result.stderr}`.slice(-2_000_000);
      if (this.buildJobs.get(job.id)?.status === "cancelled") return;
      job.result = result;
      job.status = result.success ? "completed" : "failed";
      if (!result.success) job.error = result.stderr || result.stdout;
    } catch (reason) {
      if (this.buildJobs.get(job.id)?.status !== "cancelled") {
        job.status = "failed";
        job.error = reason instanceof Error ? reason.message : String(reason);
      }
    } finally {
      job.finishedAt ||= new Date().toISOString();
    }
  }

  async startVirtualDevice(platform: string, name: string, options?: { coldBoot?: boolean; wipeData?: boolean; headless?: boolean }): Promise<void> {
    if (platform !== "android") throw new Error("Bu runtime yalnız Android hedeflerini destekliyor");
    await this.android.startVirtualDevice(name, options);
  }

  avdCatalog() { return getAndroidAvdCatalog(); }
  installSystemImage(image: string) { return installAndroidSystemImage(image); }
  createVirtualDevice(name: string, image: string, devicePreset?: string) { return createAndroidVirtualDevice(name, image, devicePreset); }
  deleteVirtualDevice(name: string) { return deleteAndroidVirtualDevice(name); }
  snapshotVirtualDevice(deviceId: string, operation: "save" | "load", name: string) { return snapshotAndroidVirtualDevice(deviceId, operation, name); }
  setDeviceState(deviceId: string, state: Parameters<typeof setAndroidEmulatorState>[1]) { return setAndroidEmulatorState(deviceId, state); }

  inspectSandbox(deviceId: string, packageName: string, path?: string) { return inspectAndroidSandbox(deviceId, packageName, path); }
  readSandboxFile(deviceId: string, packageName: string, path: string) { return readAndroidSandboxFile(deviceId, packageName, path); }
  queryDatabase(deviceId: string, packageName: string, database: string, query: string) { return queryAndroidDatabase(deviceId, packageName, database, query); }
  configureProxy(deviceId: string, proxy: string | undefined, confirmed: boolean) { return configureAndroidProxy(deviceId, proxy, confirmed); }

  configurePort(deviceId: string, direction: "reverse" | "forward", localPort: number, remotePort: number, remove?: boolean) { return configureAndroidPort(deviceId, direction, localPort, remotePort, remove); }
  developmentAction(deviceId: string, adapter: string, action: "reload" | "dev-menu" | "hot-reload" | "hot-restart") { return triggerAndroidDevelopmentAction(deviceId, adapter, action); }

  async manageApplication(deviceId: string, operation: Parameters<typeof manageAndroidApplication>[1], packageName: string, value?: string): Promise<void> {
    if (!this.androidRegistry.list().some((device) => device.id === deviceId && device.status === "ready")) throw new Error("Seçili Android cihazı hazır veya runtime’a ait değil");
    await manageAndroidApplication(deviceId, operation, packageName, value);
  }

  async installArtifact(deviceId: string, artifact: string, options?: { reinstall?: boolean; downgrade?: boolean }): Promise<void> {
    if (!existsSync(artifact)) throw new Error("APK artifact bulunamadı");
    await this.android.install(deviceId, artifact, options);
  }

  async stopVirtualDevice(platform: string, deviceId: string): Promise<void> {
    if (platform !== "android") throw new Error("iOS Simulator için Quake Mobile Runner gerekiyor");
    await this.android.stopVirtualDevice(deviceId);
  }

  async restartVirtualDevice(platform: string, name: string, deviceId: string): Promise<void> {
    if (platform !== "android") throw new Error("iOS Simulator için Quake Mobile Runner gerekiyor");
    await this.android.stopVirtualDevice(deviceId).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 800));
    await this.android.startVirtualDevice(name, { coldBoot: true });
  }

  async logs(platform: string, deviceId: string, lines?: number, packageName?: string) {
    if (platform !== "android") throw new Error("Bu runtime yalnız Android loglarını destekliyor");
    return this.android.logs(deviceId, { lines, packageName });
  }

  async screenshot(platform: string, deviceId: string): Promise<Buffer> {
    if (platform !== "android") throw new Error("iOS screenshot için Quake Mobile Runner henüz bağlı değil");
    return this.android.screenshot(deviceId);
  }

  async snapshot(platform: string, deviceId: string) {
    if (platform !== "android") throw new Error("Bu runtime yalnız Android element ağacını destekliyor");
    const snapshot = await this.android.snapshot(deviceId);
    this.snapshots.set(snapshot.snapshotId, snapshot);
    if (this.snapshots.size > 50) this.snapshots.delete(this.snapshots.keys().next().value!);
    return snapshot;
  }

  async perform(platform: string, deviceId: string, action: MobileAction): Promise<void> {
    if (platform !== "android") throw new Error("Bu runtime yalnız Android kontrolünü destekliyor");
    const elementAction = action.type === "tap_element" ? action : undefined;
    if (elementAction?.snapshotId) {
      const original = this.snapshots.get(elementAction.snapshotId);
      if (!original || original.deviceId !== deviceId) throw new Error("MOBILE_STALE_SNAPSHOT: Snapshot bulunamadı veya farklı cihaza ait");
      if (elementAction.revision && original.revision !== elementAction.revision) throw new Error("MOBILE_STALE_SNAPSHOT: Snapshot revision değişti");
      const source = original.nodes.find((node) => node.ref === elementAction.ref || node.index === elementAction.nodeIndex);
      if (!source) throw new Error("MOBILE_STALE_ELEMENT: Element snapshot içinde bulunamadı");
      const current = await this.android.snapshot(deviceId);
      const matches = current.nodes.filter((node) => node.fingerprint === source.fingerprint || (source.resourceId && node.resourceId === source.resourceId && node.className === source.className));
      if (matches.length !== 1) throw new Error(matches.length ? "MOBILE_AMBIGUOUS_ELEMENT: Hedef güvenle yeniden eşleştirilemedi" : "MOBILE_STALE_ELEMENT: Hedef artık ekranda değil");
      action = { ...elementAction, ref: matches[0]!.ref, resourceId: matches[0]!.resourceId, text: matches[0]!.text, contentDescription: matches[0]!.contentDescription };
    }
    await this.android.perform(deviceId, action);
  }
}
