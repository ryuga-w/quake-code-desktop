/**
 * Codex guard.rs — rate-limit gate before memories startup.
 * Without Codex backend auth we accept an injectable snapshot (tests + host wiring).
 */

export interface RateLimitWindow {
	used_percent: number;
}

export interface RateLimitSnapshot {
	limit_id?: string;
	rate_limit_reached_type?: string | null;
	primary?: RateLimitWindow | null;
	secondary?: RateLimitWindow | null;
}

export interface RateLimitProvider {
	getSnapshots(): RateLimitSnapshot[] | Promise<RateLimitSnapshot[]>;
}

export function windowAllowsStartup(
	window: RateLimitWindow | null | undefined,
	maxUsedPercent: number,
): boolean {
	if (!window) return true;
	return window.used_percent <= maxUsedPercent;
}

export function snapshotAllowsStartup(
	snapshot: RateLimitSnapshot,
	minRemainingPercent: number,
): boolean {
	if (snapshot.rate_limit_reached_type) return false;
	const maxUsed = 100 - Math.min(100, Math.max(0, minRemainingPercent));
	return (
		windowAllowsStartup(snapshot.primary, maxUsed) &&
		windowAllowsStartup(snapshot.secondary, maxUsed)
	);
}

/**
 * Returns true if startup should proceed.
 * No provider → allow (Codex: non-codex auth returns None → unwrap_or true).
 */
export async function rateLimitsOk(
	provider: RateLimitProvider | undefined,
	minRemainingPercent: number,
): Promise<boolean> {
	if (!provider) return true;
	try {
		const snapshots = await provider.getSnapshots();
		if (!snapshots?.length) return true;
		const snapshot =
			snapshots.find((s) => s.limit_id === "codex" || s.limit_id === "quake") || snapshots[0];
		return snapshotAllowsStartup(snapshot, minRemainingPercent);
	} catch {
		return true;
	}
}
