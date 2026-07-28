import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

export type MobileTestJob = { id: string; engine: "maestro"; deviceId: string; flow: string; status: "queued" | "running" | "passed" | "failed" | "cancelled"; log: string; createdAt: string; finishedAt?: string };

function executableName(): string { return process.platform === "win32" ? "maestro.bat" : "maestro"; }
export function resolveMaestro(): string | undefined { return [process.env.MAESTRO_PATH, ...(process.env.PATH || "").split(delimiter).map((directory) => join(directory, executableName()))].filter((value): value is string => Boolean(value)).find(existsSync); }
export async function maestroCapability() { const executable = resolveMaestro(); if (!executable) return { available: false, message: "Maestro kurulmalı veya MAESTRO_PATH ayarlanmalı" }; try { return { available: true, executable, version: (await execFileAsync(executable, ["--version"], { timeout: 5000 })).stdout.trim() }; } catch { return { available: false, executable, message: "Maestro çalıştırılamadı" }; } }

export class MobileTestRuntime {
  private jobs = new Map<string, MobileTestJob>();
  create(deviceId: string, flow: string): MobileTestJob {
    if (!existsSync(flow)) throw new Error("Maestro flow dosyası bulunamadı");
    const job: MobileTestJob = { id: randomUUID(), engine: "maestro", deviceId, flow, status: "queued", log: "", createdAt: new Date().toISOString() };
    this.jobs.set(job.id, job); void this.run(job); return job;
  }
  list(): MobileTestJob[] { return [...this.jobs.values()]; }
  get(id: string): MobileTestJob | undefined { return this.jobs.get(id); }
  private async run(job: MobileTestJob): Promise<void> {
    const executable = resolveMaestro(); if (!executable) { job.status = "failed"; job.log = "Maestro bulunamadı"; return; }
    job.status = "running";
    const child = spawn(executable, ["--device", job.deviceId, "test", job.flow, "--format", "junit"], { windowsHide: true });
    child.stdout.on("data", (chunk) => { job.log = `${job.log}${chunk}`.slice(-2_000_000); }); child.stderr.on("data", (chunk) => { job.log = `${job.log}${chunk}`.slice(-2_000_000); });
    child.once("exit", (code) => { job.status = code === 0 ? "passed" : "failed"; job.finishedAt = new Date().toISOString(); });
  }
}
