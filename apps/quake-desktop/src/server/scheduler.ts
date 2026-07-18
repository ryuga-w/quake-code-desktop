import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Lightweight cron-like scheduler.
 *
 * Persists tasks to `.quake-code/scheduled.json` under the workspace cwd and runs
 * a single ~30s setInterval tick that checks each enabled task's cron expression
 * against the current minute and fires it via the injected task runner.
 *
 * The scheduler has NO direct runtime dependency: the integrator wires the actual
 * agent dispatch through `setTaskRunner`.
 */

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  /** ISO timestamp of the next computed run, or null if the cron never matches / task disabled. */
  nextRun: string | null;
  /** ISO timestamp of the last successful (or attempted) run, or null if never run. */
  lastRun: string | null;
  createdAt: string;
}

export interface CreateTaskInput {
  name: string;
  cron: string;
  prompt: string;
  enabled?: boolean;
}

export interface UpdateTaskPatch {
  name?: string;
  cron?: string;
  prompt?: string;
  enabled?: boolean;
}

/** Callback invoked when a task fires. The integrator wires this to the runtime. */
export type TaskRunner = (task: ScheduledTask) => Promise<void>;

const TICK_MS = 30_000;

/** Internal shape persisted on disk. */
interface PersistShape {
  tasks: ScheduledTask[];
}

export class Scheduler {
  private readonly path: string;
  private tasks: ScheduledTask[] = [];
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private runner: TaskRunner | null = null;
  private pendingWrite: Promise<void> = Promise.resolve();
  /** Minute-bucket keys already fired this process lifetime, to avoid double-firing within a tick window. */
  private readonly firedMinutes = new Map<string, string>();
  /** Ids currently executing, to avoid overlapping runs of the same task. */
  private readonly running = new Set<string>();

  constructor(cwd: string) {
    this.path = join(cwd, ".quake-code", "scheduled.json");
  }

  /** Wire the agent dispatch callback. scheduler.ts stays free of runtime imports. */
  setTaskRunner(runner: TaskRunner): void {
    this.runner = runner;
  }

  async list(): Promise<ScheduledTask[]> {
    await this.ensureLoaded();
    // Recompute nextRun lazily so consumers always see a fresh value.
    const now = new Date();
    return this.tasks.map((t) => ({
      ...t,
      nextRun: t.enabled ? isoOrNull(computeNextRun(t.cron, now)) : null,
    }));
  }

  async create(input: CreateTaskInput): Promise<ScheduledTask> {
    await this.ensureLoaded();
    const name = (input.name ?? "").trim();
    const cron = (input.cron ?? "").trim();
    const prompt = (input.prompt ?? "").trim();
    if (!name) throw new SchedulerError("İsim gerekli");
    if (!prompt) throw new SchedulerError("Komut (prompt) gerekli");
    if (!isValidCron(cron)) throw new SchedulerError(`Geçersiz cron ifadesi: "${cron}"`);

    const now = new Date();
    const task: ScheduledTask = {
      id: randomUUID(),
      name,
      cron,
      prompt,
      enabled: input.enabled ?? true,
      nextRun: isoOrNull(computeNextRun(cron, now)),
      lastRun: null,
      createdAt: now.toISOString(),
    };
    this.tasks.push(task);
    await this.persist();
    return { ...task };
  }

  async update(id: string, patch: UpdateTaskPatch): Promise<ScheduledTask> {
    await this.ensureLoaded();
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new SchedulerError("Görev bulunamadı", 404);

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new SchedulerError("İsim boş olamaz");
      task.name = name;
    }
    if (patch.prompt !== undefined) {
      const prompt = patch.prompt.trim();
      if (!prompt) throw new SchedulerError("Komut (prompt) boş olamaz");
      task.prompt = prompt;
    }
    if (patch.cron !== undefined) {
      const cron = patch.cron.trim();
      if (!isValidCron(cron)) throw new SchedulerError(`Geçersiz cron ifadesi: "${cron}"`);
      task.cron = cron;
    }
    if (patch.enabled !== undefined) {
      task.enabled = !!patch.enabled;
    }

