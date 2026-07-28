import { describe, expect, it } from "vitest";
import { assertMcpNoPlaintextSecrets, normalizeMcpServer, normalizeMcpServers } from "../src/server/mcp/config";
import { mcpToolName } from "../src/server/mcp/names";
import { isSecretReferenceValue, redactSecrets, resolveSecretReferences } from "../src/server/mcp/secrets";

describe("MCP configuration", () => {
  it("migrates legacy stdio configuration", () => {
    const server = normalizeMcpServer({ id: "context7", name: "Context7", command: "npx", args: ["-y", "@upstash/context7-mcp@latest"], enabled: true }, "C:/work");
    expect(server).toMatchObject({ version: 1, transport: "stdio", autoStart: true, timeoutMs: 30_000 });
  });

  it("accepts HTTPS and localhost HTTP but rejects insecure remote URLs", () => {
    expect(normalizeMcpServer({ name: "remote", transport: "streamable-http", url: "https://example.com/mcp" }, ".").transport).toBe("streamable-http");
    expect(normalizeMcpServer({ name: "local", transport: "streamable-http", url: "http://localhost:3000/mcp" }, ".").transport).toBe("streamable-http");
    expect(() => normalizeMcpServer({ name: "bad", transport: "streamable-http", url: "http://example.com/mcp" }, ".")).toThrow("HTTPS");
  });

  it("deduplicates IDs and names", () => {
    const servers = normalizeMcpServers([{ id: "a", name: "One", command: "node" }, { id: "a", name: "Two", command: "node" }], ".");
    expect(servers).toHaveLength(1);
  });

  it("creates stable namespaced tool names", () => {
    expect(mcpToolName("Context 7", "resolve-library-id")).toBe("mcp__context_7__resolve_library_id");
  });

  it("resolves environment references and redacts values", () => {
    process.env.MCP_TEST_TOKEN = "secret-value-123";
    const resolved = resolveSecretReferences({ Authorization: "${env:MCP_TEST_TOKEN}" });
    expect(resolved?.Authorization).toBe("secret-value-123");
    expect(redactSecrets("Authorization: secret-value-123", resolved)).not.toContain("secret-value-123");
    delete process.env.MCP_TEST_TOKEN;
  });

  it("resolves vault refs and Bearer-prefixed Authorization headers", () => {
    process.env.MCP_BEARER_TOKEN = "tok_abc_xyz_999";
    const pure = resolveSecretReferences({ Authorization: "${vault:MCP_BEARER_TOKEN}" });
    expect(pure?.Authorization).toBe("tok_abc_xyz_999");
    const bearer = resolveSecretReferences({ Authorization: "Bearer ${vault:MCP_BEARER_TOKEN}" });
    expect(bearer?.Authorization).toBe("Bearer tok_abc_xyz_999");
    const envBearer = resolveSecretReferences({ Authorization: "Bearer ${env:MCP_BEARER_TOKEN}" });
    expect(envBearer?.Authorization).toBe("Bearer tok_abc_xyz_999");
    expect(redactSecrets("Authorization: Bearer tok_abc_xyz_999", bearer)).not.toContain("tok_abc_xyz_999");
    delete process.env.MCP_BEARER_TOKEN;
  });

  it("accepts Bearer vault header refs and rejects plaintext Authorization", () => {
    const server = normalizeMcpServer(
      {
        name: "remote-auth",
        transport: "streamable-http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer ${vault:MCP_BEARER_TOKEN}" },
      },
      ".",
    );
    expect(server.transport).toBe("streamable-http");
    if (server.transport === "streamable-http" || server.transport === "sse") {
      expect(server.headers?.Authorization).toBe("Bearer ${vault:MCP_BEARER_TOKEN}");
    }
    expect(isSecretReferenceValue("Bearer ${vault:MCP_BEARER_TOKEN}")).toBe(true);
    expect(isSecretReferenceValue("${env:MCP_BEARER_TOKEN}")).toBe(true);
    expect(isSecretReferenceValue("Bearer sk-live-plaintext-secret-value")).toBe(false);
    expect(() =>
      assertMcpNoPlaintextSecrets({
        headers: { Authorization: "Bearer ${vault:MCP_BEARER_TOKEN}" },
      }),
    ).not.toThrow();
    expect(() =>
      assertMcpNoPlaintextSecrets({
        headers: { Authorization: "Bearer sk-live-plaintext-secret-value" },
      }),
    ).toThrow(/vault|env|referans/i);
  });
});
