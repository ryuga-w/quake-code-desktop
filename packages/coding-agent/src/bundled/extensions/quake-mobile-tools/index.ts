import type { ExtensionAPI } from "@mrquake/quakecode-cli";
import { StringEnum } from "@mrquake/quakecode-ai";
import { Type } from "@sinclair/typebox";
import { mobileGet, mobilePost, mobileScreenshot } from "./api.js";

type Platform = "android" | "ios";
type Device = { id: string; platform: Platform; name: string; kind: string; status: string };
type Status = { devices: Device[]; androidVirtualDevices: Array<{ name: string; running: boolean; deviceId?: string }>; buildProfiles: Array<{ id: string; name: string; platform: Platform; source: string }>; capabilities: Array<{ platform: Platform; available: boolean; mode: string; message?: string }>; targets: Array<{ platform: Platform; status: string; deviceId?: string; message?: string }> };
type Node = { index: number; ref: string; fingerprint: string; text?: string; resourceId?: string; className?: string; contentDescription?: string; clickable: boolean; enabled: boolean; focused: boolean; bounds?: { left: number; top: number; right: number; bottom: number } };
type Snapshot = { platform: Platform; deviceId: string; snapshotId: string; revision: number; capturedAt: string; nodes: Node[] };
type RuntimeLog = { timestamp?: string; level: string; tag?: string; pid?: number; message: string };

const platformSchema = StringEnum(["android", "ios"] as const, { description: "Target mobile platform" });

function text(value: string) {
	return { content: [{ type: "text" as const, text: value }] };
}

async function status(signal?: AbortSignal): Promise<Status> {
	return mobileGet<Status>("/api/mobile/status", signal);
}

async function resolveDevice(platform: Platform, requested: string | undefined, signal?: AbortSignal): Promise<Device> {
	const current = await status(signal);
	const device = requested
		? current.devices.find((candidate) => candidate.id === requested && candidate.platform === platform)
		: current.devices.find((candidate) => candidate.platform === platform && candidate.status === "ready");
	if (!device) throw new Error(`${platform} için hazır mobil cihaz bulunamadı`);
	return device;
}

function reference(node: Node): string {
	return `ref=${node.ref}`;
}

function snapshotText(snapshot: Snapshot): string {
	const visible = snapshot.nodes.filter((node) => node.text || node.contentDescription || node.resourceId || node.clickable);
	const rows = visible.map((node) => {
		const label = node.text || node.contentDescription || node.resourceId || node.className || "element";
		const metadata = [node.className, node.resourceId, node.clickable ? "clickable" : "", node.focused ? "focused" : ""].filter(Boolean).join(" · ");
		const bounds = node.bounds ? ` [${node.bounds.left},${node.bounds.top}][${node.bounds.right},${node.bounds.bottom}]` : "";
		return `- ${label} [${reference(node)}]${metadata ? ` (${metadata})` : ""}${bounds}`;
	});
	return [`Platform: ${snapshot.platform}`, `Device: ${snapshot.deviceId}`, `Captured: ${snapshot.capturedAt}`, "Elements:", ...rows].join("\n");
}

async function resolveTarget(platform: Platform, deviceId: string | undefined, target: string, signal?: AbortSignal): Promise<{ device: Device; node: Node; snapshot: Snapshot }> {
	const device = await resolveDevice(platform, deviceId, signal);
	const params = new URLSearchParams({ platform, deviceId: device.id });
	const snapshot = await mobileGet<Snapshot>(`/api/mobile/snapshot?${params}`, signal);
	const refValue = target.match(/^ref=(m:[a-f0-9.]+)$/i)?.[1];
	const matches = snapshot.nodes.filter((candidate) => refValue ? candidate.ref === refValue : candidate.resourceId === target || candidate.text === target || candidate.contentDescription === target);
	if (matches.length !== 1) throw new Error(matches.length ? `Mobil hedef belirsiz: ${target}. Benzersiz ref kullanın.` : `Mobil hedef bulunamadı: ${target}. Önce mobile_snapshot çağırın.`);
	return { device, node: matches[0]!, snapshot };
}

