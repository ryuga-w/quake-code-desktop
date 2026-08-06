import http from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAX_CLIENT_MESSAGE_BYTES = 512 * 1024;
const MAX_AUDIO_BASE64_CHARS = 384 * 1024;
const MAX_QUEUED_UPSTREAM_MESSAGES = 12;
const VOICES = new Set(["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"]);
const STATIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/audio-capture-worklet.js", { file: "audio-capture-worklet.js", type: "text/javascript; charset=utf-8" }],
]);

function trimEnv(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstDefinedEnv(env, names) {
  for (const name of names) {
    if (env[name] !== undefined) return env[name];
  }
  return undefined;
}

function isAzureHost(hostname) {
  const host = hostname.toLowerCase();
  return host.endsWith(".openai.azure.com")
    || host.endsWith(".cognitiveservices.azure.com")
    || host.endsWith(".services.ai.azure.com");
}

function parseEndpoint(value) {
  if (!value) return undefined;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const parsed = new URL(withScheme);
  if (!isAzureHost(parsed.hostname)) {
    throw new Error("Endpoint yalnızca Azure OpenAI / Cognitive Services hostu olabilir.");
  }
  parsed.protocol = "https:";
  parsed.hash = "";
  return parsed;
}

/** Internal, unit-testable configuration parser. Keep its result on the server only. */
export function readLabConfig(env = process.env) {
  const endpointValue = trimEnv(firstDefinedEnv(env, ["AZURE_REALTIME_ENDPOINT", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_BASE_URL"]));
  const apiKey = trimEnv(firstDefinedEnv(env, ["AZURE_REALTIME_API_KEY", "AZURE_OPENAI_API_KEY"]));
  const deployment = trimEnv(firstDefinedEnv(env, ["AZURE_REALTIME_DEPLOYMENT", "AZURE_OPENAI_DEPLOYMENT_NAME"]));
  const apiMode = trimEnv(firstDefinedEnv(env, ["AZURE_REALTIME_API_MODE"]) ?? "v1").toLowerCase();
  const apiVersion = trimEnv(firstDefinedEnv(env, ["AZURE_REALTIME_API_VERSION"]) ?? "2024-10-21-preview");
  const errors = [];
  let endpoint;

  if (!endpointValue) errors.push("AZURE_REALTIME_ENDPOINT gerekli.");
  else {
    try {
      endpoint = parseEndpoint(endpointValue);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Azure endpoint geçersiz.");
    }
  }
  if (!apiKey) errors.push("AZURE_REALTIME_API_KEY gerekli.");
  if (!deployment) errors.push("AZURE_REALTIME_DEPLOYMENT gerekli.");
  if (apiMode !== "v1" && apiMode !== "legacy") errors.push("AZURE_REALTIME_API_MODE yalnızca v1 veya legacy olabilir.");
  if (apiMode === "legacy" && !apiVersion) errors.push("Legacy mod için AZURE_REALTIME_API_VERSION gerekli.");

  return {
    configured: errors.length === 0,
    errors,
    endpointOrigin: endpoint?.origin,
    endpointUrl: endpoint?.toString(),
    endpointHost: endpoint?.hostname,
    deployment,
    apiMode,
    apiVersion,
    apiKey,
  };
}

export function buildAzureRealtimeUrl(config) {
  if (!config.configured || !config.endpointUrl || !config.deployment) {
    throw new Error("Azure Realtime yapılandırması eksik.");
  }
  const url = new URL(config.endpointUrl);
  url.protocol = "wss:";
  if (config.apiMode === "legacy") {
    const isDeploymentPath = /^\/openai\/realtime\/deployments\/[^/]+\/?$/i.test(url.pathname);
    if (isDeploymentPath) {
      // Some Azure Realtime deployments provide this complete, versioned URL.
      // Preserve the path and query rather than converting it to the v1 shape.
      if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", config.apiVersion);
    } else {
      url.pathname = "/openai/realtime";
      url.search = "";
      url.searchParams.set("api-version", config.apiVersion);
      url.searchParams.set("deployment", config.deployment);
    }
  } else {
    url.pathname = "/openai/v1/realtime";
    url.search = "";
    url.searchParams.set("model", config.deployment);
  }
  return url;
}

function publicConfig(config) {
  return {
    configured: config.configured,
    errors: config.configured ? [] : config.errors,
    endpointHost: config.endpointHost || "",
    deployment: config.deployment || "",
    apiMode: config.apiMode,
    apiVersion: config.apiMode === "legacy" ? config.apiVersion : undefined,
  };
}

function readDotEnvLine(line) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match || line.trimStart().startsWith("#")) return undefined;
  const [, name, raw] = match;
  const quoted = raw.match(/^(["'])(.*)\1$/);
  return [name, quoted ? quoted[2] : raw.replace(/\s+#.*$/, "")];
}

async function loadLocalEnvironment() {
  const file = join(__dirname, ".env.local");
  if (!existsSync(file)) return undefined;
  const source = await readFile(file, "utf8");
  const environment = {};
  for (const line of source.split(/\r?\n/)) {
    const entry = readDotEnvLine(line);
    if (entry) environment[entry[0]] = entry[1];
  }
  return environment;
}

function isLoopback(req) {
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isLoopbackHost(host) {
  const normalized = String(host || "").toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "[::1]";
}

function isAllowedOrigin(req) {
  const value = req.headers.origin;
  const requestHost = String(req.headers.host || "").toLowerCase();
  if (!value || !requestHost) return false;
  try {
    const origin = new URL(value);
    return (origin.protocol === "http:" || origin.protocol === "https:")
      && origin.host.toLowerCase() === requestHost
      && isLoopbackHost(origin.hostname);
  } catch {
    return false;
  }
}

function writeJson(res, statusCode, value) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}

function applySecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "microphone=(self)");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; img-src 'self' data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self';",
  );
}

function send(client, value) {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(value));
}

function safeErrorMessage(error, config) {
  let text = error instanceof Error ? error.message : String(error || "Bilinmeyen hata");
  if (config.apiKey) text = text.split(config.apiKey).join("[REDACTED]");
  return text.replace(/api[-_ ]?key\s*[:=]\s*[^\s,;]+/gi, "api-key=[REDACTED]").slice(0, 360);
}

function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const voice = VOICES.has(source.voice) ? source.voice : "alloy";
  const instructions = String(source.instructions || "You are Quake Voice, a concise and helpful coding assistant.").trim().slice(0, 6_000);
  const threshold = Math.min(0.95, Math.max(0, Number(source.threshold) || 0.5));
  const silenceDurationMs = Math.min(2_000, Math.max(150, Math.round(Number(source.silenceDurationMs) || 500)));
  return { voice, instructions, threshold, silenceDurationMs };
}

function buildSessionUpdate(settings, apiMode) {
  const turnDetection = {
    type: "server_vad",
    threshold: settings.threshold,
    prefix_padding_ms: 300,
    silence_duration_ms: settings.silenceDurationMs,
    create_response: true,
  };
  if (apiMode === "legacy") {
    return {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: settings.instructions,
        voice: settings.voice,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: turnDetection,
      },
    };
  }
  return {
    type: "session.update",
    session: {
      type: "realtime",
      instructions: settings.instructions,
      output_modalities: ["audio"],
      audio: {
        input: {
          transcription: { model: "whisper-1" },
          format: { type: "audio/pcm", rate: 24_000 },
          turn_detection: turnDetection,
        },
        output: {
          voice: settings.voice,
          format: { type: "audio/pcm", rate: 24_000 },
        },
      },
    },
  };
}

function isBase64(value) {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0;
}

function clientMessageToAzureEvents(message, config) {
  if (!message || typeof message !== "object" || typeof message.type !== "string") {
    throw new Error("Geçersiz istemci olayı.");
  }
  if (message.type === "lab.configure") {
    return [buildSessionUpdate(normalizeSettings(message.settings), config.apiMode)];
  }
  if (message.type === "lab.audio.append") {
    const audio = typeof message.audio === "string" ? message.audio : "";
    if (!audio || audio.length > MAX_AUDIO_BASE64_CHARS || !isBase64(audio)) {
      throw new Error("Ses paketi geçersiz veya çok büyük.");
    }
    return [{ type: "input_audio_buffer.append", audio }];
  }
  if (message.type === "lab.text.send") {
    const text = typeof message.text === "string" ? message.text.trim().slice(0, 8_000) : "";
    if (!text) throw new Error("Gönderilecek metin boş.");
    return [
      {
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
      },
      { type: "response.create" },
    ];
  }
  if (message.type === "lab.response.cancel") {
    return [{ type: "response.cancel" }, { type: "input_audio_buffer.clear" }];
  }
  throw new Error("Bu istemci olayı desteklenmiyor.");
}

function redactEvent(event, config) {
  const serialized = JSON.stringify(event).split(config.apiKey || "__no_key__").join("[REDACTED]");
  return JSON.parse(serialized);
}

export function createVoiceLabServer(options = {}) {
  const config = options.config || readLabConfig(options.env || process.env);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/health") {
      writeJson(res, config.configured ? 200 : 503, publicConfig(config));
      return;
    }
    const asset = STATIC_FILES.get(url.pathname);
    if (req.method !== "GET" || !asset) {
      writeJson(res, 404, { error: "Not found" });
      return;
    }
    try {
      const content = await readFile(join(__dirname, asset.file));
      applySecurityHeaders(res);
      res.writeHead(200, { "Content-Type": asset.type });
      res.end(content);
    } catch {
      writeJson(res, 500, { error: "Voice Lab asset could not be loaded." });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });
  server.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url || "", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/api/realtime" || !isLoopback(req) || !isAllowedOrigin(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!config.configured) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => wss.emit("connection", client, req));
  });

  wss.on("connection", (client) => {
    const azureUrl = buildAzureRealtimeUrl(config);
    const headers = { "api-key": config.apiKey };
    if (config.apiMode === "legacy") headers["OpenAI-Beta"] = "realtime=v1";
    const upstream = new WebSocket(azureUrl, { headers });
    const pending = [];
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      try { upstream.close(); } catch { /* already closed */ }
      try { client.close(); } catch { /* already closed */ }
    };
    const sendUpstream = (event) => {
      const serialized = JSON.stringify(event);
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(serialized);
      } else if (upstream.readyState === WebSocket.CONNECTING && event.type === "input_audio_buffer.append") {
        // Audio is realtime data; stale chunks should never build up while the
        // authenticated Azure socket is still negotiating.
        return;
      } else if (upstream.readyState === WebSocket.CONNECTING && pending.length < MAX_QUEUED_UPSTREAM_MESSAGES) {
        pending.push(serialized);
      } else {
        send(client, { type: "lab.error", message: "Azure Realtime bağlantısı hazır değil." });
      }
    };

    send(client, { type: "lab.status", status: "upstream-connecting", ...publicConfig(config) });
    upstream.on("open", () => {
      send(client, { type: "lab.status", status: "upstream-connected", ...publicConfig(config) });
      for (const serialized of pending.splice(0)) upstream.send(serialized);
    });
    upstream.on("message", (raw) => {
      try {
        const event = redactEvent(JSON.parse(raw.toString()), config);
        send(client, { type: "lab.azure.event", event });
      } catch {
        send(client, { type: "lab.error", message: "Azure’dan okunamayan bir olay alındı." });
      }
    });
    upstream.on("error", (error) => {
      send(client, { type: "lab.error", message: safeErrorMessage(error, config) });
    });
    upstream.on("close", (code) => {
      send(client, { type: "lab.status", status: "upstream-disconnected", code });
      if (!closed) close();
    });

    client.on("message", (raw, isBinary) => {
      if (isBinary || raw.byteLength > MAX_CLIENT_MESSAGE_BYTES) {
        send(client, { type: "lab.error", message: "Geçersiz istemci paketi." });
        return;
      }
      try {
        const message = JSON.parse(raw.toString());
        for (const event of clientMessageToAzureEvents(message, config)) sendUpstream(event);
      } catch (error) {
        send(client, { type: "lab.error", message: safeErrorMessage(error, config) });
      }
    });
    client.on("close", close);
    client.on("error", close);
  });

  return {
    server,
    config: publicConfig(config),
    listen(port = 3001, host = "127.0.0.1") {
      if (!isLoopbackHost(host)) {
        return Promise.reject(new Error("Voice Lab yalnızca loopback adreslerinde dinleyebilir."));
      }
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        wss.close();
        server.close(() => resolve());
      });
    },
  };
}

async function main() {
  // A present .env.local is an explicit local profile. Do not merge it with
  // process.env, otherwise an old machine-wide credential could be selected.
  const localEnvironment = await loadLocalEnvironment();
  const environment = localEnvironment ?? process.env;
  const lab = createVoiceLabServer({ env: environment });
  const port = Number(trimEnv(environment.REALTIME_LAB_PORT) || 3001);
  const host = trimEnv(environment.REALTIME_LAB_HOST) || "127.0.0.1";
  await lab.listen(port, host);
  console.log(`[voice-lab] http://${host}:${port}`);
  console.log(`[voice-lab] Azure configuration: ${lab.config.configured ? "ready" : "missing — see .env.example"}`);
  const shutdown = () => void lab.close().finally(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  void main().catch((error) => {
    console.error(`[voice-lab] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
