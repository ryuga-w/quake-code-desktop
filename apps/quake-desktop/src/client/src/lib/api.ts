declare global {
  interface Window {
    __QUAKE_WEB_TOKEN__?: string;
  }
}

export const authToken = window.__QUAKE_WEB_TOKEN__ || "";

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authToken ? { "X-Quake-Web-Token": authToken } : undefined });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(res.status, body));
  return body as T;
}

export async function apiPost<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authToken ? { "X-Quake-Web-Token": authToken } : {}) },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(res.status, body));
  return body as T;
}

export async function apiPatch<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(authToken ? { "X-Quake-Web-Token": authToken } : {}) },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(res.status, body));
  return body as T;
}

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "DELETE",
    headers: authToken ? { "X-Quake-Web-Token": authToken } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(res.status, body));
  return body as T;
}

export function eventsUrl(): string {
  return `/api/events${authToken ? `?token=${encodeURIComponent(authToken)}` : ""}`;
}

function apiErrorMessage(status: number, body: any): string {
  if (typeof body?.error === "string" && body.error.trim()) return body.error;
  if (status === 401 || status === 403) return `İstek reddedildi (${status})`;
  if (status === 404) return `Kaynak bulunamadı (${status})`;
  if (status >= 500) return `Sunucu isteği tamamlayamadı (${status})`;
  return `İstek başarısız oldu (${status})`;
}
