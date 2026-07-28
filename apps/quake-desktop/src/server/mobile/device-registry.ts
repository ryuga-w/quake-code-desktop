import { EventEmitter } from "node:events";
import type { MobileDeviceDriver } from "./driver.js";
import type { MobileDevice } from "./types.js";

type RegistryDriver = Pick<MobileDeviceDriver, "devices">;

export class AndroidDeviceRegistry extends EventEmitter {
  private devicesById = new Map<string, MobileDevice>();
  private timer?: NodeJS.Timeout;
  private refreshing?: Promise<void>;

  constructor(private readonly driver: RegistryDriver, private readonly intervalMs = 1_500) {
    super();
  }

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  list(): MobileDevice[] {
    return [...this.devicesById.values()];
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshNow().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  private async refreshNow(): Promise<void> {
    const next = await this.driver.devices();
    const nextById = new Map(next.map((device) => [device.id, device]));
    for (const device of next) {
      const previous = this.devicesById.get(device.id);
      if (!previous) this.emit("connected", device);
      else if (previous.status !== device.status) this.emit("changed", device, previous);
    }
    for (const previous of this.devicesById.values()) {
      if (!nextById.has(previous.id)) this.emit("disconnected", { ...previous, status: "disconnected" });
    }
    this.devicesById = nextById;
  }
}
