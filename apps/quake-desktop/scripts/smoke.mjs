import { spawn } from "node:child_process";

const port = Number(process.env.QUAKE_WEB_SMOKE_PORT ?? 3990);
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  QUAKE_WEB_AUTH: "0",
  QUAKE_WEB_PORT: String(port),
  QUAKE_WEB_HOST: "127.0.0.1",
};

const server = spawn(process.execPath, ["apps/quake-desktop/dist/server/index.js"], {
  cwd: new URL("../../..", import.meta.url),
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
server.stdout.on("data", (chunk) => (output += chunk.toString()));
server.stderr.on("data", (chunk) => (output += chunk.toString()));

try {
  await waitForReady();
  await assertOk("/", "home");
  const config = await getJson("/api/config");
  assert(config.config?.cwd, "missing config cwd");
  const state = await getJson("/api/state");
  assert(state.state?.sessionId, "missing session id");
  const sessions = await getJson("/api/sessions");
  assert(Array.isArray(sessions.sessions), "missing sessions array");
  const models = await getJson("/api/models");
  assert(Array.isArray(models.models), "missing models array");
  const files = await getJson("/api/files?path=.");
  assert(Array.isArray(files.entries), "missing files array");
  const webSettingsWrites = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      postJson("/api/web-settings", index % 3 === 0 ? { selectedModel: "openai-codex/gpt-5.5" } : index % 3 === 1 ? { fileDir: "." } : { panels: { plan: true } }),
    ),
  );
  assert(webSettingsWrites.every((item) => item.settings), `web settings concurrent writes failed: ${JSON.stringify(webSettingsWrites)}`);
  const webSettings = await getJson("/api/web-settings");
  assert(webSettings.settings?.panels?.plan === true, "web settings panel preference was not persisted");
  const terminal = await postJson("/api/terminal/run", { command: "node --version" });
  assert(terminal.exitCode === 0, `terminal failed: ${terminal.stderr || terminal.stdout}`);
  const blocked = await postJson("/api/terminal/run", { command: "git reset --hard HEAD" });
  assert(blocked.error || blocked.message || blocked.exitCode === undefined, "tehlikeli terminal komutu engellenmedi");
  assert(blocked.error === "git reset --hard engellendi", `blocked terminal message is not localized: ${blocked.error || blocked.message}`);
  console.log("quake_web_smoke_ok", state.state.sessionId, files.entries.length, terminal.stdout.trim());
} finally {
  server.kill("SIGTERM");
}

async function waitForReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become ready\n${output}`);
}

async function assertOk(path, label) {
  const res = await fetch(`${base}${path}`);
  assert(res.ok, `${label} failed: ${res.status}`);
}

async function getJson(path) {
  const res = await fetch(`${base}${path}`);
  assert(res.ok, `${path} failed: ${res.status}`);
  return res.json();
}

async function postJson(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
