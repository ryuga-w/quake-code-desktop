import http from "node:http";

const list = await new Promise((resolve, reject) => {
  http.get("http://127.0.0.1:9222/json/list", (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => resolve(JSON.parse(data)));
  }).on("error", reject);
});

const page = list.find((p) => p.url?.includes("5173"));
if (!page) {
  console.log(JSON.stringify({ error: "no 5173 page" }, null, 2));
  process.exit(1);
}

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

async function evalJs(expression) {
  const id = send("Runtime.evaluate", { expression, returnByValue: true });
  return (await waitFor(id)).result?.value;
}

await new Promise((resolve) => socket.on("open", resolve));

const badge = await evalJs(`document.querySelector('.ui-source-badge')?.textContent`);
const extClicked = await evalJs(`(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Eklentiler');
  if (btn) btn.click();
  return !!btn;
})()`);
await new Promise((r) => setTimeout(r, 900));

const extensions = await evalJs(`(() => ({
  badge: document.querySelector('.ui-source-badge')?.textContent,
  filters: Array.from(document.querySelectorAll('[aria-label="Eklenti kaynağı filtresi"] button')).map(b => b.textContent?.trim()),
  chrome: document.body.innerText.includes('Chrome'),
  latex: document.body.innerText.includes('LaTeX'),
  featured: document.body.innerText.includes('Featured'),
  productivity: document.body.innerText.includes('Productivity'),
  openaiFilter: document.body.innerText.includes('OpenAI tarafından'),
}))()`);

const settingsClicked = await evalJs(`(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.title === 'Ayarlar' || b.textContent?.includes('Ayarlar'));
  if (btn) btn.click();
  return !!btn;
})()`);
await new Promise((r) => setTimeout(r, 900));

const settings = await evalJs(`(() => ({
  navRailHidden: !document.body.innerText.includes('Yeni sohbet'),
  back: document.body.innerText.includes('Uygulamaya geri dön'),
  calisma: document.body.innerText.includes('Çalışma modu'),
  fullpage: document.getElementById('app')?.classList.contains('settings-fullpage'),
}))()`);

console.log(JSON.stringify({ badge, extClicked, extensions, settingsClicked, settings }, null, 2));
socket.close();