export type ProviderErrorCategory = "quota_exhausted" | "transient_rate_limit" | "other";

export type ProviderErrorClassification = {
	category: ProviderErrorCategory;
	exhaustedUntil?: number;
};

const QUOTA_PATTERNS = [
	/usage_limit_reached/i,
	/usage_not_included/i,
	/resource[_\s-]?exhausted/i,
	/quota will reset/i,
	/hit your .*usage limit/i,
	/usage limit.*reached/i,
	/you have hit your/i,
	/rate_limit_exceeded.*plan/i,
];

const TRANSIENT_RATE_LIMIT_PATTERNS = [
	/overloaded/i,
	/service.?unavailable/i,
	/too many requests/i,
	/\b429\b/,
	/\b503\b/,
	/\b502\b/,
	/retry delay/i,
	/please retry in \d/i,
];

function parseDurationResetAfter(message: string): number | undefined {
	const durationMatch = message.match(/reset after (?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
	if (!durationMatch) return undefined;
	const hours = durationMatch[1] ? Number.parseInt(durationMatch[1], 10) : 0;
	const minutes = durationMatch[2] ? Number.parseInt(durationMatch[2], 10) : 0;
	const seconds = Number.parseFloat(durationMatch[3]!);
	if (!Number.isFinite(seconds)) return undefined;
	return Date.now() + ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

function parseMinutesUntilRetry(message: string): number | undefined {
	const match = message.match(/try again in ~?(\d+)\s*min/i);
	if (!match?.[1]) return undefined;
	const minutes = Number.parseInt(match[1], 10);
	if (!Number.isFinite(minutes)) return undefined;
	return Date.now() + minutes * 60_000;
}

export function parseQuotaResetTime(message: string): number | undefined {
	return parseDurationResetAfter(message) ?? parseMinutesUntilRetry(message);
}

export function classifyProviderErrorMessage(message: string): ProviderErrorClassification {
	const text = message.trim();
	if (!text) return { category: "other" };

	if (QUOTA_PATTERNS.some((pattern) => pattern.test(text))) {
		return {
			category: "quota_exhausted",
			exhaustedUntil: parseQuotaResetTime(text),
		};
	}

	if (/rate.?limit|rate_limit_exceeded/i.test(text)) {
		const exhaustedUntil = parseQuotaResetTime(text);
		if (exhaustedUntil && exhaustedUntil - Date.now() > 5 * 60_000) {
			return { category: "quota_exhausted", exhaustedUntil };
		}
		return { category: "transient_rate_limit" };
	}

	if (TRANSIENT_RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))) {
		return { category: "transient_rate_limit" };
	}

	return { category: "other" };
}

export function isQuotaExhaustedErrorMessage(message: string): boolean {
	return classifyProviderErrorMessage(message).category === "quota_exhausted";
}