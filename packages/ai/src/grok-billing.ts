import { ensureFreshGrokAuthToken, getGrokAuthToken, getGrokCliVersion } from "./grok-auth.js";

/** Reverse-engineered from Grok web UI: display credits = API raw units / 187.5 */
export const GROK_CREDITS_SCALE = 187.5;

const BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing";
const FETCH_TIMEOUT_MS = 15_000;
const BILLING_CACHE_TTL_MS = 60_000;

type ValField = { val?: number };

type GrokBillingResponse = {
	config?: {
		monthlyLimit?: ValField;
		used?: ValField;
		onDemandCap?: ValField;
		billingPeriodStart?: string;
		billingPeriodEnd?: string;
	};
};

export type GrokBillingInfo = {
	available: boolean;
	monthlyLimitRaw: number;
	usedRaw: number;
	remainingRaw: number;
	percentUsed: number;
	creditsLimit: number;
	creditsUsed: number;
	creditsRemaining: number;
	onDemandCapCredits?: number;
	billingPeriodStart?: string;
	billingPeriodEnd?: string;
	resetAt?: Date;
	error?: string;
};

let cachedBilling: { fetchedAt: number; info: GrokBillingInfo } | null = null;

function grokCliHeaders(token: string): Record<string, string> {
	const version = getGrokCliVersion();
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/json",
		"User-Agent": `GrokBuild/${version}`,
		"X-XAI-Token-Auth": "xai-grok-cli",
		"x-grok-client-version": version,
	};
}

function readVal(field: ValField | undefined): number {
	return typeof field?.val === "number" && Number.isFinite(field.val) ? field.val : 0;
}

function rawToCredits(raw: number): number {
	return Math.round((raw / GROK_CREDITS_SCALE) * 100) / 100;
}

function buildBillingInfo(config: GrokBillingResponse["config"]): GrokBillingInfo {
	const monthlyLimitRaw = readVal(config?.monthlyLimit);
	const usedRaw = readVal(config?.used);
	const remainingRaw = Math.max(0, monthlyLimitRaw - usedRaw);
	const percentUsed = monthlyLimitRaw > 0 ? Math.round((usedRaw / monthlyLimitRaw) * 1000) / 10 : 0;
	const onDemandCapRaw = readVal(config?.onDemandCap);
	const billingPeriodEnd = config?.billingPeriodEnd;
	const resetAt = billingPeriodEnd ? new Date(billingPeriodEnd) : undefined;

	return {
		available: monthlyLimitRaw > 0,
		monthlyLimitRaw,
		usedRaw,
		remainingRaw,
		percentUsed,
		creditsLimit: rawToCredits(monthlyLimitRaw),
		creditsUsed: rawToCredits(usedRaw),
		creditsRemaining: rawToCredits(remainingRaw),
		onDemandCapCredits: onDemandCapRaw > 0 ? rawToCredits(onDemandCapRaw) : undefined,
		billingPeriodStart: config?.billingPeriodStart,
		billingPeriodEnd,
		resetAt: resetAt && !Number.isNaN(resetAt.getTime()) ? resetAt : undefined,
	};
}

/** SuperGrok / Grok CLI monthly credit usage from cli-chat-proxy. */
export async function getGrokBilling(options: { force?: boolean } = {}): Promise<GrokBillingInfo> {
	if (!options.force && cachedBilling && Date.now() - cachedBilling.fetchedAt < BILLING_CACHE_TTL_MS) {
		return cachedBilling.info;
	}

	const token = (await ensureFreshGrokAuthToken()) || getGrokAuthToken();
	if (!token) {
		return {
			available: false,
			monthlyLimitRaw: 0,
			usedRaw: 0,
			remainingRaw: 0,
			percentUsed: 0,
			creditsLimit: 0,
			creditsUsed: 0,
			creditsRemaining: 0,
			error: "No Grok auth token",
		};
	}

	try {
		const response = await fetch(BILLING_URL, {
			headers: grokCliHeaders(token),
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			const info: GrokBillingInfo = {
				available: false,
				monthlyLimitRaw: 0,
				usedRaw: 0,
				remainingRaw: 0,
				percentUsed: 0,
				creditsLimit: 0,
				creditsUsed: 0,
				creditsRemaining: 0,
				error: `Billing API HTTP ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
			};
			cachedBilling = { fetchedAt: Date.now(), info };
			return info;
		}

		const payload = (await response.json()) as GrokBillingResponse;
		const info = buildBillingInfo(payload.config);
		cachedBilling = { fetchedAt: Date.now(), info };
		return info;
	} catch (error) {
		const info: GrokBillingInfo = {
			available: false,
			monthlyLimitRaw: 0,
			usedRaw: 0,
			remainingRaw: 0,
			percentUsed: 0,
			creditsLimit: 0,
			creditsUsed: 0,
			creditsRemaining: 0,
			error: error instanceof Error ? error.message : String(error),
		};
		cachedBilling = { fetchedAt: Date.now(), info };
		return info;
	}
}

export function clearGrokBillingCache(): void {
	cachedBilling = null;
}
