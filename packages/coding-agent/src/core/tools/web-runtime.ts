import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

export interface WebSearchResultItem {
	title: string;
	url: string;
	snippet: string;
	hostname: string;
}

export type WebSearchProvider = "duckduckgo" | "google" | "cache";
export type WebSearchStatus = "ok" | "empty";

export interface WebSearchResponse {
	query: string;
	results: WebSearchResultItem[];
	url: string;
	title: string;
	provider: WebSearchProvider;
	status: WebSearchStatus;
	duplicate?: boolean;
	cached?: boolean;
	warnings?: string[];
}

type CachedSearch = { value: WebSearchResponse; at: number };
type ProviderAttempt = {
	provider: Exclude<WebSearchProvider, "cache">;
	url: string;
	results: WebSearchResultItem[];
	error?: string;
};

const SEARCH_CACHE_TTL_MS = 60_000;
const DUPLICATE_WINDOW_MS = 120_000;
const SEARCH_CACHE_LIMIT = 80;
const SEARCH_RESULT_LIMIT = 10;
const SEARCH_QUERY_LIMIT = 500;

export class WebSearchRuntimeError extends Error {
	readonly code: "invalid-query" | "runtime-error" | "blocked" | "timeout";
	readonly diagnostics: string[];

	constructor(code: WebSearchRuntimeError["code"], message: string, diagnostics: string[] = []) {
		super(message);
		this.name = "WebSearchRuntimeError";
		this.code = code;
		this.diagnostics = diagnostics;
	}
}

