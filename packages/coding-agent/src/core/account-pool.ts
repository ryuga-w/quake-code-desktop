import { randomUUID } from "node:crypto";
import type { ApiKeyCredential, OAuthCredential } from "./auth-storage.js";

export type CloudBedrockCredential = {
	awsProfile?: string;
	accessKeyId?: string;
	secretAccessKey?: string;
	bearerToken?: string;
	region?: string;
};

export type CloudVertexCredential = {
	project: string;
	location: string;
	credentialsPath?: string;
	apiKey?: string;
};

export type CloudAzureCredential = {
	apiKey: string;
	baseUrl?: string;
	resourceName?: string;
	apiVersion?: string;
};

export type PooledAccountKind = "oauth" | "api_key" | "cloud_bedrock" | "cloud_vertex" | "cloud_azure";

export type PooledAccountCredential =
	| ApiKeyCredential
	| OAuthCredential
	| CloudBedrockCredential
	| CloudVertexCredential
	| CloudAzureCredential;

export type PooledAccount = {
	label: string;
	kind: PooledAccountKind;
	credential: PooledAccountCredential;
	exhaustedUntil?: number | null;
	lastUsedAt?: number;
};

export type AccountPoolRotation = {
	enabled: boolean;
	order: string[];
};

export type AccountPoolCredential = {
	type: "account_pool";
	activeAccountId: string;
	rotation: AccountPoolRotation;
	accounts: Record<string, PooledAccount>;
};

export type StoredProviderCredential = ApiKeyCredential | OAuthCredential | AccountPoolCredential;

export type PooledAccountSummary = {
	accountId: string;
	label: string;
	kind: PooledAccountKind;
	isActive: boolean;
	exhaustedUntil?: number | null;
	lastUsedAt?: number;
};

export function isAccountPool(credential: StoredProviderCredential | undefined): credential is AccountPoolCredential {
	return credential?.type === "account_pool";
}

export function inferAccountKind(credential: ApiKeyCredential | OAuthCredential): PooledAccountKind {
	return credential.type === "oauth" ? "oauth" : "api_key";
}

export function inferAccountLabel(credential: ApiKeyCredential | OAuthCredential): string {
	if (credential.type === "oauth") {
		const record = credential as OAuthCredential & Record<string, unknown>;
		if (typeof record.email === "string" && record.email) return record.email;
		if (typeof record.login === "string" && record.login) return record.login;
		if (typeof record.account === "string" && record.account) return record.account;
		if (typeof record.accountId === "string" && record.accountId) return record.accountId;
		return "OAuth hesabı";
	}
	return "API key";
}

export function wrapLegacyCredential(credential: ApiKeyCredential | OAuthCredential): AccountPoolCredential {
	const accountId = randomUUID();
	return {
		type: "account_pool",
		activeAccountId: accountId,
		rotation: { enabled: true, order: [accountId] },
		accounts: {
			[accountId]: {
				label: inferAccountLabel(credential),
				kind: inferAccountKind(credential),
				credential,
			},
		},
	};
}

export function normalizeToPool(credential: StoredProviderCredential | undefined): AccountPoolCredential | undefined {
	if (!credential) return undefined;
	if (isAccountPool(credential)) return credential;
	if (credential.type === "oauth" || credential.type === "api_key") {
		return wrapLegacyCredential(credential);
	}
	return undefined;
}

export function getActiveAccountId(pool: AccountPoolCredential): string | undefined {
	if (pool.accounts[pool.activeAccountId]) return pool.activeAccountId;
	const first = pool.rotation.order.find((id) => pool.accounts[id]);
	return first ?? Object.keys(pool.accounts)[0];
}

export function getActiveAccount(pool: AccountPoolCredential): { accountId: string; account: PooledAccount } | undefined {
	const accountId = getActiveAccountId(pool);
	if (!accountId) return undefined;
	const account = pool.accounts[accountId];
	if (!account) return undefined;
	return { accountId, account };
}

export function getActiveCredential(pool: AccountPoolCredential): PooledAccountCredential | undefined {
	return getActiveAccount(pool)?.account.credential;
}

export function isAccountExhausted(account: PooledAccount, now = Date.now()): boolean {
	return typeof account.exhaustedUntil === "number" && account.exhaustedUntil > now;
}

export function listAccountSummaries(pool: AccountPoolCredential): PooledAccountSummary[] {
	const activeId = getActiveAccountId(pool);
	const order = pool.rotation.order.length > 0 ? pool.rotation.order : Object.keys(pool.accounts);
	const seen = new Set<string>();
	const summaries: PooledAccountSummary[] = [];

	for (const accountId of order) {
		if (seen.has(accountId)) continue;
		const account = pool.accounts[accountId];
		if (!account) continue;
		seen.add(accountId);
		summaries.push({
			accountId,
			label: account.label,
			kind: account.kind,
			isActive: accountId === activeId,
			exhaustedUntil: account.exhaustedUntil,
			lastUsedAt: account.lastUsedAt,
		});
	}

	for (const accountId of Object.keys(pool.accounts)) {
		if (seen.has(accountId)) continue;
		const account = pool.accounts[accountId]!;
		summaries.push({
			accountId,
			label: account.label,
			kind: account.kind,
			isActive: accountId === activeId,
			exhaustedUntil: account.exhaustedUntil,
			lastUsedAt: account.lastUsedAt,
		});
	}

	return summaries;
}

export function findNextAvailableAccountId(
	pool: AccountPoolCredential,
	options?: { excludeIds?: Set<string>; now?: number },
): string | undefined {
	const now = options?.now ?? Date.now();
	const activeId = getActiveAccountId(pool);
	const order = pool.rotation.order.length > 0 ? pool.rotation.order : Object.keys(pool.accounts);
	const exclude = options?.excludeIds ?? new Set<string>();
	const startIndex = activeId ? Math.max(0, order.indexOf(activeId) + 1) : 0;

	for (let offset = 0; offset < order.length; offset++) {
		const accountId = order[(startIndex + offset) % order.length]!;
		if (exclude.has(accountId)) continue;
		const account = pool.accounts[accountId];
		if (!account) continue;
		if (!isAccountExhausted(account, now)) return accountId;
	}

	for (const accountId of Object.keys(pool.accounts)) {
		if (exclude.has(accountId)) continue;
		const account = pool.accounts[accountId];
		if (!account) continue;
		if (!isAccountExhausted(account, now)) return accountId;
	}

	return undefined;
}

export function cloudBedrockIsValid(credential: CloudBedrockCredential): boolean {
	return Boolean(
		credential.awsProfile ||
			(credential.accessKeyId && credential.secretAccessKey) ||
			credential.bearerToken,
	);
}

export function cloudVertexIsValid(credential: CloudVertexCredential): boolean {
	return Boolean(credential.project && credential.location && (credential.apiKey || credential.credentialsPath));
}

export function cloudAzureIsValid(credential: CloudAzureCredential): boolean {
	return Boolean(credential.apiKey && (credential.baseUrl || credential.resourceName));
}

export function isStoredApiKeyCredential(credential: PooledAccountCredential): credential is ApiKeyCredential {
	return "type" in credential && credential.type === "api_key";
}

export function isStoredOAuthCredential(credential: PooledAccountCredential): credential is OAuthCredential {
	return "type" in credential && credential.type === "oauth";
}