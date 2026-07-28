export function readStorageJson<T>(key: string, fallback: T): T {
  try {
    const raw = readStorageValue(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    removeStorageValue(key);
    return fallback;
  }
}

export function readStorageValue(key: string, fallback = ""): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStorageValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }
}

export function writeStorageJson(key: string, value: unknown): void {
  writeStorageValue(key, JSON.stringify(value));
}

export function removeStorageValue(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }
}

export function readStorageArray<T = unknown>(key: string): T[] {
  const value = readStorageJson<unknown>(key, []);
  return Array.isArray(value) ? value as T[] : [];
}

export function readStorageRecord<T = unknown>(key: string): Record<string, T> {
  const value = readStorageJson<unknown>(key, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, T> : {};
}
