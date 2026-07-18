import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockContextClose, mockLaunchPersistentContext, mockPageClose, mockPageEvalResults } = vi.hoisted(() => {
	const mockContextClose = vi.fn().mockResolvedValue(undefined);
	const mockPageClose = vi.fn().mockResolvedValue(undefined);

	// Controlled by tests: configure what page.evaluate returns
	const mockPageEvalResults = {
		interactiveElements: [] as Array<Record<string, unknown>>,
		ariaSnapshot: `- main [ref=e1]:\n  - button "Submit" [ref=e2] [cursor=pointer]\n  - textbox "Email" [ref=e3]`,
		viewportRefs: ["e2", "e3"] as string[],
		locatorResult: {} as Record<string, string>,
	};

	const mockLocator = {
		click: vi.fn().mockResolvedValue(undefined),
		fill: vi.fn().mockResolvedValue(undefined),
		type: vi.fn().mockResolvedValue(undefined),
		hover: vi.fn().mockResolvedValue(undefined),
		scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
		elementHandle: vi.fn().mockResolvedValue({}),
		selectOption: vi.fn().mockResolvedValue(undefined),
		dragTo: vi.fn().mockResolvedValue(undefined),
		nth: vi.fn().mockReturnThis(),
		first: vi.fn().mockReturnThis(),
		setInputFiles: vi.fn().mockResolvedValue(undefined),
	};
	const mockAllTextContents = vi.fn().mockResolvedValue([]);

	const mockPage = {
		goto: vi.fn().mockResolvedValue(undefined),
		url: vi.fn().mockReturnValue("https://example.com"),
		title: vi.fn().mockResolvedValue("Example"),
		close: mockPageClose,
		on: vi.fn(),
		ariaSnapshot: vi.fn().mockImplementation(() => Promise.resolve(mockPageEvalResults.ariaSnapshot)),
		screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png-data")),
		evaluate: vi.fn().mockImplementation((fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
			const fnStr = fn.toString();
			// For viewport filtering: return viewportRefs
			if (fnStr.includes('viewportWidth = window.innerWidth')) {
				return Promise.resolve(mockPageEvalResults.viewportRefs);
			}
			// For overlay: just resolve undefined
			if (fnStr.includes('__pw_ref_label') || fnStr.includes('outline =')) {
				return Promise.resolve(undefined);
			}
			// For locator generation: return locatorResult
			if (fnStr.includes('CSS.escape') || fnStr.includes('data-aria-ref')) {
				return Promise.resolve(mockPageEvalResults.locatorResult);
			}
			// For highlight: resolve undefined
			if (fnStr.includes('scrollIntoView') && fnStr.includes('outline')) {
				return Promise.resolve(undefined);
			}
			// Default: return interactive elements (legacy snapshot)
			if (fnStr.includes('document.querySelectorAll')) {
				return Promise.resolve({
					interactive: mockPageEvalResults.interactiveElements,
					textBlocks: ["Sample text"],
				});
			}
			return Promise.resolve(undefined);
		}),
		locator: vi.fn().mockReturnValue(mockLocator),
		// h1,h2,h3 locator for headings
		locator_heading: {
			allTextContents: mockAllTextContents,
		},
	};
	// Make page.locator("h1,h2,h3") return the heading mock
	mockPage.locator = vi.fn().mockImplementation((selector: string) => {
		if (selector === "h1,h2,h3") return mockPage.locator_heading;
		return mockLocator;
	});

	const mockLaunchPersistentContext = vi.fn().mockResolvedValue({
		pages: () => [],
		close: mockContextClose,
		newPage: vi.fn().mockResolvedValue(mockPage),
	});
	return { mockContextClose, mockLaunchPersistentContext, mockPageClose, mockPageEvalResults };
});

vi.mock("playwright", () => ({
	chromium: {
		launchPersistentContext: mockLaunchPersistentContext,
	},
}));

import registerBrowserTools, {
	detailForTool,
	isSearchResultsUrl,
	statusLabel,
} from "../src/bundled/extensions/quake-browser-tools/index.js";

describe("isSearchResultsUrl", () => {
	it("blocks common search result pages", () => {
		expect(isSearchResultsUrl("https://www.google.com/search?q=playwright")).toBe(true);
		expect(isSearchResultsUrl("https://www.bing.com/search?q=playwright")).toBe(true);
		expect(isSearchResultsUrl("https://duckduckgo.com/?q=playwright")).toBe(true);
		expect(isSearchResultsUrl("https://search.yahoo.com/search?p=playwright")).toBe(true);
	});

	it("allows direct page URLs", () => {
		expect(isSearchResultsUrl("https://example.com/docs")).toBe(false);
		expect(isSearchResultsUrl("https://github.com/microsoft/playwright")).toBe(false);
		expect(isSearchResultsUrl("https://www.google.com/chrome/")).toBe(false);
	});
});

