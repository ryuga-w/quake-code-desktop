import { describe, expect, test } from "vitest";
import {
	findNextAvailableAccountId,
	getActiveAccountId,
	listAccountSummaries,
	wrapLegacyCredential,
} from "../src/core/account-pool.js";

describe("account-pool", () => {
	test("wrapLegacyCredential creates a single-account pool", () => {
		const pool = wrapLegacyCredential({ type: "api_key", key: "sk-test" });
		expect(pool.type).toBe("account_pool");
		expect(Object.keys(pool.accounts)).toHaveLength(1);
		expect(getActiveAccountId(pool)).toBeDefined();
	});

	test("findNextAvailableAccountId skips exhausted accounts", () => {
		const pool = wrapLegacyCredential({ type: "api_key", key: "a" });
		const [first, second] = Object.keys(pool.accounts);
		pool.accounts[second] = {
			label: "second",
			kind: "api_key",
			credential: { type: "api_key", key: "b" },
		};
		pool.rotation.order = [first!, second!];
		pool.activeAccountId = first!;
		pool.accounts[first!]!.exhaustedUntil = Date.now() + 60_000;
		pool.accounts[second!]!.exhaustedUntil = Date.now() + 60_000;

		const next = findNextAvailableAccountId(pool);
		expect(next).toBeUndefined();
	});

	test("listAccountSummaries marks active account", () => {
		const pool = wrapLegacyCredential({ type: "oauth", access: "a", refresh: "r", expires: Date.now() + 1000 });
		const summaries = listAccountSummaries(pool);
		expect(summaries).toHaveLength(1);
		expect(summaries[0]?.isActive).toBe(true);
	});
});