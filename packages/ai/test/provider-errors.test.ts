import { describe, expect, test } from "vitest";
import { classifyProviderErrorMessage, isQuotaExhaustedErrorMessage } from "../src/utils/provider-errors.js";

describe("provider-errors", () => {
	test("detects ChatGPT usage limit as quota exhausted", () => {
		const result = classifyProviderErrorMessage(
			"You have hit your ChatGPT usage limit (plus plan). Try again in ~42 min.",
		);
		expect(result.category).toBe("quota_exhausted");
		expect(result.exhaustedUntil).toBeGreaterThan(Date.now());
	});

	test("detects Gemini quota reset message", () => {
		const result = classifyProviderErrorMessage("Your quota will reset after 18h31m10s");
		expect(result.category).toBe("quota_exhausted");
	});

	test("treats overloaded as transient rate limit", () => {
		expect(classifyProviderErrorMessage("overloaded_error").category).toBe("transient_rate_limit");
	});

	test("isQuotaExhaustedErrorMessage helper", () => {
		expect(isQuotaExhaustedErrorMessage("usage_limit_reached")).toBe(true);
		expect(isQuotaExhaustedErrorMessage("overloaded_error")).toBe(false);
	});
});