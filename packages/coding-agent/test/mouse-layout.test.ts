import {
	type Component,
	Container,
	MouseLayoutCollector,
	type RenderContext,
	Spacer,
	type TUI,
} from "@mrquake/quakecode-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { ToolDefinition } from "../src/core/extensions/types.js";
import { createReadToolDefinition } from "../src/core/tools/read.js";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.js";
import { MouseLayoutBuilder } from "../src/modes/interactive/mouse-layout.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function createFakeTui(): TUI {
	return {
		requestRender: () => {},
	} as unknown as TUI;
}

function createContext(overrides: Partial<RenderContext> = {}): RenderContext {
	return {
		width: 80,
		height: 24,
		totalLines: 100,
		viewportStart: 76,
		viewportScrollOffset: 0,
		mouseRegions: [],
		overlayMouseRegions: [],
		overlayContentRegions: [],
		...overrides,
	};
}

function rebuildFromSections(
	builder: MouseLayoutBuilder,
	sections: Component[],
	width: number,
	overrides: Partial<RenderContext> = {},
): void {
	const collector = new MouseLayoutCollector();
	let line = 0;
	for (const section of sections) {
		const sectionLines = collector.collectChild(section, width);
		line += sectionLines.length;
	}
	builder.rebuild(
		createContext({
			width,
			totalLines: line,
			viewportStart: Math.max(0, line - 24),
			mouseRegions: collector.takeRegions(),
			...overrides,
		}),
	);
}

describe("MouseLayoutBuilder", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("indexes compact tool lines for cache lookup", () => {
		const header = new Container();
		header.addChild(new Spacer(2));
		const chat = new Container();
		const main = new Container();
		main.addChild(chat);
		const footer = new Container();
		footer.addChild(new Spacer(1));

		const tools: ToolExecutionComponent[] = [];
		for (let i = 0; i < 5; i++) {
			const tool = new ToolExecutionComponent(
				"read",
				`tool-${i}`,
				{ path: `file-${i}.md` },
				{},
				createReadToolDefinition(process.cwd()),
				createFakeTui(),
			);
			tool.render(60);
			chat.addChild(tool);
			tools.push(tool);
		}

		const mainSplit = {
			render: (width: number, layout?: MouseLayoutCollector) => main.render(width, layout),
			invalidate: () => main.invalidate(),
		};

		const builder = new MouseLayoutBuilder({
			getContentWidth: () => 60,
		});

		const sections = [header, mainSplit, footer];
		rebuildFromSections(builder, sections, 80);

		const hit = builder.hitTestTool(4, 2);
		expect(hit).toBe(tools[0]);
	});

	test("hitTest does not apply an already-rendered viewport offset twice", () => {
		const chat = new Container();
		chat.addChild(new Spacer(100));
		const main = new Container();
		main.addChild(chat);
		const header = new Container();
		const footer = new Container();

		const tool = new ToolExecutionComponent(
			"read",
			"scroll-tool",
			{ path: "a.md" },
			{},
			createReadToolDefinition(process.cwd()),
			createFakeTui(),
		);
		tool.render(60);
		chat.addChild(tool);

		const mainSplit = {
			render: (width: number, layout?: MouseLayoutCollector) => main.render(width, layout),
			invalidate: () => main.invalidate(),
		};

		const builder = new MouseLayoutBuilder({
			getContentWidth: () => 60,
		});

		rebuildFromSections(builder, [header, mainSplit, footer], 80, {
			totalLines: 200,
			// Bottom viewport would start at 100; scrolling up by 5 makes 95 the
			// actual first visible content line reported by TUI.
			viewportStart: 95,
			viewportScrollOffset: 5,
			height: 24,
		});

		const hit = builder.hitTestTool(2, 5);
		expect(hit).toBe(tool);
	});

	test("hitTest stays fast with 500 tool regions", () => {
		const chat = new Container();
		const main = new Container();
		main.addChild(chat);
		const header = new Container();
		const footer = new Container();

		for (let i = 0; i < 500; i++) {
			const tool = new ToolExecutionComponent(
				"read",
				`perf-${i}`,
				{ path: `f-${i}.md` },
				{},
				createReadToolDefinition(process.cwd()),
				createFakeTui(),
			);
			tool.render(60);
			chat.addChild(tool);
		}

		const mainSplit = {
			render: (width: number, layout?: MouseLayoutCollector) => main.render(width, layout),
			invalidate: () => main.invalidate(),
		};

		const builder = new MouseLayoutBuilder({
			getContentWidth: () => 60,
		});

		rebuildFromSections(builder, [header, mainSplit, footer], 80);

		const start = performance.now();
		for (let i = 0; i < 1000; i++) {
			builder.hitTestTool(2, 1);
		}
		const elapsed = performance.now() - start;
		expect(elapsed).toBeLessThan(50);
	});

	test("screen-relative overlay regions ignore chat scroll offset", () => {
		const builder = new MouseLayoutBuilder({ getContentWidth: () => 80 });
		builder.rebuild(
			createContext({
				overlayContentRegions: [
					{
						id: "overlay-item:settings:0",
						contentLineStart: 8,
						contentLineEnd: 9,
						screenRelative: true,
						target: {},
					},
				],
			}),
		);
		const hit = builder.hitTest(10, 8);
		expect(hit?.region.id).toBe("overlay-item:settings:0");

		builder.rebuild(
			createContext({
				viewportScrollOffset: 40,
				overlayContentRegions: [
					{
						id: "overlay-item:settings:0",
						contentLineStart: 8,
						contentLineEnd: 9,
						screenRelative: true,
						target: {},
					},
				],
			}),
		);
		expect(builder.hitTest(10, 8)?.region.id).toBe("overlay-item:settings:0");
	});

	test("hasHoverTargets detects interactive mouse regions", () => {
		const builder = new MouseLayoutBuilder({ getContentWidth: () => 80 });
		builder.rebuild(createContext());
		expect(builder.hasHoverTargets()).toBe(false);

		builder.rebuild(
			createContext({
				mouseRegions: [{ id: "tool:1", contentLineStart: 1, contentLineEnd: 2, target: {} }],
			}),
		);
		expect(builder.hasHoverTargets()).toBe(true);
	});

	test("rebuild does not re-render components when regions are pre-collected", () => {
		const chat = new Container();
		const tool = new ToolExecutionComponent(
			"read",
			"no-rerender",
			{ path: "a.md" },
			{},
			createReadToolDefinition(process.cwd()),
			createFakeTui(),
		);
		tool.render(60);
		chat.addChild(tool);

		const builder = new MouseLayoutBuilder({ getContentWidth: () => 60 });

		const collector = new MouseLayoutCollector();
		const lines = collector.collectChild(chat, 60);
		const regions = collector.takeRegions();

		const renderSpy = vi.spyOn(tool, "render");
		builder.rebuild(
			createContext({
				totalLines: lines.length,
				mouseRegions: regions,
			}),
		);

		expect(renderSpy).not.toHaveBeenCalled();
		renderSpy.mockRestore();
	});
});
