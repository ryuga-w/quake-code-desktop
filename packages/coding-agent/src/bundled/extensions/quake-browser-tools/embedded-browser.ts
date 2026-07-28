import type { Page } from "playwright";

export const EMBEDDED_UA_MARKER = "QuakeEmbeddedBrowser/1";

export function isEmbeddedModeRequired(): boolean {
	const v = process.env.QUAKE_BROWSER_EMBEDDED?.trim().toLowerCase();
	return v === "1" || v === "true" || v === "yes";
}

export function shellUrlPattern(): RegExp {
	const ports = new Set(["5173", "3737"]);
	const webPort = process.env.QUAKE_WEB_PORT?.trim();
	if (webPort) ports.add(webPort);
	const portGroup = [...ports].join("|");
	return new RegExp(`(?:127\\.0\\.0\\.1|localhost):(?:${portGroup})(?:/|$)`);
}

export function isShellUrl(url: string): boolean {
	if (!url) return false;
	if (url.startsWith("chrome-extension://") || url.startsWith("devtools://")) return true;
	if (url.startsWith("data:")) return true; // computer-use overlay vb.
	return shellUrlPattern().test(url);
}

export function isEmbeddedByUserAgent(userAgent: string): boolean {
	return userAgent.includes(EMBEDDED_UA_MARKER);
}

/** Sync check when UA is already known. */
export function isEmbeddedBrowserCandidate(url: string, userAgent: string): boolean {
	if (isEmbeddedByUserAgent(userAgent)) return true;
	// UA yoksa: shell/overlay olmayan gerçek sayfa = embedded WebContentsView adayı
	if (!url || isShellUrl(url)) return false;
	if (url === "about:blank") return false;
	return true;
}

export async function readPageUserAgent(page: Page): Promise<string> {
	return page.evaluate(() => navigator.userAgent).catch(() => "");
}

export async function isEmbeddedBrowserPage(page: Page): Promise<boolean> {
	const url = page.url();
	const ua = await readPageUserAgent(page);
	return isEmbeddedBrowserCandidate(url, ua);
}

export async function findEmbeddedBrowserPage(pages: Page[]): Promise<Page | undefined> {
	// 1) UA marker (en güvenilir)
	for (const page of pages) {
		const ua = await readPageUserAgent(page);
		if (isEmbeddedByUserAgent(ua)) return page;
	}
	// 2) Shell/overlay olmayan gerçek URL'ler
	for (const page of pages) {
		const url = page.url();
		if (url && !isShellUrl(url) && url !== "about:blank") return page;
	}
	return undefined;
}

export const EMBEDDED_BROWSER_MISSING_ERROR =
	"Uygulama içi tarayıcı bulunamadı. Electron uygulamasının açık olduğundan ve sağ paneldeki Tarayıcı sekmesinin kullanılabilir olduğundan emin olun.";

export const EMBEDDED_CDP_UNAVAILABLE_ERROR =
	"Uygulama içi tarayıcıya bağlanılamadı. Electron uygulamasının açık olduğundan ve güncel sürümle yeniden başlatıldığından emin olun.";

const DEFAULT_CDP_HTTP = "http://127.0.0.1:9222";
const DEFAULT_BRIDGE_PORT = "9223";

export function electronCdpHttpBase(): string {
	const port = process.env.QUAKE_CDP_PORT?.trim() || "9222";
	const host = process.env.QUAKE_CDP_HOST?.trim() || "127.0.0.1";
	return `http://${host}:${port}`;
}

/** Electron main'deki in-process debugger + DevTools'u Playwright CDP icin serbest birak. */
export async function prepareElectronCdpForPlaywright(): Promise<void> {
	const port = process.env.QUAKE_BROWSER_BRIDGE_PORT?.trim() || DEFAULT_BRIDGE_PORT;
	const host = process.env.QUAKE_CDP_HOST?.trim() || "127.0.0.1";
	try {
		await fetch(`http://${host}:${port}/cdp/prepare-playwright`, {
			method: "POST",
			signal: AbortSignal.timeout(4000),
		});
	} catch {
		/* Bridge yoksa (web modu) devam et */
	}
}

export type CdpPageTarget = {
	id: string;
	type: string;
	url: string;
	title?: string;
	webSocketDebuggerUrl: string;
};

export async function fetchCdpPageTargets(base = electronCdpHttpBase()): Promise<CdpPageTarget[]> {
	try {
		const res = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(3000) });
		if (!res.ok) return [];
		const list = (await res.json()) as CdpPageTarget[];
		return list.filter((t) => t.type === "page");
	} catch {
		return [];
	}
}