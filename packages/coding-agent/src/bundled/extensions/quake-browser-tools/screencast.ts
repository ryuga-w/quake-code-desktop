/// <reference lib="dom" />
/**
 * Live browser screencast broadcaster.
 *
 * Streams the agent's Playwright/Chromium page frames over a lightweight
 * WebSocket server so a UI (e.g. grok-premium BrowserPanel) can render exactly
 * what the agent sees while it drives the browser — Cursor / Codex Desktop style.
 *
 * Design goals:
 * - Fully isolated from the model/RPC/SSE stream (frames never reach the LLM).
 * - High frequency safe (CDP Page.startScreencast, JPEG, ~10-15 fps).
 * - Zero impact when no client is connected (screencast paused until a viewer).
 */
import type { CDPSession, Page } from "playwright";
import { WebSocketServer, type WebSocket } from "ws";

const DEFAULT_PORT = Number(process.env.QUAKE_BROWSER_STREAM_PORT || 5192);

export type ScreencastActivity = {
	type: "navigate" | "click" | "type" | "snapshot" | "info";
	text: string;
	url?: string;
	at: number;
};

/**
 * The agent's virtual cursor position over the live page, in CSS pixels
 * relative to the page viewport. Used to render a visible agent cursor.
 */
export type ScreencastCursor = {
	/** What the agent is doing at this position. */
	kind: "move" | "click" | "hover" | "type" | "drag";
	x: number;
	y: number;
	/** Optional end point for drag gestures. */
	toX?: number;
	toY?: number;
	/** Short label (e.g. element ref or text) for a tooltip near the cursor. */
	label?: string;
	at: number;
};

/**
 * Input commands sent from a viewer (panel) back to the agent's live page.
 * Coordinates are already normalized to the real page viewport (CSS pixels).
 */
