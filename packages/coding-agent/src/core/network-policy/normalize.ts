/** Normalize host for network policy matching (lowercase, strip brackets/port). */

export function normalizeHost(host: string): string {
	let h = String(host || "")
		.trim()
		.toLowerCase();
	if (!h) return "";
	// [ipv6]
	if (h.startsWith("[") && h.includes("]")) {
		h = h.slice(1, h.indexOf("]"));
	}
	// strip trailing path junk
	h = h.replace(/\/.*$/, "");
	// host:port (not ipv6)
	if (h.includes(":") && !h.includes("::") && /^[^:]+:\d+$/.test(h)) {
		h = h.replace(/:\d+$/, "");
	}
	// strip userinfo
	if (h.includes("@")) h = h.split("@").pop() || h;
	return h;
}

/** Exact match or *.suffix style */
export function hostMatches(candidate: string, rule: string): boolean {
	const c = normalizeHost(candidate);
	const r = normalizeHost(rule);
	if (!c || !r) return false;
	if (c === r) return true;
	if (r.startsWith("*.")) {
		const suffix = r.slice(1); // .example.com
		return c.endsWith(suffix) || c === r.slice(2);
	}
	return false;
}
