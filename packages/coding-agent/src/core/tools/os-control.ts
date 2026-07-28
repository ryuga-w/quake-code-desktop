import { spawnSync } from "node:child_process";
import type { AgentTool } from "@mrquake/quakecode-agent-core";
import { type Static, Type } from "@sinclair/typebox";
import type { ToolDefinition } from "../extensions/index.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";

const pythonScript = "C:\\Users\\musta\\quake code\\quake code\\packages\\os-bridge\\scripts\\inspector.py";
const DEFAULT_WAIT_TIMEOUT_MS = 8000;
const DEFAULT_WAIT_INTERVAL_MS = 350;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function runPython(payload?: string) {
	return spawnSync("python", payload ? [pythonScript, payload] : [pythonScript], {
		encoding: "utf-8",
		maxBuffer: 15 * 1024 * 1024,
		timeout: 30000, // 30 second timeout for Python UI bridge
	});
}

function inspectSnapshot() {
	const result = runPython();
	if (result.error || result.status !== 0) {
		throw new Error(result.stderr || result.error?.message || "Process failed");
	}
	const data = JSON.parse(result.stdout);
	if (data.status === "error") {
		throw new Error(data.message || "Inspection failed");
	}
	return data;
}

function stringifyLegend(elements: any[] | undefined): string {
	if (!elements?.length) return "No interactive elements detected";
	return elements
		.slice(0, 80)
		.map((el) => {
			const center = Array.isArray(el.center) ? ` @ ${el.center[0]},${el.center[1]}` : "";
			const scope = el.windowTitle && !el.isWindow ? ` <${el.windowTitle}>` : "";
			return `[${el.id}] ${el.name} (${el.type})${scope} - HWND: ${el.hwnd}${center}`;
		})
		.join("\n");
}

function snapshotContainsText(snapshot: any, query: string): boolean {
	const q = query.toLocaleLowerCase();
	const haystacks: string[] = [];
	if (snapshot.activeWindow?.title) haystacks.push(String(snapshot.activeWindow.title));
	for (const w of snapshot.windows || []) {
		if (w?.title) haystacks.push(String(w.title));
	}
	for (const el of snapshot.elements || []) {
		if (el?.name) haystacks.push(String(el.name));
		if (el?.windowTitle) haystacks.push(String(el.windowTitle));
	}
	return haystacks.some((text) => text.toLocaleLowerCase().includes(q));
}

function findWindowMatch(snapshot: any, title: string, hwnd?: number): any | undefined {
	const normalizedTitle = title.toLocaleLowerCase();
	return (snapshot.windows || []).find((w: any) => {
		if (hwnd && Number(w?.hwnd) !== Number(hwnd)) return false;
		if (!title) return true;
		return String(w?.title || "")
			.toLocaleLowerCase()
			.includes(normalizedTitle);
	});
}

function snapshotHasHwnd(snapshot: any, hwnd: number): boolean {
	return (snapshot.windows || []).some((w: any) => Number(w?.hwnd) === Number(hwnd));
}

function snapshotHasForegroundHwnd(snapshot: any, hwnd: number): boolean {
	return Number(snapshot?.activeWindow?.hwnd) === Number(hwnd);
}

function snapshotHasFocusedHwnd(snapshot: any, hwnd: number): boolean {
	return Number(snapshot?.focusedElement?.hwnd) === Number(hwnd);
}

function snapshotFocusedTypeMatches(snapshot: any, expectedType: string): boolean {
	return String(snapshot?.focusedElement?.type || "")
		.toLocaleLowerCase()
		.includes(expectedType.toLocaleLowerCase());
}

function snapshotFocusedNameMatches(snapshot: any, expectedName: string): boolean {
	return String(snapshot?.focusedElement?.name || "")
		.toLocaleLowerCase()
		.includes(expectedName.toLocaleLowerCase());
}

