export class MobileApiError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function requireAndroid(platform: unknown): "android" { if (platform !== "android") throw new MobileApiError("MOBILE_PLATFORM_UNSUPPORTED", "Yalnız Android destekleniyor"); return "android"; }
export function requireDeviceId(value: unknown): string { const id = String(value || ""); if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(id)) throw new MobileApiError("MOBILE_INVALID_DEVICE", "Geçersiz deviceId"); return id; }
export function requirePackage(value: unknown): string { const name = String(value || ""); if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(name)) throw new MobileApiError("MOBILE_INVALID_PACKAGE", "Geçersiz Android package adı"); return name; }
export function requireBooleanConfirmation(value: unknown): true { if (value !== true) throw new MobileApiError("MOBILE_CONFIRMATION_REQUIRED", "Bu işlem açık onay gerektirir", 409); return true; }

export class MobileRateLimiter {
  private entries = new Map<string, number[]>();
  check(key: string, limit = 20, windowMs = 60_000): void {
    const now = Date.now(); const current = (this.entries.get(key) || []).filter((time) => now - time < windowMs);
    if (current.length >= limit) throw new MobileApiError("MOBILE_RATE_LIMITED", "Çok fazla mobil operasyon isteği", 429);
    current.push(now); this.entries.set(key, current);
  }
}
