import type { DesktopScreenshotResult } from "./types.js";

const DEFAULT_BRIDGE_PORT = "9224";

export function computerUseBridgeBase(): string {
	const port = process.env.QUAKE_COMPUTER_USE_BRIDGE_PORT?.trim() || DEFAULT_BRIDGE_PORT;
	const host = process.env.QUAKE_CDP_HOST?.trim() || "127.0.0.1";
	return `http://${host}:${port}`;
}

export async function isComputerUseBridgeAvailable(): Promise<boolean> {
	try {
		const res = await fetch(`${computerUseBridgeBase()}/health`, {
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
	const res = await fetch(`${computerUseBridgeBase()}${path}`, {
		method: "POST",
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(60_000),
	});
	const data = (await res.json()) as T & { ok?: boolean; error?: string };
	if (!res.ok || data.ok === false) {
		throw new Error(data.error || `computer-use bridge ${path} failed (${res.status})`);
	}
	return data;
}

export function isComputerUseEmbeddedRequired(): boolean {
	const v = process.env.QUAKE_BROWSER_EMBEDDED?.trim().toLowerCase();
	return v === "1" || v === "true" || v === "yes";
}

export const COMPUTER_USE_BRIDGE_UNAVAILABLE_ERROR =
	"Masaüstü computer-use köprüsüne bağlanılamadı. Quake Desktop'un açık olduğundan ve güncel sürümle yeniden başlatıldığından emin olun.";

let activeSessionId: string | undefined;
let idleEndTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Son desktop_* aracından / turdan sonra bu kadar sessizlik olursa session biter (kenar fade kapanır).
 * Model düşünürken (turn arası) 4s çok kısaydı — fade ajan hâlâ çalışırken kapanıyordu.
 * agent_end / desktop_task_done hâlâ anında kapatır.
 */
const COMPUTER_USE_IDLE_END_MS = 90_000;

export function getActiveComputerUseSessionId(): string | undefined {
	return activeSessionId;
}

function clearIdleEndTimer() {
	if (idleEndTimer) {
		clearTimeout(idleEndTimer);
		idleEndTimer = undefined;
	}
}

/** Soft close: overlay/session stays until idle elapses (renewed on each tool). */
export function scheduleComputerUseIdleEnd(ms: number = COMPUTER_USE_IDLE_END_MS) {
	clearIdleEndTimer();
	idleEndTimer = setTimeout(() => {
		void endComputerUseBridgeSession();
	}, ms);
}

export async function startComputerUseBridgeSession(): Promise<void> {
	await bridgePost("/computer-use/session/start");
	// Don't start the kill-clock until first real tool finishes renewing via ensure
	// Keep a long grace so fade does not blink off between model thoughts
	scheduleComputerUseIdleEnd(COMPUTER_USE_IDLE_END_MS);
}

export async function endComputerUseBridgeSession(): Promise<void> {
	clearIdleEndTimer();
	await bridgePost("/computer-use/session/end").catch(() => {});
	activeSessionId = undefined;
}

export async function ensureComputerUseBridgeSession(sessionId: string): Promise<void> {
	if (!activeSessionId) {
		await startComputerUseBridgeSession();
		activeSessionId = sessionId;
	} else {
		// Her araç kullanımı idle zamanlayıcıyı yeniler — model düşünürken fade kalsın
		scheduleComputerUseIdleEnd();
	}
}

export async function captureDesktopScreenshot(): Promise<DesktopScreenshotResult> {
	const data = await bridgePost<DesktopScreenshotResult & { ok: boolean }>("/computer-use/screenshot");
	return {
		data: data.data,
		mimeType: data.mimeType,
		width: data.width,
		height: data.height,
		displayId: data.displayId,
		displayName: data.displayName,
		scaleFactor: data.scaleFactor,
		physicalWidth: data.physicalWidth,
		physicalHeight: data.physicalHeight,
	};
}

export async function readDesktopCursorPosition(): Promise<{ x: number; y: number }> {
	const data = await bridgePost<{ x: number; y: number; ok: boolean }>("/computer-use/cursor-position");
	return { x: data.x, y: data.y };
}

export type DesktopWindowInfo = {
	id?: string;
	handle?: string;
	name?: string;
	title?: string;
	displayId?: string;
	left?: number;
	top?: number;
	right?: number;
	bottom?: number;
	pid?: number;
};

export async function listDesktopWindows(): Promise<DesktopWindowInfo[]> {
	const data = await bridgePost<{ ok: boolean; windows?: DesktopWindowInfo[] }>("/computer-use/list-windows");
	return (data.windows ?? []).map((w) => ({
		...w,
		// Normalize native + capturer shapes for the agent
		id: w.handle || w.id,
		name: w.title || w.name,
		title: w.title || w.name,
		handle: w.handle || w.id,
	}));
}

export async function openDesktopApp(
	app: string,
	args?: string,
): Promise<Record<string, unknown>> {
	const data = await bridgePost<{ ok: boolean; detail?: Record<string, unknown> }>(
		"/computer-use/open-app",
		{ app, args },
	);
	return data.detail ?? {};
}

export async function focusDesktopWindow(params: {
	title?: string;
	handle?: string;
}): Promise<Record<string, unknown>> {
	const data = await bridgePost<{ ok: boolean; detail?: Record<string, unknown> }>(
		"/computer-use/focus-window",
		params,
	);
	return data.detail ?? {};
}

export async function closeDesktopWindow(params: {
	title?: string;
	handle?: string;
}): Promise<Record<string, unknown>> {
	const data = await bridgePost<{ ok: boolean; detail?: Record<string, unknown> }>(
		"/computer-use/close-window",
		params,
	);
	return data.detail ?? {};
}

export async function uiaSnapshot(params: {
	title?: string;
	handle?: string;
	max?: number;
} = {}): Promise<Record<string, unknown>> {
	const data = await bridgePost<{ ok: boolean; detail?: Record<string, unknown> }>(
		"/computer-use/uia/snapshot",
		params,
	);
	return data.detail ?? {};
}

export async function uiaFind(params: {
	title?: string;
	handle?: string;
	name?: string;
	role?: string;
	automationId?: string;
	contains?: boolean;
	max?: number;
}): Promise<Record<string, unknown>> {
	const data = await bridgePost<{ ok: boolean; detail?: Record<string, unknown> }>(
		"/computer-use/uia/find",
		params,
	);
	return data.detail ?? {};
}

export async function uiaInvoke(params: {
	title?: string;
	handle?: string;
	name?: string;
	role?: string;
	automationId?: string;
	contains?: boolean;
	index?: number;
}): Promise<Record<string, unknown>> {
	const data = await bridgePost<{ ok: boolean; detail?: Record<string, unknown> }>(
		"/computer-use/uia/invoke",
		params,
	);
	return data.detail ?? {};
}

export async function uiaSetValue(params: {
	title?: string;
	handle?: string;
	name?: string;
	role?: string;
	automationId?: string;
	text: string;
	contains?: boolean;
}): Promise<Record<string, unknown>> {
	const data = await bridgePost<{ ok: boolean; detail?: Record<string, unknown> }>(
		"/computer-use/uia/set-value",
		params,
	);
	return data.detail ?? {};
}

export async function listDesktopApps(): Promise<Record<string, unknown>> {
	const data = await bridgePost<{ ok: boolean; detail?: Record<string, unknown> }>(
		"/computer-use/list-apps",
		{},
	);
	return data.detail ?? {};
}

export async function dialogSetPath(params: {
	path: string;
	confirm?: boolean;
	title?: string;
}): Promise<Record<string, unknown>> {
	const data = await bridgePost<{ ok: boolean; detail?: Record<string, unknown> }>(
		"/computer-use/dialog/set-path",
		params,
	);
	return data.detail ?? {};
}

export async function detectUac(): Promise<Record<string, unknown>> {
	const data = await bridgePost<{ ok: boolean; detail?: Record<string, unknown> }>(
		"/computer-use/detect-uac",
		{},
	);
	return data.detail ?? {};
}

export async function listDisplays(): Promise<
	Array<{
		index: number;
		id: number;
		primary?: boolean;
		label?: string;
		size?: { width: number; height: number };
	}>
> {
	const res = await fetch(`${computerUseBridgeBase()}/computer-use/displays`, {
		signal: AbortSignal.timeout(10_000),
	});
	const data = (await res.json()) as {
		ok?: boolean;
		displays?: Array<{
			index: number;
			id: number;
			primary?: boolean;
			label?: string;
			size?: { width: number; height: number };
		}>;
		error?: string;
	};
	if (!res.ok || data.ok === false) throw new Error(data.error || "list displays failed");
	return data.displays ?? [];
}

/**
 * Actuate a desktop action via the Electron bridge.
 * Passes harness params (including coordinate) through to the bridge.
 * Returns detail with coordinate/physical preserved for trajectory + cursor overlay.
 */
export async function actuateDesktopAction(
	action: string,
	params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
	// Spread harness params so coordinate / start_coordinate / text / etc. reach the bridge.
	const data = await bridgePost<{ ok: boolean; detail?: Record<string, unknown> }>("/computer-use/actuate", {
		action,
		...params,
	});
	const detail: Record<string, unknown> = { ...(data.detail ?? {}) };

	// Keep physical coords from bridge when present (full-screen cursor overlay).
	// If the bridge omitted model-space coordinate but the request had one, fill it in
	// so trajectory / tool details can still show the cursor position.
	if (detail.coordinate == null && params.coordinate != null) {
		detail.coordinate = params.coordinate;
	}
	if (detail.start_coordinate == null && params.start_coordinate != null) {
		detail.start_coordinate = params.start_coordinate;
	}

	return detail;
}