function snapshotFocusedAutomationIdMatches(snapshot: any, expectedAutomationId: string): boolean {
	return String(snapshot?.focusedElement?.automationId || "")
		.toLocaleLowerCase()
		.includes(expectedAutomationId.toLocaleLowerCase());
}

function snapshotFocusedEnabled(snapshot: any): boolean | undefined {
	const value = snapshot?.focusedElement?.isEnabled;
	return typeof value === "boolean" ? value : undefined;
}

function snapshotClipboardText(snapshot: any): string | undefined {
	const value = snapshot?.clipboard?.text;
	return typeof value === "string" ? value : undefined;
}

function buildStrategyHints(snapshot: any): string[] {
	const hints: string[] = [];
	const focusedType = String(snapshot?.focusedElement?.type || "").toLocaleLowerCase();
	const focusedName = String(snapshot?.focusedElement?.name || "");
	if (focusedType.includes("edit")) {
		hints.push(
			"Focused control looks editable; prefer type/ghost_type and verify with expectedFocusedType or expectedText.",
		);
	}
	if (focusedType.includes("document")) {
		hints.push(
			"Focused control is a document surface; prefer click/focus before typing and consider clipboard-based verification.",
		);
	}
	if (/terminal|powershell|command prompt|cmd|windows terminal/i.test(focusedName)) {
		hints.push(
			"Terminal-like surface detected; prefer foreground actions and verify visible text rather than relying only on background input.",
		);
	}
	if (snapshot?.clipboard?.hasText) {
		hints.push(
			"Clipboard already contains text; copy/select flows can use expectedClipboardChanged or expectedClipboardText.",
		);
	}
	return hints;
}

function compactEvidence(snapshot: any) {
	return {
		activeWindow: snapshot?.activeWindow
			? {
					title: snapshot.activeWindow.title,
					hwnd: snapshot.activeWindow.hwnd,
					bounds: snapshot.activeWindow.bounds,
				}
			: undefined,
		focusedElement: snapshot?.focusedElement
			? {
					name: snapshot.focusedElement.name,
					type: snapshot.focusedElement.type,
					hwnd: snapshot.focusedElement.hwnd,
					windowTitle: snapshot.focusedElement.windowTitle,
					bounds: snapshot.focusedElement.bounds,
					automationId: snapshot.focusedElement.automationId,
					isEnabled: snapshot.focusedElement.isEnabled,
					hasKeyboardFocus: snapshot.focusedElement.hasKeyboardFocus,
					valuePreview: snapshot.focusedElement.valuePreview,
				}
			: undefined,
		clipboard: snapshot?.clipboard
			? {
					hasText: Boolean(snapshot.clipboard.hasText),
					preview: snapshot.clipboard.preview,
				}
			: undefined,
		windowTitles: (snapshot?.windows || []).slice(0, 12).map((w: any) => ({
			title: w.title,
			hwnd: w.hwnd,
			isForeground: w.isForeground,
		})),
		strategyHints: buildStrategyHints(snapshot),
		elementSample: (snapshot?.elements || []).slice(0, 12).map((el: any) => ({
			id: el.id,
			name: el.name,
			type: el.type,
			hwnd: el.hwnd,
			windowTitle: el.windowTitle,
			automationId: el.automationId,
			isEnabled: el.isEnabled,
			hasKeyboardFocus: el.hasKeyboardFocus,
			valuePreview: el.valuePreview,
		})),
	};
}

const inspectWindowsUiSchema = Type.Object({
	reason: Type.Optional(Type.String({ description: "Why are you inspecting the screen?" })),
});

export type InspectWindowsUiInput = Static<typeof inspectWindowsUiSchema>;

