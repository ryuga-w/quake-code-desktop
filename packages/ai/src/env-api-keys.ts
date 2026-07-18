// NEVER convert to top-level imports - breaks browser/Vite builds (web-ui)
let _existsSync: typeof import("node:fs").existsSync | null = null;
let _homedir: typeof import("node:os").homedir | null = null;
let _join: typeof import("node:path").join | null = null;

type DynamicImport = (specifier: string) => Promise<unknown>;

const dynamicImport: DynamicImport = (specifier) => import(specifier);
const NODE_FS_SPECIFIER = "node:" + "fs";
const NODE_OS_SPECIFIER = "node:" + "os";
const NODE_PATH_SPECIFIER = "node:" + "path";

// Eagerly load in Node.js/Bun environment only
if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
	dynamicImport(NODE_FS_SPECIFIER).then((m) => {
		_existsSync = (m as typeof import("node:fs")).existsSync;
	});
	dynamicImport(NODE_OS_SPECIFIER).then((m) => {
		_homedir = (m as typeof import("node:os")).homedir;
	});
	dynamicImport(NODE_PATH_SPECIFIER).then((m) => {
		_join = (m as typeof import("node:path")).join;
	});
}

import { getGrokAuthToken } from "./grok-auth.js";
import type { KnownProvider } from "./types.js";

let cachedVertexAdcCredentialsExists: boolean | null = null;

function hasVertexAdcCredentials(): boolean {
	if (cachedVertexAdcCredentialsExists === null) {
		// If node modules haven't loaded yet (async import race at startup),
		// return false WITHOUT caching so the next call retries once they're ready.
		// Only cache false permanently in a browser environment where fs is never available.
		if (!_existsSync || !_homedir || !_join) {
			const isNode = typeof process !== "undefined" && (process.versions?.node || process.versions?.bun);
			if (!isNode) {
				// Definitively in a browser — safe to cache false permanently
				cachedVertexAdcCredentialsExists = false;
			}
			return false;
		}

		// Check GOOGLE_APPLICATION_CREDENTIALS env var first (standard way)
		const gacPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
		if (gacPath) {
			cachedVertexAdcCredentialsExists = _existsSync(gacPath);
		} else {
			// Fall back to default ADC path (lazy evaluation)
			cachedVertexAdcCredentialsExists = _existsSync(
				_join(_homedir(), ".config", "gcloud", "application_default_credentials.json"),
			);
		}
	}
	return cachedVertexAdcCredentialsExists;
}

/**
 * Get API key for provider from known environment variables, e.g. OPENAI_API_KEY.
 *
 * Will not return API keys for providers that require OAuth tokens.
 */
export function getEnvApiKey(provider: KnownProvider): string | undefined;
export function getEnvApiKey(provider: string): string | undefined;
export function getEnvApiKey(provider: any): string | undefined {
	// Fall back to environment variables
	if (provider === "github-copilot") {
		return process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
	}

	// ANTHROPIC_OAUTH_TOKEN takes precedence over ANTHROPIC_API_KEY
	if (provider === "anthropic") {
		return process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
	}

	// Vertex AI supports either an explicit API key or Application Default Credentials
	// Auth is configured via `gcloud auth application-default login`
	if (provider === "google-vertex") {
		if (process.env.GOOGLE_CLOUD_API_KEY) {
			return process.env.GOOGLE_CLOUD_API_KEY;
		}

		const hasCredentials = hasVertexAdcCredentials();
		const hasProject = !!(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT);
		const hasLocation = !!process.env.GOOGLE_CLOUD_LOCATION;

		if (hasCredentials && hasProject && hasLocation) {
			return "<authenticated>";
		}
	}

	if (provider === "amazon-bedrock") {
		// Amazon Bedrock supports multiple credential sources:
		// 1. AWS_PROFILE - named profile from ~/.aws/credentials
		// 2. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY - standard IAM keys
		// 3. AWS_BEARER_TOKEN_BEDROCK - Bedrock API keys (bearer token)
		// 4. AWS_CONTAINER_CREDENTIALS_RELATIVE_URI - ECS task roles
		// 5. AWS_CONTAINER_CREDENTIALS_FULL_URI - ECS task roles (full URI)
		// 6. AWS_WEB_IDENTITY_TOKEN_FILE - IRSA (IAM Roles for Service Accounts)
		if (
			process.env.AWS_PROFILE ||
			(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
			process.env.AWS_BEARER_TOKEN_BEDROCK ||
			process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
			process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI ||
			process.env.AWS_WEB_IDENTITY_TOKEN_FILE
		) {
			return "<authenticated>";
		}
	}
	// 9router local proxy — always available with embedded key, env var overrides
	if (provider === "9router") {
		return process.env.NINE_ROUTER_API_KEY || "sk-c2ea19f9d28ac0f9-0u6ywe-73174a32";
	}

	// OpenCode Free: hardcoded "public" key, env override
	if (provider === "opencode-free") {
		return process.env.OPENCODE_API_KEY || "public";
	}

	// Grok CLI proxy + xAI API — JWT from ~/.grok/auth.json (`grok login`)
	if (provider === "grok-cli" || provider === "grok") {
		return process.env.GROK_AUTH_TOKEN || getGrokAuthToken() || process.env.XAI_API_KEY;
	}

	// NVIDIA Direct API — reads from env or auth.json
	if (provider === "nvidia-direct") {
		return process.env.NVIDIA_API_KEY || process.env.OPENCODE_API_KEY || undefined;
	}

	// Azure AI Foundry — reads from AZURE_AI_FOUNDRY_API_KEY
	if (provider === "azure-ai-foundry") {
		return process.env.AZURE_AI_FOUNDRY_API_KEY;
	}

	// Cloudflare — env var override for image gen extension
	if (provider === "cloudflare") {
		if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
			return JSON.stringify({
				apiToken: process.env.CLOUDFLARE_API_TOKEN,
				accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
			});
		}
	}

	const envMap: Record<string, string> = {
		openai: "OPENAI_API_KEY",
		"azure-openai-responses": "AZURE_OPENAI_API_KEY",
		google: "GEMINI_API_KEY",
		groq: "GROQ_API_KEY",
		cerebras: "CEREBRAS_API_KEY",
		xai: "XAI_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
		"vercel-ai-gateway": "AI_GATEWAY_API_KEY",
		zai: "ZAI_API_KEY",
		mistral: "MISTRAL_API_KEY",
		huggingface: "HF_TOKEN",
		opencode: "OPENCODE_API_KEY",
		"opencode-go": "OPENCODE_API_KEY",
		"opencode-free": "OPENCODE_API_KEY",
		"kimi-coding": "KIMI_API_KEY",
		"9router": "NINE_ROUTER_API_KEY",
		nvidia: "NVIDIA_API_KEY",
	};

	if (provider === "xai") {
		return process.env.XAI_API_KEY || getGrokAuthToken();
	}

	const envVar = envMap[provider];
	return envVar ? process.env[envVar] : undefined;
}
