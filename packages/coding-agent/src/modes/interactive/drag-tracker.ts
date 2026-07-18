export interface DragPoint {
	x: number;
	y: number;
}

export interface DragSession {
	start: DragPoint;
	current: DragPoint;
	elapsedMs: number;
}

export interface DragTrackerOptions {
	distanceThreshold?: number;
	timeThresholdMs?: number;
	onDragStart?: (session: DragSession) => void;
	onDrag?: (session: DragSession) => void;
	onDragEnd?: (session: DragSession) => void;
	onClick?: (point: DragPoint) => void;
}

const DEFAULT_DISTANCE = 4;
// Time alone must NOT promote a stationary press to a drag, otherwise a slow or
// deliberate click (press, brief pause, release in place) is misread as a drag
// and the click is lost. A drag requires actual pointer movement; the time
// threshold only matters once the pointer has also moved a little.
const DEFAULT_TIME_MS = 400;
const MIN_MOVE_FOR_TIMED_DRAG = 2;

export class DragTracker {
	private pending: (DragPoint & { at: number }) | undefined;
	private dragging = false;

	constructor(private readonly options: DragTrackerOptions = {}) {}

	reset(): void {
		this.pending = undefined;
		this.dragging = false;
	}

	onPointerDown(point: DragPoint): void {
		this.pending = { ...point, at: Date.now() };
		this.dragging = false;
	}

	onPointerMove(point: DragPoint): boolean {
		if (!this.pending) return false;
		const session = this.session(point);
		if (!this.dragging && this.isDrag(session)) {
			this.dragging = true;
			this.options.onDragStart?.(session);
		}
		if (this.dragging) {
			this.options.onDrag?.(session);
			return true;
		}
		return false;
	}

	onPointerUp(point: DragPoint): "click" | "drag" | undefined {
		if (!this.pending) return undefined;
		const session = this.session(point);
		const wasDrag = this.dragging || this.isDrag(session);
		this.pending = undefined;
		if (wasDrag) {
			this.dragging = false;
			this.options.onDragEnd?.(session);
			return "drag";
		}
		this.options.onClick?.(point);
		return "click";
	}

	private session(point: DragPoint): DragSession {
		const start = this.pending!;
		return {
			start: { x: start.x, y: start.y },
			current: point,
			elapsedMs: Date.now() - start.at,
		};
	}

	private isDrag(session: DragSession): boolean {
		const distance = Math.max(
			Math.abs(session.current.x - session.start.x),
			Math.abs(session.current.y - session.start.y),
		);
		const distanceThreshold = this.options.distanceThreshold ?? DEFAULT_DISTANCE;
		const timeThreshold = this.options.timeThresholdMs ?? DEFAULT_TIME_MS;
		// Primary signal: the pointer clearly moved.
		if (distance > distanceThreshold) return true;
		// Secondary: a long hold counts as a drag only if the pointer also drifted a
		// little (a true slow drag), never for a perfectly stationary long press.
		return distance >= MIN_MOVE_FOR_TIMED_DRAG && session.elapsedMs > timeThreshold;
	}
}
