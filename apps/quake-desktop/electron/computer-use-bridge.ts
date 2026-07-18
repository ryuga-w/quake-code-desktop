import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { desktopCapturer, screen } from "electron";
import { actuateDesktop, readCursorPosition } from "./actuate-desktop";

export const TARGET_WIDTH = 1280;
export const TARGET_HEIGHT = 800;
const DEFAULT_PORT = 9224;

export type ComputerUseCursorKind = "move" | "click" | "type" | "scroll" | "drag" | "default";

export type ComputerUseCursorEvent = {
	/** Model space (default 1280×800) — panel önizleme */
	x: number;
	y: number;
	/** Fiziksel ekran px (primary display) — full-screen overlay */
	physicalX?: number;
	physicalY?: number;
	kind: ComputerUseCursorKind;
	label?: string;
	at: number;
};

export type ComputerUseBridgeHooks = {
	onCursor?: (cursor: ComputerUseCursorEvent) => void;
	onSessionStart?: () => void;
	onSessionEnd?: () => void;
	onActuate?: () => void;
};

let server: Server | undefined;
let sessionActive = false;
let bridgeHooks: ComputerUseBridgeHooks = {};
let lastCursor: ComputerUseCursorEvent | null = null;

export function setComputerUseBridgeHooks(hooks: ComputerUseBridgeHooks): void {
	bridgeHooks = hooks;
}

/** Tarayıcı oturumu devralınca computer-use'ı zorla kapat. */
export function forceEndComputerUseSession(): void {
	if (!sessionActive && !lastCursor) {
		bridgeHooks.onSessionEnd?.();
		return;
	}
	sessionActive = false;
	lastCursor = null;
	bridgeHooks.onSessionEnd?.();
}

export function getLastComputerUseCursor(): ComputerUseCursorEvent | null {
	return lastCursor;
}

export function isComputerUseSessionActive(): boolean {
	return sessionActive;
}

function mapActionToCursorKind(action: string): ComputerUseCursorKind {
	if (action.includes("click") || action === "double_click") return "click";
	if (action === "type" || action === "key" || action === "open_app") return "type";
	if (action === "scroll") return "scroll";
	if (action === "drag") return "drag";
	if (action === "mouse_move" || action === "focus_window") return "move";
	if (action === "close_window") return "click";
	return "default";
}

function publishCursor(cursor: ComputerUseCursorEvent): void {
	lastCursor = cursor;
	bridgeHooks.onCursor?.(cursor);
}

function cursorFromCoordinate(
	coordinate: [number, number] | undefined,
	kind: ComputerUseCursorKind,
	label?: string,
	physical?: { x: number; y: number },
): ComputerUseCursorEvent | null {
	if (!coordinate && !physical) return null;
	const display = primaryDisplay();
	const modelX = coordinate
		? coordinate[0]
		: physical && display
			? Math.round((physical.x / display.size.width) * TARGET_WIDTH)
			: 0;
	const modelY = coordinate
		? coordinate[1]
		: physical && display
			? Math.round((physical.y / display.size.height) * TARGET_HEIGHT)
			: 0;
	let physicalX = physical?.x;
	let physicalY = physical?.y;
	if ((physicalX == null || physicalY == null) && coordinate && display) {
		physicalX = Math.round((coordinate[0] / TARGET_WIDTH) * display.size.width);
		physicalY = Math.round((coordinate[1] / TARGET_HEIGHT) * display.size.height);
	}
	return {
		x: modelX,
		y: modelY,
		physicalX,
		physicalY,
		kind,
		label,
		at: Date.now(),
	};
}

function updateCursorFromActuate(action: string, detail: Record<string, unknown>): void {
	const coordinate = Array.isArray(detail.coordinate)
		? (detail.coordinate as [number, number])
		: undefined;
	const physicalRaw = detail.physical as { x?: number; y?: number } | undefined;
	const physical =
		physicalRaw && Number.isFinite(physicalRaw.x) && Number.isFinite(physicalRaw.y)
			? { x: Number(physicalRaw.x), y: Number(physicalRaw.y) }
			: undefined;
	const kind = mapActionToCursorKind(action);
	const label =
		action === "type"
			? "yazıyor"
			: action === "key"
				? String(detail.key || "tuş")
				: action === "left_click" || action === "click"
					? "tık"
					: action === "mouse_move"
						? "hareket"
						: action.replace(/_/g, " ");
	const cursor = cursorFromCoordinate(coordinate, kind, label, physical);
	if (cursor) {
		publishCursor(cursor);
		bridgeHooks.onActuate?.();
	} else {
		bridgeHooks.onActuate?.();
	}
}

