import type { AndroidVirtualDevice, MobileAction, MobileDevice, MobileHostCapability, MobileRuntimeLog, MobileSemanticSnapshot } from "./types.js";

export interface MobileDeviceDriver {
  readonly platform: "android";
  capability(): Promise<MobileHostCapability>;
  devices(): Promise<MobileDevice[]>;
  virtualDevices(): Promise<AndroidVirtualDevice[]>;
  startVirtualDevice(name: string, options?: { coldBoot?: boolean; wipeData?: boolean; headless?: boolean }): Promise<void>;
  stopVirtualDevice(deviceId: string): Promise<void>;
  logs(deviceId: string, options?: { lines?: number; packageName?: string; pid?: number; minimumLevel?: string }): Promise<MobileRuntimeLog[]>;
  screenshot(deviceId: string): Promise<Buffer>;
  snapshot(deviceId: string): Promise<MobileSemanticSnapshot>;
  perform(deviceId: string, action: MobileAction): Promise<void>;
  foregroundApp(deviceId: string): Promise<Record<string, string | undefined>>;
  install(deviceId: string, artifactPath: string, options?: { reinstall?: boolean; downgrade?: boolean }): Promise<void>;
}

export interface MobileProjectAdapter {
  readonly id: string;
  detect(root: string): boolean;
}

export interface MobileBuildAdapter {
  readonly id: string;
  readonly framework: string;
}
