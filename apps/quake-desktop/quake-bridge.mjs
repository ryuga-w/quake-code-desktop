import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import path from "node:path";

const DEFAULT_QUAKE_REPO = "C:\\Users\\musta\\quake code\\quake code";
const DEFAULT_QUAKE_CLI = path.join(
  DEFAULT_QUAKE_REPO,
  "packages",
  "coding-agent",
  "dist",
  "cli.js"
);

const PORT = Number(process.env.QUAKE_BRIDGE_PORT || 8788);
const QUAKE_REPO = process.env.QUAKE_REPO || DEFAULT_QUAKE_REPO;
const QUAKE_CLI = process.env.QUAKE_CLI || DEFAULT_QUAKE_CLI;
const ALLOWED_ROOTS = (process.env.QUAKE_ALLOWED_ROOTS || QUAKE_REPO)
  .split(path.delimiter)
  .map((root) => path.resolve(root.trim()))
  .filter(Boolean);

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(data));
}

function assertAllowedCwd(cwd) {
  const resolved = path.resolve(cwd || QUAKE_REPO);
  const allowed = ALLOWED_ROOTS.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );
  if (!allowed) {
    throw new Error(`cwd is outside allowed roots: ${resolved}`);
  }
  return resolved;
}

function pushJsonl(bufferState, chunk, onJson) {
  bufferState.buffer += bufferState.decoder.write(chunk);
  while (true) {
    const index = bufferState.buffer.indexOf("\n");
    if (index === -1) break;
    let line = bufferState.buffer.slice(0, index);
    bufferState.buffer = bufferState.buffer.slice(index + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.trim().startsWith("{")) continue;
    try {
      onJson(JSON.parse(line));
    } catch {
      // Ignore non-JSONL diagnostics
    }
  }
}

function runQuakePrompt({
  prompt,
  cwd,
  provider,
  model,
  allowMutations = true,
  timeoutMs = 180_000
}) {
  return new Promise((resolve, reject) => {
    if (!prompt || typeof prompt !== "string") {
      reject(new Error("prompt is required"));
      return;
    }

    const args = [
      QUAKE_CLI,
      "--mode",
      "rpc",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates"
    ];

    if (!allowMutations) {
      args.push("--tools", "read,grep,find,ls");
    }

    if (provider) args.push("--provider", String(provider));
    if (model) args.push("--model", String(model));

    const child = spawn(process.execPath, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    const stdoutState = { decoder: new StringDecoder("utf8"), buffer: "" };
    const stderrState = { decoder: new StringDecoder("utf8"), buffer: "" };
    const textParts = [];
    const toolEvents = [];
    const diagnostics = [];
    let settled = false;

    const timer = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error(`Quake prompt timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      pushJsonl(stdoutState, chunk, (event) => {
        if (event.type === "message_update") {
          const delta = event.assistantMessageEvent;
          if (delta?.type === "text_delta") textParts.push(delta.delta);
        }
        if (
          event.type === "tool_execution_start" ||
          event.type === "tool_execution_end"
        ) {
          toolEvents.push({
            type: event.type,
            toolName: event.toolName,
            isError: event.isError,
            result: event.result
          });
        }
        if (event.type === "agent_end" && !settled) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          resolve({
            text: textParts.join("").trim(),
            toolEvents,
            diagnostics
          });
        }
      });
    });

    child.stderr.on("data", (chunk) => {
      pushJsonl(stderrState, chunk, (event) => {
        if (event.type === "diagnostic") {
          diagnostics.push(event);
        }
      });
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (code === 0 && textParts.length > 0) {
          resolve({
            text: textParts.join("").trim(),
            toolEvents,
            diagnostics
          });
        } else {
          reject(new Error(`Quake exited with code ${code}`));
        }
      }
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, {
      ok: true,
      port: PORT,
      quakeRepo: QUAKE_REPO,
      allowedRoots: ALLOWED_ROOTS
    });
    return;
  }

  if (req.method === "POST" && req.url === "/execute") {
    try {
      const body = await readJsonBody(req);
      const { prompt, cwd, provider, model, allowMutations, timeoutMs } = body;

      const safeCwd = assertAllowedCwd(cwd);

      const result = await runQuakePrompt({
        prompt,
        cwd: safeCwd,
        provider,
        model,
        allowMutations,
        timeoutMs
      });

      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message || String(error)
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Quake Bridge listening on http://localhost:${PORT}`);
  console.log(`QUAKE_REPO: ${QUAKE_REPO}`);
  console.log(`ALLOWED_ROOTS: ${ALLOWED_ROOTS.join(path.delimiter)}`);
});
