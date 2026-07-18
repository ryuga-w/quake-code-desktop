/**
 * Computer-use smoke suite (Windows + Quake Desktop Electron bridge).
 * Requires: bridge on QUAKE_COMPUTER_USE_BRIDGE_PORT (default 9224).
 *
 *   npm run computer-use:smoke
 */
const base = `http://127.0.0.1:${process.env.QUAKE_COMPUTER_USE_BRIDGE_PORT || "9224"}`;

async function post(path, body = {}) {
	const res = await fetch(`${base}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(120_000),
	});
	const data = await res.json();
	if (!res.ok || data.ok === false) {
		throw new Error(data.error || `${path} failed (${res.status})`);
	}
	return data;
}

async function get(path) {
	const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });
	const data = await res.json();
	if (!res.ok || data.ok === false) throw new Error(data.error || `${path} failed`);
	return data;
}

function assert(cond, msg) {
	if (!cond) throw new Error(msg);
}

async function main() {
	console.log(`[computer-use:smoke] bridge ${base}`);
	const health = await get("/health");
	assert(health.ok === true && health.embedded === true, "bridge not healthy/embedded");
	console.log("  health OK");

	// Ensure clean session
	await post("/computer-use/session/end").catch(() => {});
	await post("/computer-use/session/start");
	console.log("  session start OK");

	// --- calc open/focus/type/close ---
	await post("/computer-use/open-app", { app: "calc" });
	await new Promise((r) => setTimeout(r, 1500));
	const focus = await post("/computer-use/focus-window", { title: "Hesap" });
	assert(focus.detail?.focused !== false, "calc focus failed");
	console.log("  calc open+focus OK", focus.detail?.title || "");

	const snap = await post("/computer-use/uia/snapshot", { title: "Hesap", max: 50 });
	const elements = snap.detail?.elements || [];
	assert(elements.length > 5, `uia snapshot too small: ${elements.length}`);
	console.log(`  uia snapshot OK (${elements.length} elements)`);

	// Prefer Turkish accessible names when present
	const tryNames = ["Bir", "Artı", "Yedi", "Eşittir", "1", "+", "7", "="];
	let invoked = 0;
	for (const name of tryNames) {
		try {
			await post("/computer-use/uia/invoke", { title: "Hesap", name, contains: true });
			invoked += 1;
		} catch {
			/* optional names */
		}
	}
	assert(invoked >= 1, "uia invoke: no named buttons worked");
	console.log(`  uia invoke OK (${invoked} names)`);

	// Host latency: warm keys
	const times = [];
	for (let i = 0; i < 6; i++) {
		const t0 = Date.now();
		await post("/computer-use/actuate", { action: "key", key: "escape" });
		times.push(Date.now() - t0);
	}
	const avg = times.reduce((a, b) => a + b, 0) / times.length;
	console.log(`  key latency avg ${avg.toFixed(0)}ms (min ${Math.min(...times)} max ${Math.max(...times)})`);
	assert(avg < 500, `key latency too high: ${avg}ms`);

	await post("/computer-use/close-window", { title: "Hesap" });
	console.log("  calc close OK");

	// --- notepad type (ASCII + Turkish Unicode) ---
	await post("/computer-use/open-app", { app: "notepad" });
	await new Promise((r) => setTimeout(r, 1200));
	try {
		await post("/computer-use/focus-window", { title: "Not" });
	} catch {
		await post("/computer-use/focus-window", { title: "Untitled" }).catch(() => {});
	}
	await post("/computer-use/actuate", { action: "type", text: "quake-smoke" });
	console.log("  notepad type OK");
	// Unicode path (ğüşöçı) via KEYEVENTF_UNICODE
	await post("/computer-use/actuate", { action: "type", text: " guşöçİ" });
	console.log("  notepad unicode type OK");
	// Paste path
	await post("/computer-use/actuate", {
		action: "paste",
		text: " [paste-ok]",
	});
	console.log("  notepad paste OK");

	// --- focus steal recovery: open calc on top, re-focus notepad ---
	await post("/computer-use/open-app", { app: "calc" });
	await new Promise((r) => setTimeout(r, 1200));
	await post("/computer-use/focus-window", { title: "Hesap" });
	const refocus = await post("/computer-use/focus-window", { title: "Not" }).catch(async () =>
		post("/computer-use/focus-window", { title: "Untitled" }),
	);
	assert(refocus.detail?.focused !== false, "focus steal recovery failed");
	const fg = String(refocus.detail?.foreground || refocus.detail?.title || "");
	console.log(`  focus steal recovery OK (fg=${fg || "?"})`);

	try {
		await post("/computer-use/close-window", { title: "Not" });
	} catch {
		await post("/computer-use/close-window", { title: "Untitled" }).catch(() => {});
	}
	await post("/computer-use/close-window", { title: "Hesap" }).catch(() => {});
	// Notepad may prompt save — best-effort kill
	try {
		const { execFileSync } = await import("node:child_process");
		execFileSync("taskkill", ["/IM", "notepad.exe", "/F"], { stdio: "ignore", windowsHide: true });
		execFileSync("taskkill", ["/IM", "CalculatorApp.exe", "/F"], { stdio: "ignore", windowsHide: true });
	} catch {
		/* ignore */
	}
	console.log("  notepad+calc cleanup OK");

	// --- list apps / displays / uac ---
	const apps = await post("/computer-use/list-apps", {});
	const appCount = apps.detail?.count ?? apps.detail?.apps?.length ?? 0;
	assert(appCount >= 5, `list_apps too small: ${appCount}`);
	console.log(`  list_apps OK (${appCount})`);

	const displays = await get("/computer-use/displays");
	assert(Array.isArray(displays.displays) && displays.displays.length >= 1, "no displays");
	console.log(`  displays OK (${displays.displays.length})`);

	const uac = await post("/computer-use/detect-uac", {});
	assert(typeof uac.detail?.present === "boolean", "detect_uac shape");
	console.log(`  detect_uac OK (present=${uac.detail.present})`);

	await post("/computer-use/session/end");
	const endHealth = await get("/health");
	assert(endHealth.sessionActive === false, "session should be inactive");
	console.log("  session end OK");

	console.log("[computer-use:smoke] ALL PASSED");
}

main().catch((err) => {
	console.error("[computer-use:smoke] FAILED:", err.message || err);
	process.exitCode = 1;
});