    task.nextRun = task.enabled ? isoOrNull(computeNextRun(task.cron, new Date())) : null;
    await this.persist();
    return { ...task };
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.tasks.length === before) throw new SchedulerError("Görev bulunamadı", 404);
    this.firedMinutes.delete(id);
    await this.persist();
  }

  /** Fire a task immediately, regardless of schedule or enabled state. */
  async runNow(id: string): Promise<void> {
    await this.ensureLoaded();
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new SchedulerError("Görev bulunamadı", 404);
    await this.fire(task);
  }

  /** Begin the periodic tick. Idempotent. */
  start(): void {
    if (this.timer) return;
    // Kick an initial load + tick without blocking the caller.
    void this.ensureLoaded().then(() => this.tick());
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    // Don't hold the event loop open solely for the scheduler.
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  /** Stop the periodic tick. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ---- internals -------------------------------------------------------------

  private async tick(): Promise<void> {
    if (!this.runner) return;
    const now = new Date();
    const minuteKey = minuteBucket(now);
    for (const task of this.tasks) {
      if (!task.enabled) continue;
      if (this.running.has(task.id)) continue;
      if (this.firedMinutes.get(task.id) === minuteKey) continue;
      if (!cronMatches(task.cron, now)) continue;
      this.firedMinutes.set(task.id, minuteKey);
      await this.fire(task).catch(() => {});
    }
    // Keep the fired-minute map small: prune stale keys.
    if (this.firedMinutes.size > this.tasks.length * 2 + 16) {
      for (const [id] of this.firedMinutes) {
        if (this.firedMinutes.get(id) !== minuteKey) this.firedMinutes.delete(id);
      }
    }
  }

  private async fire(task: ScheduledTask): Promise<void> {
    if (!this.runner) throw new SchedulerError("Görev çalıştırıcı bağlı değil", 503);
    if (this.running.has(task.id)) return;
    this.running.add(task.id);
    try {
      await this.runner({ ...task });
      task.lastRun = new Date().toISOString();
      task.nextRun = task.enabled ? isoOrNull(computeNextRun(task.cron, new Date())) : null;
      await this.persist();
    } finally {
      this.running.delete(task.id);
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.pendingWrite.catch(() => {});
    if (existsSync(this.path)) {
      try {
        const text = await readFile(this.path, "utf8");
        const parsed = JSON.parse(text) as PersistShape;
        if (parsed && Array.isArray(parsed.tasks)) {
          this.tasks = parsed.tasks.map(normalizeTask).filter((t): t is ScheduledTask => t !== null);
        }
      } catch {
        this.tasks = [];
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const snapshot: PersistShape = { tasks: this.tasks.map((t) => ({ ...t })) };
    const run = async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tempPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await rm(this.path, { force: true });
      await rename(tempPath, this.path);
    };
    const result = this.pendingWrite.then(run, run);
    this.pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }
}

/** Convenience factory mirroring the class constructor. */
export function createScheduler(cwd: string): Scheduler {
  return new Scheduler(cwd);
}

/** Error carrying an HTTP-friendly status for the route layer to map. */
export class SchedulerError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "SchedulerError";
    this.status = status;
  }
}

// ---- task normalization ------------------------------------------------------

function normalizeTask(raw: any): ScheduledTask | null {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : randomUUID();
  const name = typeof raw.name === "string" ? raw.name : "";
  const cron = typeof raw.cron === "string" ? raw.cron : "";
  const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
  if (!cron || !prompt) return null;
  return {
    id,
    name,
    cron,
    prompt,
    enabled: raw.enabled !== false,
    nextRun: typeof raw.nextRun === "string" ? raw.nextRun : null,
    lastRun: typeof raw.lastRun === "string" ? raw.lastRun : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
  };
}

