import http from "node:http";
import { default as WebSocket } from "ws";

const targets = await new Promise((resolve, reject) => {
  http.get("http://127.0.0.1:9222/json/list", (response) => {
    let data = "";
    response.on("data", (chunk) => {
      data += chunk;
    });
    response.on("end", () => resolve(JSON.parse(data)));
  }).on("error", reject);
});

const page = targets.find((target) => target.url?.includes("5173") || target.title === "Quake Code");
if (!page?.webSocketDebuggerUrl) {
  console.error(JSON.stringify({ error: "no_electron_page", targets }, null, 2));
  process.exit(1);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 10_000);
    pending.set(id, { resolve, reject, timer });
  });
}

socket.on("message", (raw) => {
  const message = JSON.parse(String(raw));
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  if (message.method !== "Debugger.paused") return;
  const callFrames = (message.params?.callFrames || []).slice(0, 30).map((frame) => ({
    functionName: frame.functionName,
    url: frame.url,
    line: frame.location?.lineNumber != null ? frame.location.lineNumber + 1 : undefined,
    column: frame.location?.columnNumber != null ? frame.location.columnNumber + 1 : undefined,
  }));
  console.log(JSON.stringify({
    reason: message.params?.reason,
    hitBreakpoints: message.params?.hitBreakpoints,
    callFrames,
  }, null, 2));
  void send("Debugger.resume").finally(() => socket.close());
});

await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

socket.send(JSON.stringify({ id: nextId++, method: "Debugger.enable", params: {} }));
socket.send(JSON.stringify({ id: nextId++, method: "Debugger.pause", params: {} }));

setTimeout(() => {
  console.error("Debugger.pause timed out");
  socket.close();
  process.exitCode = 1;
}, 15_000).unref();
