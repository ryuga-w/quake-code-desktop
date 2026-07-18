import http from "node:http";

const list = await new Promise((resolve, reject) => {
  http.get("http://127.0.0.1:9222/json/list", (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => resolve(JSON.parse(data)));
  }).on("error", reject);
});

const page = list.find((p) => p.url?.includes("5173") || p.title === "Quake Code");
if (!page?.webSocketDebuggerUrl) {
  console.log(JSON.stringify({ error: "no_electron_page", pages: list.map((p) => ({ title: p.title, url: p.url })) }));
  process.exit(1);
}

const { default: WebSocket } = await import("ws");
const socket = new WebSocket(page.webSocketDebuggerUrl);

const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timeout")), 10000);
  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression: `(() => {
            const badge = document.querySelector(".ui-source-badge")?.textContent || null;
            const sidebarPrimary = document.querySelectorAll(".sidebar-primary").length;
            const appShell = !!document.querySelector(".app-shell");
            const titlebar = !!document.querySelector(".titlebar");
            const navActions = Array.from(document.querySelectorAll("button span")).map(s => s.textContent?.trim()).filter(Boolean).slice(0, 12);
            const text = document.body?.innerText || "";
            return {
              url: location.href,
              badge,
              sidebarPrimary,
              appShell,
              titlebar,
              hasNavRailLabels: ["Yeni sohbet","Arama","Eklentiler"].every(l => text.includes(l)),
              hasQuickLauncher: text.includes("İncele") && text.includes("Tarayıcı"),
              hasOldSearchSettings: text.includes("Search settings"),
              hasTurkishSettings: text.includes("Ayarlarda ara"),
              mounted: !!window.__QUAKE_UI_MOUNTED__,
              navActions,
              sample: text.slice(0, 500)
            };
          })()`,
          returnByValue: true,
        },
      }),
    );
  });
  socket.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.result?.result?.value) {
      clearTimeout(timer);
      resolve(msg.result.result.value);
      socket.close();
    }
  });
  socket.on("error", reject);
});

console.log(JSON.stringify(result, null, 2));