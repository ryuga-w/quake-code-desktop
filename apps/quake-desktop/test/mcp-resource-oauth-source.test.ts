/**
 * Source contracts for MCP resource UX polish + Bearer token OAuth MVP (S-MCP).
 * Full browser OAuth remains Phase 2 — this card is the honest token path.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const settings = readFileSync(join(root, "src/client/src/components/settings/SettingsPanels.tsx"), "utf8");
const styles = readFileSync(join(root, "src/client/src/components/settings/SettingsPanels.module.css"), "utf8");
const secrets = readFileSync(join(root, "src/server/mcp/secrets.ts"), "utf8");
const config = readFileSync(join(root, "src/server/mcp/config.ts"), "utf8");
const connection = readFileSync(join(root, "src/server/mcp/connection.ts"), "utf8");

describe("MCP resource UX + OAuth Bearer MVP (S-MCP)", () => {
  it("exposes resource actions: Önizle, URI kopyala, Composer'a ekle", () => {
    expect(settings).toContain("Önizle");
    expect(settings).toContain("URI kopyala");
    expect(settings).toContain("Composer'a ekle");
    expect(settings).toContain("copyResourceUri");
    expect(settings).toContain("insertResourceToComposer");
    expect(settings).toContain("previewResource");
    expect(settings).toContain("Resource URI kopyalandı");
    expect(settings).toContain("Resource composer'a eklendi");
    expect(settings).toContain("Resource önizlemesi");
    expect(settings).toContain("quake:set-composer-draft");
    expect(settings).toMatch(/MCP resource: \$\{label\}|MCP resource:/);
    expect(settings).toContain("URI:");
  });

  it("labels resource list in Turkish and keeps prompts insert path", () => {
    expect(settings).toContain("Kaynaklar (");
    expect(settings).toContain("Promptlar (");
    expect(settings).toContain("kaynak ·");
    expect(settings).toContain("MCP prompt composer'a eklendi");
    // Do not regress server CRUD labels
    expect(settings).toContain("MCP sunucuları");
    expect(settings).toContain("Sunucu ekle");
    expect(settings).toContain("Bağlantıyı kes");
    expect(settings).toContain("/api/mcp/servers");
  });

  it("ships Bearer token MVP card with vault save (not half-broken browser OAuth)", () => {
    expect(settings).toContain("MCP OAuth / Bearer token (MVP)");
    expect(settings).toContain("Token'ı kasaya kaydet");
    expect(settings).toContain("Bearer token yapıştır");
    expect(settings).toContain("Bearer token vault adı");
    expect(settings).toContain("saveBearerTokenToVault");
    expect(settings).toContain("Authorization: Bearer");
    expect(settings).toContain("${vault:NAME}");
    expect(settings).toContain("Phase 2");
    expect(settings).toContain("Tarayıcı OAuth");
    expect(settings).toContain("authorization code + refresh");
    expect(settings).toContain("Henüz kullanılamıyor");
    expect(settings).toContain("Güvenli secret kasasına git");
    expect(settings).toContain('id="mcp-secret-vault"');
    expect(settings).toContain("scrollToMcpSecretVault");
    expect(settings).toContain("Güvenli secret kasası");
    // No fake full OAuth browser controls
    const oauthCard = settings.slice(
      settings.indexOf("MCP OAuth / Bearer token (MVP)"),
      settings.indexOf("Sunucu ekle", settings.indexOf("MCP OAuth / Bearer token (MVP)")),
    );
    expect(oauthCard.length).toBeGreaterThan(40);
    expect(oauthCard).not.toContain("OAuth başlat");
    expect(oauthCard).not.toContain("Authorize");
    expect(oauthCard).not.toContain("Connect with OAuth");
    expect(oauthCard).not.toContain("/api/mcp/oauth");
    expect(oauthCard).toContain("Token'ı kasaya kaydet");
    expect(oauthCard).toContain("scrollToMcpSecretVault");
  });

  it("wires remote Authorization header via Bearer vault refs on add form", () => {
    expect(settings).toContain("Authorization header");
    expect(settings).toContain("bearer-vault");
    expect(settings).toContain("Bearer token (vault)");
    expect(settings).toContain("buildRemoteHeaders");
    expect(settings).toContain('Bearer \\${vault:');
    expect(settings).toContain("Bağlantıyı test et");
    expect(settings).toContain("testConnection");
    expect(settings).toContain("auth_required");
    // streamable-http remains available
    expect(settings).toContain("streamable-http");
    expect(settings).toContain("Streamable HTTP");
  });

  it("resolves vault and Bearer-prefixed secret references for HTTP headers", () => {
    expect(secrets).toContain("env|vault");
    expect(secrets).toContain("isSecretReferenceValue");
    expect(secrets).toContain("resolveSecretReferences");
    expect(config).toContain("isSecretReferenceValue");
    expect(config).toContain("${vault:NAME}");
    expect(config).toContain("Bearer \\${vault:NAME}");
    // Connection path still resolves headers for remote transports
    expect(connection).toContain("resolveSecretReferences(this.config.headers)");
    expect(connection).toContain("StreamableHTTPClientTransport");
    expect(connection).toContain("requestInit");
  });

  it("styles resource action rows and auth hint without collapsing metadata list", () => {
    expect(styles).toContain(".mcpResourceRow");
    expect(styles).toContain(".mcpResourceActions");
    expect(styles).toContain(".mcpResourceUri");
    expect(styles).toContain(".mcpPreviewBlock");
    expect(styles).toContain(".mcpMetadataList");
    expect(styles).toContain(".mcpAuthHint");
    expect(styles).toContain(".mcpFieldLabel");
  });
});