// ---- cron engine -------------------------------------------------------------
//
// 5-field cron: minute hour day-of-month month day-of-week
//   minute       0-59
//   hour         0-23
//   day-of-month 1-31
//   month        1-12
//   day-of-week  0-6 (0 = Sunday; 7 also accepted as Sunday)
//
// Each field supports:  *  |  */n  |  a-b  |  a-b/n  |  comma lists of any of these  |  single value

interface CronField {
  /** Set of allowed integer values within the field's range. */
  values: Set<number>;
  /** True when the original token was just "*" (used for the dom/dow OR rule). */
  wildcard: boolean;
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
}

const FIELD_RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week
];

function parseCron(expr: string): ParsedCron | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const fields: CronField[] = [];
  for (let i = 0; i < 5; i++) {
    const field = parseField(parts[i], FIELD_RANGES[i][0], FIELD_RANGES[i][1], i === 4);
    if (!field) return null;
    fields.push(field);
  }
  return { minute: fields[0], hour: fields[1], dom: fields[2], month: fields[3], dow: fields[4] };
}

function parseField(token: string, min: number, max: number, isDow: boolean): CronField | null {
  const values = new Set<number>();
  let wildcard = false;
  for (const part of token.split(",")) {
    const segment = part.trim();
    if (!segment) return null;

    let rangePart = segment;
    let step = 1;
    const slash = segment.split("/");
    if (slash.length === 2) {
      rangePart = slash[0];
      const parsedStep = Number(slash[1]);
      if (!Number.isInteger(parsedStep) || parsedStep <= 0) return null;
      step = parsedStep;
    } else if (slash.length > 2) {
      return null;
    }

    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
      if (token === "*") wildcard = true;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      lo = Number(a);
      hi = Number(b);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
    } else {
      lo = Number(rangePart);
      hi = lo;
      if (!Number.isInteger(lo)) return null;
    }

    // Day-of-week: normalize 7 -> 0 (Sunday).
    if (isDow) {
      if (lo === 7) lo = 0;
      if (hi === 7) hi = 0;
    }

    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  if (values.size === 0) return null;
  return { values, wildcard };
}

function fieldMatches(field: CronField, value: number): boolean {
  return field.values.has(value);
}

/** True if the given Date (local time, second/ms ignored) satisfies the cron expression. */
export function cronMatches(expr: string, date: Date): boolean {
  const parsed = parseCron(expr);
  if (!parsed) return false;
  return matchesParsed(parsed, date);
}

function matchesParsed(parsed: ParsedCron, date: Date): boolean {
  if (!fieldMatches(parsed.minute, date.getMinutes())) return false;
  if (!fieldMatches(parsed.hour, date.getHours())) return false;
  if (!fieldMatches(parsed.month, date.getMonth() + 1)) return false;

  const domMatch = fieldMatches(parsed.dom, date.getDate());
  const dowMatch = fieldMatches(parsed.dow, date.getDay());

  // Standard cron rule: when both day-of-month and day-of-week are restricted
  // (neither is "*"), a match on EITHER is sufficient. When one is "*", both must match.
  if (parsed.dom.wildcard && parsed.dow.wildcard) return true;
  if (parsed.dom.wildcard) return dowMatch;
  if (parsed.dow.wildcard) return domMatch;
  return domMatch || dowMatch;
}

/** Whether an expression is a syntactically valid 5-field cron. */
export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null;
}

/**
 * Compute the next Date (strictly after `from`) at which the cron matches.
 * Scans minute-by-minute up to ~366 days ahead; returns null if no match found.
 */
export function computeNextRun(expr: string, from: Date = new Date()): Date | null {
  const parsed = parseCron(expr);
  if (!parsed) return null;

  // Start at the next whole minute after `from`.
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const maxMinutes = 366 * 24 * 60; // upper bound: just over a year
  for (let i = 0; i < maxMinutes; i++) {
    if (matchesParsed(parsed, cursor)) return new Date(cursor.getTime());
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

// ---- helpers -----------------------------------------------------------------

function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function minuteBucket(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}T${date.getHours()}:${date.getMinutes()}`;
}
