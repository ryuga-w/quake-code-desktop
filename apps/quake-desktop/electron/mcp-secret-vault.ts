import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

type VaultFile = { version: 1; values: Record<string, string> };

export function listMcpSecretNames(): string[] {
  return Object.keys(readVault().values).sort();
}

export function setMcpSecret(name: string, value: string): void {
  assertName(name);
  if (!value) throw new Error("Secret değeri boş olamaz");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("İşletim sistemi güvenli secret depolaması kullanılamıyor");
  const vault = readVault();
  vault.values[name] = safeStorage.encryptString(value).toString("base64");
  writeVault(vault);
}

export function removeMcpSecret(name: string): void {
  assertName(name);
  const vault = readVault();
  delete vault.values[name];
  writeVault(vault);
}

export function loadMcpSecrets(): Record<string, string> {
  if (!safeStorage.isEncryptionAvailable()) return {};
  const result: Record<string, string> = {};
  for (const [name, encrypted] of Object.entries(readVault().values)) {
    try { result[name] = safeStorage.decryptString(Buffer.from(encrypted, "base64")); } catch { /* corrupted entries stay unavailable */ }
  }
  return result;
}

function vaultPath(): string {
  return path.join(app.getPath("userData"), "mcp-secrets.v1.json");
}

function readVault(): VaultFile {
  const file = vaultPath();
  if (!existsSync(file)) return { version: 1, values: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed?.version === 1 && parsed.values && typeof parsed.values === "object" ? parsed : { version: 1, values: {} };
  } catch { return { version: 1, values: {} }; }
}

function writeVault(vault: VaultFile): void {
  mkdirSync(path.dirname(vaultPath()), { recursive: true });
  writeFileSync(vaultPath(), `${JSON.stringify(vault, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function assertName(name: string): void {
  if (!SECRET_NAME.test(name)) throw new Error("Secret adı geçersiz");
}
