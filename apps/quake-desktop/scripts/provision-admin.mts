import { randomBytes } from "node:crypto";
import { AccountAuthError, AccountAuthService } from "../src/server/account-auth.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

const email = argument("email", "admin@quakecode.local");
const displayName = argument("name", "Quake Administrator");
const temporaryPassword = `Qc!7-${randomBytes(18).toString("base64url")}`;
const auth = new AccountAuthService();

try {
  const user = await auth.provisionAdmin({
    email,
    displayName,
    password: temporaryPassword,
    passwordChangeRequired: true,
  });
  process.stdout.write(`${JSON.stringify({
    created: true,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    passwordChangeRequired: user.passwordChangeRequired,
    temporaryPassword,
    database: auth.filePath,
  }, null, 2)}\n`);
} catch (error) {
  if (error instanceof AccountAuthError) {
    process.stderr.write(`${error.code}: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
