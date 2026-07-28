/// <reference lib="dom" />
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	AgentToolResult,
	ExtensionAPI,
	Theme,
	ToolDefinition,
	ToolRenderResultOptions,
} from "@mrquake/quakecode-cli";
import { Text } from "@mrquake/quakecode-tui";
import type { Static, TSchema } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { type BrowserContext, type ConsoleMessage, chromium, type Dialog, type Page, type Request } from "playwright";
import { BridgePage } from "./bridge-page.js";
import {
	bridgeApi,
	endElectronBridgeSession,
	isElectronBridgeAvailable,
	startElectronBridgeSession,
} from "./electron-bridge.js";
import {
	electronCdpHttpBase,
	EMBEDDED_BROWSER_MISSING_ERROR,
	EMBEDDED_CDP_UNAVAILABLE_ERROR,
	findEmbeddedBrowserPage,
	isEmbeddedBrowserPage,
	isEmbeddedModeRequired,
	prepareElectronCdpForPlaywright,
} from "./embedded-browser.js";
import { attachScreencast, dispatchInputToCdp, getScreencastHub } from "./screencast.js";
import type { CDPSession } from "playwright";

type ManagedPage = Page | BridgePage;

interface TabState {
	id: string;
	page: ManagedPage;
	console: Array<{ type: string; text: string; location?: string }>;
	requests: Array<{ method: string; url: string; resourceType: string; status?: number }>;
	dialog?: { type: string; message: string; defaultValue?: string };
	pendingDialog?: Dialog;
	/** Detach the live CDP screencast for this tab. */
	detachScreencast?: () => Promise<void>;
	/** CDP session for this tab (used for live input dispatch). */
	cdp?: CDPSession;
}

export function isSearchResultsUrl(url: string): boolean {
	return /google\.[^/]+\/search\?|bing\.com\/search\?|duckduckgo\.com\/\?|search\.yahoo\.com\/search/.test(url);
}

class BrowserManager {
	private context?: BrowserContext;
	private tabs = new Map<string, TabState>();
	private activeTabId?: string;
	private counter = 1;
	private previousRefs = new Set<string>();
	private isCDP = false;
	private useBridge = false;
	/** Last virtual mouse position (page viewport CSS px). Starts at viewport center. */
	private lastMouse = { x: 720, y: 480 };

	private async ensureContext(): Promise<BrowserContext> {
		if (this.useBridge) {
			return null as unknown as BrowserContext;
		}
		if (this.context) return this.context;

		// Embedded masaüstü: bridge önce (en stabil). 3 deneme — Electron yeni açıldıysa.
		if (isEmbeddedModeRequired()) {
			for (let attempt = 0; attempt < 3; attempt++) {
				await this.tryAttachElectronBridge();
				if (this.useBridge) {
					return null as unknown as BrowserContext;
				}
				await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
			}
		} else {
			await this.tryAttachElectronBridge();
			if (this.useBridge) {
				return null as unknown as BrowserContext;
			}
		}

		// CDP yalnızca gerçek embedded sayfa bulunursa başarılı sayılır
		const attached = await this.tryAttachElectronCDP();
		if (attached) return attached;

		if (isEmbeddedModeRequired()) {
			throw new Error(EMBEDDED_CDP_UNAVAILABLE_ERROR);
		}

		// Fallback: launch standalone persistent context (Edge on Windows)
		const userDataDir = join(homedir(), ".quake-code", "playwright-profile");
		this.context = await chromium.launchPersistentContext(userDataDir, {
			headless: false,
			channel: process.platform === "win32" ? "msedge" : undefined,
			viewport: { width: 1440, height: 960 },
			locale: "tr-TR",
			args: ["--disable-blink-features=AutomationControlled", "--disable-infobars"],
		});
		if (this.context.pages().length > 0) {
			const first = this.context.pages()[0]!;
			const id = `tab-${this.counter++}`;
			const tab: TabState = { id, page: first, console: [], requests: [] };
			this.tabs.set(id, tab);
			this.activeTabId = id;
			this.wireTab(tab);
		}
		return this.context;
	}

	/** Prefer the in-process Electron HTTP bridge (9223) — Playwright CDP is unreliable on Electron. */
	private async tryAttachElectronBridge(): Promise<BrowserContext | undefined> {
		if (!(await isElectronBridgeAvailable())) return undefined;
		try {
			await startElectronBridgeSession();
			this.useBridge = true;
			this.isCDP = true;
			// Computer-use paneli açık kaldıysa tarayıcı oturumu devralır
			void fetch(
				`http://${process.env.QUAKE_CDP_HOST?.trim() || "127.0.0.1"}:${process.env.QUAKE_COMPUTER_USE_BRIDGE_PORT?.trim() || "9224"}/computer-use/session/end`,
				{ method: "POST", signal: AbortSignal.timeout(2000) },
			).catch(() => {});
			const page = new BridgePage();
			await page.refreshState();
			const id = `tab-${this.counter++}`;
			const tab: TabState = { id, page, console: [], requests: [] };
			this.tabs.set(id, tab);
			this.activeTabId = id;
			return undefined;
		} catch (error) {
			this.useBridge = false;
			this.isCDP = false;
			console.warn(
				"[quake-browser-tools] Electron bridge attach failed:",
				error instanceof Error ? error.message : error,
			);
			return undefined;
		}
	}

	/**
	 * Attempt to connect to the Electron desktop app via Chrome DevTools Protocol.
	 * Only succeeds when an embedded (non-shell) page is found — otherwise undefined.
	 */
	private async tryAttachElectronCDP(): Promise<BrowserContext | undefined> {
		await prepareElectronCdpForPlaywright();
		const cdpBase = electronCdpHttpBase();
		try {
			const browser = await chromium.connectOverCDP(cdpBase, {
				timeout: 15_000,
			});
			const contexts = browser.contexts();
			if (contexts.length === 0) {
				await browser.close().catch(() => {});
				return undefined;
			}

			const context = contexts[0]!;
			const embedded = await findEmbeddedBrowserPage(context.pages());
			if (!embedded) {
				// Shell-only attach = fail (aksi halde getOrCreateTab "tarayıcı yok" der)
				await browser.close().catch(() => {});
				this.isCDP = false;
				return undefined;
			}

			this.context = context;
			this.isCDP = true;
			const id = `tab-${this.counter++}`;
			const tab: TabState = { id, page: embedded, console: [], requests: [] };
			this.tabs.set(id, tab);
			this.activeTabId = id;
			this.wireTab(tab);

			return this.context;
		} catch (error) {
			this.isCDP = false;
			this.context = undefined;
			console.warn(
				"[quake-browser-tools] Electron CDP attach failed:",
				error instanceof Error ? error.message : error,
			);
			return undefined;
		}
	}

