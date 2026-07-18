import { type RenderContext, SpatialIndex } from "@mrquake/quakecode-tui";
import { ToolExecutionComponent } from "./components/tool-execution.js";

export interface MouseLayoutDeps {
	getContentWidth: (totalWidth: number) => number;
}

export class MouseLayoutBuilder {
	private readonly index = new SpatialIndex();
	private lastContext: RenderContext | null = null;

	constructor(private readonly deps: MouseLayoutDeps) {}

	rebuild(ctx: RenderContext): void {
		this.lastContext = ctx;
		this.index.replace([...ctx.mouseRegions, ...ctx.overlayMouseRegions, ...ctx.overlayContentRegions]);
	}

	hitTest(screenX: number, screenY: number) {
		if (!this.lastContext) return undefined;
		const ctx = this.lastContext;
		const contentWidth = this.deps.getContentWidth(ctx.width);
		// RenderContext.viewportStart already points at the first visible line after
		// application scrolling. Passing viewportScrollOffset again would subtract it
		// twice and make mouse targets drift upward after every wheel tick.
		return this.index.hitTest(screenX, screenY, ctx.viewportStart, 0, contentWidth);
	}

	hitTestTool(screenX: number, screenY: number): ToolExecutionComponent | undefined {
		const hit = this.hitTest(screenX, screenY);
		if (!hit) return undefined;
		const target = hit.region.target;
		if (!(target instanceof ToolExecutionComponent)) return undefined;
		const localLine = hit.contentLine - hit.region.contentLineStart;
		return target.isMouseLineClickable(localLine) ? target : undefined;
	}

	getIndex(): SpatialIndex {
		return this.index;
	}

	/** True when the layout has regions that support mouse hover highlighting. */
	hasHoverTargets(): boolean {
		return this.index.getRegions().some((region) => {
			const id = region.id;
			return (
				id.startsWith("tool:") ||
				id.startsWith("welcome:") ||
				id.startsWith("autocomplete:") ||
				id.startsWith("overlay-item:") ||
				id === "overlay:close"
			);
		});
	}
}
