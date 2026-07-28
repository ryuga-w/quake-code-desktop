import { getEnvApiKey } from "@mrquake/quakecode-ai";
import { getOAuthProvider, getOAuthProviders } from "@mrquake/quakecode-ai/oauth";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthStorage } from "@mrquake/quakecode-cli";
import type {
  ProviderAuthKind,
  WebProviderCatalogEntry,
  WebProviderListItem,
  WebProviderStatusEntry,
} from "../shared/protocol.js";
import { getPoolMeta, seedPoolFromAuthStorage } from "./provider-accounts.js";

const PROVIDER_ORDER: Record<string, number> = {
  "openai-codex": 0,
  "google-antigravity": 1,
  anthropic: 2,
  "google-gemini-cli": 3,
  "amazon-kiro": 4,
  "github-copilot": 5,
  openrouter: 6,
};

const API_KEY_CATALOG: Array<{
  id: string;
  name: string;
  envVar: string;
  order: number;
  supportsOAuth?: boolean;
}> = [
  { id: "anthropic", name: "Anthropic", envVar: "ANTHROPIC_API_KEY", order: 10, supportsOAuth: true },
  { id: "azure-openai-responses", name: "Azure OpenAI Responses", envVar: "AZURE_OPENAI_API_KEY", order: 11 },
  { id: "openai", name: "OpenAI", envVar: "OPENAI_API_KEY", order: 12 },
  { id: "google", name: "Google Gemini", envVar: "GEMINI_API_KEY", order: 13 },
  { id: "mistral", name: "Mistral", envVar: "MISTRAL_API_KEY", order: 14 },
  { id: "groq", name: "Groq", envVar: "GROQ_API_KEY", order: 15 },
  { id: "cerebras", name: "Cerebras", envVar: "CEREBRAS_API_KEY", order: 16 },
  { id: "xai", name: "xAI", envVar: "XAI_API_KEY", order: 17 },
  { id: "openrouter", name: "OpenRouter", envVar: "OPENROUTER_API_KEY", order: 18 },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", envVar: "AI_GATEWAY_API_KEY", order: 19 },
  { id: "zai", name: "ZAI", envVar: "ZAI_API_KEY", order: 20 },
  { id: "opencode", name: "OpenCode Zen", envVar: "OPENCODE_API_KEY", order: 21 },
  { id: "opencode-go", name: "OpenCode Go", envVar: "OPENCODE_API_KEY", order: 22 },
  { id: "huggingface", name: "Hugging Face", envVar: "HF_TOKEN", order: 23 },
  { id: "kimi-coding", name: "Kimi For Coding", envVar: "KIMI_API_KEY", order: 24 },
  { id: "minimax", name: "MiniMax", envVar: "MINIMAX_API_KEY", order: 25 },
  { id: "minimax-cn", name: "MiniMax (China)", envVar: "MINIMAX_CN_API_KEY", order: 26 },
  { id: "nvidia", name: "NVIDIA NIM API", envVar: "NVIDIA_API_KEY", order: 27, supportsOAuth: false },
];

const CLOUD_CATALOG: Array<{
  id: string;
  name: string;
  order: number;
  docsHint: string;
}> = [
  {
    id: "azure-openai-responses",
    name: "Azure OpenAI",
    order: 30,
    docsHint: "AZURE_OPENAI_API_KEY + AZURE_OPENAI_BASE_URL veya AZURE_OPENAI_RESOURCE_NAME",
  },
  {
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
    order: 31,
    docsHint: "AWS_PROFILE, IAM keys, bearer token veya ECS/IRSA kimlik bilgileri",
  },
  {
    id: "google-vertex",
    name: "Google Vertex AI",
    order: 32,
    docsHint: "gcloud auth application-default login + GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION",
  },
];

function logoUrl(id: string): string {
  return `/providers/${id}.svg`;
}

function sortProviders<T extends { id: string; order: number; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aOrder = PROVIDER_ORDER[a.id] ?? a.order;
    const bOrder = PROVIDER_ORDER[b.id] ?? b.order;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.name.localeCompare(b.name);
  });
}