export const inspectWindowsUiToolDefinition: ToolDefinition<typeof inspectWindowsUiSchema> = {
	name: "inspect_windows_ui",
	label: "Inspect UI",
	description:
		"Captures a screenshot with ID labels and HWND (Windows Handles). Returns a map for precision background control.",
	parameters: inspectWindowsUiSchema,
	execute: async () => {
		try {
			const data = inspectSnapshot();
			const activeWindowText = data.activeWindow
				? `Active window: ${data.activeWindow.title} (${data.activeWindow.hwnd})`
				: "Active window: unknown";
			const focusedElementText = data.focusedElement
				? `Focused element: ${data.focusedElement.name} (${data.focusedElement.type}) - HWND: ${data.focusedElement.hwnd}${data.focusedElement.hasKeyboardFocus ? " [keyboard-focus]" : ""}`
				: "Focused element: unknown";
			const clipboardText = data.clipboard?.hasText
				? `Clipboard: ${String(data.clipboard.preview || "")
						.replace(/\s+/g, " ")
						.slice(0, 120)}`
				: "Clipboard: empty or non-text";
			const strategyHints = buildStrategyHints(data);
			const strategyText = strategyHints.length
				? `Strategy hints:\n- ${strategyHints.join("\n- ")}`
				: "Strategy hints: none";
			const legend = stringifyLegend(data.elements);

			return {
				content: [
					{
						type: "text",
						text:
							`✦ UI Mapper Active\n` +
							`${activeWindowText}\n` +
							`${focusedElementText}\n` +
							`${clipboardText}\n` +
							`Schema: ${data.schemaVersion || "unknown"}\n\n` +
							`${strategyText}\n\n` +
							`Element Legend:\n${legend}\n\n` +
							`Use HWND-aware actions for background work. Prefer ghost_* actions when the user should keep control of mouse/keyboard.`,
					},
					{ type: "image", data: data.screenshot, mimeType: "image/png" },
				],
				isError: false,
				details: {
					schemaVersion: data.schemaVersion,
					elementCount: data.elements?.length || 0,
					windowCount: data.windows?.length || 0,
					activeWindow: data.activeWindow,
					focusedElement: data.focusedElement,
					clipboard: data.clipboard,
					strategyHints,
					elementSample: (data.elements || []).slice(0, 12),
				},
			};
		} catch (err: any) {
			return {
				content: [{ type: "text", text: `Mapper Error: ${err.message}` }],
				isError: true,
				details: undefined,
			};
		}
	},
};

const osActionSchema = Type.Union([
	Type.Literal("click"),
	Type.Literal("double_click"),
	Type.Literal("right_click"),
	Type.Literal("move"),
	Type.Literal("hover"),
	Type.Literal("drag"),
	Type.Literal("type"),
	Type.Literal("ghost_click"),
	Type.Literal("ghost_type"),
	Type.Literal("press"),
	Type.Literal("ghost_press"),
	Type.Literal("hotkey"),
	Type.Literal("ghost_hotkey"),
	Type.Literal("send_keys"),
	Type.Literal("scroll"),
	Type.Literal("ghost_scroll"),
	Type.Literal("focus_window"),
	Type.Literal("activate_window"),
	Type.Literal("copy"),
	Type.Literal("paste"),
	Type.Literal("select_all"),
]);

const osActionParamsSchema = Type.Object({
	elementId: Type.Optional(Type.Number()),
	hwnd: Type.Optional(Type.Number({ description: "Target Window Handle for window-aware actions" })),
	x: Type.Optional(Type.Number()),
	y: Type.Optional(Type.Number()),
	toX: Type.Optional(Type.Number({ description: "Destination X coordinate for drag actions" })),
	toY: Type.Optional(Type.Number({ description: "Destination Y coordinate for drag actions" })),
	durationMs: Type.Optional(Type.Number({ description: "Optional movement duration in milliseconds" })),
	text: Type.Optional(Type.String()),
	key: Type.Optional(Type.String()),
	keys: Type.Optional(Type.Array(Type.String())),
	amount: Type.Optional(Type.Number({ description: "Scroll amount in wheel steps/pixels depending on driver" })),
});

