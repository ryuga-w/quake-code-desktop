/**
 * Render-time spatial index for terminal mouse hit-testing.
 */

import type { Component } from "./tui.js";

export interface HitRegion {
	id: string;
	/** Absolute content line (0-based, before viewport transform). */
	contentLineStart: number;
	/** Exclusive end line. */
	contentLineEnd: number;
	/** Inclusive start column; defaults to 0. */
	xStart?: number;
	/** Exclusive end column; defaults to content width. */
	xEnd?: number;
	/** When true, contentLineStart/End are screen rows (not document lines). */
	screenRelative?: boolean;
	target: unknown;
}

/** Overlay chrome (e.g. close button) exposed for screen-relative hit-testing. */
export interface OverlayChromeTarget {
	collectOverlayMouseRegions(width: number): HitRegion[];
	invokeClose(): void;
}

export function isOverlayChromeTarget(component: unknown): component is OverlayChromeTarget {
	return (
		typeof component === "object" &&
		component !== null &&
		typeof (component as OverlayChromeTarget).collectOverlayMouseRegions === "function" &&
		typeof (component as OverlayChromeTarget).invokeClose === "function"
	);
}

/** Overlay list/content interaction (hover, click, wheel) for modal panels. */
export interface OverlayInteractiveTarget {
	/** Hit regions relative to the overlay component's top-left (line 0). */
	collectOverlayContentRegions(width: number): HitRegion[];
	setMouseHoverIndex(index: number | null): void;
	selectMouseIndex(index: number): void;
	scrollByWheel(direction: "up" | "down"): void;
}

export function isOverlayInteractiveTarget(component: unknown): component is OverlayInteractiveTarget {
	return (
		typeof component === "object" &&
		component !== null &&
		typeof (component as OverlayInteractiveTarget).collectOverlayContentRegions === "function" &&
		typeof (component as OverlayInteractiveTarget).setMouseHoverIndex === "function" &&
		typeof (component as OverlayInteractiveTarget).selectMouseIndex === "function" &&
		typeof (component as OverlayInteractiveTarget).scrollByWheel === "function"
	);
}

export interface MouseCollectContext {
	startLine: number;
	width: number;
	/** Lines produced by the render pass that preceded collection. */
	lineCount: number;
}

export interface MouseTarget {
	collectMouseRegions(ctx: MouseCollectContext): HitRegion[];
}

export function isMouseTarget(component: Component): component is Component & MouseTarget {
	return typeof (component as unknown as MouseTarget).collectMouseRegions === "function";
}

export interface SpatialHit {
	region: HitRegion;
	contentLine: number;
}

export class SpatialIndex {
	private regions: HitRegion[] = [];

	clear(): void {
		this.regions = [];
	}

	addRegions(regions: HitRegion[]): void {
		this.regions.push(...regions);
	}

	replace(regions: HitRegion[]): void {
		this.regions = regions;
	}

	getRegions(): readonly HitRegion[] {
		return this.regions;
	}

	/**
	 * Hit-test a screen coordinate against cached regions.
	 * @param screenX - 0-based column on screen
	 * @param screenY - 0-based row on screen (viewport-relative)
	 * @param viewportStart - first visible content line
	 * @param scrollOffset - additional upward scroll (chat scroll)
	 * @param contentWidth - max x for hits (sidebar boundary)
	 */
	hitTest(
		screenX: number,
		screenY: number,
		viewportStart: number,
		scrollOffset = 0,
		contentWidth?: number,
	): SpatialHit | undefined {
		const contentLine = viewportStart - scrollOffset + screenY;

		for (const region of this.regions) {
			if (!region.screenRelative && contentWidth !== undefined && screenX >= contentWidth) {
				continue;
			}

			// Screen-relative regions (overlays) use viewport rows; chat scroll offset does not apply.
			const line = region.screenRelative ? screenY : contentLine;
			if (line < region.contentLineStart || line >= region.contentLineEnd) {
				continue;
			}
			const xStart = region.xStart ?? 0;
			const xEnd = region.xEnd ?? Number.POSITIVE_INFINITY;
			if (screenX < xStart || screenX >= xEnd) {
				continue;
			}
			return { region, contentLine: line };
		}

		return undefined;
	}
}
