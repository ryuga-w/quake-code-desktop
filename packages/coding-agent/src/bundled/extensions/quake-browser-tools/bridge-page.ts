import { bridgeApi } from "./electron-bridge.js";

class BridgeLocator {
	constructor(private readonly target: string) {}

	getTarget() {
		return this.target;
	}

	async click() {
		await bridgeApi.click(this.target);
	}

	async fill(text: string) {
		await bridgeApi.type(this.target, text);
	}

	async type(text: string) {
		await bridgeApi.type(this.target, text);
	}

	async hover() {
		await bridgeApi.hover(this.target);
	}

	async selectOption(value: string | { value?: string; label?: string }) {
		const resolved =
			typeof value === "string" ? value : (value.value ?? value.label ?? "");
		await bridgeApi.selectOption(this.target, resolved);
	}

	async dragTo(other: BridgeLocator) {
		await bridgeApi.drag(this.target, other.getTarget());
	}

	async boundingBox(_opts?: { timeout?: number }): Promise<{
		x: number;
		y: number;
		width: number;
		height: number;
	} | null> {
		const res = await bridgeApi.boundingBox(this.target);
		return res.box;
	}

	async scrollIntoViewIfNeeded() {
		const ref = this.target.replace(/^ref=/, "");
		await bridgeApi
			.evaluate(
				`(function(){
				const el = document.querySelector('[data-aria-ref="${ref}"]');
				if (el) el.scrollIntoView({ block: 'center', inline: 'center' });
			})()`,
			)
			.catch(() => {});
	}

	async elementHandle() {
		const box = await this.boundingBox();
		return box ? {} : null;
	}

	async allTextContents(): Promise<string[]> {
		return [];
	}
}

/** Minimal Page-shaped adapter backed by the Electron HTTP bridge (port 9223). */
export class BridgePage {
	private cachedUrl = "";
	private cachedTitle = "";

	async refreshState() {
		const state = await bridgeApi.state();
		this.cachedUrl = state.url;
		this.cachedTitle = state.title;
	}

	locator(target: string) {
		return new BridgeLocator(target);
	}

	async goto(url: string, _opts?: { waitUntil?: string }) {
		const res = await bridgeApi.navigate(url);
		this.cachedUrl = res.url;
		this.cachedTitle = res.title;
	}

	url() {
		return this.cachedUrl;
	}

	async title() {
		if (!this.cachedTitle) await this.refreshState();
		return this.cachedTitle;
	}

	async evaluate<T>(fnOrExpression: string | (() => T)): Promise<T> {
		const expression =
			typeof fnOrExpression === "function" ? `(${fnOrExpression.toString()})()` : fnOrExpression;
		const res = await bridgeApi.evaluate(expression);
		return res.result as T;
	}

	async ariaSnapshot() {
		const snap = await bridgeApi.snapshot();
		return snap.yaml;
	}

	mouse = {
		move: async (_x: number, _y: number) => {},
		click: async (_x: number, _y: number) => {},
		down: async () => {},
		up: async () => {},
	};

	keyboard = {
		press: async (key: string) => {
			await bridgeApi.pressKey(key);
		},
	};

	async screenshot(_opts?: { type?: string; fullPage?: boolean }) {
		const res = await bridgeApi.screenshot();
		return Buffer.from(res.data, "base64");
	}

	async waitForSelector(_selector: string, _opts?: { timeout?: number }) {
		/* handled by bridge wait-for at manager level */
	}

	getByText(_text: string, _opts?: { exact?: boolean }) {
		return {
			waitFor: async () => {},
		};
	}

	async waitForLoadState(_state?: string, _opts?: { timeout?: number }) {
		await bridgeApi.waitFor({ timeoutMs: _opts?.timeout });
	}

	async setViewportSize(_size: { width: number; height: number }) {
		/* embedded view size is controlled by BrowserPanel bounds */
	}

	async goBack() {
		await bridgeApi.goBack();
	}

	async close() {
		/* single embedded tab — no close */
	}

	on(_event: string, _handler: (...args: unknown[]) => void) {
		/* event streaming not available in bridge mode */
	}

	mainFrame() {
		return { url: () => this.url() };
	}
}