const osControlActionSchema = Type.Object({
	action: osActionSchema,
	params: osActionParamsSchema,
	reason: Type.String({ description: "What is the goal of this action?" }),
});

export type OsControlActionInput = Static<typeof osControlActionSchema>;

export const osControlActionToolDefinition: ToolDefinition<typeof osControlActionSchema> = {
	name: "os_control_action",
	label: "OS Action",
	description: "Performs actions. Use 'ghost_' prefix for background interaction (no mouse movement).",
	parameters: osControlActionSchema,
	execute: async (_toolCallId, params) => {
		try {
			const payload = JSON.stringify({ action: params.action, params: params.params });
			const result = runPython(payload);
			if (result.error || result.status !== 0) {
				throw new Error(result.stderr || result.error?.message || "Action failed");
			}
			const data = JSON.parse(result.stdout);
			if (data.status === "error" || data.ok === false) {
				return {
					content: [
						{
							type: "text",
							text:
								`✦ OS action failed\n` +
								`Action: ${params.action}\n` +
								`Reason: ${data.failureReason || data.message || "unknown"}\n` +
								`${data.fallbackSuggested ? `Suggested fallback: ${data.fallbackSuggested}` : ""}`,
						},
					],
					isError: true,
					details: data,
				};
			}
			return {
				content: [
					{
						type: "text",
						text: `✦ OS Action Success\nAction: ${params.action}\nMethod: ${data.method || "unknown"}\nResult: ${data.result || "Success"}`,
					},
				],
				isError: false,
				details: data,
			};
		} catch (err: any) {
			return {
				content: [{ type: "text", text: `Action Error: ${err.message}` }],
				isError: true,
				details: undefined,
			};
		}
	},
};

const osWaitForWindowSchema = Type.Object({
	title: Type.String({ description: "Window title substring to wait for." }),
	hwnd: Type.Optional(Type.Number({ description: "Optional exact window handle to wait for." })),
	timeoutMs: Type.Optional(Type.Number({ description: "Maximum wait time in milliseconds." })),
});

export type OsWaitForWindowInput = Static<typeof osWaitForWindowSchema>;

export const osWaitForWindowToolDefinition: ToolDefinition<typeof osWaitForWindowSchema> = {
	name: "os_wait_for_window",
	label: "Wait for Window",
	description: "Polls Windows UI state until a window appears or becomes active.",
	parameters: osWaitForWindowSchema,
	execute: async (_toolCallId, params) => {
		const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
		const deadline = Date.now() + timeoutMs;
		let attempts = 0;
		try {
			while (Date.now() <= deadline) {
				attempts += 1;
				const snapshot = inspectSnapshot();
				const match = findWindowMatch(snapshot, params.title, params.hwnd);
				if (match) {
					return {
						content: [
							{
								type: "text",
								text: `✦ Window ready\nTitle: ${match.title}\nHWND: ${match.hwnd}\nAttempts: ${attempts}`,
							},
						],
						isError: false,
						details: { match, attempts, timeoutMs },
					};
				}
				await sleep(DEFAULT_WAIT_INTERVAL_MS);
			}
			return {
				content: [
					{ type: "text", text: `✦ Window wait timed out\nTitle query: ${params.title}\nTimeout: ${timeoutMs}ms` },
				],
				isError: true,
				details: { timeoutMs, attempts, title: params.title, hwnd: params.hwnd },
			};
		} catch (err: any) {
			return {
				content: [{ type: "text", text: `Window wait error: ${err.message}` }],
				isError: true,
				details: { timeoutMs, attempts },
			};
		}
	},
};

const osWaitForTextSchema = Type.Object({
	text: Type.String({ description: "Text substring to wait for anywhere in the active UI snapshot." }),
	timeoutMs: Type.Optional(Type.Number({ description: "Maximum wait time in milliseconds." })),
});