/** Deduped catalog: OAuth subscription + API keys + cloud-only (azure once). */
export function getProviderCatalog(): WebProviderCatalogEntry[] {
  const oauthProviders = getOAuthProviders();
  const oauthIds = new Set(oauthProviders.map((p) => p.id));

  const subscription: WebProviderCatalogEntry[] = oauthProviders.map((provider) => ({
    id: provider.id,
    name: provider.name,
    kind: "oauth",
    group: "subscription",
    logoUrl: logoUrl(provider.id),
    usesCallbackServer: provider.usesCallbackServer ?? false,
    supportsOAuth: true,
    supportsApiKey: provider.id === "anthropic",
    order: PROVIDER_ORDER[provider.id] ?? 100,
  }));

  const apiKey: WebProviderCatalogEntry[] = API_KEY_CATALOG.filter((entry) => !oauthIds.has(entry.id)).map(
    (entry) => ({
      id: entry.id,
      name: entry.name,
      kind: "api_key" as const,
      group: "api_key" as const,
      envVar: entry.envVar,
      logoUrl: logoUrl(entry.id),
      supportsOAuth: entry.supportsOAuth ?? false,
      supportsApiKey: true,
      order: entry.order,
    }),
  );

  // Cloud-only entries not already listed as api_key/oauth
  const listedIds = new Set([...subscription, ...apiKey].map((e) => e.id));
  const cloud: WebProviderCatalogEntry[] = CLOUD_CATALOG.filter((entry) => !listedIds.has(entry.id)).map(
    (entry) => ({
      id: entry.id,
      name: entry.name,
      kind: "cloud_env" as const,
      group: "cloud" as const,
      logoUrl: logoUrl(entry.id),
      order: entry.order,
      docsHint: entry.docsHint,
    }),
  );

  // Azure already in api_key — enrich docsHint on that entry
  for (const entry of apiKey) {
    if (entry.id === "azure-openai-responses") {
      entry.docsHint = CLOUD_CATALOG.find((c) => c.id === entry.id)?.docsHint;
      entry.group = "cloud";
      entry.kind = "cloud_env";
    }
  }

  return sortProviders([...subscription, ...apiKey, ...cloud]);
}

function getProviderEnvKey(providerId: string): string | undefined {
  // xAI: only explicit XAI_API_KEY counts as env login.
  // Do NOT treat ~/.grok Grok-CLI JWT as an xAI provider connection in the UI.
  if (providerId === "xai") {
    const key = process.env.XAI_API_KEY?.trim();
    return key || undefined;
  }
  // azure-openai-responses: require real endpoint+key via isCloudConfigured path;
  // bare AZURE_OPENAI_API_KEY alone should not mark "Env bağlı" without endpoint.
  if (providerId === "azure-openai-responses") {
    return undefined; // handled only by isCloudConfigured()
  }
  const fromLib = getEnvApiKey(providerId);
  if (fromLib) return fromLib;
  if (providerId === "minimax") return process.env.MINIMAX_API_KEY;
  if (providerId === "minimax-cn") return process.env.MINIMAX_CN_API_KEY;
  return undefined;
}

/** Always-on free catalogs (no login). OpenCode Zen public free tier. */
const ALWAYS_VISIBLE_FREE_PROVIDERS = new Set<string>(["opencode-free", "azure-mrquake-gpt56sol"]);

/**
 * Whether this provider's models appear in the composer / settings picker.
 *
 * Visible providers:
 *   - connected_oauth (valid token)
 *   - connected_api_key (saved key / pool)
 *   - custom models.json providers with configured request auth
 *   - always-visible free providers (opencode-free / Quake Code Free)
 * Hidden: other free catalogs (9router), env-only (xai/grok), cloud env-only,
 * not_configured, expired OAuth.
 */
export function isProviderVisibleInModelPicker(
  authStorage: AuthStorage,
  providerId: string,
  registryHasConfiguredAuth: boolean,
): boolean {
  if (!providerId) return false;

  // Quake Code Free (OpenCode Zen free models) — always list, no login.
  if (ALWAYS_VISIBLE_FREE_PROVIDERS.has(providerId)) return true;

  const catalogEntry = getProviderCatalog().find((e) => e.id === providerId);
  // Custom providers are not in the built-in catalog. A models.json API key is
  // nevertheless valid configured auth and their models must remain selectable.
  if (!catalogEntry) return registryHasConfiguredAuth;

  const status = resolveStatusForProvider(authStorage, providerId, catalogEntry.kind);
  return status.status === "connected_oauth" || status.status === "connected_api_key";
}

function hasVertexAdcCredentials(): boolean {
  const gacPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gacPath) return existsSync(gacPath);
  return existsSync(join(homedir(), ".config", "gcloud", "application_default_credentials.json"));
}

function isCloudConfigured(providerId: string): boolean {
  if (providerId === "amazon-bedrock") {
    return Boolean(getEnvApiKey("amazon-bedrock"));
  }
  if (providerId === "google-vertex") {
    const hasProject = Boolean(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT);
    const hasLocation = Boolean(process.env.GOOGLE_CLOUD_LOCATION);
    return hasVertexAdcCredentials() && hasProject && hasLocation;
  }
  if (providerId === "azure-openai-responses") {
    const hasKey = Boolean(process.env.AZURE_OPENAI_API_KEY?.trim());
    const hasEndpoint =
      Boolean(process.env.AZURE_OPENAI_BASE_URL?.trim()) ||
      Boolean(process.env.AZURE_OPENAI_RESOURCE_NAME?.trim());
    return hasKey && hasEndpoint;
  }
  return false;
}

