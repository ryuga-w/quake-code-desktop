import http from "node:http";

const list = await new Promise((resolve, reject) => {
  http.get("http://127.0.0.1:9222/json/list", (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => resolve(JSON.parse(data)));
  }).on("error", reject);
});

const page = list.find((p) => p.url?.includes("5173"));
const { default: WebSocket } = await import("ws");
const socket = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 1;

function send(method, params = {}) {
  const id = msgId++;
  socket.send(JSON.stringify({ id, method, params }));
  return id;
}

function waitFor(id, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeout);
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
}

await new Promise((resolve) => socket.on("open", resolve));

const evalId = send("Runtime.evaluate", {
  expression: `(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.title === 'Ayarlar' || b.textContent?.includes('Ayarlar'));
    if (btn) btn.click();
    return !!btn;
  })()`,
  returnByValue: true,
});
const clicked = (await waitFor(evalId)).result?.value;
await new Promise((r) => setTimeout(r, 800));

const checkId = send("Runtime.evaluate", {
  expression: `(() => ({
    badge: document.querySelector('.ui-source-badge')?.textContent,
    back: document.body.innerText.includes('Uygulamaya geri dön'),
    search: document.body.innerText.includes('Ayarlarda ara'),
    kisisel: document.body.innerText.includes('Kişisel'),
    computerUse: document.body.innerText.includes('Bilgisayar kullanımı'),
    calisma: document.body.innerText.includes('Çalışma modu'),
    sample: document.body.innerText.slice(0, 600)
  }))()`,
  returnByValue: true,
});
const state = (await waitFor(checkId)).result?.value;
console.log(JSON.stringify({ clicked, state }, null, 2));
socket.close();