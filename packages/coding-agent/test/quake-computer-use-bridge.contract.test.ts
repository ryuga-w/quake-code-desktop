import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
	captureDesktopScreenshot,
	computerUseBridgeBase,
	isComputerUseBridgeAvailable,
	listDesktopWindows,
} from "../src/bundled/extensions/quake-computer-use/electron-bridge.js";

let server: http.Server | undefined;
let port = 0;

function startMockBridge(): Promise<void> {
	return new Promise((resolve) => {
		server = http.createServer(async (req, res) => {
			const url = req.url || "";
			res.setHeader("Content-Type", "application/json");
			if (url === "/health" && req.method === "GET") {
				res.end(JSON.stringify({ ok: true, embedded: true, targetWidth: 1280, targetHeight: 800 }));
				return;
			}
			if (url === "/computer-use/session/start" && req.method === "POST") {
				res.end(JSON.stringify({ ok: true }));
				return;
			}
			if (url === "/computer-use/screenshot" && req.method === "POST") {
				res.end(
					JSON.stringify({
						ok: true,
						data: "aGVsbG8=",
						mimeType: "image/png",
						width: 1280,
						height: 800,
						displayId: "screen:0",
						displayName: "Display 1",
						scaleFactor: 1,
						physicalWidth: 1920,
						physicalHeight: 1080,
					}),
				);
				return;
			}
			if (url === "/computer-use/list-windows" && req.method === "POST") {
				res.end(JSON.stringify({ ok: true, windows: [{ id: "win:1", name: "Notepad" }] }));
				return;
			}
			res.statusCode = 404;
			res.end(JSON.stringify({ ok: false, error: "not_found" }));
		});
		server!.listen(0, "127.0.0.1", () => {
			const addr = server!.address();
			port = typeof addr === "object" && addr ? addr.port : 0;
			process.env.QUAKE_COMPUTER_USE_BRIDGE_PORT = String(port);
			process.env.QUAKE_CDP_HOST = "127.0.0.1";
			resolve();
		});
	});
}

afterEach(async () => {
	if (server) {
		await new Promise<void>((resolve) => server!.close(() => resolve()));
		server = undefined;
	}
	delete process.env.QUAKE_COMPUTER_USE_BRIDGE_PORT;
	delete process.env.QUAKE_CDP_HOST;
});

describe("computer-use bridge contract", () => {
	it("probes health endpoint", async () => {
		await startMockBridge();
		expect(await isComputerUseBridgeAvailable()).toBe(true);
		expect(computerUseBridgeBase()).toContain(String(port));
	});

	it("captures screenshot via bridge", async () => {
		await startMockBridge();
		const shot = await captureDesktopScreenshot();
		expect(shot.width).toBe(1280);
		expect(shot.data).toBe("aGVsbG8=");
	});

	it("lists windows via bridge", async () => {
		await startMockBridge();
		const windows = await listDesktopWindows();
		expect(windows).toHaveLength(1);
		expect(windows[0]?.name).toBe("Notepad");
	});
});