/**
 * Session + optional durable host allow/deny policy.
 * Policy-level only — not a transparent proxy.
 *
 * Session clear (NetworkPolicyStore.clear) must NOT wipe durable hosts.
 * Durable hosts are wired via setDurableHostChecker from:
 * - S-NET.1 network-hosts.json (~/.quake-code/agent/network-hosts.json)
 * - S-TRUST.1 guardian-always.json hosts (composed as extra checker)
 */
import { hostMatches, normalizeHost } from "./normalize.js";

export type HostDecision = "allow" | "deny" | "ask";

export type DurableHostChecker = {
	isAllowed: (host: string) => boolean;
	isDenied: (host: string) => boolean;
};

export class NetworkPolicyStore {
	/** Session-scoped allows (cleared by clear / clearSessionApprovals). */
	private allowed = new Set<string>();
	/** Session-scoped denials. */
	private denied = new Set<string>();
	/** Optional durable layer (single source: guardian-always.json hosts). */
	private durableChecker?: DurableHostChecker;

	/**
	 * Wire durable host allow/deny (guardian durable-allows).
	 * One network durable API — do not duplicate host lists elsewhere.
	 */
	setDurableHostChecker(checker: DurableHostChecker | undefined): void {
		this.durableChecker = checker;
	}

	/**
	 * Clear session host rules only.
	 * Durable guardian host allows/denies are NOT cleared here.
	 */
	clear(): void {
		this.allowed.clear();
		this.denied.clear();
	}

	allowHost(host: string): void {
		const h = normalizeHost(host);
		if (!h) return;
		this.denied.delete(h);
		this.allowed.add(h);
	}

	denyHost(host: string): void {
		const h = normalizeHost(host);
		if (!h) return;
		this.allowed.delete(h);
		this.denied.add(h);
	}

	isAllowed(host: string): boolean {
		const h = normalizeHost(host);
		if (!h) return false;
		for (const rule of this.allowed) {
			if (hostMatches(h, rule)) return true;
		}
		if (this.durableChecker?.isAllowed(h)) return true;
		return false;
	}

	isDenied(host: string): boolean {
		const h = normalizeHost(host);
		if (!h) return false;
		for (const rule of this.denied) {
			if (hostMatches(h, rule)) return true;
		}
		if (this.durableChecker?.isDenied(h)) return true;
		return false;
	}

	evaluateHost(host: string): HostDecision {
		if (this.isDenied(host)) return "deny";
		if (this.isAllowed(host)) return "allow";
		return "ask";
	}

	/** Evaluate multiple hosts: deny wins; ask if any needs approval; allow only if all allowed. */
	evaluateHosts(hosts: string[]): HostDecision {
		if (!hosts.length) return "allow";
		let anyAsk = false;
		for (const host of hosts) {
			const d = this.evaluateHost(host);
			if (d === "deny") return "deny";
			if (d === "ask") anyAsk = true;
		}
		return anyAsk ? "ask" : "allow";
	}

	/** Session-only snapshot (does not include durable hosts). */
	snapshot(): { allowed: string[]; denied: string[] } {
		return { allowed: [...this.allowed], denied: [...this.denied] };
	}
}

export const sessionNetworkPolicy = new NetworkPolicyStore();