describe("browser tool render helpers", () => {
	it("counts browser_fill_form fields from object keys", () => {
		expect(detailForTool("browser_fill_form", { values: { email: "a@b.c", password: "secret" } }, undefined)).toBe(
			"2 fields",
		);
		expect(detailForTool("browser_fill_form", { values: {} }, undefined)).toBe("0 fields");
		expect(detailForTool("browser_fill_form", {}, undefined)).toBe("0 fields");
	});

	it("formats browser_navigate and browser_type details", () => {
		expect(detailForTool("browser_navigate", { url: "https://example.com" }, undefined)).toBe("https://example.com");
		expect(detailForTool("browser_type", { target: "#email", text: "hello@example.com" }, undefined)).toBe(
			"#email ← hello@example.com",
		);
	});

	it("formats browser_highlight and browser_generate_locator details", () => {
		expect(detailForTool("browser_highlight", { target: "ref=e2" }, undefined)).toBe("ref=e2");
		expect(detailForTool("browser_generate_locator", { target: "ref=e2" }, undefined)).toBe("ref=e2");
		expect(detailForTool("browser_aria_snapshot", {}, { title: "Test" })).toBe("Test");
		expect(detailForTool("browser_aria_snapshot", {}, { url: "https://example.com" })).toBe("https://example.com");
	});

	it("uses human-readable status labels for browser tools", () => {
		expect(statusLabel("browser_navigate", {}, false)).toBe("Opening page");
		expect(statusLabel("browser_navigate", {}, true)).toBe("Opened page");
		expect(statusLabel("browser_snapshot", {}, true)).toBe("Captured snapshot");
		expect(statusLabel("browser_highlight", {}, false)).toBe("Highlighting element");
		expect(statusLabel("browser_highlight", {}, true)).toBe("Highlighted element");
		expect(statusLabel("browser_generate_locator", {}, false)).toBe("Generating locator");
		expect(statusLabel("browser_generate_locator", {}, true)).toBe("Generated locator");
		expect(statusLabel("browser_aria_snapshot", {}, false)).toBe("Capturing ARIA snapshot");
		expect(statusLabel("browser_aria_snapshot", {}, true)).toBe("Captured ARIA snapshot");
	});
});

describe("quake browser tools extension", () => {
	beforeEach(() => {
		mockContextClose.mockClear();
		mockLaunchPersistentContext.mockClear();
		mockPageClose.mockClear();
	});

	function registerWithMocks() {
		const handlers = new Map<string, () => Promise<void>>();
		const tools = new Map<string, { execute: (id: string, params: unknown) => Promise<unknown> }>();
		registerBrowserTools({
			registerTool: (def: { name: string; execute: (id: string, params: unknown) => Promise<unknown> }) => {
				tools.set(def.name, def);
			},
			on: (event: string, handler: () => Promise<void>) => {
				handlers.set(event, handler);
			},
		} as any);
		return { handlers, tools };
	}

	it("registers a session_shutdown hook", () => {
		const { handlers } = registerWithMocks();
		expect(handlers.has("session_shutdown")).toBe(true);
	});

	it("uses the browser-tools Playwright profile and closes context on session_shutdown", async () => {
		const { handlers, tools } = registerWithMocks();
		const shutdown = handlers.get("session_shutdown");
		expect(shutdown).toBeTypeOf("function");

		await tools.get("browser_navigate")!.execute("test-id", { url: "https://example.com" });
		expect(mockLaunchPersistentContext).toHaveBeenCalledWith(
			expect.stringMatching(/playwright-profile$/),
			expect.objectContaining({ headless: false }),
		);
		expect(mockLaunchPersistentContext).toHaveBeenCalledTimes(1);

		await shutdown!();
		expect(mockContextClose).toHaveBeenCalledTimes(1);

		mockContextClose.mockClear();
		await tools.get("browser_navigate")!.execute("test-id", { url: "https://example.com/docs" });
		expect(mockLaunchPersistentContext).toHaveBeenCalledTimes(2);
	});

	it("registers the new accessibility tools: browser_aria_snapshot, browser_highlight, browser_generate_locator", () => {
		const { tools } = registerWithMocks();
		expect(tools.has("browser_aria_snapshot")).toBe(true);
		expect(tools.has("browser_highlight")).toBe(true);
		expect(tools.has("browser_generate_locator")).toBe(true);
	});

	it("browser_aria_snapshot returns YAML accessibility tree with refs", async () => {
		const { tools } = registerWithMocks();
		const tool = tools.get("browser_aria_snapshot")!;
		await tools.get("browser_navigate")!.execute("test-id", { url: "https://example.com" });

		const result = await tool.execute("test-id", {}) as { content: Array<{ text: string }>; details: { yaml: string; elementCount: number } };
		expect(result.content[0].text).toContain("Accessibility tree for");
		expect(result.details.elementCount).toBe(3);
		expect(result.details.yaml).toContain("[ref=e2]");
	});

	it("browser_highlight scrolls element and returns confirmation", async () => {
		const { tools } = registerWithMocks();
		const tool = tools.get("browser_highlight")!;
		await tools.get("browser_navigate")!.execute("test-id", { url: "https://example.com" });

		const result = await tool.execute("test-id", { target: "ref=e2" }) as { content: Array<{ text: string }> };
		expect(result.content[0].text).toContain("Highlighted ref=e2");
	});

	it("browser_generate_locator returns locator strategies", async () => {
		const { tools } = registerWithMocks();
		const tool = tools.get("browser_generate_locator")!;
		await tools.get("browser_navigate")!.execute("test-id", { url: "https://example.com" });

		mockPageEvalResults.locatorResult = {
			"by-id": "#submit-btn",
			"by-aria-label": "[aria-label='Submit']",
		};

		const result = await tool.execute("test-id", { target: "ref=e2" }) as { content: Array<{ text: string }>; details: { locators: Record<string, string> } };
		expect(result.details.locators["by-id"]).toBe("#submit-btn");
		expect(result.content[0].text).toContain("Locators for ref=e2");
	});
});