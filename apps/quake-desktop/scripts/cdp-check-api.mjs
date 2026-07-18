import http from "node:http";

const list = await new Promise((resolve, reject) => {
  http.get("http://127.0.0.1:9222/json/list", (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => resolve(JSON.parse(data)));
  }).on("error", reject);
});

const page = list.find((p) => p.title === "Quake Code");
const { default: WebSocket } = await import("ws");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => socket.on("open", resolve));
let msgId = 1;
const send = (method, params = {}) => {
  const id = msgId++;
  socket.send(JSON.stringify({ id, method, params }));
  return id;
};
const waitFor = (id) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 15000);
    const onMsg = (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === id) {
        clearTimeout(timer);
        socket.off("message", onMsg);
        resolve(msg.result);
      }
    };
    socket.on("message", onMsg);
  });

const expr = `fetch('/api/extensions').then(async r => ({ status: r.status, text: await r.text() })).then(async raw => { try { const d = JSON.parse(raw.text); return { status: raw.status, names: (d.extensions || []).map(e => e.name), ids: (d.extensions || []).map(e => e.id) }; } catch { return { status: raw.status, error: raw.text.slice(0,200) }; } })`;
const id = send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
const result = await waitFor(id);
console.log(JSON.stringify(result?.result?.value, null, 2));
socket.close();