function oauthAccountHint(credential: Record<string, unknown>): string | undefined {
  if (typeof credential.email === "string" && credential.email) return credential.email;
  if (typeof credential.login === "string" && credential.login) return credential.login;
  if (typeof credential.account === "string" && credential.account) return credential.account;
  if (typeof credential.accountId === "string" && credential.accountId) return credential.accountId;
  return undefined;
}

function resolveStatusForProvider(
  authStorage: AuthStorage,
  providerId: string,
  kind: ProviderAuthKind,
): WebProviderStatusEntry {
  // Ensure single-credential auth.json is represented in multi-account pool
  seedPoolFromAuthStorage(authStorage, providerId);
  const poolMeta = getPoolMeta(providerId, authStorage);
  const stored = authStorage.get(providerId);

  if (stored?.type === "oauth") {
    const expired =
      typeof stored.expires === "number" && stored.expires > 0 && Date.now() > stored.expires;
    return {
      id: providerId,
      status: expired ? "expired" : "connected_oauth",
      accountHint: poolMeta.activeLabel || oauthAccountHint(stored as Record<string, unknown>),
      expiresAt: typeof stored.expires === "number" ? stored.expires : undefined,
      source: "auth_file",
      accountCount: Math.max(1, poolMeta.accountCount),
      rotationEnabled: poolMeta.rotationEnabled,
      accounts: poolMeta.accounts,
    };
  }

  if (stored?.type === "api_key") {
    return {
      id: providerId,
      status: "connected_api_key",
      accountHint:
        poolMeta.accountCount > 1
          ? `${poolMeta.activeLabel || "API key"} · ${poolMeta.accountCount} hesap`
          : poolMeta.activeLabel || "API key kayıtlı",
      source: "auth_file",
      accountCount: Math.max(1, poolMeta.accountCount),
      rotationEnabled: poolMeta.rotationEnabled,
      accounts: poolMeta.accounts,
    };
  }

  if (kind === "cloud_env" || providerId === "azure-openai-responses" || providerId === "amazon-bedrock" || providerId === "google-vertex") {
    if (isCloudConfigured(providerId)) {
      return { id: providerId, status: "connected_env", accountHint: "Ortam değişkenleri yapılandırıldı", source: "env" };
    }
  }

  if (getProviderEnvKey(providerId)) {
    return { id: providerId, status: "connected_env", accountHint: "Ortam değişkeni", source: "env" };
  }

  // Pool may still have accounts if auth was cleared partially
  if (poolMeta.accountCount > 0) {
    return {
      id: providerId,
      status: "error",
      accountHint: "Havuzda hesap var ama aktif kimlik yok — bir hesabı aktifleştirin",
      source: "auth_file",
      accountCount: poolMeta.accountCount,
      rotationEnabled: poolMeta.rotationEnabled,
      accounts: poolMeta.accounts,
    };
  }

  return { id: providerId, status: "not_configured", source: "none" };
}

export function getProviderStatus(authStorage: AuthStorage): WebProviderStatusEntry[] {
  const catalog = getProviderCatalog();
  return catalog.map((entry) => resolveStatusForProvider(authStorage, entry.id, entry.kind));
}

export function getProviderList(
  authStorage: AuthStorage,
  modelCounts?: Record<string, number>,
): WebProviderListItem[] {
  const catalog = getProviderCatalog();
  return catalog.map((entry) => {
    const st = resolveStatusForProvider(authStorage, entry.id, entry.kind);
    return {
      ...entry,
      status: st.status,
      accountHint: st.accountHint,
      expiresAt: st.expiresAt,
      source: st.source,
      accountCount: st.accountCount,
      rotationEnabled: st.rotationEnabled,
      accounts: st.accounts,
      modelCount: modelCounts?.[entry.id] ?? 0,
      error: st.error,
    };
  });
}

export function isOAuthProviderId(providerId: string): boolean {
  return Boolean(getOAuthProvider(providerId));
}

export function isApiKeyProviderId(providerId: string): boolean {
  return API_KEY_CATALOG.some((entry) => entry.id === providerId) || providerId === "anthropic";
}

export function isKnownProviderId(providerId: string): boolean {
  return getProviderCatalog().some((e) => e.id === providerId);
}

export function getApiKeyEnvVar(providerId: string): string | undefined {
  return API_KEY_CATALOG.find((e) => e.id === providerId)?.envVar;
}

export function getCloudDocsHint(providerId: string): string | undefined {
  return (
    CLOUD_CATALOG.find((e) => e.id === providerId)?.docsHint ||
    getProviderCatalog().find((e) => e.id === providerId)?.docsHint
  );
}
