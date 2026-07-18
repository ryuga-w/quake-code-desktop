/**
 * Collects mouse hit regions during a single render pass.
 */

import { type HitRegion, isMouseTarget } from "./spatial-index.js";
import type { Component } from "./tui.js";

export class MouseLayoutCollector {
	private regions: HitRegion[] = [];
	private lineCursor = 0;

	getRegions(): readonly HitRegion[] {
		return this.regions;
	}

	takeRegions(): HitRegion[] {
		const regions = this.regions;
		this.regions = [];
		this.lineCursor = 0;
		return regions;
	}

	collectChild(component: Component, width: number): string[] {
		const startLine = this.lineCursor;
		const lines = renderWithLayout(component, width, this);
		if (isMouseTarget(component)) {
			this.regions.push(
				...component.collectMouseRegions({
					startLine,
					width,
					lineCount: lines.length,
				}),
			);
		}
		this.lineCursor = startLine + lines.length;
		return lines;
	}
}

export function renderWithLayout(component: Component, width: number, layout?: MouseLayoutCollector): string[] {
	return layout ? component.render(width, layout) : component.render(width);
}
