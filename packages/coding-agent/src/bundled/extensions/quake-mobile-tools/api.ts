const DEFAULT_BASE = "http://127.0.0.1:3737";

function apiBase(): string {
	return (process.env.QUAKE_MOBILE_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
}

function headers(json = false): Record<string, string> {
	const token = process.env.QUAKE_MOBILE_API_TOKEN || process.env.QUAKE_WEB_TOKEN || "";
	return {
		...(json ? { "Content-Type": "application/json" } : {}),
		...(token ? { "X-Quake-Web-Token": token } : {}),
	};
}

async function responseError(response: Response): Promise<Error> {
	const body = await response.json().catch(() => ({})) as { error?: string };
	return new Error(body.error || `Quake Mobile API isteği başarısız (${response.status})`);
}

export async function mobileGet<T>(path: string, signal?: AbortSignal): Promise<T> {
	const response = await fetch(`${apiBase()}${path}`, { headers: headers(), signal });
	if (!response.ok) throw await responseError(response);
	return await response.json() as T;
}

export async function mobilePost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
	const response = await fetch(`${apiBase()}${path}`, {
		method: "POST",
		headers: headers(true),
		body: JSON.stringify(body),
		signal,
	});
	if (!response.ok) throw await responseError(response);
	return await response.json() as T;
}

export async function mobileScreenshot(platform: string, deviceId: string, signal?: AbortSignal): Promise<Buffer> {
	const params = new URLSearchParams({ platform, deviceId });
	const response = await fetch(`${apiBase()}/api/mobile/screenshot?${params}`, { headers: headers(), signal });
	if (!response.ok) throw await responseError(response);
	return Buffer.from(await response.arrayBuffer());
}