	private wireTab(tab: TabState) {
		tab.page.on("console", (msg: ConsoleMessage) => {
			tab.console.push({
				type: msg.type(),
				text: msg.text(),
				location: (() => {
					const loc = msg.location();
					return loc?.url ? `${loc.url}:${loc.lineNumber ?? 0}` : undefined;
				})(),
			});
			tab.console = tab.console.slice(-200);
		});

		tab.page.on("request", (req: Request) => {
			tab.requests.push({ method: req.method(), url: req.url(), resourceType: req.resourceType() });
			tab.requests = tab.requests.slice(-300);
		});

		tab.page.on("response", async (res) => {
			for (let i = tab.requests.length - 1; i >= 0; i--) {
				const req = tab.requests[i]!;
				if (req.url === res.url() && req.status === undefined) {
					req.status = res.status();
					break;
				}
			}
		});

		tab.page.on("dialog", (dialog: Dialog) => {
			tab.pendingDialog = dialog;
			tab.dialog = {
				type: dialog.type(),
				message: dialog.message(),
				defaultValue: dialog.defaultValue(),
			};
		});

		// Live screencast: stream this tab's frames to any connected viewer.
		// Skip screencast for CDP-connected Electron pages to prevent guest webview CDP crashes.
		// Agent cursor in embedded mode flows via Electron IPC (browser-bridge emit), not WS 5192.
		if (this.isCDP) {
			// Broadcast in-page navigations (link clicks, redirects) to the live viewer.
			tab.page.on("framenavigated", (frame) => {
				if (frame !== tab.page.mainFrame()) return;
				const url = frame.url();
				if (!url || url === "about:blank") return;
				getScreencastHub().emitNavigated(tab.id, url);
			});
			return;
		}

		void attachScreencast(tab.page, tab.id)
			.then((attachment) => {
				if (!attachment) return;
				tab.detachScreencast = attachment.detach;
				tab.cdp = attachment.cdp;
				this.ensureInputHandler();
			})
			.catch(() => {
				/* screencast unavailable — non-fatal */
			});

		// Broadcast in-page navigations (link clicks, redirects) to the live viewer.
		tab.page.on("framenavigated", (frame) => {
			if (frame !== tab.page.mainFrame()) return;
			const url = frame.url();
			if (!url || url === "about:blank") return;
			getScreencastHub().emitNavigated(tab.id, url);
		});
	}

	async getOrCreateTab(tabId?: string): Promise<TabState> {
		if (tabId && this.tabs.has(tabId)) {
			this.activeTabId = tabId;
			return this.tabs.get(tabId)!;
		}
		if (!tabId && this.activeTabId && this.tabs.has(this.activeTabId)) {
			return this.tabs.get(this.activeTabId)!;
		}
		if (this.useBridge) {
			if (this.tabs.size > 0) {
				const first = this.tabs.values().next().value as TabState;
				this.activeTabId = first.id;
				return first;
			}
			await this.tryAttachElectronBridge();
			const created = this.tabs.values().next().value as TabState | undefined;
			if (created) {
				this.activeTabId = created.id;
				return created;
			}
			throw new Error(EMBEDDED_BROWSER_MISSING_ERROR);
		}

		const context = await this.ensureContext();

		if (this.isCDP) {
			const webviewPage = await findEmbeddedBrowserPage(context.pages());

			if (webviewPage) {
				const existing = Array.from(this.tabs.values()).find((t) => t.page === webviewPage);
				if (existing) {
					this.activeTabId = existing.id;
					return existing;
				}
				const id = `tab-${this.counter++}`;
				const tab: TabState = { id, page: webviewPage, console: [], requests: [] };
				this.tabs.set(id, tab);
				this.activeTabId = id;
				this.wireTab(tab);
				return tab;
			}

			throw new Error(EMBEDDED_BROWSER_MISSING_ERROR);
		}

		const page = await context.newPage();
		const id = `tab-${this.counter++}`;
		const tab: TabState = { id, page, console: [], requests: [] };
		this.tabs.set(id, tab);
		this.activeTabId = id;
		this.wireTab(tab);
		return tab;
	}

	async navigate(url: string, tabId?: string) {
		if (isSearchResultsUrl(url)) {
			throw new Error(
				"Use web_search for general web searching. Only use browser tools after you know which page needs direct interaction.",
			);
		}
		const tab = await this.getOrCreateTab(tabId);
		getScreencastHub().emitActivity({ type: "navigate", text: url, url, at: Date.now() });
		await tab.page.goto(url, { waitUntil: "domcontentloaded" });
		this.activeTabId = tab.id;
		getScreencastHub().emitNavigated(tab.id, tab.page.url(), await tab.page.title().catch(() => undefined));
		this.emitTabsState();
		return this.describeTab(tab);
	}

	private emitTabsState(): void {
		getScreencastHub().emitTabs(this.activeTabId, Array.from(this.tabs.keys()));
	}

	private inputHandlerBound = false;

	/** Wire viewer input (from the live panel) to the active tab's CDP session. */
	private ensureInputHandler(): void {
		if (this.inputHandlerBound) return;
		this.inputHandlerBound = true;
		getScreencastHub().setInputHandler(async (input) => {
			const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
			if (!tab?.cdp) return;
			try {
				await dispatchInputToCdp(tab.cdp, input);
			} catch {
				/* page may have navigated/closed */
			}
		});
	}