const osPerformStepSchema = Type.Object({
	action: osActionSchema,
	params: osActionParamsSchema,
	reason: Type.String({ description: "Why this step is being performed." }),
	expectedWindowTitle: Type.Optional(
		Type.String({ description: "Expected window title substring after the action." }),
	),
	expectedText: Type.Optional(Type.String({ description: "Expected text substring after the action." })),
	expectedHwnd: Type.Optional(Type.Number({ description: "Expected window handle to exist after the action." })),
	expectedForeground: Type.Optional(
		Type.Boolean({ description: "Whether the expected HWND should be the foreground window after the action." }),
	),
	expectedFocusedHwnd: Type.Optional(
		Type.Number({ description: "Expected focused element window handle after the action." }),
	),
	expectedFocusedType: Type.Optional(
		Type.String({ description: "Expected focused element control type substring after the action." }),
	),
	expectedFocusedName: Type.Optional(
		Type.String({ description: "Expected focused element name substring after the action." }),
	),
	expectedFocusedAutomationId: Type.Optional(
		Type.String({ description: "Expected focused element automationId substring after the action." }),
	),
	expectedFocusedEnabled: Type.Optional(
		Type.Boolean({ description: "Whether the focused element should be enabled after the action." }),
	),
	expectedClipboardText: Type.Optional(
		Type.String({ description: "Expected clipboard text substring after the action." }),
	),
	expectedClipboardChanged: Type.Optional(
		Type.Boolean({ description: "Whether the clipboard text should change after the action." }),
	),
	expectedClipboardNonEmpty: Type.Optional(
		Type.Boolean({ description: "Whether clipboard text should be non-empty after the action." }),
	),
	timeoutMs: Type.Optional(Type.Number({ description: "Maximum verification time in milliseconds." })),
});

export type OsWaitForTextInput = Static<typeof osWaitForTextSchema>;

export const osWaitForTextToolDefinition: ToolDefinition<typeof osWaitForTextSchema> = {
	name: "os_wait_for_text",
	label: "Wait for Text",
	description: "Polls Windows UI state until target text appears in windows or controls.",
	parameters: osWaitForTextSchema,
	execute: async (_toolCallId, params) => {
		const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
		const deadline = Date.now() + timeoutMs;
		let attempts = 0;
		try {
			while (Date.now() <= deadline) {
				attempts += 1;
				const snapshot = inspectSnapshot();
				if (snapshotContainsText(snapshot, params.text)) {
					return {
						content: [{ type: "text", text: `✦ Text detected\nQuery: ${params.text}\nAttempts: ${attempts}` }],
						isError: false,
						details: { text: params.text, attempts, timeoutMs },
					};
				}
				await sleep(DEFAULT_WAIT_INTERVAL_MS);
			}
			return {
				content: [{ type: "text", text: `✦ Text wait timed out\nQuery: ${params.text}\nTimeout: ${timeoutMs}ms` }],
				isError: true,
				details: { timeoutMs, attempts, text: params.text },
			};
		} catch (err: any) {
			return {
				content: [{ type: "text", text: `Text wait error: ${err.message}` }],
				isError: true,
				details: { timeoutMs, attempts },
			};
		}
	},
};

export type OsPerformStepInput = Static<typeof osPerformStepSchema>;