export default function (quake: ExtensionAPI) {
	quake.registerTool({
		name: "mobile_status",
		label: "mobile_status",
		description: "List Android/iOS runtime capabilities, emulators, connected devices, and build profiles in Quake Mobile Studio.",
		promptSnippet: "Inspect Android/iOS devices, emulators, and mobile build profiles",
		parameters: Type.Object({}),
		async execute(_id, _params, signal) {
			const current = await status(signal);
			const output = [
				...current.capabilities.map((capability) => `${capability.platform}: ${capability.available ? "available" : capability.mode}${capability.message ? ` · ${capability.message}` : ""}`),
				`Devices: ${current.devices.length ? current.devices.map((device) => `${device.platform}/${device.id} (${device.status}, ${device.name})`).join(", ") : "none"}`,
				`Android AVDs: ${current.androidVirtualDevices.length ? current.androidVirtualDevices.map((avd) => `${avd.name}${avd.running ? " (running)" : ""}`).join(", ") : "none"}`,
				`Build profiles: ${current.buildProfiles.length ? current.buildProfiles.map((profile) => `${profile.id} (${profile.platform}, ${profile.name})`).join(", ") : "none"}`,
			].join("\n");
			return { ...text(output), details: current };
		},
	});

	quake.registerTool({
		name: "mobile_start_device",
		label: "mobile_start_device",
		description: "Start an Android virtual device. iOS simulators require a connected Quake Mobile Runner on macOS.",
		promptSnippet: "Start an Android emulator or remote iOS simulator",
		parameters: Type.Object({ platform: platformSchema, name: Type.String({ description: "Virtual device name from mobile_status" }) }),
		async execute(_id, params, signal) {
			await mobilePost("/api/mobile/emulator/start", params, signal);
			return { ...text(`Starting ${params.platform} virtual device: ${params.name}`), details: params };
		},
	});

	quake.registerTool({
		name: "mobile_snapshot",
		label: "mobile_snapshot",
		description: "Capture the native accessibility/UI hierarchy and return stable ref=mN targets for mobile interaction tools.",
		promptSnippet: "Capture a semantic Android/iOS UI snapshot with element refs",
		promptGuidelines: [
			"Always call mobile_snapshot before mobile_tap or mobile_type so actions use semantic ref=mN targets instead of coordinates.",
			"Use mobile_screenshot separately when visual layout, spacing, colors, or images must be inspected.",
		],
		parameters: Type.Object({ platform: platformSchema, deviceId: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) {
			const device = await resolveDevice(params.platform, params.deviceId, signal);
			const query = new URLSearchParams({ platform: params.platform, deviceId: device.id });
			const snapshot = await mobileGet<Snapshot>(`/api/mobile/snapshot?${query}`, signal);
			return { ...text(snapshotText(snapshot)), details: snapshot };
		},
	});

	quake.registerTool({
		name: "mobile_screenshot",
		label: "mobile_screenshot",
		description: "Capture the current Android/iOS device screen for visual inspection.",
		promptSnippet: "Capture a mobile device screenshot",
		parameters: Type.Object({ platform: platformSchema, deviceId: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) {
			const device = await resolveDevice(params.platform, params.deviceId, signal);
			const screenshot = await mobileScreenshot(params.platform, device.id, signal);
			return {
				content: [
					{ type: "text" as const, text: `Captured ${params.platform} screenshot from ${device.name} (${screenshot.length} bytes).` },
					{ type: "image" as const, data: screenshot.toString("base64"), mimeType: "image/png" },
				],
				details: { platform: params.platform, deviceId: device.id, bytes: screenshot.length },
			};
		},
	});

	quake.registerTool({
		name: "mobile_tap",
		label: "mobile_tap",
		description: "Tap a semantic mobile element using a ref=mN from mobile_snapshot, visible text, accessibility description, or resource ID.",
		promptSnippet: "Tap a native mobile element by semantic ref",
		promptGuidelines: ["Always call mobile_snapshot first and prefer ref=mN targets."],
		parameters: Type.Object({ platform: platformSchema, target: Type.String({ description: "ref=mN from mobile_snapshot, text, accessibility description, or resource ID" }), deviceId: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) {
			const { device, node, snapshot } = await resolveTarget(params.platform, params.deviceId, params.target, signal);
			if (!node.bounds) throw new Error(`Mobil hedefin dokunma koordinatı yok: ${params.target}`);
			await mobilePost("/api/mobile/action", { platform: params.platform, deviceId: device.id, action: { type: "tap_element", ref: node.ref, snapshotId: snapshot.snapshotId, revision: snapshot.revision } }, signal);
			return { ...text(`Tapped ${params.target} on ${device.name}`), details: { deviceId: device.id, target: params.target, node } };
		},
	});

	quake.registerTool({
		name: "mobile_type",
		label: "mobile_type",
		description: "Focus a semantic mobile element and type text into the current Android/iOS device.",
		promptSnippet: "Type text into a native mobile element",
		promptGuidelines: ["Always call mobile_snapshot first and use a ref=mN target."],
		parameters: Type.Object({ platform: platformSchema, target: Type.String({ description: "ref=mN from mobile_snapshot" }), text: Type.String(), deviceId: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) {
			const { device, node, snapshot } = await resolveTarget(params.platform, params.deviceId, params.target, signal);
			if (!node.bounds) throw new Error(`Mobil hedefin odak koordinatı yok: ${params.target}`);
			await mobilePost("/api/mobile/action", { platform: params.platform, deviceId: device.id, action: { type: "tap_element", ref: node.ref, snapshotId: snapshot.snapshotId, revision: snapshot.revision } }, signal);
			await mobilePost("/api/mobile/action", { platform: params.platform, deviceId: device.id, action: { type: "type", text: params.text } }, signal);
			return { ...text(`Typed into ${params.target} on ${device.name}`), details: { deviceId: device.id, target: params.target, characters: params.text.length } };
		},
	});

	quake.registerTool({
		name: "mobile_swipe",
		label: "mobile_swipe",
		description: "Swipe on a mobile device using native screen coordinates.",
		promptSnippet: "Swipe on an Android/iOS device",
		parameters: Type.Object({ platform: platformSchema, fromX: Type.Number(), fromY: Type.Number(), toX: Type.Number(), toY: Type.Number(), durationMs: Type.Optional(Type.Number()), deviceId: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) {
			const device = await resolveDevice(params.platform, params.deviceId, signal);
			await mobilePost("/api/mobile/action", { platform: params.platform, deviceId: device.id, action: { type: "swipe", fromX: params.fromX, fromY: params.fromY, toX: params.toX, toY: params.toY, durationMs: params.durationMs } }, signal);
			return { ...text(`Swiped on ${device.name}`), details: { deviceId: device.id, ...params } };
		},
	});

	quake.registerTool({
		name: "mobile_press",
		label: "mobile_press",
		description: "Press Back, Home, or App Switch on an Android/iOS device.",
		promptSnippet: "Press a mobile system navigation key",
		parameters: Type.Object({ platform: platformSchema, key: StringEnum(["back", "home", "app-switch"] as const), deviceId: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) {
			const device = await resolveDevice(params.platform, params.deviceId, signal);
			await mobilePost("/api/mobile/action", { platform: params.platform, deviceId: device.id, action: { type: "key", key: params.key } }, signal);
			return { ...text(`Pressed ${params.key} on ${device.name}`), details: { deviceId: device.id, key: params.key } };
		},
	});

	quake.registerTool({
		name: "mobile_logs",
		label: "mobile_logs",
		description: "Read recent Android Logcat or iOS runtime logs. Output is capped at 500 entries.",
		promptSnippet: "Read recent mobile runtime logs",
		parameters: Type.Object({ platform: platformSchema, lines: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })), deviceId: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) {
			const device = await resolveDevice(params.platform, params.deviceId, signal);
			const query = new URLSearchParams({ platform: params.platform, deviceId: device.id, lines: String(params.lines || 120) });
			const response = await mobileGet<{ logs: RuntimeLog[] }>(`/api/mobile/logs?${query}`, signal);
			const output = response.logs.map((log) => `${log.timestamp || ""} ${log.level.toUpperCase()} ${log.tag || "app"}: ${log.message}`).join("\n") || "No recent mobile logs.";
			return { ...text(output), details: { deviceId: device.id, logs: response.logs } };
		},
	});

	quake.registerTool({
		name: "mobile_build_parallel",
		label: "mobile_build_parallel",
		description: "Build Android and iOS profiles concurrently and return independent per-platform results. One platform failure does not discard the other result.",
		promptSnippet: "Build Android and iOS mobile profiles in parallel",
		parameters: Type.Object({
			androidProfileId: Type.Optional(Type.String()),
			iosProfileId: Type.Optional(Type.String()),
			androidDeviceId: Type.Optional(Type.String()),
			iosDeviceId: Type.Optional(Type.String()),
		}),
		async execute(_id, params, signal, onUpdate) {
			const jobs = [
				params.androidProfileId ? { platform: "android", profileId: params.androidProfileId, deviceId: params.androidDeviceId } : undefined,
				params.iosProfileId ? { platform: "ios", profileId: params.iosProfileId, deviceId: params.iosDeviceId } : undefined,
			].filter((job): job is { platform: string; profileId: string; deviceId: string | undefined } => Boolean(job));
			if (!jobs.length) throw new Error("En az bir Android veya iOS build profili gerekli");
			onUpdate?.(text(`Building ${jobs.map((job) => job.platform).join(" + ")} in parallel…`));
			const settled = await Promise.all(jobs.map(async (job) => {
				try {
					const response = await mobilePost<{ result: { success: boolean; exitCode: number | null; durationMs: number; stdout: string; stderr: string; installed?: boolean; launched?: boolean } }>("/api/mobile/build", { profileId: job.profileId, deviceId: job.deviceId }, signal);
					return { platform: job.platform, profileId: job.profileId, ...response.result };
				} catch (error) {
					return { platform: job.platform, profileId: job.profileId, success: false, error: error instanceof Error ? error.message : String(error) };
				}
			}));
			const output = settled.map((result) => `${result.platform}: ${result.success ? "passed" : "failed"}${"durationMs" in result ? ` · ${Math.max(1, Math.round(result.durationMs / 1000))}s` : ""}${"installed" in result && result.installed ? " · installed" : ""}${"error" in result ? `\n${result.error}` : ""}`).join("\n");
			return { ...text(output), details: { results: settled } };
		},
	});

	quake.registerTool({
		name: "mobile_wait_for",
		label: "mobile_wait_for",
		description: "Wait until a semantic Android element appears.",
		parameters: Type.Object({ platform: platformSchema, target: Type.String(), timeoutMs: Type.Optional(Type.Number({ minimum: 100, maximum: 60000 })), deviceId: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) { const deadline = Date.now() + (params.timeoutMs || 10000); while (Date.now() < deadline) { try { const result = await resolveTarget(params.platform, params.deviceId, params.target, signal); return { ...text(`Found ${params.target}`), details: result.node }; } catch { await new Promise((resolve) => setTimeout(resolve, 400)); } } throw new Error(`Timeout waiting for ${params.target}`); },
	});

	quake.registerTool({
		name: "mobile_assert",
		label: "mobile_assert",
		description: "Assert that a semantic Android element is visible.",
		parameters: Type.Object({ platform: platformSchema, target: Type.String(), deviceId: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) { const result = await resolveTarget(params.platform, params.deviceId, params.target, signal); return { ...text(`Assertion passed: ${params.target}`), details: result.node }; },
	});

	quake.registerTool({
		name: "mobile_long_press",
		label: "mobile_long_press",
		description: "Long press a semantic Android element.",
		parameters: Type.Object({ platform: platformSchema, target: Type.String(), durationMs: Type.Optional(Type.Number()), deviceId: Type.Optional(Type.String()) }),
		async execute(_id, params, signal) { const { device, node } = await resolveTarget(params.platform, params.deviceId, params.target, signal); if (!node.bounds) throw new Error("Element bounds unavailable"); await mobilePost("/api/mobile/action", { platform: params.platform, deviceId: device.id, action: { type: "long_press", x: (node.bounds.left + node.bounds.right) / 2, y: (node.bounds.top + node.bounds.bottom) / 2, durationMs: params.durationMs } }, signal); return text(`Long pressed ${params.target}`); },
	});

	for (const operation of ["launch", "terminate", "clear-data", "deep-link", "grant", "revoke", "uninstall"] as const) quake.registerTool({
		name: `mobile_${operation === "clear-data" ? "clear_data" : operation === "deep-link" ? "deep_link" : operation === "grant" || operation === "revoke" ? "permission" : operation}`,
		label: `mobile_${operation}`,
		description: `Android application operation: ${operation}. Destructive operations require confirmed=true.`,
		parameters: Type.Object({ deviceId: Type.String(), packageName: Type.String(), value: Type.Optional(Type.String()), confirmed: Type.Optional(Type.Boolean()) }),
		async execute(_id, params, signal) { if (["clear-data", "uninstall"].includes(operation) && params.confirmed !== true) throw new Error("Bu yıkıcı işlem confirmed=true gerektirir"); await mobilePost("/api/mobile/app", { deviceId: params.deviceId, packageName: params.packageName, operation, value: params.value }, signal); return text(`${operation} completed for ${params.packageName}`); },
	});

	quake.registerTool({
		name: "mobile_set_device_state", label: "mobile_set_device_state", description: "Set Android emulator location, network, battery, locale, timezone, theme, or font scale.", parameters: Type.Object({ deviceId: Type.String(), state: Type.Record(Type.String(), Type.Unknown()) }), async execute(_id, params, signal) { await mobilePost("/api/mobile/device/state", params, signal); return text("Android device state updated"); },
	});

	quake.registerTool({
		name: "mobile_build_job", label: "mobile_build_job", description: "Queue a cancellable Android build job.", parameters: Type.Object({ profileId: Type.String(), deviceId: Type.Optional(Type.String()) }), async execute(_id, params, signal) { const response = await mobilePost<{ job: unknown }>("/api/mobile/build/jobs", params, signal); return { ...text("Build job queued"), details: response.job }; },
	});

	quake.registerTool({
		name: "mobile_build",
		label: "mobile_build",
		description: "Build a framework-independent mobile profile and optionally install/launch its artifact on the selected device.",
		promptSnippet: "Build, install, and launch a configured Android/iOS app",
		parameters: Type.Object({ profileId: Type.String({ description: "Build profile ID from mobile_status" }), deviceId: Type.Optional(Type.String()) }),
		async execute(_id, params, signal, onUpdate) {
			onUpdate?.(text(`Building mobile profile ${params.profileId}…`));
			const response = await mobilePost<{ result: { success: boolean; exitCode: number | null; durationMs: number; stdout: string; stderr: string; installed?: boolean; launched?: boolean } }>("/api/mobile/build", params, signal);
			const result = response.result;
			if (!result.success) throw new Error(`Mobile build failed (exit ${result.exitCode ?? "?"})\n${(result.stderr || result.stdout).slice(-8000)}`);
			return { ...text(`Mobile build completed in ${Math.max(1, Math.round(result.durationMs / 1000))}s${result.installed ? " · installed" : ""}${result.launched ? " · launched" : ""}`), details: result };
		},
	});
}