export function normalizeSearchQuery(query: string): string {
	return query
		.toLowerCase()
		.replace(/[?!.;,،]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeResultUrl(raw: string): string | undefined {
	try {
		const url = new URL(raw);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		for (const key of [...url.searchParams.keys()]) {
			if (/^(utm_|gclid|fbclid|ref$)/i.test(key)) url.searchParams.delete(key);
		}
		url.hash = "";
		return url.href;
	} catch {
		return undefined;
	}
}

export function normalizeWebSearchResults(items: Array<Partial<WebSearchResultItem>>, limit = SEARCH_RESULT_LIMIT): WebSearchResultItem[] {
	const seenUrls = new Set<string>();
	const results: WebSearchResultItem[] = [];
	for (const item of items) {
		const title = String(item.title || "").replace(/\s+/g, " ").trim().slice(0, 180);
		const url = normalizeResultUrl(String(item.url || ""));
		if (!title || !url || seenUrls.has(url)) continue;
		seenUrls.add(url);
		results.push({
			title,
			url,
			hostname: new URL(url).hostname.replace(/^www\./i, ""),
			snippet: String(item.snippet || "").replace(/\s+/g, " ").trim().slice(0, 360),
		});
		if (results.length >= limit) break;
	}
	return results;
}

function classifyProviderError(error: unknown): { code: WebSearchRuntimeError["code"]; message: string } {
	const message = error instanceof Error ? error.message : String(error);
	if (/timeout/i.test(message)) return { code: "timeout", message };
	if (/captcha|blocked|unusual traffic|access denied|robot/i.test(message)) return { code: "blocked", message };
	return { code: "runtime-error", message };
}

class QuakeWebRuntime {
	private contextPromise?: Promise<any>;
	private pagePromise?: Promise<any>;
	private playwrightPromise?: Promise<any>;
	private searchCache = new Map<string, CachedSearch>();
	private lastSearch?: { normalizedQuery: string; at: number; value: WebSearchResponse };

	private async getPlaywright(): Promise<any> {
		if (!this.playwrightPromise) {
			this.playwrightPromise = (async () => {
				const require = createRequire(import.meta.url);
				const candidates = [
					"playwright",
					join(homedir(), ".quake-code", "agent", "extensions", "quake-browser-tools", "node_modules", "playwright"),
				];
				for (const candidate of candidates) {
					try {
						return require(candidate);
					} catch {
						// Try the next supported installation location.
					}
				}
				throw new WebSearchRuntimeError("runtime-error", "Playwright is not installed for web search.");
			})();
		}
		return this.playwrightPromise;
	}

	private async ensureContext(): Promise<any> {
		if (!this.contextPromise) {
			const { chromium } = await this.getPlaywright();
			const userDataDir = join(homedir(), ".quake-code", "playwright-web-profile");
			this.contextPromise = chromium.launchPersistentContext(userDataDir, {
				headless: true,
				channel: process.platform === "win32" ? "msedge" : undefined,
				viewport: { width: 1440, height: 960 },
				locale: "tr-TR",
				args: ["--disable-blink-features=AutomationControlled", "--disable-infobars"],
			});
		}
		return this.contextPromise;
	}

	async getPage(): Promise<any> {
		if (!this.pagePromise) {
			this.pagePromise = (async () => {
				const context = await this.ensureContext();
				const existing = context.pages()[0];
				if (existing) return existing;
				return context.newPage();
			})();
		}
		return this.pagePromise;
	}

	private pruneCache(now: number): void {
		for (const [key, cached] of this.searchCache) {
			if (now - cached.at >= SEARCH_CACHE_TTL_MS) this.searchCache.delete(key);
		}
		while (this.searchCache.size >= SEARCH_CACHE_LIMIT) {
			const oldest = this.searchCache.keys().next().value as string | undefined;
			if (!oldest) break;
			this.searchCache.delete(oldest);
		}
	}

	private async detectBlocked(page: any): Promise<void> {
		const evidence = await page.evaluate(() => {
			const doc = (globalThis as any).document;
			return `${doc?.title || ""}\n${doc?.body?.innerText || ""}`.slice(0, 4000);
		});
		if (/captcha|unusual traffic|access denied|verify you are human|robot check/i.test(evidence)) {
			throw new WebSearchRuntimeError("blocked", "Search provider blocked the automated request.");
		}
	}

	private async searchDuckDuckGo(page: any, query: string): Promise<ProviderAttempt> {
		const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`;
		try {
			await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
			await this.detectBlocked(page);
			await page.waitForSelector('[data-testid="result"], article', { timeout: 8_000 }).catch(() => {});
			const raw = await page.evaluate(() => {
				const doc = (globalThis as any).document;
				return [...doc.querySelectorAll('[data-testid="result"], article')].map((element: any) => {
					const link = element.querySelector('[data-testid="result-title-a"], h2 a');
					const snippet = element.querySelector('[data-testid="result-snippet"], [data-result="snippet"]');
					return { title: link?.textContent, url: link?.href, snippet: snippet?.textContent };
				});
			});
			return { provider: "duckduckgo", url: page.url(), results: normalizeWebSearchResults(raw) };
		} catch (error) {
			return { provider: "duckduckgo", url, results: [], error: classifyProviderError(error).message };
		}
	}

	private async searchGoogle(page: any, query: string): Promise<ProviderAttempt> {
		const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=10`;
		try {
			await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
			await this.detectBlocked(page);
			await page.waitForSelector("h3", { timeout: 8_000 }).catch(() => {});
			const raw = await page.evaluate(() => {
				const doc = (globalThis as any).document;
				return [...doc.querySelectorAll("h3")].map((heading: any) => {
					const link = heading.closest("a") || heading.querySelector("a");
					const parent = link?.closest("[data-sokoban-container], .yuRUbf")?.parentElement;
					const snippet = parent?.querySelector(".VwiC3b, [data-sncf='1'], span[jsname]");
					return { title: heading.textContent, url: link?.href, snippet: snippet?.textContent };
				});
			});
			return {
				provider: "google",
				url: page.url(),
				results: normalizeWebSearchResults(raw.filter((item: any) => !String(item.url || "").includes("google.com"))),
			};
		} catch (error) {
			return { provider: "google", url, results: [], error: classifyProviderError(error).message };
		}
	}

	async search(query: string): Promise<WebSearchResponse> {
		const cleanQuery = String(query || "").replace(/\s+/g, " ").trim();
		if (!cleanQuery) throw new WebSearchRuntimeError("invalid-query", "Web search query cannot be empty.");
		if (cleanQuery.length > SEARCH_QUERY_LIMIT) {
			throw new WebSearchRuntimeError("invalid-query", `Web search query cannot exceed ${SEARCH_QUERY_LIMIT} characters.`);
		}

		const normalizedQuery = normalizeSearchQuery(cleanQuery);
		const now = Date.now();
		this.pruneCache(now);
		if (this.lastSearch && this.lastSearch.normalizedQuery === normalizedQuery && now - this.lastSearch.at < DUPLICATE_WINDOW_MS) {
			return { ...this.lastSearch.value, duplicate: true, cached: true, provider: "cache" };
		}
		const cached = this.searchCache.get(normalizedQuery);
		if (cached) {
			const value = { ...cached.value, cached: true, provider: "cache" as const };
			this.lastSearch = { normalizedQuery, at: now, value };
			return value;
		}

		const context = await this.ensureContext();
		const page = await context.newPage();
		const attempts: ProviderAttempt[] = [];
		try {
			const duck = await this.searchDuckDuckGo(page, cleanQuery);
			attempts.push(duck);
			if (!duck.results.length) attempts.push(await this.searchGoogle(page, cleanQuery));
		} finally {
			await page.close().catch(() => {});
		}

		const successful = attempts.find((attempt) => attempt.results.length > 0);
		const completed = attempts.find((attempt) => !attempt.error);
		if (!successful && !completed) {
			const diagnostics = attempts.map((attempt) => `${attempt.provider}: ${attempt.error || "unknown error"}`);
			const classified = classifyProviderError(attempts.map((attempt) => attempt.error).join(" "));
			throw new WebSearchRuntimeError(classified.code, "Web search providers failed.", diagnostics);
		}

		const selected = successful || completed!;
		const warnings = attempts.filter((attempt) => attempt.error).map((attempt) => `${attempt.provider}: ${attempt.error}`);
		const value: WebSearchResponse = {
			query: cleanQuery,
			results: selected.results,
			url: selected.url,
			title: `Search results for ${cleanQuery}`,
			provider: selected.provider,
			status: selected.results.length ? "ok" : "empty",
			...(warnings.length ? { warnings } : {}),
		};
		this.searchCache.set(normalizedQuery, { value, at: now });
		this.lastSearch = { normalizedQuery, at: now, value };
		return value;
	}

	async openPage(url: string): Promise<{ url: string; title: string }> {
		const page = await this.getPage();
		await page.goto(url, { waitUntil: "domcontentloaded" });
		await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
		return { url: page.url(), title: await page.title() };
	}

	async findInPage(pattern: string): Promise<{ pattern: string; matches: number; samples: string[]; url: string; title: string }> {
		const page = await this.getPage();
		const result = await page.evaluate((needle: string) => {
			const doc = (globalThis as any).document;
			const lines = String(doc?.body?.innerText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
			const lowerNeedle = needle.toLowerCase();
			const matched = lines.filter((line) => line.toLowerCase().includes(lowerNeedle));
			return { matches: matched.length, samples: matched.slice(0, 8) };
		}, pattern);
		return { pattern, matches: result.matches, samples: result.samples, url: page.url(), title: await page.title() };
	}
}

export const quakeWebRuntime = new QuakeWebRuntime();