export const osPerformStepToolDefinition: ToolDefinition<typeof osPerformStepSchema> = {
	name: "os_perform_step",
	label: "Perform OS Step",
	description: "Executes an OS action, then waits/verifies expected window/text state in one orchestration step.",
	parameters: osPerformStepSchema,
	execute: async (_toolCallId, params) => {
		const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
		try {
			const before = inspectSnapshot();
			const beforeEvidence = compactEvidence(before);
			const beforeClipboardText = snapshotClipboardText(before);
			const actionPayload = JSON.stringify({ action: params.action, params: params.params });
			const actionResult = runPython(actionPayload);
			if (actionResult.error || actionResult.status !== 0) {
				throw new Error(actionResult.stderr || actionResult.error?.message || "Action failed");
			}
			const actionData = JSON.parse(actionResult.stdout);
			if (actionData.status === "error" || actionData.ok === false) {
				return {
					content: [
						{
							type: "text",
							text:
								`✦ OS step failed during action\n` +
								`Action: ${params.action}\n` +
								`Reason: ${actionData.failureReason || actionData.message || "unknown"}`,
						},
					],
					isError: true,
					details: { phase: "action", before: beforeEvidence, action: actionData },
				};
			}

			let verification: { ok: boolean; kind: string; attempts: number; snapshot?: any; failedChecks?: string[] } = {
				ok: true,
				kind: "none",
				attempts: 0,
			};

			if (
				params.expectedWindowTitle ||
				params.expectedText ||
				params.expectedHwnd ||
				params.expectedForeground !== undefined ||
				params.expectedFocusedHwnd ||
				params.expectedFocusedType ||
				params.expectedFocusedName ||
				params.expectedFocusedAutomationId ||
				params.expectedFocusedEnabled !== undefined ||
				params.expectedClipboardText ||
				params.expectedClipboardChanged !== undefined ||
				params.expectedClipboardNonEmpty !== undefined
			) {
				const deadline = Date.now() + timeoutMs;
				while (Date.now() <= deadline) {
					verification.attempts += 1;
					const snapshot = inspectSnapshot();
					const windowOk = params.expectedWindowTitle
						? !!findWindowMatch(snapshot, params.expectedWindowTitle, params.expectedHwnd)
						: true;
					const textOk = params.expectedText ? snapshotContainsText(snapshot, params.expectedText) : true;
					const hwndOk = params.expectedHwnd ? snapshotHasHwnd(snapshot, params.expectedHwnd) : true;
					const foregroundOk =
						params.expectedForeground !== undefined
							? params.expectedHwnd
								? snapshotHasForegroundHwnd(snapshot, params.expectedHwnd) === params.expectedForeground
								: Boolean(snapshot?.activeWindow) === params.expectedForeground
							: true;
					const focusedHwndOk = params.expectedFocusedHwnd
						? snapshotHasFocusedHwnd(snapshot, params.expectedFocusedHwnd)
						: true;
					const focusedTypeOk = params.expectedFocusedType
						? snapshotFocusedTypeMatches(snapshot, params.expectedFocusedType)
						: true;
					const focusedNameOk = params.expectedFocusedName
						? snapshotFocusedNameMatches(snapshot, params.expectedFocusedName)
						: true;
					const focusedAutomationIdOk = params.expectedFocusedAutomationId
						? snapshotFocusedAutomationIdMatches(snapshot, params.expectedFocusedAutomationId)
						: true;
					const focusedEnabledOk =
						params.expectedFocusedEnabled !== undefined
							? snapshotFocusedEnabled(snapshot) === params.expectedFocusedEnabled
							: true;
					const clipboardText = snapshotClipboardText(snapshot);
					const clipboardTextOk = params.expectedClipboardText
						? String(clipboardText || "")
								.toLocaleLowerCase()
								.includes(params.expectedClipboardText.toLocaleLowerCase())
						: true;
					const clipboardChangedOk =
						params.expectedClipboardChanged !== undefined
							? (clipboardText !== beforeClipboardText) === params.expectedClipboardChanged
							: true;
					const clipboardNonEmptyOk =
						params.expectedClipboardNonEmpty !== undefined
							? Boolean((clipboardText || "").length > 0) === params.expectedClipboardNonEmpty
							: true;
					if (
						windowOk &&
						textOk &&
						hwndOk &&
						foregroundOk &&
						focusedHwndOk &&
						focusedTypeOk &&
						focusedNameOk &&
						focusedAutomationIdOk &&
						focusedEnabledOk &&
						clipboardTextOk &&
						clipboardChangedOk &&
						clipboardNonEmptyOk
					) {
						const verificationKinds = [
							params.expectedWindowTitle ? "window" : undefined,
							params.expectedText ? "text" : undefined,
							params.expectedHwnd ? "hwnd" : undefined,
							params.expectedForeground !== undefined ? "foreground" : undefined,
							params.expectedFocusedHwnd ? "focusedHwnd" : undefined,
							params.expectedFocusedType ? "focusedType" : undefined,
							params.expectedFocusedName ? "focusedName" : undefined,
							params.expectedFocusedAutomationId ? "focusedAutomationId" : undefined,
							params.expectedFocusedEnabled !== undefined ? "focusedEnabled" : undefined,
							params.expectedClipboardText ? "clipboardText" : undefined,
							params.expectedClipboardChanged !== undefined ? "clipboardChanged" : undefined,
							params.expectedClipboardNonEmpty !== undefined ? "clipboardNonEmpty" : undefined,
						].filter(Boolean);
						verification = {
							ok: true,
							kind: verificationKinds.join("+") || "none",
							attempts: verification.attempts,
							snapshot,
						};
						break;
					}
					await sleep(DEFAULT_WAIT_INTERVAL_MS);
				}

				if (!verification.snapshot) {
					const snapshot = inspectSnapshot();
					const failedChecks: string[] = [];
					if (
						params.expectedWindowTitle &&
						!findWindowMatch(snapshot, params.expectedWindowTitle, params.expectedHwnd)
					)
						failedChecks.push("windowTitle");
					if (params.expectedText && !snapshotContainsText(snapshot, params.expectedText))
						failedChecks.push("text");
					if (params.expectedHwnd && !snapshotHasHwnd(snapshot, params.expectedHwnd)) failedChecks.push("hwnd");
					if (params.expectedForeground !== undefined) {
						const ok = params.expectedHwnd
							? snapshotHasForegroundHwnd(snapshot, params.expectedHwnd) === params.expectedForeground
							: Boolean(snapshot?.activeWindow) === params.expectedForeground;
						if (!ok) failedChecks.push("foreground");
					}
					if (params.expectedFocusedHwnd && !snapshotHasFocusedHwnd(snapshot, params.expectedFocusedHwnd))
						failedChecks.push("focusedHwnd");
					if (params.expectedFocusedType && !snapshotFocusedTypeMatches(snapshot, params.expectedFocusedType))
						failedChecks.push("focusedType");
					if (params.expectedFocusedName && !snapshotFocusedNameMatches(snapshot, params.expectedFocusedName))
						failedChecks.push("focusedName");
					if (
						params.expectedFocusedAutomationId &&
						!snapshotFocusedAutomationIdMatches(snapshot, params.expectedFocusedAutomationId)
					)
						failedChecks.push("focusedAutomationId");
					if (
						params.expectedFocusedEnabled !== undefined &&
						snapshotFocusedEnabled(snapshot) !== params.expectedFocusedEnabled
					)
						failedChecks.push("focusedEnabled");
					const clipboardText = snapshotClipboardText(snapshot);
					if (
						params.expectedClipboardText &&
						!String(clipboardText || "")
							.toLocaleLowerCase()
							.includes(params.expectedClipboardText.toLocaleLowerCase())
					)
						failedChecks.push("clipboardText");
					if (
						params.expectedClipboardChanged !== undefined &&
						(clipboardText !== beforeClipboardText) !== params.expectedClipboardChanged
					)
						failedChecks.push("clipboardChanged");
					if (
						params.expectedClipboardNonEmpty !== undefined &&
						Boolean((clipboardText || "").length > 0) !== params.expectedClipboardNonEmpty
					)
						failedChecks.push("clipboardNonEmpty");
					verification = {
						ok: false,
						kind: failedChecks.join("+") || "unknown",
						attempts: verification.attempts,
						snapshot,
						failedChecks,
					};
				}
			}

			if (!verification.ok) {
				const expectedParts = [
					params.expectedWindowTitle ? `window contains "${params.expectedWindowTitle}"` : undefined,
					params.expectedText ? `text contains "${params.expectedText}"` : undefined,
					params.expectedHwnd ? `hwnd ${params.expectedHwnd} exists` : undefined,
					params.expectedForeground !== undefined
						? params.expectedHwnd
							? `hwnd ${params.expectedHwnd} foreground=${params.expectedForeground}`
							: `foreground=${params.expectedForeground}`
						: undefined,
					params.expectedFocusedHwnd ? `focused hwnd ${params.expectedFocusedHwnd}` : undefined,
					params.expectedFocusedType ? `focused type contains "${params.expectedFocusedType}"` : undefined,
					params.expectedFocusedName ? `focused name contains "${params.expectedFocusedName}"` : undefined,
					params.expectedFocusedAutomationId
						? `focused automationId contains "${params.expectedFocusedAutomationId}"`
						: undefined,
					params.expectedFocusedEnabled !== undefined
						? `focused enabled=${params.expectedFocusedEnabled}`
						: undefined,
					params.expectedClipboardText ? `clipboard contains "${params.expectedClipboardText}"` : undefined,
					params.expectedClipboardChanged !== undefined
						? `clipboardChanged=${params.expectedClipboardChanged}`
						: undefined,
					params.expectedClipboardNonEmpty !== undefined
						? `clipboardNonEmpty=${params.expectedClipboardNonEmpty}`
						: undefined,
				].filter(Boolean);
				return {
					content: [
						{
							type: "text",
							text:
								`✦ OS step verification failed\n` +
								`Action: ${params.action}\n` +
								`Expected: ${expectedParts.join(", ")}\n` +
								`Failed checks: ${(verification.failedChecks || []).join(", ") || verification.kind}\n` +
								`Attempts: ${verification.attempts}`,
						},
					],
					isError: true,
					details: {
						phase: "verify",
						before: beforeEvidence,
						action: actionData,
						verification: {
							...verification,
							snapshot: compactEvidence(verification.snapshot),
						},
						failureReason: "expected_state_not_reached",
						retrySuggested: true,
					},
				};
			}

			return {
				content: [
					{
						type: "text",
						text:
							`✦ OS step completed\n` +
							`Action: ${params.action}\n` +
							`Method: ${actionData.method || "unknown"}\n` +
							`Verification: ${verification.kind}\n` +
							`Attempts: ${verification.attempts}`,
					},
				],
				isError: false,
				details: {
					before: beforeEvidence,
					action: actionData,
					verification: {
						...verification,
						snapshot: compactEvidence(verification.snapshot),
					},
					timeoutMs,
				},
			};
		} catch (err: any) {
			return {
				content: [{ type: "text", text: `OS step error: ${err.message}` }],
				isError: true,
				details: undefined,
			};
		}
	},
};

export function createInspectWindowsUiTool(): AgentTool<typeof inspectWindowsUiSchema> {
	return wrapToolDefinition(inspectWindowsUiToolDefinition);
}

export function createOsControlActionTool(): AgentTool<typeof osControlActionSchema> {
	return wrapToolDefinition(osControlActionToolDefinition);
}

export function createOsWaitForWindowTool(): AgentTool<typeof osWaitForWindowSchema> {
	return wrapToolDefinition(osWaitForWindowToolDefinition);
}

export function createOsWaitForTextTool(): AgentTool<typeof osWaitForTextSchema> {
	return wrapToolDefinition(osWaitForTextToolDefinition);
}

export function createOsPerformStepTool(): AgentTool<typeof osPerformStepSchema> {
	return wrapToolDefinition(osPerformStepToolDefinition);
}

export const inspectWindowsUiTool = createInspectWindowsUiTool();
export const osControlActionTool = createOsControlActionTool();
export const osWaitForWindowTool = createOsWaitForWindowTool();
export const osWaitForTextTool = createOsWaitForTextTool();
export const osPerformStepTool = createOsPerformStepTool();
