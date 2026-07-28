import fs from "node:fs";
import path from "node:path";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.js";

const TOKEN_PATH = path.join(process.env.USERPROFILE || "", ".aws", "sso", "cache", "kiro-auth-token.json");

export async function loginAmazonKiro(): Promise<OAuthCredentials> {
	if (!fs.existsSync(TOKEN_PATH)) {
		throw new Error("Kiro oturumu bulunamadı. Lütfen Kiro IDE'yi açıp giriş yapın.");
	}

	const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));

	return {
		access: tokenData.accessToken,
		refresh: "none", // Kiro kendi yeniliyor
		expires: Date.now() + 3600000, // Varsayılan 1 saat
		accountId: "kiro-user",
	};
}

export const amazonKiroOAuthProvider: OAuthProviderInterface = {
	id: "amazon-kiro",
	name: "Amazon Q (Kiro Subscription)",
	usesCallbackServer: false,

	async login(_callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		return loginAmazonKiro();
	},

	async refreshToken(_credentials: OAuthCredentials): Promise<OAuthCredentials> {
		// Token her seferinde dosyadan taze okunacağı için burada da login'i çağırabiliriz
		return loginAmazonKiro();
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