function primaryDisplay() {
	const displays = screen.getAllDisplays();
	return screen.getPrimaryDisplay() ?? displays[0];
}

/** Resolve target display: body.displayId | body.displayIndex | primary */
function resolveDisplay(body?: Record<string, unknown>) {
	const displays = screen.getAllDisplays();
	const primary = screen.getPrimaryDisplay() ?? displays[0];
	if (!body) return primary;
	if (body.displayId != null) {
		const id = Number(body.displayId);
		const found = displays.find((d) => d.id === id);
		if (found) return found;
	}
	if (body.displayIndex != null) {
		const idx = Number(body.displayIndex);
		if (Number.isFinite(idx) && idx >= 0 && idx < displays.length) return displays[idx];
	}
	return primary;
}

function listDisplaysMeta() {
	const primary = screen.getPrimaryDisplay();
	return screen.getAllDisplays().map((d, index) => ({
		index,
		id: d.id,
		primary: primary?.id === d.id,
		bounds: d.bounds,
		size: d.size,
		scaleFactor: d.scaleFactor,
		label: `Display ${index}${primary?.id === d.id ? " (primary)" : ""} ${d.size.width}×${d.size.height}`,
	}));
}

/** Attach model-space (1280×800) coords to UIA elements for agent clicks. */
function enrichUiaDetail(
	detail: Record<string, unknown>,
	dispW: number,
	dispH: number,
): Record<string, unknown> {
	const mapCenter = (el: Record<string, unknown>) => {
		const center = el.center as { x?: number; y?: number } | undefined;
		if (!center || center.x == null || center.y == null) return el;
		return {
			...el,
			modelCenter: {
				x: Math.round((Number(center.x) / Math.max(dispW, 1)) * TARGET_WIDTH),
				y: Math.round((Number(center.y) / Math.max(dispH, 1)) * TARGET_HEIGHT),
			},
		};
	};
	const elements = detail.elements;
	if (Array.isArray(elements)) {
		return {
			...detail,
			elements: elements.map((e) => mapCenter((e ?? {}) as Record<string, unknown>)),
			display: { width: dispW, height: dispH, modelWidth: TARGET_WIDTH, modelHeight: TARGET_HEIGHT },
		};
	}
	if (detail.element && typeof detail.element === "object") {
		return {
			...detail,
			element: mapCenter(detail.element as Record<string, unknown>),
			display: { width: dispW, height: dispH, modelWidth: TARGET_WIDTH, modelHeight: TARGET_HEIGHT },
		};
	}
	return detail;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk) => {
			body += chunk;
			if (body.length > 2_000_000) {
				reject(new Error("Request body too large"));
				req.destroy();
			}
		});
		req.on("end", () => {
			try {
				resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}

function sendJson(res: ServerResponse, status: number, data: Record<string, unknown>) {
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
		"Access-Control-Allow-Headers": "content-type",
	});
	res.end(JSON.stringify(data));
}

async function captureScreenshot() {
	const display = primaryDisplay();
	if (!display) throw new Error("No primary display");

	const physicalWidth = Math.round(display.size.width * display.scaleFactor);
	const physicalHeight = Math.round(display.size.height * display.scaleFactor);
	const sources = await desktopCapturer.getSources({
		types: ["screen"],
		thumbnailSize: { width: physicalWidth, height: physicalHeight },
	});
	const source =
		sources.find((item) => item.display_id === String(display.id)) ??
		sources.find((item) => /screen|display|entire/i.test(item.name)) ??
		sources[0];
	if (!source) throw new Error("No screen capture source available");

	const resized = source.thumbnail.resize({ width: TARGET_WIDTH, height: TARGET_HEIGHT });
	const png = resized.toPNG();

	return {
		data: png.toString("base64"),
		mimeType: "image/png",
		width: TARGET_WIDTH,
		height: TARGET_HEIGHT,
		displayId: `screen:${display.id}`,
		displayName: source.name,
		scaleFactor: display.scaleFactor,
		physicalWidth: display.size.width,
		physicalHeight: display.size.height,
	};
}

