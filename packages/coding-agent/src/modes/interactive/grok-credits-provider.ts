import { getGrokAuthInfo, getGrokBilling } from "@mrquake/quakecode-ai";
import { theme } from "./theme/theme.js";

const REFRESH_INTERVAL_MS = 3_000;

export class GrokCreditsProvider {
	private display: string | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private refreshInFlight = false;
	private pendingRefresh = false;
	private callbacks = new Set<() => void>();
	private disposed = false;

	start(): void {
		if (this.disposed || this.timer) return;
		void this.refresh();
		this.timer = setInterval(() => {
			void this.refresh();
		}, REFRESH_INTERVAL_MS);
	}

	onChange(callback: () => void): () => void {
		this.callbacks.add(callback);
		return () => this.callbacks.delete(callback);
	}

	getDisplay(): string | null {
		return this.display;
	}

	async refresh(force = false): Promise<void> {
		if (this.disposed) return;
		if (this.refreshInFlight) {
			if (force) this.pendingRefresh = true;
			return;
		}
		this.refreshInFlight = true;
		try {
			const auth = getGrokAuthInfo();
			if (!auth.configured || auth.tokenSource === "xai-env") {
				this.setDisplay(null);
				return;
			}

			const billing = await getGrokBilling({ force: true });
			if (!billing.available || billing.error) {
				this.setDisplay(null);
				return;
			}

			const remaining = billing.creditsRemaining.toFixed(1);
			const limit = billing.creditsLimit.toFixed(0);
			const tone = billing.percentUsed >= 90 ? "error" : billing.percentUsed >= 70 ? "warning" : "success";
			let expirySuffix = "";
			if (auth.expiresAt) {
				const msLeft = auth.expiresAt.getTime() - Date.now();
				if (msLeft <= 0) {
					expirySuffix = ` · ${theme.fg("error", "token expired — grok login")}`;
				} else if (msLeft < 24 * 60 * 60 * 1000) {
					const hours = Math.max(1, Math.ceil(msLeft / (60 * 60 * 1000)));
					expirySuffix = ` · ${theme.fg("warning", `expires ~${hours}h`)}`;
				}
			}
			this.setDisplay(
				`${theme.fg("muted", "grok")} ${theme.fg(tone, `${remaining}`)} ${theme.fg("dim", `/ ${limit} kredi`)} · ${theme.fg("dim", `%${billing.percentUsed}`)}${expirySuffix}`,
			);
		} catch {
			this.setDisplay(null);
		} finally {
			this.refreshInFlight = false;
			if (this.pendingRefresh) {
				this.pendingRefresh = false;
				void this.refresh(true);
			}
		}
	}

	dispose(): void {
		this.disposed = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.callbacks.clear();
		this.display = null;
	}

	private setDisplay(next: string | null): void {
		if (this.display === next) return;
		this.display = next;
		for (const callback of this.callbacks) callback();
	}
}
