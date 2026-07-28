type AnimationSubscriber = () => void;

export interface SharedAnimationClock {
	subscribe(subscriber: AnimationSubscriber): () => void;
	getSubscriberCount(): number;
}

/**
 * Shared animation clock with reference-counted lifecycle.
 * Components subscribe while visible and the underlying timer only runs when needed.
 */
export function createSharedAnimationClock(intervalMs: number): SharedAnimationClock {
	const subscribers = new Set<AnimationSubscriber>();
	let timer: NodeJS.Timeout | undefined;

	const stopTimerIfIdle = () => {
		if (subscribers.size === 0 && timer) {
			clearInterval(timer);
			timer = undefined;
		}
	};

	const ensureTimer = () => {
		if (timer) return;
		timer = setInterval(() => {
			for (const subscriber of [...subscribers]) {
				subscriber();
			}
			stopTimerIfIdle();
		}, intervalMs);
	};

	return {
		subscribe(subscriber: AnimationSubscriber): () => void {
			subscribers.add(subscriber);
			ensureTimer();
			return () => {
				subscribers.delete(subscriber);
				stopTimerIfIdle();
			};
		},
		getSubscriberCount(): number {
			return subscribers.size;
		},
	};
}
