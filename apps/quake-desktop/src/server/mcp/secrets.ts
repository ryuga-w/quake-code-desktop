/** Matches ${env:NAME} or ${vault:NAME} (vault secrets are injected into process.env at server start). */
const SECRET_REFERENCE_SOURCE = "\\$\\{(?:env|vault):([A-Za-z_][A-Za-z0-9_]*)\\}";
const SECRET_KEY = /authorization|cookie|token|secret|api[-_]?key/i;

function secretReferencePattern(flags = "g"): RegExp {
  return new RegExp(SECRET_REFERENCE_SOURCE, flags);
}

/**
 * True when value is only secret refs (optionally with safe prefixes like "Bearer ").
 * Rejects values that still contain long opaque blobs after refs are stripped.
 */
export function isSecretReferenceValue(value: string): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  if (!secretReferencePattern().test(value)) return false;
  const stripped = value.replace(secretReferencePattern(), "");
  // After removing refs, remaining text must not look like a raw secret.
  return !/[A-Za-z0-9+/=_-]{12,}/.test(stripped);
}

export function resolveSecretReferences(values: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!values) return undefined;
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    resolved[key] = value.replace(secretReferencePattern(), (_match, name: string) => {
      const secret = process.env[name];
      if (!secret) throw new Error(`MCP secret environment variable bulunamadı: ${name}`);
      return secret;
    });
  }
  return resolved;
}

export function redactSecrets(message: string, values?: Record<string, string>): string {
  // Capture full header values including "Bearer <token>" (not only the first word).
  let redacted = message.replace(/(authorization|cookie|token|secret|api[-_]?key)\s*[:=]\s*([^\r\n,;]+)/gi, "$1=[REDACTED]");
  for (const [key, value] of Object.entries(values || {})) {
    if (!(SECRET_KEY.test(key) || value.length >= 12) || !value) continue;
    redacted = redacted.split(value).join("[REDACTED]");
    // Also scrub token segments after prefixes like "Bearer ".
    for (const part of value.split(/\s+/)) {
      if (part.length >= 12) redacted = redacted.split(part).join("[REDACTED]");
    }
  }
  return redacted;
}