async function listWindows() {
	const sources = await desktopCapturer.getSources({
		types: ["window"],
		thumbnailSize: { width: 1, height: 1 },
		fetchWindowIcons: false,
	});
	return sources
		.filter((source) => source.name && source.name !== "Quake Code")
		.map((source) => ({
			id: source.id,
			name: source.name,
			displayId: source.display_id,
		}));
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
	const url = req.url || "/";
	try {
		if (req.method === "OPTIONS") {
			sendJson(res, 200, { ok: true });
			return;
		}
		if (req.method === "GET" && url === "/health") {
			sendJson(res, 200, {
				ok: true,
				embedded: true,
				targetWidth: TARGET_WIDTH,
				targetHeight: TARGET_HEIGHT,
				sessionActive,
				lastCursor,
				displays: listDisplaysMeta(),
			});
			return;
		}
		if (req.method === "GET" && url === "/computer-use/displays") {
			sendJson(res, 200, { ok: true, displays: listDisplaysMeta() });
			return;
		}
		if (req.method === "POST" && url === "/computer-use/session/start") {
			sessionActive = true;
			bridgeHooks.onSessionStart?.();
			const display = primaryDisplay();
			const cx = Math.round(TARGET_WIDTH / 2);
			const cy = Math.round(TARGET_HEIGHT / 2);
			publishCursor({
				x: cx,
				y: cy,
				physicalX: display ? Math.round(display.size.width / 2) : cx,
				physicalY: display ? Math.round(display.size.height / 2) : cy,
				kind: "default",
				label: "ajan",
				at: Date.now(),
			});
			sendJson(res, 200, { ok: true });
			return;
		}
		if (req.method === "POST" && url === "/computer-use/session/end") {
			sessionActive = false;
			lastCursor = null;
			bridgeHooks.onSessionEnd?.();
			sendJson(res, 200, { ok: true });
			return;
		}
		if (req.method === "POST" && url === "/computer-use/screenshot") {
			const shot = await captureScreenshot();
			sendJson(res, 200, { ok: true, ...shot });
			return;
		}
		if (req.method === "POST" && url === "/computer-use/cursor-position") {
			const display = primaryDisplay();
			const pos = await readCursorPosition({
				width: display.size.width,
				height: display.size.height,
			});
			// pos is typically model-scaled from readCursorPosition — keep + physical
			const physicalX = Math.round((Number(pos.x) / TARGET_WIDTH) * display.size.width);
			const physicalY = Math.round((Number(pos.y) / TARGET_HEIGHT) * display.size.height);
			publishCursor({
				x: Number(pos.x),
				y: Number(pos.y),
				physicalX,
				physicalY,
				kind: "move",
				at: Date.now(),
			});
			sendJson(res, 200, { ok: true, ...pos });
			return;
		}
		if (req.method === "POST" && url === "/computer-use/list-windows") {
			// Prefer native Win32 titles (handles + bounds); fall back to capturer.
			const display = primaryDisplay();
			try {
				const native = await actuateDesktop(
					"list_windows_native",
					{},
					{ width: display.size.width, height: display.size.height },
				);
				const windows = Array.isArray(native.windows) ? native.windows : [];
				sendJson(res, 200, { ok: true, windows, source: "native" });
				return;
			} catch {
				const windows = await listWindows();
				sendJson(res, 200, { ok: true, windows, source: "capturer" });
				return;
			}
		}
		if (req.method === "POST" && url === "/computer-use/open-app") {
			const body = await readJsonBody(req);
			const display = resolveDisplay(body);
			const detail = await actuateDesktop("open_app", body, {
				width: display.size.width,
				height: display.size.height,
			});
			updateCursorFromActuate("open_app", detail);
			sendJson(res, 200, { ok: true, detail });
			return;
		}
		if (req.method === "POST" && url === "/computer-use/focus-window") {
			const body = await readJsonBody(req);
			const display = resolveDisplay(body);
			const detail = await actuateDesktop("focus_window", body, {
				width: display.size.width,
				height: display.size.height,
			});
			updateCursorFromActuate("focus_window", detail);
			sendJson(res, 200, { ok: true, detail });
			return;
		}
		if (req.method === "POST" && url === "/computer-use/close-window") {
			const body = await readJsonBody(req);
			const display = resolveDisplay(body);
			const detail = await actuateDesktop("close_window", body, {
				width: display.size.width,
				height: display.size.height,
			});
			updateCursorFromActuate("close_window", detail);
			sendJson(res, 200, { ok: true, detail });
			return;
		}
		if (req.method === "POST" && url === "/computer-use/list-apps") {
			const display = primaryDisplay();
			const detail = await actuateDesktop(
				"list_apps",
				{},
				{ width: display.size.width, height: display.size.height },
			);
			sendJson(res, 200, { ok: true, detail });
			return;
		}
		if (req.method === "POST" && url === "/computer-use/dialog/set-path") {
			const body = await readJsonBody(req);
			const display = resolveDisplay(body);
			const detail = await actuateDesktop("dialog_set_path", body, {
				width: display.size.width,
				height: display.size.height,
			});
			bridgeHooks.onActuate?.();
			sendJson(res, 200, { ok: true, detail });
			return;
		}
		if (req.method === "POST" && url === "/computer-use/detect-uac") {
			const display = primaryDisplay();
			const detail = await actuateDesktop(
				"detect_uac",
				{},
				{ width: display.size.width, height: display.size.height },
			);
			sendJson(res, 200, { ok: true, detail });
			return;
		}
		if (req.method === "POST" && url === "/computer-use/actuate") {
			const body = await readJsonBody(req);
			const action = String(body.action || "");
			const display = resolveDisplay(body);
			// Scale model coords against selected display; pass bounds origin for multi-monitor
			const detail = await actuateDesktop(
				action,
				{
					...body,
					displayBounds: display.bounds,
				},
				{
					width: display.size.width,
					height: display.size.height,
					x: display.bounds.x,
					y: display.bounds.y,
				} as { width: number; height: number },
			);
			updateCursorFromActuate(action, detail);
			sendJson(res, 200, { ok: true, detail, displayId: display.id });
			return;
		}
		// --- UI Automation ---
		if (req.method === "POST" && url === "/computer-use/uia/snapshot") {
			const body = await readJsonBody(req);
			const display = resolveDisplay(body);
			const detail = await actuateDesktop("uia_snapshot", body, {
				width: display.size.width,
				height: display.size.height,
			});
			const enriched = enrichUiaDetail(detail, display.size.width, display.size.height);
			sendJson(res, 200, { ok: true, detail: enriched });
			return;
		}
		if (req.method === "POST" && url === "/computer-use/uia/find") {
			const body = await readJsonBody(req);
			const display = resolveDisplay(body);
			const detail = await actuateDesktop("uia_find", body, {
				width: display.size.width,
				height: display.size.height,
			});
			const enriched = enrichUiaDetail(detail, display.size.width, display.size.height);
			sendJson(res, 200, { ok: true, detail: enriched });
			return;
		}
		if (req.method === "POST" && url === "/computer-use/uia/invoke") {
			const body = await readJsonBody(req);
			const display = resolveDisplay(body);
			const detail = await actuateDesktop("uia_invoke", body, {
				width: display.size.width,
				height: display.size.height,
			});
			const enriched = enrichUiaDetail(detail, display.size.width, display.size.height);
			bridgeHooks.onActuate?.();
			sendJson(res, 200, { ok: true, detail: enriched });
			return;
		}
		if (req.method === "POST" && url === "/computer-use/uia/set-value") {
			const body = await readJsonBody(req);
			const display = resolveDisplay(body);
			const detail = await actuateDesktop("uia_set_value", body, {
				width: display.size.width,
				height: display.size.height,
			});
			const enriched = enrichUiaDetail(detail, display.size.width, display.size.height);
			bridgeHooks.onActuate?.();
			sendJson(res, 200, { ok: true, detail: enriched });
			return;
		}
		sendJson(res, 404, { ok: false, error: "not_found" });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		sendJson(res, 500, { ok: false, error: message });
	}
}

export function startComputerUseBridge(port = Number(process.env.QUAKE_COMPUTER_USE_BRIDGE_PORT || DEFAULT_PORT)): Promise<void> {
	if (server) return Promise.resolve();
	const host = process.env.QUAKE_CDP_HOST?.trim() || "127.0.0.1";
	return new Promise((resolve, reject) => {
		server = createServer((req, res) => {
			void handleRequest(req, res);
		});
		server.on("error", reject);
		server.listen(port, host, () => {
			console.log(`[computer-use-bridge] listening on http://${host}:${port}`);
			resolve();
		});
	});
}

export function stopComputerUseBridge(): Promise<void> {
	if (!server) return Promise.resolve();
	return new Promise((resolve) => {
		server!.close(() => {
			server = undefined;
			sessionActive = false;
			lastCursor = null;
			bridgeHooks.onSessionEnd?.();
			resolve();
		});
	});
}