export type ScreencastInput =
	| { kind: "mousemove"; x: number; y: number; buttons?: number }
	| { kind: "mousedown"; x: number; y: number; button?: "left" | "right" | "middle" }
	| { kind: "mouseup"; x: number; y: number; button?: "left" | "right" | "middle" }
	| { kind: "click"; x: number; y: number; button?: "left" | "right" | "middle"; clickCount?: number }
	| { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
	| { kind: "key"; key: string; code?: string; text?: string }
	| { kind: "text"; text: string };

export type ScreencastInputHandler = (input: ScreencastInput) => void | Promise<void>;

type OutboundMessage =
	| {
			type: "frame";
			data: string;
			tabId: string;
			url?: string;
			at: number;
			deviceWidth?: number;
			deviceHeight?: number;
	  }
	| { type: "navigated"; url: string; title?: string; tabId: string; at: number }
	| { type: "activity"; activity: ScreencastActivity }
	| { type: "cursor"; cursor: ScreencastCursor }
	| { type: "tabs"; activeTabId?: string; tabIds: string[] }
	| { type: "hello"; port: number };

/**
 * Singleton WebSocket broadcaster. One per extension process.
 */
class ScreencastHub {
	private wss?: WebSocketServer;
	private clients = new Set<WebSocket>();
	private port = DEFAULT_PORT;
	private lastFrameByTab = new Map<string, OutboundMessage>();
	private lastCursor?: OutboundMessage;
	private starting = false;
	private inputHandler?: ScreencastInputHandler;

	/** Register the handler that applies viewer input to the live page. */
	setInputHandler(handler: ScreencastInputHandler): void {
		this.inputHandler = handler;
	}

	get hasClients(): boolean {
		return this.clients.size > 0;
	}

	getPort(): number {
		return this.port;
	}

	/** Lazily start the WS server. Safe to call repeatedly. */
	ensureServer(): void {
		if (this.wss || this.starting) return;
		this.starting = true;
		try {
			this.wss = new WebSocketServer({ port: this.port, host: "127.0.0.1" });
			this.wss.on("connection", (socket: WebSocket) => {
				this.clients.add(socket);
				this.send(socket, { type: "hello", port: this.port });
				// Replay last known frame for each tab so a late viewer sees content immediately.
				for (const frame of this.lastFrameByTab.values()) {
					this.send(socket, frame);
				}
				// Replay last cursor so a late viewer sees where the agent is.
				if (this.lastCursor) this.send(socket, this.lastCursor);
				socket.on("message", (raw: unknown) => {
					if (!this.inputHandler) return;
					try {
						const msg = JSON.parse(String(raw)) as { type?: string; input?: ScreencastInput };
						if (msg.type === "input" && msg.input) {
							void this.inputHandler(msg.input);
						}
					} catch {
						/* ignore malformed input */
					}
				});
				socket.on("close", () => this.clients.delete(socket));
				socket.on("error", () => this.clients.delete(socket));
			});
			this.wss.on("error", (err: Error) => {
				// Port busy or similar — degrade gracefully, screencast just won't be available.
				console.error("[browser-screencast] WS server error:", err.message);
				this.wss = undefined;
			});
			console.error(`[browser-screencast] live stream ws://127.0.0.1:${this.port}`);
		} catch (err) {
			console.error("[browser-screencast] failed to start WS server:", (err as Error).message);
			this.wss = undefined;
		} finally {
			this.starting = false;
		}
	}

	private send(socket: WebSocket, message: OutboundMessage): void {
		if (socket.readyState !== socket.OPEN) return;
		try {
			socket.send(JSON.stringify(message));
		} catch {
			/* drop */
		}
	}

	broadcast(message: OutboundMessage): void {
		if (message.type === "frame") {
			this.lastFrameByTab.set(message.tabId, message);
		} else if (message.type === "cursor") {
			this.lastCursor = message;
		}
		for (const socket of this.clients) {
			this.send(socket, message);
		}
	}

	emitFrame(tabId: string, data: string, url?: string, deviceWidth?: number, deviceHeight?: number): void {
		this.broadcast({ type: "frame", data, tabId, url, at: Date.now(), deviceWidth, deviceHeight });
	}

	emitNavigated(tabId: string, url: string, title?: string): void {
		this.broadcast({ type: "navigated", url, title, tabId, at: Date.now() });
	}

	emitActivity(activity: ScreencastActivity): void {
		this.broadcast({ type: "activity", activity });
	}

	emitCursor(cursor: ScreencastCursor): void {
		this.broadcast({ type: "cursor", cursor });
	}

	emitTabs(activeTabId: string | undefined, tabIds: string[]): void {
		this.broadcast({ type: "tabs", activeTabId, tabIds });
	}

	clearTab(tabId: string): void {
		this.lastFrameByTab.delete(tabId);
	}
}

let hub: ScreencastHub | null = null;

export function getScreencastHub(): ScreencastHub {
	if (!hub) hub = new ScreencastHub();
	hub.ensureServer();
	return hub;
}

export type ScreencastAttachment = {
	/** The CDP session bound to this page (reusable for input dispatch). */
	cdp: CDPSession;
	/** Stop screencast and detach. */
	detach: () => Promise<void>;
};

/**
 * Attaches a CDP screencast to a Playwright page and pipes frames into the hub.
 * Returns the CDP session (for input dispatch) and a detach function.
 */
export async function attachScreencast(page: Page, tabId: string): Promise<ScreencastAttachment | null> {
	const activeHub = getScreencastHub();
	let session: CDPSession | undefined;
	let stopped = false;

	try {
		session = await page.context().newCDPSession(page);
	} catch (err) {
		console.error("[browser-screencast] newCDPSession failed:", (err as Error).message);
		return null;
	}

	const cdp = session;

	// CDP screencast metadata often reports deviceWidth/Height as 0. The agent's
	// boundingBox coordinates live in the page's layout viewport, so we use the
	// real viewport size as the authoritative coordinate space for the cursor.
	const fallbackViewport = page.viewportSize();

	cdp.on(
		"Page.screencastFrame",
		async (event: {
			data: string;
			sessionId: number;
			metadata?: { deviceWidth?: number; deviceHeight?: number };
		}) => {
			try {
				const metaW = event.metadata?.deviceWidth;
				const metaH = event.metadata?.deviceHeight;
				activeHub.emitFrame(
					tabId,
					event.data,
					page.url(),
					metaW && metaW > 0 ? metaW : fallbackViewport?.width,
					metaH && metaH > 0 ? metaH : fallbackViewport?.height,
				);
			} finally {
				// Always ACK so CDP keeps sending frames.
				try {
					await cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId });
				} catch {
					/* page closed */
				}
			}
		},
	);

	try {
		await cdp.send("Page.startScreencast", {
			format: "jpeg",
			quality: 60,
			maxWidth: 1280,
			maxHeight: 800,
			everyNthFrame: 1,
		});
	} catch (err) {
		console.error("[browser-screencast] startScreencast failed:", (err as Error).message);
	}

	return {
		cdp,
		detach: async () => {
			if (stopped) return;
			stopped = true;
			activeHub.clearTab(tabId);
			try {
				await cdp.send("Page.stopScreencast");
			} catch {
				/* ignore */
			}
			try {
				await cdp.detach();
			} catch {
				/* ignore */
			}
		},
	};
}

/**
 * Apply a viewer input command to a page via its CDP session.
 * Coordinates must already be in CSS pixels relative to the page viewport.
 */
export async function dispatchInputToCdp(cdp: CDPSession, input: ScreencastInput): Promise<void> {
	switch (input.kind) {
		case "mousemove":
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: input.x,
				y: input.y,
				buttons: input.buttons ?? 0,
			});
			break;
		case "mousedown":
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mousePressed",
				x: input.x,
				y: input.y,
				button: input.button ?? "left",
				buttons: 1,
				clickCount: 1,
			});
			break;
		case "mouseup":
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mouseReleased",
				x: input.x,
				y: input.y,
				button: input.button ?? "left",
				buttons: 0,
				clickCount: 1,
			});
			break;
		case "click": {
			const button = input.button ?? "left";
			const clickCount = input.clickCount ?? 1;
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mousePressed",
				x: input.x,
				y: input.y,
				button,
				buttons: 1,
				clickCount,
			});
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mouseReleased",
				x: input.x,
				y: input.y,
				button,
				buttons: 0,
				clickCount,
			});
			break;
		}
		case "wheel":
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: input.x,
				y: input.y,
				deltaX: input.deltaX,
				deltaY: input.deltaY,
			});
			break;
		case "text":
			await cdp.send("Input.insertText", { text: input.text });
			break;
		case "key": {
			const base = { key: input.key, code: input.code, text: input.text };
			await cdp.send("Input.dispatchKeyEvent", { type: input.text ? "keyDown" : "rawKeyDown", ...base });
			await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
			break;
		}
	}
}
