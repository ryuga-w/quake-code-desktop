import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/grok-auth.js", () => ({
	ensureFreshGrokAuthToken: vi.fn(async () => "test-token"),
	getGrokAuthToken: vi.fn(() => "test-token"),
	getGrokCliVersion: vi.fn(() => "0.2.64"),
}));

import { clearGrokBillingCache, GROK_CREDITS_SCALE, getGrokBilling } from "../src/grok-billing.js";

describe("grok-billing", () => {
	afterEach(() => {
		clearGrokBillingCache();
		vi.unstubAllGlobals();
	});

	it("converts raw billing units to display credits", () => {
		expect(GROK_CREDITS_SCALE).toBe(187.5);
		expect(15000 / GROK_CREDITS_SCALE).toBe(80);
		expect(4213 / GROK_CREDITS_SCALE).toBeCloseTo(22.47, 2);
	});

	it("parses cli-chat-proxy billing response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							config: {
								monthlyLimit: { val: 15000 },
								used: { val: 4213 },
								onDemandCap: { val: 1875 },
								billingPeriodStart: "2026-06-01T00:00:00+00:00",
								billingPeriodEnd: "2026-07-01T00:00:00+00:00",
							},
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					),
			),
		);

		const billing = await getGrokBilling({ force: true });

		expect(billing.available).toBe(true);
		expect(billing.percentUsed).toBeCloseTo(28.1, 1);
		expect(billing.creditsLimit).toBe(80);
		expect(billing.creditsUsed).toBeCloseTo(22.47, 2);
		expect(billing.creditsRemaining).toBeCloseTo(57.53, 2);
		expect(billing.onDemandCapCredits).toBe(10);
		expect(billing.resetAt?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
	});
});
