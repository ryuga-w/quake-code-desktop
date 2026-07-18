export type ModelRef = {
  provider?: string;
  id?: string;
  name?: string;
  current?: boolean;
  configured?: boolean;
};

const OPENCODE_FREE_LABELS: Record<string, string> = {
  "deepseek-v4-flash-free": "Quake Free · DeepSeek V4 Flash",
  "mimo-v2.5-free": "Quake Free · MiMo V2.5",
  "north-mini-code-free": "Quake Free · North Mini Code",
  "nemotron-3-ultra-free": "Quake Free · Nemotron 3 Ultra",
  "big-pickle": "Quake Free · Big Pickle",
  "hy3-free": "Quake Free · HY3",
};

export function modelValue(model: ModelRef): string {
  return `${model.provider}/${model.id}`;
}

/**
 * Human-readable model label for settings / composer UI.
 * Accepts either a "provider/id" string or provider+id parts.
 */
export function formatModelDisplayLabel(value: string, displayName?: string): string {
  if (displayName && displayName.trim()) return displayName.trim();
  const [provider, ...rest] = value.split("/");
  const id = rest.join("/") || provider || value;
  if (!id) return "";
  if (provider === "opencode-free") {
    return OPENCODE_FREE_LABELS[id] || `Quake Free · ${id}`;
  }
  return id
    .replace(/^gpt-/i, "GPT-")
    .replace(/-codex/i, " Codex")
    .replace(/(^|[-_])([a-z])/g, (_match, separator, letter) => `${separator === "_" ? " " : separator}${String(letter).toUpperCase()}`);
}

/** Prefer API `name` (e.g. "Quake Free · …"), else format provider/id. */
export function formatModelRefLabel(model: ModelRef): string {
  const value = modelValue(model);
  return formatModelDisplayLabel(value, model.name);
}

/** Registry can return duplicate provider/id rows; keep one stable entry per key. */
export function dedupeModels<T extends ModelRef>(models: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const model of models) {
    const key = modelValue(model);
    if (!key || key === "undefined/undefined") continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, model);
      continue;
    }
    if (model.current && !existing.current) {
      byKey.set(key, model);
      continue;
    }
    if (!existing.configured && model.configured) {
      byKey.set(key, model);
    }
  }
  return Array.from(byKey.values());
}

export function configuredModels<T extends ModelRef>(models: T[]): T[] {
  return dedupeModels(models.filter((model) => model.configured));
}