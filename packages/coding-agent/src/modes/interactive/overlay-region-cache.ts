import type { HitRegion } from "@mrquake/quakecode-tui";

/** Caches overlay hit regions so hover re-renders skip redundant layout work. */
export class OverlayRegionCache {
	private width = -1;
	private key = "";
	private regions: HitRegion[] = [];

	get(width: number, key: string, build: () => HitRegion[]): HitRegion[] {
		if (width === this.width && key === this.key) {
			return this.regions;
		}
		this.width = width;
		this.key = key;
		this.regions = build();
		return this.regions;
	}

	invalidate(): void {
		this.width = -1;
		this.key = "";
		this.regions = [];
	}
}

export function mapOverlayHitMap(
	hitMap: ReadonlyArray<{ index: number; line: number }>,
	panelId: string,
	width: number,
	target: unknown,
): HitRegion[] {
	return hitMap.map(({ index, line }) => ({
		id: `overlay-item:${panelId}:${index}`,
		contentLineStart: line,
		contentLineEnd: line + 1,
		xStart: 0,
		xEnd: width,
		target,
	}));
}
