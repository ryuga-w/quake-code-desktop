import net from "node:net";

/** Boş bir TCP portu bul (ephemeral). */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("Boş port alınamadı"))));
    });
  });
}

/** host:port dinlemeye başlayana kadar bekle (smoke.mjs deseni). */
export function waitUntilListening(host: string, port: number, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ host, port });
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`Zaman aşımı: ${host}:${port} dinlemiyor`));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}