	async snapshot(tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		const page = tab.page;
		const title = await page.title();
		const url = page.url();

		// Primary: accessibility tree (ARIA snapshot) with element references
		const yaml = this.useBridge
			? await (page as BridgePage).ariaSnapshot()
			: await (page as Page).ariaSnapshot({ mode: "ai" });
		const elementCount = (yaml.match(/\[ref=/g) || []).length;

		// Change detection: mark new elements with * since last snapshot
		const currentRefs = new Set<string>();
		const processedLines: string[] = [];

		for (const line of yaml.split("\n")) {
			const refMatch = line.match(/\[ref=(e\d+)\]/);
			if (refMatch) {
				currentRefs.add(refMatch[1]);
				if (!this.previousRefs.has(refMatch[1])) {
					// New element — prefix with *
					processedLines.push(`* ${line}`);
					continue;
				}
			}
			processedLines.push(line);
		}

		// Update previousRefs (keep last 1000 refs to prevent unbounded growth)
		this.previousRefs = new Set([...this.previousRefs, ...currentRefs].slice(-1000));

		const hasChanges = processedLines.some((l) => l.startsWith("* "));

		// Fallback: legacy DOM query elements for backward compat (tool detail, annotation picker)
		const pageData = await page.evaluate(() => {
			const selector = "a,button,input,textarea,select,[role='button'],[role='link']";
			const interactive = Array.from(document.querySelectorAll(selector))
				.slice(0, 80)
				.map((el, i) => {
					const html = el as HTMLElement;
					const rect = html.getBoundingClientRect();
					const text = (
						html.innerText ||
						html.getAttribute("aria-label") ||
						html.getAttribute("placeholder") ||
						html.getAttribute("name") ||
						html.id ||
						html.tagName
					).trim();
					return {
						index: i + 1,
						tag: html.tagName.toLowerCase(),
						text: text.slice(0, 120),
						id: html.id || undefined,
						name: html.getAttribute("name") || undefined,
						type: html.getAttribute("type") || undefined,
						placeholder: html.getAttribute("placeholder") || undefined,
						href: html.getAttribute("href") || undefined,
						visible: rect.width > 0 && rect.height > 0,
					};
				});
			const textBlocks = Array.from(document.querySelectorAll("main,article,section,p,li"))
				.map((el) => (el.textContent || "").trim())
				.filter(Boolean)
				.slice(0, 20);
			return { interactive, textBlocks };
		});
		const headings = await page
			.locator("h1,h2,h3")
			.allTextContents()
			.catch(() => []);
		const summary = pageData.textBlocks.slice(0, 6).join(" | ").slice(0, 500);

		const text = [
			...(hasChanges ? ["* = new element since last snapshot"] : []),
			`Page snapshot`,
			`Title: ${title || "(untitled)"}`,
			`URL: ${url}`,
			headings.length ? `Headings: ${headings.slice(0, 8).join(" | ")}` : undefined,
			summary ? `Visible summary: ${summary}` : undefined,
			`Accessibility tree (${elementCount} interactive elements with refs):`,
			"",
			processedLines.join("\n"),
			"",
			"Use `ref=eN` (e.g., `ref=e46`) as target parameter for browser_click, browser_type, browser_hover, etc.",
		]
			.filter(Boolean)
			.join("\n");

		// Also keep structured data for backward compat (tool detail, annotation)
		const grouped = {
			inputs: pageData.interactive.filter((e) => ["input", "textarea", "select"].includes(e.tag)),
			buttons: pageData.interactive.filter((e) => e.tag === "button" || e.type === "submit"),
			links: pageData.interactive.filter((e) => e.tag === "a"),
			other: pageData.interactive.filter(
				(e) => !["input", "textarea", "select", "button", "a"].includes(e.tag),
			),
		};

		return {
			tabId: tab.id,
			title,
			url,
			elements: pageData.interactive,
			headings,
			summary,
			grouped,
			yaml,
			elementCount,
			text,
		};
	}

	async ariaSnapshot(tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		const page = tab.page;
		const title = await page.title();
		const url = page.url();

		// Playwright 1.60: ariaSnapshot({ mode: "ai" }) returns YAML with [ref=eN] markers
		// Also injects data-aria-ref attributes into DOM elements for locator targeting
		const yaml = this.useBridge
			? await (page as BridgePage).ariaSnapshot()
			: await (page as Page).ariaSnapshot({ mode: "ai" });
		const elementCount = (yaml.match(/\[ref=/g) || []).length;

		return { tabId: tab.id, title, url, yaml, elementCount };
	}

	async ariaSnapshotFiltered(tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		const page = tab.page;
		const title = await page.title();
		const url = page.url();

		// Get the full accessibility tree first (injects data-aria-ref into DOM)
		const yaml = this.useBridge
			? await (page as BridgePage).ariaSnapshot()
			: await (page as Page).ariaSnapshot({ mode: "ai" });

		// Determine which refs are in the viewport
		const viewportRefs: string[] = await page.evaluate(() => {
			const viewportWidth = window.innerWidth;
			const viewportHeight = window.innerHeight;
			const visible: string[] = [];
			const elements = document.querySelectorAll('[data-aria-ref^="e"]');
			elements.forEach((el) => {
				if (!(el instanceof HTMLElement)) return;
				const ref = el.getAttribute("data-aria-ref");
				if (!ref) return;
				const rect = el.getBoundingClientRect();
				// Element must be at least 20% visible in viewport
				const visibleWidth = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
				const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
				if (visibleWidth > 0 && visibleHeight > 0) {
					const visibleArea = visibleWidth * visibleHeight;
					const totalArea = rect.width * rect.height;
					if (totalArea > 0 && visibleArea / totalArea >= 0.2) {
						visible.push(ref);
					}
				}
			});
			return visible;
		});

		// Filter YAML: only keep lines for elements in viewport
		const visibleSet = new Set(viewportRefs);
		const filteredLines: string[] = [];
		let keepBlock = true;

		for (const line of yaml.split("\n")) {
			const refMatch = line.match(/\[ref=(e\d+)\]/);
			if (refMatch) {
				keepBlock = visibleSet.has(refMatch[1]);
			}
			// Always keep structural lines (non-element lines like '- list:', '- navigation:')
			if (keepBlock || !refMatch) {
				filteredLines.push(line);
			}
		}

		const filteredYaml = filteredLines.join("\n");
		const elementCount = (filteredYaml.match(/\[ref=/g) || []).length;

		return { tabId: tab.id, title, url, yaml: filteredYaml, elementCount };
	}

	private locator(page: ManagedPage, target: string) {
		// ref=eN format → data-aria-ref attribute (from accessibility snapshot)
		const refMatch = target.match(/^ref=(e\d+)$/);
		if (refMatch) {
			return page.locator(`[data-aria-ref="${refMatch[1]}"]`);
		}
		// Numeric index (legacy format, less reliable)
		if (/^\d+$/.test(target)) {
			const index = Number(target);
			const selector = "a,button,input,textarea,select,[role='button'],[role='link']";
			return page.locator(selector).nth(index - 1);
		}
		// CSS selector
		return page.locator(target).first();
	}

	/**
	 * Broadcast the agent's virtual cursor to the live panel, positioned at the
	 * center of the target element. Never throws — cursor is cosmetic.
	 */
	/**
	 * Glide the REAL Playwright mouse from its last position to (x, y) in smooth
	 * steps, broadcasting each intermediate point to the live panel so the overlay
	 * cursor tracks the genuine pointer. The final point carries `kind` so the
	 * panel can play the click/type ripple + label. Never throws — cosmetic motion.
	 */
	private async glideMouseTo(
		page: ManagedPage,
		x: number,
		y: number,
		kind: "move" | "click" | "hover" | "type" | "drag",
		label?: string,
		extra?: { toX?: number; toY?: number },
	): Promise<void> {
		const start = this.lastMouse;
		const steps = 18;
		const emitMove = (ix: number, iy: number, moveKind: typeof kind = "move") => {
			const payload = { kind: moveKind, x: ix, y: iy, label, at: Date.now(), ...extra };
			if (this.useBridge) {
				void bridgeApi.emitCursor(payload);
				return;
			}
			getScreencastHub().emitCursor(payload);
		};
		try {
			for (let i = 1; i <= steps; i++) {
				const t = i / steps;
				const e = 1 - Math.pow(1 - t, 3);
				const ix = Math.round(start.x + (x - start.x) * e);
				const iy = Math.round(start.y + (y - start.y) * e);
				try {
					await page.mouse.move(ix, iy);
				} catch {
					/* page navigated mid-glide — stop moving */
				}
				emitMove(ix, iy, "move");
				await new Promise((r) => setTimeout(r, 12));
			}
		} catch {
			/* ignore glide errors */
		}
		this.lastMouse = { x, y };
		// Son noktada kind (click/type/hover) — bridge ve CDP için imleç durumu net olsun.
		emitMove(x, y, kind);
	}

	/**
	 * Resolve an element's center in page viewport CSS pixels, then glide the real
	 * mouse there. Returns the center (or null if the element isn't resolvable).
	 */
	private async glideToTarget(
		page: ManagedPage,
		target: string,
		kind: "move" | "click" | "hover" | "type" | "drag",
		label?: string,
	): Promise<{ x: number; y: number } | null> {
		try {
			const box = await this.locator(page, target).boundingBox({ timeout: 1500 });
			if (!box) return null;
			const cx = Math.round(box.x + box.width / 2);
			const cy = Math.round(box.y + box.height / 2);
			await this.glideMouseTo(page, cx, cy, kind, label);
			return { x: cx, y: cy };
		} catch {
			return null;
		}
	}

	async click(target: string, tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		getScreencastHub().emitActivity({ type: "click", text: target, url: tab.page.url(), at: Date.now() });
		// Glide the real mouse to the element center, then click there physically so
		// the visible pointer and the actual click land on the same spot.
		const center = await this.glideToTarget(tab.page, target, "click", target);
		if (center) {
			try {
				await tab.page.mouse.click(center.x, center.y);
				return this.describeTab(tab);
			} catch {
				/* fall back to locator click below */
			}
		}
		await this.locator(tab.page, target).click();
		return this.describeTab(tab);
	}

	async type(target: string, text: string, tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		const preview = text.length > 40 ? `${text.slice(0, 40)}…` : text;
		getScreencastHub().emitActivity({
			type: "type",
			text: `${target}: ${preview}`,
			url: tab.page.url(),
			at: Date.now(),
		});
		// Glide the real mouse to the field, click to focus, then type.
		const typeCenter = await this.glideToTarget(tab.page, target, "type", preview);
		if (typeCenter) {
			try {
				await tab.page.mouse.click(typeCenter.x, typeCenter.y);
			} catch {
				/* ignore — fill/type below still focuses */
			}
		}
		await this.locator(tab.page, target).fill("");
		await this.locator(tab.page, target).type(text);
		return this.describeTab(tab);
	}

	async fillForm(values: Record<string, string>, tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		for (const [selector, value] of Object.entries(values)) {
			await this.locator(tab.page, selector).fill(value);
		}
		return this.describeTab(tab);
	}

	async selectOption(target: string, value: string, tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		await this.locator(tab.page, target).selectOption(value);
		return this.describeTab(tab);
	}

	async hover(target: string, tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		// Real mouse glide already produces the hover; locator.hover() is a safe re-assert.
		await this.glideToTarget(tab.page, target, "hover", target);
		await this.locator(tab.page, target).hover();
		return this.describeTab(tab);
	}

	async pressKey(key: string, tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		await tab.page.keyboard.press(key);
		return this.describeTab(tab);
	}

	async drag(from: string, to: string, tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		try {
			const fromBox = await this.locator(tab.page, from).boundingBox({ timeout: 1500 });
			const toBox = await this.locator(tab.page, to).boundingBox({ timeout: 1500 });
			if (fromBox && toBox) {
				const fx = Math.round(fromBox.x + fromBox.width / 2);
				const fy = Math.round(fromBox.y + fromBox.height / 2);
				const tx = Math.round(toBox.x + toBox.width / 2);
				const ty = Math.round(toBox.y + toBox.height / 2);
				// Real drag: glide to source, press, glide to target (drag trail), release.
				await this.glideMouseTo(tab.page, fx, fy, "move");
				try {
					await tab.page.mouse.down();
					await this.glideMouseTo(tab.page, tx, ty, "drag", undefined, { toX: tx, toY: ty });
					await tab.page.mouse.up();
					return this.describeTab(tab);
				} catch {
					try {
						await tab.page.mouse.up();
					} catch {
						/* ignore */
					}
				}
			}
		} catch {
			/* skip glide — fall back to locator drag */
		}
		await this.locator(tab.page, from).dragTo(this.locator(tab.page, to));
		return this.describeTab(tab);
	}

	async waitFor(opts: { text?: string; selector?: string; timeoutMs?: number }, tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		const timeout = opts.timeoutMs ?? 10000;
		if (opts.selector) {
			await tab.page.waitForSelector(opts.selector, { timeout });
		} else if (opts.text) {
			await tab.page.getByText(opts.text, { exact: false }).waitFor({ timeout });
		} else {
			await tab.page.waitForLoadState("networkidle", { timeout });
		}
		return this.describeTab(tab);
	}

	async screenshot(tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		const bytes = await tab.page.screenshot({ type: "png", fullPage: true });
		return {
			tabId: tab.id,
			title: await tab.page.title(),
			url: tab.page.url(),
			data: bytes.toString("base64"),
			mimeType: "image/png",
		};
	}

	async screenshotWithBoxes(tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		const page = tab.page;

		// Take aria snapshot first to get refs (injects data-aria-ref into DOM)
		if (this.useBridge) await (page as BridgePage).ariaSnapshot();
		else await (page as Page).ariaSnapshot({ mode: "ai" });

		// Draw colored bounding boxes + ref labels on elements
		await page.evaluate(() => {
			const elements = document.querySelectorAll('[data-aria-ref^="e"]');
			elements.forEach((el) => {
				if (!(el instanceof HTMLElement)) return;
				const ref = el.getAttribute("data-aria-ref");
				if (!ref) return;
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return;

				// Create overlay label
				const label = document.createElement("div");
				label.className = "__pw_ref_label";
				label.textContent = ref;
				label.style.cssText = `
					position: fixed;
					left: ${rect.left}px;
					top: ${rect.top}px;
					background: rgba(255, 107, 107, 0.9);
					color: white;
					font: bold 12px/16px monospace;
					padding: 2px 6px;
					border-radius: 3px;
					z-index: 2147483647;
					pointer-events: none;
				`;
				document.body.appendChild(label);

				// Add outline to element
				el.style.outline = "2px solid rgba(255, 107, 107, 0.8)";
				el.style.outlineOffset = "1px";
			});
		});

		// Take screenshot with overlays
		const bytes = await page.screenshot({ type: "png", fullPage: true });

		// Clean up overlays
		await page.evaluate(() => {
			document.querySelectorAll(".__pw_ref_label").forEach((el) => el.remove());
			document.querySelectorAll('[data-aria-ref^="e"]').forEach((el) => {
				if (el instanceof HTMLElement) {
					el.style.outline = "";
					el.style.outlineOffset = "";
				}
			});
		});

		return {
			tabId: tab.id,
			title: await tab.page.title(),
			url: tab.page.url(),
			data: bytes.toString("base64"),
			mimeType: "image/png",
		};
	}

	async consoleMessages(tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		if (this.useBridge) {
			const res = await bridgeApi.console();
			return { tabId: tab.id, messages: res.messages };
		}
		return { tabId: tab.id, messages: tab.console };
	}

	async networkRequests(tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		if (this.useBridge) {
			const res = await bridgeApi.network();
			return { tabId: tab.id, requests: res.requests };
		}
		return { tabId: tab.id, requests: tab.requests };
	}

	async tabsInfo() {
		const tabs = await Promise.all(
			Array.from(this.tabs.values()).map(async (tab) => ({
				id: tab.id,
				active: tab.id === this.activeTabId,
				url: tab.page.url(),
				title: await tab.page.title(),
			})),
		);
		return { activeTabId: this.activeTabId, tabs };
	}

	async close(tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		if (tab.detachScreencast) await tab.detachScreencast().catch(() => {});
		await tab.page.close();
		this.tabs.delete(tab.id);
		if (this.activeTabId === tab.id) {
			this.activeTabId = Array.from(this.tabs.keys())[0];
		}
		this.emitTabsState();
		return { closedTabId: tab.id, activeTabId: this.activeTabId };
	}

	async shutdown(): Promise<void> {
		if (this.useBridge) {
			await endElectronBridgeSession();
			this.useBridge = false;
		}
		if (this.context) {
			await this.context.close();
			this.context = undefined;
		}
		this.tabs.clear();
		this.activeTabId = undefined;
		this.isCDP = false;
	}

	async runCode(code: string, tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		// Playwright's evaluate() overloads are typed for functions; passing a raw
		// string body is valid at runtime but needs a cast to satisfy the overload.
		const result = await tab.page.evaluate(code as unknown as () => unknown);
		return { tabId: tab.id, result };
	}

	async evaluate(expression: string, tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		// See runCode(): string-body evaluate is valid at runtime; cast satisfies the overload.
		const result = await tab.page.evaluate(expression as unknown as () => unknown);
		return { tabId: tab.id, result };
	}

	async upload(target: string, filePaths: string[], tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		await this.locator(tab.page, target).setInputFiles(filePaths);
		return this.describeTab(tab);
	}

	async handleDialog(action: "accept" | "dismiss", promptText?: string, tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		const dialogState = tab.dialog;
		const pending = tab.pendingDialog;
		if (!dialogState || !pending) throw new Error("No pending dialog");
		if (action === "accept") await pending.accept(promptText);
		else await pending.dismiss();
		tab.dialog = undefined;
		tab.pendingDialog = undefined;
		return { tabId: tab.id, handled: dialogState };
	}

	async resize(width: number, height: number, tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		await tab.page.setViewportSize({ width, height });
		return this.describeTab(tab);
	}

	async navigateBack(tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		await tab.page.goBack({ waitUntil: "domcontentloaded" });
		return this.describeTab(tab);
	}

	async highlight(target: string, tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		const page = tab.page;
		const loc = this.locator(page, target);

		// Scroll element into view
		await loc.scrollIntoViewIfNeeded();

		// Add visual highlight via CSS outline + background
		await page.evaluate(
			(refValue) => {
				const el = document.querySelector(`[data-aria-ref="${refValue}"]`);
				if (el instanceof HTMLElement) {
					el.style.outline = "3px solid #ff6b6b";
					el.style.outlineOffset = "2px";
					el.style.backgroundColor = "rgba(255, 107, 107, 0.1)";
					el.scrollIntoView({ behavior: "smooth", block: "center" });
				}
			},
			target.replace("ref=", ""),
		);

		return this.describeTab(tab);
	}

	async generateLocator(target: string, tabId?: string) {
		const tab = await this.getOrCreateTab(tabId);
		const page = tab.page;

		// Try to get element by ref first
		let loc: import("playwright").Locator;
		const refMatch = target.match(/^ref=(e\d+)$/);
		if (refMatch) {
			loc = page.locator(`[data-aria-ref="${refMatch[1]}"]`);
		} else {
			loc = this.locator(page, target);
		}

		const element = await loc.elementHandle();
		if (!element) throw new Error(`Element not found: ${target}`);

		// Generate locators
		const locators: Record<string, string> = await page.evaluate(
			(refValue) => {
				const el = document.querySelector(`[data-aria-ref="${refValue}"]`);
				if (!el) return {};
				const result: Record<string, string> = {};

				// Tag + id
				if (el.id) result["by-id"] = `#${CSS.escape(el.id)}`;

				// Tag + class (first class only)
				const classes = Array.from(el.classList).slice(0, 2);
				if (classes.length)
					result["by-class"] = `${el.tagName.toLowerCase()}.${classes.map((c) => CSS.escape(c)).join(".")}`;

				// aria-label
				const ariaLabel = el.getAttribute("aria-label");
				if (ariaLabel) result["by-aria-label"] = `[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;

				// Button/link text
				if (el.tagName === "BUTTON" || el.tagName === "A") {
					const text = (el as HTMLElement).innerText?.trim().slice(0, 50);
					if (text) result["by-text"] = `${el.tagName.toLowerCase()}:has-text("${text}")`;
				}

				// data-testid
				const testId = el.getAttribute("data-testid");
				if (testId) result["by-testid"] = `[data-testid="${testId}"]`;

				return result;
			},
			refMatch ? refMatch[1] : target,
		);

		return {
			tabId: tab.id,
			target,
			locators,
			recommended:
				locators["by-aria-label"] ||
				locators["by-testid"] ||
				locators["by-id"] ||
				locators["by-text"] ||
				locators["by-class"] ||
				"",
			text: Object.entries(locators).length
				? `Locators for ${target}:\n${Object.entries(locators)
						.map(([k, v]) => `  ${k}: ${v}`)
						.join("\n")}`
				: `No locator could be generated for ${target}. Use the ref=eN value directly.`,
		};
	}

	private async describeTab(tab: TabState) {
		return {
			tabId: tab.id,
			url: tab.page.url(),
			title: await tab.page.title(),
		};
	}
}

const manager = new BrowserManager();

function textContent(text: string) {
	return [{ type: "text" as const, text }];
}

function dot(theme: Theme, completed: boolean): string {
	return completed ? theme.fg("dim", "•") : theme.fg("muted", "◦");
}

function firstLine(text: string, fallback = ""): string {
	return (
		text
			.split(/\r?\n/)
			.find((line) => line.trim().length > 0)
			?.trim() || fallback
	);
}

export function statusLabel(toolName: string, _args: unknown, completed: boolean): string {
	if (toolName === "browser_navigate") {
		return completed ? "Opened page" : "Opening page";
	}
	if (toolName === "browser_snapshot") return completed ? "Captured snapshot" : "Capturing snapshot";
	if (toolName === "browser_take_screenshot") return completed ? "Captured screenshot" : "Capturing screenshot";
	if (toolName === "browser_console_messages") return completed ? "Read console messages" : "Reading console messages";
	if (toolName === "browser_network_requests") return completed ? "Read network requests" : "Reading network requests";
	if (toolName === "browser_tabs") return completed ? "Listed browser tabs" : "Reading browser tabs";
	if (toolName === "browser_highlight") return completed ? "Highlighted element" : "Highlighting element";
	if (toolName === "browser_generate_locator") return completed ? "Generated locator" : "Generating locator";
	if (toolName === "browser_aria_snapshot") return completed ? "Captured ARIA snapshot" : "Capturing ARIA snapshot";
	return completed ? toolName.replaceAll("_", " ") : toolName.replaceAll("_", " ");
}

/** Safely read a string-ish field from an untyped bag. */
function str(bag: Record<string, unknown> | undefined, key: string): string {
	const value = bag?.[key];
	return value == null ? "" : String(value);
}

/** Safely read the length of an array-ish field from an untyped bag. */
function len(bag: Record<string, unknown> | undefined, key: string): number {
	const value = bag?.[key];
	return Array.isArray(value) ? value.length : 0;
}

export function detailForTool(
	toolName: string,
	args: Record<string, unknown> | undefined,
	details: Record<string, unknown> | undefined,
): string {
	if (toolName === "browser_navigate") return str(details, "url") || str(args, "url");
	if (toolName === "browser_snapshot") return str(details, "summary") || str(details, "title") || str(details, "url");
	if (toolName === "browser_click") return str(args, "target");
	if (toolName === "browser_type") return `${str(args, "target")} ← ${str(args, "text").slice(0, 80)}`;
	if (toolName === "browser_fill_form") {
		const values = args?.values;
		return `${values && typeof values === "object" ? Object.keys(values).length : 0} fields`;
	}
	if (toolName === "browser_select_option") return `${str(args, "target")} = ${str(args, "value")}`;
	if (toolName === "browser_hover") return str(args, "target");
	if (toolName === "browser_press_key") return str(args, "key");
	if (toolName === "browser_drag") return `${str(args, "from")} -> ${str(args, "to")}`;
	if (toolName === "browser_wait_for") return str(args, "selector") || str(args, "text") || "network idle";
	if (toolName === "browser_take_screenshot") return str(details, "title") || str(details, "url");
	if (toolName === "browser_console_messages") return `${len(details, "messages")} messages`;
	if (toolName === "browser_network_requests") return `${len(details, "requests")} requests`;
	if (toolName === "browser_tabs") return `${len(details, "tabs")} tabs`;
	if (toolName === "browser_close") return str(details, "closedTabId");
	if (toolName === "browser_run_code")
		return firstLine(JSON.stringify(details?.result ?? "", null, 2), "evaluated code");
	if (toolName === "browser_evaluate")
		return firstLine(JSON.stringify(details?.result ?? "", null, 2), "evaluated expression");
	if (toolName === "browser_file_upload") return `${len(args, "files")} files`;
	if (toolName === "browser_handle_dialog") {
		const handled = details?.handled;
		const message = handled && typeof handled === "object" ? (handled as Record<string, unknown>).message : undefined;
		return message ? String(message) : "dialog handled";
	}
	if (toolName === "browser_resize") return `${str(args, "width")}x${str(args, "height")}`;
	if (toolName === "browser_navigate_back") return str(details, "url");
	if (toolName === "browser_highlight") return str(args, "target");
	if (toolName === "browser_generate_locator") return str(args, "target");
	if (toolName === "browser_aria_snapshot") return str(details, "title") || str(details, "url");
	return "";
}

function renderCall(toolName: string) {
	return (args: Record<string, unknown>, theme: Theme) => {
		const label = statusLabel(toolName, args, false);
		const detail = detailForTool(toolName, args, undefined);
		const text = `${dot(theme, false)} ${theme.bold(label)}${detail ? ` ${theme.fg("dim", detail)}` : ""}`;
		return new Text(text, 0, 0);
	};
}

function renderResult(toolName: string) {
	return (result: AgentToolResult<unknown>, { isPartial, expanded }: ToolRenderResultOptions, theme: Theme) => {
		if (isPartial) {
			const text = `${dot(theme, false)} ${theme.bold(statusLabel(toolName, undefined, false))}`;
			return new Text(text, 0, 0);
		}
		const details = result.details as Record<string, unknown> | undefined;
		const detail = detailForTool(toolName, undefined, details);
		let text = `${dot(theme, true)} ${theme.bold(statusLabel(toolName, { url: details?.url }, true))}`;
		if (detail) text += ` ${theme.fg("dim", detail)}`;

		if (expanded) {
			const content = result.content?.find((c) => c.type === "text")?.text as string | undefined;
			if (content) {
				const lines = String(content).split(/\r?\n/).slice(0, 20);
				for (const line of lines) text += `\n${theme.fg("dim", line)}`;
			}
		}
		return new Text(text, 0, 0);
	};
}

function registerTool<TParams extends TSchema, TDetails = unknown>(
	quake: ExtensionAPI,
	def: ToolDefinition<TParams, TDetails>,
) {
	quake.registerTool(def);
}

export default function (quake: ExtensionAPI) {
	registerTool(quake, {
		name: "browser_navigate",
		label: "browser_navigate",
		description:
			"Open a URL in the shared browser session. After navigation, call browser_snapshot to see the accessibility tree.",
		promptGuidelines: [
			"After navigating to a page, always call browser_snapshot to examine the accessibility tree and available element refs.",
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({ url: Type.String(), tabId: Type.Optional(Type.String()) }),
		renderCall: renderCall("browser_navigate"),
		renderResult: renderResult("browser_navigate"),
		async execute(_id, params) {
			const res = await manager.navigate(params.url, params.tabId);
			return {
				content: textContent(`Opened ${res.title || "(untitled)"}\n${res.url}\nTab: ${res.tabId}`),
				details: res,
			};
		},
	});

	registerTool(quake, {
		name: "browser_snapshot",
		label: "browser_snapshot",
		description:
			"Capture an accessibility tree snapshot of the current page. Returns a YAML-formatted accessibility tree (ARIA snapshot) with [ref=eN] element references you can use in all browser interaction tools. Use the ref (e.g., ref=e46) as the target parameter for browser_click, browser_type, browser_hover, browser_select_option, etc.",
		promptGuidelines: [
			"Always call browser_snapshot FIRST to see the page's accessibility tree and available element refs.",
			"Use the [ref=eN] value (e.g., ref=e46) as the target parameter for browser_click, browser_type, browser_hover, and all other interaction tools.",
			"If you need a screenshot for visual context, call browser_take_screenshot separately.",
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({ tabId: Type.Optional(Type.String()) }),
		renderCall: renderCall("browser_snapshot"),
		renderResult: renderResult("browser_snapshot"),
		async execute(_id, params) {
			const res = await manager.snapshot(params.tabId);
			return { content: textContent(res.text), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_click",
		label: "browser_click",
		description: "Click an element by accessibility ref (ref=eN), numeric index, or CSS selector.",
		promptGuidelines: [
			"Always call browser_snapshot FIRST to see the page's accessibility tree and element refs.",
			"Use ref=eN (e.g., ref=e46) as the target parameter — this is the most reliable way to target elements.",
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({
			target: Type.String({
				description:
					"Element reference from browser_snapshot (e.g., ref=e46), numeric snapshot index, or CSS selector",
			}),
			tabId: Type.Optional(Type.String()),
		}),
		renderCall: renderCall("browser_click"),
		renderResult: renderResult("browser_click"),
		async execute(_id, params) {
			const res = await manager.click(params.target, params.tabId);
			return {
				content: textContent(`Clicked ${params.target}\n${res.title || "(untitled)"}\n${res.url}`),
				details: res,
			};
		},
	});

	registerTool(quake, {
		name: "browser_type",
		label: "browser_type",
		description: "Type text into an element by accessibility ref (ref=eN), numeric index, or CSS selector.",
		promptGuidelines: [
			"Always call browser_snapshot FIRST to see the page's accessibility tree and element refs.",
			"Use ref=eN (e.g., ref=e46) as the target parameter — this is the most reliable way to target elements.",
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({
			target: Type.String({
				description:
					"Element reference from browser_snapshot (e.g., ref=e46), numeric snapshot index, or CSS selector",
			}),
			text: Type.String(),
			tabId: Type.Optional(Type.String()),
		}),
		renderCall: renderCall("browser_type"),
		renderResult: renderResult("browser_type"),
		async execute(_id, params) {
			const res = await manager.type(params.target, params.text, params.tabId);
			return { content: textContent(`Typed into ${params.target}`), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_fill_form",
		label: "browser_fill_form",
		description: "Fill multiple form fields using accessibility ref or CSS selector keys and value entries.",
		promptGuidelines: [
			"Always call browser_snapshot FIRST to see the page's accessibility tree and element refs.",
			"Use ref=eN (e.g., ref=e46) as keys in the values object to target specific fields.",
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({
			values: Type.Record(Type.String(), Type.String()),
			tabId: Type.Optional(Type.String()),
		}),
		renderCall: renderCall("browser_fill_form"),
		renderResult: renderResult("browser_fill_form"),
		async execute(_id, params) {
			const res = await manager.fillForm(params.values, params.tabId);
			return {
				content: textContent(`Filled ${Object.keys(params.values ?? {}).length} form fields`),
				details: res,
			};
		},
	});

	registerTool(quake, {
		name: "browser_select_option",
		label: "browser_select_option",
		description:
			"Select an option in a <select> element. Target by accessibility ref (ref=eN), numeric index, or CSS selector.",
		promptGuidelines: [
			"Always call browser_snapshot FIRST to see the page's accessibility tree and element refs.",
			"Use ref=eN (e.g., ref=e46) as the target parameter — this is the most reliable way to target elements.",
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({
			target: Type.String({
				description:
					"Element reference from browser_snapshot (e.g., ref=e46), numeric snapshot index, or CSS selector",
			}),
			value: Type.String(),
			tabId: Type.Optional(Type.String()),
		}),
		renderCall: renderCall("browser_select_option"),
		renderResult: renderResult("browser_select_option"),
		async execute(_id, params) {
			const res = await manager.selectOption(params.target, params.value, params.tabId);
			return { content: textContent(`Selected ${params.value} in ${params.target}`), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_hover",
		label: "browser_hover",
		description: "Hover an element by accessibility ref (ref=eN), numeric index, or CSS selector.",
		promptGuidelines: [
			"Always call browser_snapshot FIRST to see the page's accessibility tree and element refs.",
			"Use ref=eN (e.g., ref=e46) as the target parameter — this is the most reliable way to target elements.",
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({
			target: Type.String({
				description:
					"Element reference from browser_snapshot (e.g., ref=e46), numeric snapshot index, or CSS selector",
			}),
			tabId: Type.Optional(Type.String()),
		}),
		renderCall: renderCall("browser_hover"),
		renderResult: renderResult("browser_hover"),
		async execute(_id, params) {
			const res = await manager.hover(params.target, params.tabId);
			return { content: textContent(`Hovered ${params.target}`), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_press_key",
		label: "browser_press_key",
		description:
			"Press a keyboard shortcut on the current page. For element-specific typing, use browser_type with a ref=eN target.",
		promptGuidelines: [
			"Always call browser_snapshot FIRST to see the page's accessibility tree and element refs.",
			"Use browser_type with ref=eN target for text input into specific elements.",
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({ key: Type.String(), tabId: Type.Optional(Type.String()) }),
		renderCall: renderCall("browser_press_key"),
		renderResult: renderResult("browser_press_key"),
		async execute(_id, params) {
			const res = await manager.pressKey(params.key, params.tabId);
			return { content: textContent(`Pressed ${params.key}`), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_drag",
		label: "browser_drag",
		description:
			"Drag from one element to another. Both from and to accept accessibility ref (ref=eN), numeric index, or CSS selector.",
		promptGuidelines: [
			"Always call browser_snapshot FIRST to see the page's accessibility tree and element refs.",
			"Use ref=eN (e.g., ref=e46) as the target parameter — this is the most reliable way to target elements.",
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({
			from: Type.String({
				description:
					"Element reference from browser_snapshot (e.g., ref=e46), numeric snapshot index, or CSS selector",
			}),
			to: Type.String({
				description:
					"Element reference from browser_snapshot (e.g., ref=e46), numeric snapshot index, or CSS selector",
			}),
			tabId: Type.Optional(Type.String()),
		}),
		renderCall: renderCall("browser_drag"),
		renderResult: renderResult("browser_drag"),
		async execute(_id, params) {
			const res = await manager.drag(params.from, params.to, params.tabId);
			return { content: textContent(`Dragged ${params.from} -> ${params.to}`), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_wait_for",
		label: "browser_wait_for",
		description:
			"Wait for a selector, text, or network idle state. After waiting, call browser_snapshot again to refresh the accessibility tree.",
		promptGuidelines: [
			"Always call browser_snapshot FIRST to see the page's accessibility tree and element refs.",
			"After waiting for a condition, call browser_snapshot again to get fresh element refs — previous ref=eN values may no longer be valid.",
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({
			selector: Type.Optional(Type.String()),
			text: Type.Optional(Type.String()),
			timeoutMs: Type.Optional(Type.Number()),
			tabId: Type.Optional(Type.String()),
		}),
		renderCall: renderCall("browser_wait_for"),
		renderResult: renderResult("browser_wait_for"),
		async execute(_id, params) {
			const res = await manager.waitFor(params, params.tabId);
			return { content: textContent(`Wait condition satisfied`), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_take_screenshot",
		label: "browser_take_screenshot",
		description:
			"Take a screenshot of the current page. Pass boxes=true to overlay element bounding boxes with ref=eN labels.",
		promptGuidelines: [
			"Always call browser_snapshot FIRST to see the page's accessibility tree — use screenshots only when you need visual context (layout, colors, images).",
			"Set boxes=true to see element bounding boxes with ref labels overlaid on the screenshot.",
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({
			tabId: Type.Optional(Type.String()),
			boxes: Type.Optional(
				Type.Boolean({
					description: "When true, overlay element bounding boxes with ref=eN labels on the screenshot",
				}),
			),
		}),
		renderCall: renderCall("browser_take_screenshot"),
		renderResult: renderResult("browser_take_screenshot"),
		async execute(_id, params) {
			const res = params.boxes
				? await manager.screenshotWithBoxes(params.tabId)
				: await manager.screenshot(params.tabId);
			return {
				content: [
					{ type: "text" as const, text: `${res.title || "(untitled)"}\n${res.url}` },
					{ type: "image" as const, data: res.data, mimeType: res.mimeType },
				],
				details: res,
			};
		},
	});

	registerTool(quake, {
		name: "browser_console_messages",
		label: "browser_console_messages",
		description: "Read recent browser console messages.",
		promptGuidelines: [
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({ tabId: Type.Optional(Type.String()) }),
		renderCall: renderCall("browser_console_messages"),
		renderResult: renderResult("browser_console_messages"),
		async execute(_id, params) {
			const res = await manager.consoleMessages(params.tabId);
			const text = res.messages.length
				? res.messages.map((m) => `[${m.type}] ${m.text}${m.location ? ` (${m.location})` : ""}`).join("\n")
				: "No console messages.";
			return { content: textContent(text), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_network_requests",
		label: "browser_network_requests",
		description: "Read recent browser network requests.",
		promptGuidelines: [
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({ tabId: Type.Optional(Type.String()) }),
		renderCall: renderCall("browser_network_requests"),
		renderResult: renderResult("browser_network_requests"),
		async execute(_id, params) {
			const res = await manager.networkRequests(params.tabId);
			const text = res.requests.length
				? res.requests.map((r) => `${r.method} ${r.status ?? "..."} ${r.url}`).join("\n")
				: "No network requests.";
			return { content: textContent(text), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_tabs",
		label: "browser_tabs",
		description: "List browser tabs and active tab.",
		promptGuidelines: [
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({}),
		renderCall: renderCall("browser_tabs"),
		renderResult: renderResult("browser_tabs"),
		async execute() {
			const res = await manager.tabsInfo();
			const text = res.tabs.length
				? res.tabs.map((t) => `${t.active ? "*" : "-"} ${t.id} ${t.title || "(untitled)"} ${t.url}`).join("\n")
				: "No open tabs.";
			return { content: textContent(text), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_close",
		label: "browser_close",
		description: "Close a browser tab.",
		promptGuidelines: [
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({ tabId: Type.Optional(Type.String()) }),
		renderCall: renderCall("browser_close"),
		renderResult: renderResult("browser_close"),
		async execute(_id, params) {
			const res = await manager.close(params.tabId);
			return { content: textContent(`Closed ${res.closedTabId}`), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_run_code",
		label: "browser_run_code",
		description: "Run JavaScript in the page context.",
		promptGuidelines: [
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({ code: Type.String(), tabId: Type.Optional(Type.String()) }),
		renderCall: renderCall("browser_run_code"),
		renderResult: renderResult("browser_run_code"),
		async execute(_id, params) {
			const res = await manager.runCode(params.code, params.tabId);
			return { content: textContent(JSON.stringify(res.result, null, 2)), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_evaluate",
		label: "browser_evaluate",
		description: "Evaluate an expression in the page context.",
		promptGuidelines: [
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({ expression: Type.String(), tabId: Type.Optional(Type.String()) }),
		renderCall: renderCall("browser_evaluate"),
		renderResult: renderResult("browser_evaluate"),
		async execute(_id, params) {
			const res = await manager.evaluate(params.expression, params.tabId);
			return { content: textContent(JSON.stringify(res.result, null, 2)), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_file_upload",
		label: "browser_file_upload",
		description:
			"Upload one or more files into a file input. Target by accessibility ref (ref=eN), numeric index, or CSS selector.",
		promptGuidelines: [
			"Always call browser_snapshot FIRST to see the page's accessibility tree and element refs.",
			"Use ref=eN (e.g., ref=e46) as the target parameter — this is the most reliable way to target elements.",
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({
			target: Type.String({
				description:
					"Element reference from browser_snapshot (e.g., ref=e46), numeric snapshot index, or CSS selector",
			}),
			files: Type.Array(Type.String()),
			tabId: Type.Optional(Type.String()),
		}),
		renderCall: renderCall("browser_file_upload"),
		renderResult: renderResult("browser_file_upload"),
		async execute(_id, params) {
			const res = await manager.upload(params.target, params.files, params.tabId);
			return { content: textContent(`Uploaded ${params.files.length} file(s)`), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_handle_dialog",
		label: "browser_handle_dialog",
		description: "Accept or dismiss a pending alert/confirm/prompt dialog.",
		promptGuidelines: [
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("accept"), Type.Literal("dismiss")], { description: "accept or dismiss" }),
			promptText: Type.Optional(Type.String()),
			tabId: Type.Optional(Type.String()),
		}),
		renderCall: renderCall("browser_handle_dialog"),
		renderResult: renderResult("browser_handle_dialog"),
		async execute(_id, params) {
			const res = await manager.handleDialog(params.action, params.promptText, params.tabId);
			return { content: textContent(`Handled ${res.handled.type} dialog: ${res.handled.message}`), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_resize",
		label: "browser_resize",
		description: "Resize the browser viewport.",
		promptGuidelines: [
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({ width: Type.Number(), height: Type.Number(), tabId: Type.Optional(Type.String()) }),
		renderCall: renderCall("browser_resize"),
		renderResult: renderResult("browser_resize"),
		async execute(_id, params) {
			const res = await manager.resize(params.width, params.height, params.tabId);
			return { content: textContent(`Viewport set to ${params.width}x${params.height}`), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_navigate_back",
		label: "browser_navigate_back",
		description: "Go back in browser history. After navigation, call browser_snapshot to see the accessibility tree.",
		promptGuidelines: [
			"After navigating back, always call browser_snapshot to re-examine the accessibility tree — previous element refs are no longer valid.",
			"Only use browser tools when direct page interaction or browser state is required. For general research or web lookups, use web_search first.",
		],
		parameters: Type.Object({ tabId: Type.Optional(Type.String()) }),
		renderCall: renderCall("browser_navigate_back"),
		renderResult: renderResult("browser_navigate_back"),
		async execute(_id, params) {
			const res = await manager.navigateBack(params.tabId);
			return { content: textContent(`Navigated back\n${res.title || "(untitled)"}\n${res.url}`), details: res };
		},
	});

	registerTool(quake, {
		name: "browser_highlight",
		label: "browser_highlight",
		description:
			"Scroll an element into view and add a visual highlight (outline). Target by accessibility ref (ref=eN), numeric index, or CSS selector.",
		promptGuidelines: [
			"Use browser_highlight to visually locate an element on the page before interacting with it.",
			"Always call browser_snapshot FIRST to get element refs.",
			"Use ref=eN (e.g., ref=e46) as the target parameter.",
		],
		parameters: Type.Object({
			target: Type.String({
				description:
					"Element reference from browser_snapshot (e.g., ref=e46), numeric snapshot index, or CSS selector",
			}),
			tabId: Type.Optional(Type.String()),
		}),
		renderCall: renderCall("browser_highlight"),
		renderResult: renderResult("browser_highlight"),
		async execute(_id, params) {
			const res = await manager.highlight(params.target, params.tabId);
			return {
				content: textContent(`Highlighted ${params.target}\n${res.title || "(untitled)"}\n${res.url}`),
				details: res,
			};
		},
	});

	registerTool(quake, {
		name: "browser_generate_locator",
		label: "browser_generate_locator",
		description:
			"Generate Playwright locator strategies (CSS selectors, aria-label, test-id) for an element identified by ref=eN. Useful when you need stable selectors for repeated interactions.",
		promptGuidelines: [
			"Use browser_generate_locator when you need a stable CSS selector for an element found via browser_snapshot.",
			"The recommended locator is the first available: aria-label, test-id, id, text, or class.",
		],
		parameters: Type.Object({
			target: Type.String({ description: "Element reference from browser_snapshot (e.g., ref=e46)" }),
			tabId: Type.Optional(Type.String()),
		}),
		renderCall: renderCall("browser_generate_locator"),
		renderResult: renderResult("browser_generate_locator"),
		async execute(_id, params) {
			const res = await manager.generateLocator(params.target, params.tabId);
			return {
				content: textContent(res.text),
				details: res,
			};
		},
	});

	registerTool(quake, {
		name: "browser_aria_snapshot",
		label: "browser_aria_snapshot",
		description:
			"Capture a raw accessibility tree (ARIA snapshot) of the current page. Returns YAML-formatted tree with [ref=eN] element references. Unlike browser_snapshot, this returns ONLY the accessibility tree without page summary or headings.",
		promptGuidelines: [
			"Use browser_aria_snapshot when you need the raw accessibility tree YAML without the extra page summary info.",
			"The [ref=eN] values can be used as target parameters in browser_click, browser_type, etc.",
			"If you need page summary (headings, text summary) alongside the tree, use browser_snapshot instead.",
		],
		parameters: Type.Object({ tabId: Type.Optional(Type.String()) }),
		renderCall: renderCall("browser_aria_snapshot"),
		renderResult: renderResult("browser_aria_snapshot"),
		async execute(_id, params) {
			const res = await manager.ariaSnapshot(params.tabId);
			return {
				content: textContent(
					[
						`Accessibility tree for ${res.title || "(untitled)"}`,
						`URL: ${res.url}`,
						`${res.elementCount} interactive elements with refs:`,
						"",
						res.yaml,
						"",
						"Use ref=eN as target parameter for browser_click, browser_type, etc.",
					].join("\n"),
				),
				details: res,
			};
		},
	});

	quake.on("session_shutdown", async () => {
		await manager.shutdown();
	});
}
