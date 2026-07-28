const DEFAULT_BRIDGE_PORT = "9223";

export function electronBridgeBase(): string {
	const port = process.env.QUAKE_BROWSER_BRIDGE_PORT?.trim() || DEFAULT_BRIDGE_PORT;
	const host = process.env.QUAKE_CDP_HOST?.trim() || "127.0.0.1";
	return `http://${host}:${port}`;
}

export async function isElectronBridgeAvailable(): Promise<boolean> {
	try {
		const res = await fetch(`${electronBridgeBase()}/health`, {
			signal: AbortSignal.timeout(2000),
		});
		if (!res.ok) return false;
		const data = (await res.json()) as { ok?: boolean; embedded?: boolean };
		return data.ok === true && data.embedded === true;
	} catch {
		return false;
	}
}

async function bridgePost<T>(path: string, body?: Record<string, unknown>): Promise<T> {
	const res = await fetch(`${electronBridgeBase()}${path}`, {
		method: "POST",
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(60_000),
	});
	const data = (await res.json()) as T & { ok?: boolean; error?: string };
	if (!res.ok || data.ok === false) {
		throw new Error(data.error || `bridge ${path} failed (${res.status})`);
	}
	return data;
}

async function bridgeGet<T>(path: string): Promise<T> {
	const res = await fetch(`${electronBridgeBase()}${path}`, {
		signal: AbortSignal.timeout(10_000),
	});
	const data = (await res.json()) as T & { ok?: boolean; error?: string };
	if (!res.ok || data.ok === false) {
		throw new Error(data.error || `bridge ${path} failed (${res.status})`);
	}
	return data;
}

export async function startElectronBridgeSession(): Promise<void> {
	await bridgePost("/agent-browser/session/start");
}

export async function endElectronBridgeSession(): Promise<void> {
	await bridgePost("/agent-browser/session/end").catch(() => {});
}

export type BridgeSnapshot = {
	url: string;
	title: string;
	interactive: Array<Record<string, unknown>>;
	textBlocks: string[];
	headings: string[];
	yaml: string;
	elementCount: number;
};

export type BridgeBoundingBox = { x: number; y: number; width: number; height: number };

export type BridgeConsoleMessage = { type: string; text: string; location?: string };
export type BridgeNetworkRequest = { method: string; url: string; resourceType: string; status?: number };

export const bridgeApi = {
	state: () => bridgeGet<{ url: string; title: string }>("/agent-browser/state"),
	navigate: (url: string) => bridgePost<{ url: string; title: string }>("/agent-browser/navigate", { url }),
	evaluate: (expression: string) => bridgePost<{ result: unknown }>("/agent-browser/evaluate", { expression }),
	snapshot: () => bridgePost<BridgeSnapshot>("/agent-browser/snapshot"),
	screenshot: () =>
		bridgePost<{ data: string; mimeType: string; url: string; title: string }>("/agent-browser/screenshot"),
	click: (target: string) => bridgePost<{ url: string; title: string }>("/agent-browser/click", { target }),
	type: (target: string, text: string) =>
		bridgePost<{ url: string; title: string }>("/agent-browser/type", { target, text }),
	hover: (target: string) => bridgePost<{ url: string; title: string }>("/agent-browser/hover", { target }),
	drag: (from: string, to: string) =>
		bridgePost<{ url: string; title: string }>("/agent-browser/drag", { from, to }),
	selectOption: (target: string, value: string) =>
		bridgePost<{ url: string; title: string }>("/agent-browser/select-option", { target, value }),
	boundingBox: (target: string) =>
		bridgePost<{ box: BridgeBoundingBox | null }>("/agent-browser/bounding-box", { target }),
	console: () => bridgePost<{ messages: BridgeConsoleMessage[] }>("/agent-browser/console"),
	network: () => bridgePost<{ requests: BridgeNetworkRequest[] }>("/agent-browser/network"),
	highlight: (target: string) => bridgePost<{ url: string; title: string }>("/agent-browser/highlight", { target }),
	pressKey: (key: string) => bridgePost<Record<string, never>>("/agent-browser/press-key", { key }),
	goBack: () => bridgePost<{ url: string; title: string }>("/agent-browser/go-back"),
	waitFor: (opts: { selector?: string; text?: string; timeoutMs?: number }) =>
		bridgePost<Record<string, never>>("/agent-browser/wait-for", opts),
	emitCursor: (event: {
		x: number;
		y: number;
		kind: "move" | "click" | "hover" | "type" | "drag" | "scroll" | "idle";
		label?: string;
		toX?: number;
		toY?: number;
		at?: number;
	}) => bridgePost<Record<string, never>>("/agent-browser/emit-cursor", event).catch(() => {}),
};