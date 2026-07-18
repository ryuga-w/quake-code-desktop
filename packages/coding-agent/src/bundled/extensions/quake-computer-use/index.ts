import type { ExtensionAPI, ExtensionContext } from "@mrquake/quakecode-cli";
import { Text } from "@mrquake/quakecode-tui";
import { Type } from "@sinclair/typebox";
import { clampCoordinate, TARGET_DISPLAY_HEIGHT, TARGET_DISPLAY_WIDTH } from "./coordinates.js";
import {
	actuateDesktopAction,
	closeDesktopWindow,
	COMPUTER_USE_BRIDGE_UNAVAILABLE_ERROR,
	captureDesktopScreenshot,
	detectUac,
	dialogSetPath,
	endComputerUseBridgeSession,
	ensureComputerUseBridgeSession,
	getActiveComputerUseSessionId,
	scheduleComputerUseIdleEnd,
	focusDesktopWindow,
	isComputerUseBridgeAvailable,
	isComputerUseEmbeddedRequired,
	listDesktopApps,
	listDesktopWindows,
	listDisplays,
	openDesktopApp,
	readDesktopCursorPosition,
	uiaFind,
	uiaInvoke,
	uiaSetValue,
	uiaSnapshot,
} from "./electron-bridge.js";
import {
	claudeComputerToolParameters,
	detectScreenshotInjectionRisk,
	translateClaudeComputerInput,
} from "./claude-passthrough.js";
import { assertComputerUseToolAllowed, resetStepCount } from "./policy.js";
import { buildComputerUseRoutingGuidelines } from "./prompts.js";
import {
	createSessionId,
	endTrajectorySession,
	logToolStep,
	startTrajectorySession,
} from "./trajectory.js";

const sessionByCwd = new Map<string, string>();

/** [x, y] pair — avoid Type.Tuple (Google CCA rejects items: [schema, schema]). */
function coordinatePairSchema(description = "[x, y] coordinates") {
	return Type.Array(Type.Number(), {
		minItems: 2,
		maxItems: 2,
		description,
	});
}

/** Short Turkish-friendly labels shown in the TUI while tools run. */
const TOOL_LABELS: Record<string, string> = {
	desktop_screenshot: "Ekran görüntüsü",
	desktop_cursor_position: "İmleç konumu",
	desktop_list_windows: "Pencereler",
	desktop_mouse_move: "İmleç hareketi",
	desktop_click: "Tıklama",
	desktop_type: "Yazma",
	desktop_key: "Tuş",
	desktop_scroll: "Kaydırma",
	desktop_wait: "Bekleme",
	desktop_open_app: "Uygulama aç",
	desktop_focus_window: "Pencere odakla",
	desktop_close_window: "Pencere kapat",
	desktop_ui_snapshot: "UI öğeleri",
	desktop_ui_find: "UI bul",
	desktop_ui_click: "UI tıkla",
	desktop_ui_type: "UI yaz",
	desktop_list_apps: "Uygulama listesi",
	desktop_list_displays: "Ekran listesi",
	desktop_dialog_set_path: "Diyalog yolu",
	desktop_detect_uac: "UAC kontrol",
	desktop_task_done: "Masaüstü bitti",
	computer: "Masaüstü",
};

/** Short Turkish-friendly completed labels for tool results. */
const TOOL_RESULT_LABELS: Record<string, string> = {
	desktop_screenshot: "Ekran alındı",
	desktop_cursor_position: "İmleç okundu",
	desktop_list_windows: "Pencereler listelendi",
	desktop_mouse_move: "İmleç taşındı",
	desktop_click: "Tıklandı",
	desktop_type: "Yazıldı",
	desktop_key: "Tuş basıldı",
	desktop_scroll: "Kaydırıldı",
	desktop_wait: "Beklendi",
	desktop_open_app: "Uygulama açıldı",
	desktop_focus_window: "Pencere odaklandı",
	desktop_close_window: "Pencere kapatıldı",
	desktop_ui_snapshot: "UI tarandı",
	desktop_ui_find: "UI bulundu",
	desktop_ui_click: "UI tıklandı",
	desktop_ui_type: "UI yazıldı",
	desktop_list_apps: "Uygulamalar listelendi",
	desktop_list_displays: "Ekranlar listelendi",
	desktop_dialog_set_path: "Diyalog yolu yazıldı",
	desktop_detect_uac: "UAC kontrol edildi",
	desktop_task_done: "Masaüstü oturumu bitti",
	computer: "Masaüstü işlemi",
};

/** Merge actuate bridge detail with request params so coordinate always survives for trajectory/cursor. */
function mergeActuateDetails(
	sessionId: string,
	paramsDetail: Record<string, unknown>,
	actuateDetail: Record<string, unknown> = {},
): Record<string, unknown> {
	const merged: Record<string, unknown> = {
		sessionId,
		...paramsDetail,
		...actuateDetail,
	};
	// Prefer bridge physical; fill coordinate from params if bridge omitted it.
	if (merged.coordinate == null && paramsDetail.coordinate != null) {
		merged.coordinate = paramsDetail.coordinate;
	}
	if (merged.start_coordinate == null && paramsDetail.start_coordinate != null) {
		merged.start_coordinate = paramsDetail.start_coordinate;
	}
	// Keep detail.physical from actuate when present (full-screen cursor).
	if (merged.physical == null && actuateDetail.physical != null) {
		merged.physical = actuateDetail.physical;
	}
	return merged;
}

function formatCoordinateShort(coordinate: [number, number] | undefined): string {
	if (!coordinate) return "";
	return `(${coordinate[0]}, ${coordinate[1]})`;
}

function actuateResultText(action: string, detail: Record<string, unknown>): string {
	const coord = Array.isArray(detail.coordinate)
		? formatCoordinateShort(detail.coordinate as [number, number])
		: "";
	switch (action) {
		case "mouse_move":
			return coord ? `İmleç → ${coord}` : "İmleç taşındı";
		case "left_click":
		case "click":
			return coord ? `Sol tık ${coord}` : "Sol tık";
		case "right_click":
			return coord ? `Sağ tık ${coord}` : "Sağ tık";
		case "middle_click":
			return coord ? `Orta tık ${coord}` : "Orta tık";
		case "double_click":
			return coord ? `Çift tık ${coord}` : "Çift tık";
		case "type": {
			const len = typeof detail.length === "number" ? detail.length : undefined;
			return len != null ? `Yazıldı · ${len} karakter` : "Yazıldı";
		}
		case "key":
		case "hold_key":
			return detail.key ? `Tuş: ${String(detail.key)}` : "Tuş basıldı";
		case "open_app":
			return detail.target || detail.app
				? `Uygulama açıldı: ${detail.target || detail.app}`
				: "Uygulama açıldı";
		case "focus_window":
			return detail.title ? `Odak: ${detail.title}` : "Pencere odaklandı";
		case "close_window":
			return detail.title ? `Kapatıldı: ${detail.title}` : "Pencere kapatıldı";
		case "scroll": {
			const dir = detail.direction ?? detail.scroll_direction ?? "";
			const amount = detail.amount ?? detail.scroll_amount;
			const base = amount != null ? `Kaydır ${dir} ×${amount}` : `Kaydır ${dir}`;
			return coord ? `${base.trim()} ${coord}` : base.trim() || "Kaydırıldı";
		}
		case "wait":
			return detail.duration != null ? `Beklendi ${detail.duration}s` : "Beklendi";
		case "drag":
			return coord ? `Sürükle → ${coord}` : "Sürükleme";
		default:
			return coord ? `${action} ${coord}` : `İşlem: ${action}`;
	}
}

function resolveSessionId(cwd: string): string {
	let sessionId = sessionByCwd.get(cwd);
	if (!sessionId) {
		sessionId = createSessionId();
		sessionByCwd.set(cwd, sessionId);
		startTrajectorySession(cwd, sessionId);
		resetStepCount(cwd);
	}
	return sessionId;
}

async function assertBridgeReady(): Promise<void> {
	if (!(await isComputerUseBridgeAvailable())) {
		if (isComputerUseEmbeddedRequired()) {
			throw new Error(COMPUTER_USE_BRIDGE_UNAVAILABLE_ERROR);
		}
		throw new Error(
			"Computer-use bridge is not available. Run Quake Desktop (Electron) or set QUAKE_COMPUTER_USE_BRIDGE_PORT.",
		);
	}
}

function desktopRender(toolName: string) {
	return {
		renderCall(_args: Record<string, unknown>, theme: { bold: (s: string) => string }) {
			return new Text(theme.bold(TOOL_LABELS[toolName] || toolName), 0, 0);
		},
		renderResult(
			result: { content?: Array<{ type: string; text?: string }>; details?: Record<string, unknown> },
			options: { expanded?: boolean },
			theme: { bold: (s: string) => string; fg: (role: string, s: string) => string },
		) {
			let text = theme.bold(TOOL_RESULT_LABELS[toolName] || TOOL_LABELS[toolName] || "Masaüstü işlemi");
			const details = result.details as Record<string, unknown> | undefined;
			if (typeof details?.displayName === "string") text += ` ${theme.fg("dim", `· ${details.displayName}`)}`;
			if (typeof details?.width === "number" && typeof details?.height === "number") {
				text += ` ${theme.fg("dim", `· ${details.width}×${details.height}`)}`;
			}
			if (typeof details?.x === "number" && typeof details?.y === "number") {
				text += ` ${theme.fg("dim", `· (${details.x}, ${details.y})`)}`;
			} else if (Array.isArray(details?.coordinate) && details.coordinate.length >= 2) {
				const [cx, cy] = details.coordinate as [number, number];
				text += ` ${theme.fg("dim", `· (${cx}, ${cy})`)}`;
			}
			if (options.expanded) {
				const body = result.content?.find((c) => c.type === "text")?.text;
				if (body) text += `\n${theme.fg("dim", body)}`;
			}
			return new Text(text, 0, 0);
		},
	};
}

async function runDesktopTool<T extends Record<string, unknown>>(
	input: {
		toolName: string;
		cwd: string;
		sessionId: string;
		kind: "screenshot" | "cursor_position" | "actuate";
		action?: string;
		/** Params-side detail (e.g. coordinate) — always merged into log even if actuate omits it. */
		detail?: Record<string, unknown>;
		run: () => Promise<{ text: string; details: T }>;
	},
): Promise<{ content: Array<{ type: "text"; text: string }>; details: T }> {
	assertComputerUseToolAllowed(input.cwd, input.toolName);
	try {
		const result = await input.run();
		const resultDetails = result.details as Record<string, unknown>;
		// Merge params detail + result so trajectory always has coordinate when provided in params.
		const logDetail = mergeActuateDetails(input.sessionId, input.detail ?? {}, resultDetails);
		logToolStep({
			cwd: input.cwd,
			sessionId: input.sessionId,
			kind: input.kind,
			tool: input.toolName,
			action: input.action,
			ok: true,
			detail: logDetail,
		});
		// Surface the same merged detail (coordinate/physical) to the tool result for cursor UI.
		const details = { ...result.details, ...logDetail } as T;
		// Observe→verify: always surface active window when host reported it
		const fg =
			typeof details.foreground === "string"
				? details.foreground
				: typeof (details as any).title === "string" && input.toolName.includes("focus")
					? (details as any).title
					: undefined;
		const textWithFg =
			fg && !result.text.includes(fg)
				? `${result.text}\n[foreground] ${fg}`
				: result.text;
		const needsVerify =
			input.kind === "actuate" &&
			input.toolName !== "desktop_wait" &&
			input.toolName !== "desktop_task_done";
		const text = needsVerify
			? `${textWithFg}\n[verify] Sonraki adımda desktop_ui_snapshot veya desktop_screenshot ile doğrula; iş bittiyse desktop_task_done.`
			: textWithFg;
		return {
			content: [{ type: "text" as const, text }],
			details: { ...details, needsVerify } as T,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// On error, still log coordinate from params so trajectory shows intended cursor target.
		logToolStep({
			cwd: input.cwd,
			sessionId: input.sessionId,
			kind: "error",
			tool: input.toolName,
			action: input.action,
			ok: false,
			detail: input.detail,
			error: message,
		});
		throw error;
	}
}

async function prepareContext(context: ExtensionContext) {
	const cwd = context.cwd;
	const sessionId = resolveSessionId(cwd);
	await assertBridgeReady();
	await ensureComputerUseBridgeSession(sessionId);
	return { cwd, sessionId };
}

function parseCoordinate(value: unknown): [number, number] | undefined {
	if (!Array.isArray(value) || value.length !== 2) return undefined;
	const x = Number(value[0]);
	const y = Number(value[1]);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
	return clampCoordinate([x, y], { width: TARGET_DISPLAY_WIDTH, height: TARGET_DISPLAY_HEIGHT });
}

const ROUTING_GUIDELINES = buildComputerUseRoutingGuidelines();

export default function (quake: ExtensionAPI) {
	quake.registerTool({
		name: "computer",
		label: "computer",
		description:
			"Anthropic-compatible unified computer tool (computer_20250124). Use when toolMode=claude_native or with Claude models.",
		promptSnippet: "Control the desktop via Claude computer actions",
		promptGuidelines: [
			...ROUTING_GUIDELINES,
			"Prefer this tool when policy toolMode is claude_native; otherwise use desktop_* tools.",
		],
		parameters: claudeComputerToolParameters(),
		anthropicNative: {
			type: "computer_20250124",
			displayWidthPx: TARGET_DISPLAY_WIDTH,
			displayHeightPx: TARGET_DISPLAY_HEIGHT,
		},
		...desktopRender("desktop_screenshot"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			const dispatch = translateClaudeComputerInput(params as Record<string, unknown>);
			assertComputerUseToolAllowed(cwd, "computer", { requiresActuate: dispatch.kind === "actuate" });

			if (dispatch.kind === "screenshot") {
				return runDesktopTool({
					toolName: "computer",
					cwd,
					sessionId,
					kind: "screenshot",
					action: dispatch.logAction,
					run: async () => {
						const capture = await captureDesktopScreenshot();
						const injectionRisks = detectScreenshotInjectionRisk(capture.displayName || "");
						return {
							text: [
								`Desktop screenshot (${capture.width}×${capture.height}).`,
								injectionRisks.length > 0
									? `Injection risk flags: ${injectionRisks.join(", ")}`
									: "",
							]
								.filter(Boolean)
								.join("\n"),
							details: { ...capture, sessionId, injectionRisks },
						};
					},
				});
			}

			if (dispatch.kind === "cursor_position") {
				return runDesktopTool({
					toolName: "computer",
					cwd,
					sessionId,
					kind: "cursor_position",
					action: dispatch.logAction,
					run: async () => {
						const pos = await readDesktopCursorPosition();
						return { text: `Cursor: (${pos.x}, ${pos.y})`, details: { ...pos, sessionId } };
					},
				});
			}

			const actuateParamsDetail: Record<string, unknown> = {
				action: dispatch.logAction,
				...dispatch.harnessParams,
			};
			return runDesktopTool({
				toolName: "computer",
				cwd,
				sessionId,
				kind: "actuate",
				action: dispatch.logAction,
				detail: actuateParamsDetail,
				run: async () => {
					const actuateDetail = await actuateDesktopAction(
						dispatch.harnessAction,
						dispatch.harnessParams,
					);
					const details = mergeActuateDetails(sessionId, actuateParamsDetail, actuateDetail);
					return {
						text: actuateResultText(dispatch.logAction || dispatch.harnessAction, details),
						details,
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_screenshot",
		label: "desktop_screenshot",
		description: "Capture a screenshot of the primary desktop display for computer-use tasks.",
		promptSnippet: "Capture the desktop screen",
		promptGuidelines: [
			...ROUTING_GUIDELINES,
			"desktop_* is for native OS apps only; the user will see a full-screen agent cursor while these tools run.",
			"Ground clicks using 1280×800 coordinates from tool details.",
			"Actuate tools require user opt-in in Settings → Masaüstü Computer-Use.",
		],
		parameters: Type.Object({
			reason: Type.Optional(Type.String({ description: "Short note on why the screenshot is needed" })),
		}),
		...desktopRender("desktop_screenshot"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			return runDesktopTool({
				toolName: "desktop_screenshot",
				cwd,
				sessionId,
				kind: "screenshot",
				run: async () => {
					const capture = await captureDesktopScreenshot();
					return {
						text: [
							`Desktop screenshot captured (${capture.width}×${capture.height}).`,
							`Display: ${capture.displayName}`,
							`Scale: ${capture.scaleFactor}x`,
							params.reason ? `Reason: ${params.reason}` : "",
						]
							.filter(Boolean)
							.join("\n"),
						details: {
							...capture,
							sessionId,
							targetWidth: TARGET_DISPLAY_WIDTH,
							targetHeight: TARGET_DISPLAY_HEIGHT,
						},
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_list_windows",
		label: "desktop_list_windows",
		description: "List visible desktop windows (titles and ids) for targeting native apps.",
		promptSnippet: "List desktop windows",
		parameters: Type.Object({}),
		...desktopRender("desktop_list_windows"),
		async execute(_toolCallId, _params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			return runDesktopTool({
				toolName: "desktop_list_windows",
				cwd,
				sessionId,
				kind: "screenshot",
				run: async () => {
					const windows = await listDesktopWindows();
					const lines = windows
						.map((w) => {
							const title = w.title || w.name || "?";
							const id = w.handle || w.id || "";
							const bounds =
								w.left != null
									? ` @(${w.left},${w.top})-(${w.right},${w.bottom})`
									: "";
							return `- ${title} [handle=${id}]${bounds}`;
						})
						.join("\n");
					return {
						text: windows.length > 0 ? `Desktop windows:\n${lines}` : "No desktop windows found.",
						details: { sessionId, windows, count: windows.length },
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_cursor_position",
		label: "desktop_cursor_position",
		description: "Read the current mouse cursor position on the primary display.",
		promptSnippet: "Read desktop cursor position",
		parameters: Type.Object({}),
		...desktopRender("desktop_cursor_position"),
		async execute(_toolCallId, _params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			return runDesktopTool({
				toolName: "desktop_cursor_position",
				cwd,
				sessionId,
				kind: "cursor_position",
				run: async () => {
					const pos = await readDesktopCursorPosition();
					return {
						text: `Cursor position: (${pos.x}, ${pos.y})`,
						details: { ...pos, sessionId, targetWidth: TARGET_DISPLAY_WIDTH, targetHeight: TARGET_DISPLAY_HEIGHT },
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_mouse_move",
		label: "desktop_mouse_move",
		description: "Move the mouse cursor to a coordinate on the primary display (1280×800 space). User sees full-screen agent cursor.",
		promptSnippet: "Move desktop mouse",
		parameters: Type.Object({
			coordinate: coordinatePairSchema("Move target [x, y]"),
		}),
		...desktopRender("desktop_mouse_move"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			const coordinate = parseCoordinate(params.coordinate);
			if (!coordinate) throw new Error("coordinate must be [x, y]");
			const paramsDetail: Record<string, unknown> = { coordinate };
			return runDesktopTool({
				toolName: "desktop_mouse_move",
				cwd,
				sessionId,
				kind: "actuate",
				action: "mouse_move",
				detail: paramsDetail,
				run: async () => {
					const actuateDetail = await actuateDesktopAction("mouse_move", { coordinate });
					const details = mergeActuateDetails(sessionId, paramsDetail, actuateDetail);
					return {
						text: actuateResultText("mouse_move", details),
						details,
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_click",
		label: "desktop_click",
		description: "Click on the desktop at an optional coordinate. User sees full-screen agent cursor.",
		promptSnippet: "Click on desktop",
		parameters: Type.Object({
			button: Type.Optional(
				Type.Union([
					Type.Literal("left"),
					Type.Literal("right"),
					Type.Literal("middle"),
					Type.Literal("double"),
				]),
			),
			coordinate: Type.Optional(coordinatePairSchema("Click target [x, y]")),
		}),
		...desktopRender("desktop_click"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			const button = params.button ?? "left";
			const coordinate = params.coordinate ? parseCoordinate(params.coordinate) : undefined;
			const action = button === "double" ? "double_click" : button === "right" ? "right_click" : button === "middle" ? "middle_click" : "left_click";
			const paramsDetail: Record<string, unknown> = { button, coordinate };
			return runDesktopTool({
				toolName: "desktop_click",
				cwd,
				sessionId,
				kind: "actuate",
				action,
				detail: paramsDetail,
				run: async () => {
					const actuateDetail = await actuateDesktopAction(action, coordinate ? { coordinate } : {});
					const details = mergeActuateDetails(sessionId, paramsDetail, actuateDetail);
					return {
						text: actuateResultText(action, details),
						details,
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_type",
		label: "desktop_type",
		description: "Type text using the desktop keyboard focus (native OS apps only).",
		promptSnippet: "Type on desktop",
		parameters: Type.Object({
			text: Type.String({ description: "Text to type" }),
		}),
		...desktopRender("desktop_type"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			const paramsDetail: Record<string, unknown> = { length: params.text.length };
			return runDesktopTool({
				toolName: "desktop_type",
				cwd,
				sessionId,
				kind: "actuate",
				action: "type",
				detail: paramsDetail,
				run: async () => {
					const actuateDetail = await actuateDesktopAction("type", { text: params.text });
					const details = mergeActuateDetails(sessionId, paramsDetail, actuateDetail);
					return {
						text: actuateResultText("type", details),
						details,
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_key",
		label: "desktop_key",
		description:
			"Press a key or combo via real Win32 SendInput (win, win+e, ctrl+s, alt+f4, enter, escape, tab, arrows, f1–f12).",
		promptSnippet: "Press desktop key",
		parameters: Type.Object({
			key: Type.String({
				description: "Key or combo: win, win+e, ctrl+c, alt+f4, enter, escape, tab, left/right/up/down, f5",
			}),
		}),
		...desktopRender("desktop_key"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			const paramsDetail: Record<string, unknown> = { key: params.key };
			return runDesktopTool({
				toolName: "desktop_key",
				cwd,
				sessionId,
				kind: "actuate",
				action: "key",
				detail: paramsDetail,
				run: async () => {
					const actuateDetail = await actuateDesktopAction("key", { text: params.key });
					const details = mergeActuateDetails(sessionId, paramsDetail, actuateDetail);
					return {
						text: actuateResultText("key", details),
						details,
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_scroll",
		label: "desktop_scroll",
		description: "Scroll on the desktop at an optional coordinate.",
		promptSnippet: "Scroll desktop",
		parameters: Type.Object({
			direction: Type.Union([
				Type.Literal("up"),
				Type.Literal("down"),
				Type.Literal("left"),
				Type.Literal("right"),
			]),
			amount: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
			coordinate: Type.Optional(coordinatePairSchema("Scroll origin [x, y]")),
		}),
		...desktopRender("desktop_scroll"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			const coordinate = params.coordinate ? parseCoordinate(params.coordinate) : undefined;
			const amount = params.amount ?? 3;
			const paramsDetail: Record<string, unknown> = {
				direction: params.direction,
				amount,
				coordinate,
			};
			return runDesktopTool({
				toolName: "desktop_scroll",
				cwd,
				sessionId,
				kind: "actuate",
				action: "scroll",
				detail: paramsDetail,
				run: async () => {
					const actuateDetail = await actuateDesktopAction("scroll", {
						scroll_direction: params.direction,
						scroll_amount: amount,
						...(coordinate ? { coordinate } : {}),
					});
					const details = mergeActuateDetails(sessionId, paramsDetail, actuateDetail);
					return {
						text: actuateResultText("scroll", details),
						details,
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_wait",
		label: "desktop_wait",
		description: "Wait for a duration before the next desktop action.",
		promptSnippet: "Wait on desktop",
		parameters: Type.Object({
			duration: Type.Number({ minimum: 0, maximum: 100, description: "Seconds to wait" }),
		}),
		...desktopRender("desktop_wait"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			const paramsDetail: Record<string, unknown> = { duration: params.duration };
			return runDesktopTool({
				toolName: "desktop_wait",
				cwd,
				sessionId,
				kind: "actuate",
				action: "wait",
				detail: paramsDetail,
				run: async () => {
					const actuateDetail = await actuateDesktopAction("wait", { duration: params.duration });
					const details = mergeActuateDetails(sessionId, paramsDetail, actuateDetail);
					return {
						text: actuateResultText("wait", details),
						details,
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_open_app",
		label: "desktop_open_app",
		description:
			"Launch a native OS app/process reliably (preferred over Win+Search). Examples: calc, notepad, explorer, msedge, chrome, or a full path / protocol URI.",
		promptSnippet: "Open a desktop app",
		promptGuidelines: [
			"Prefer desktop_open_app for opening apps (calc, notepad, explorer) — do not use Win key + typing.",
			"After open, wait 1–2s then list_windows/screenshot to verify.",
		],
		parameters: Type.Object({
			app: Type.String({
				description: "App alias or path: calc, notepad, explorer, msedge, chrome, or calc.exe / full path",
			}),
			args: Type.Optional(Type.String({ description: "Optional process arguments" })),
		}),
		...desktopRender("desktop_open_app"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			const paramsDetail: Record<string, unknown> = { app: params.app, args: params.args };
			return runDesktopTool({
				toolName: "desktop_open_app",
				cwd,
				sessionId,
				kind: "actuate",
				action: "open_app",
				detail: paramsDetail,
				run: async () => {
					const actuateDetail = await openDesktopApp(params.app, params.args);
					const details = mergeActuateDetails(sessionId, paramsDetail, actuateDetail);
					return {
						text: actuateResultText("open_app", details),
						details,
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_focus_window",
		label: "desktop_focus_window",
		description: "Bring a desktop window to the foreground by title substring or window handle.",
		promptSnippet: "Focus a desktop window",
		parameters: Type.Object({
			title: Type.Optional(Type.String({ description: "Window title substring (e.g. Calculator, Notepad)" })),
			handle: Type.Optional(Type.String({ description: "Window handle from desktop_list_windows" })),
		}),
		...desktopRender("desktop_focus_window"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			const paramsDetail: Record<string, unknown> = { title: params.title, handle: params.handle };
			return runDesktopTool({
				toolName: "desktop_focus_window",
				cwd,
				sessionId,
				kind: "actuate",
				action: "focus_window",
				detail: paramsDetail,
				run: async () => {
					const actuateDetail = await focusDesktopWindow({
						title: params.title,
						handle: params.handle,
					});
					const details = mergeActuateDetails(sessionId, paramsDetail, actuateDetail);
					return {
						text: actuateResultText("focus_window", details),
						details,
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_close_window",
		label: "desktop_close_window",
		description: "Close a desktop window by title substring or handle (sends WM_CLOSE). Use for Calculator, Notepad, etc.",
		promptSnippet: "Close a desktop window",
		parameters: Type.Object({
			title: Type.Optional(Type.String({ description: "Window title substring" })),
			handle: Type.Optional(Type.String({ description: "Window handle from desktop_list_windows" })),
		}),
		...desktopRender("desktop_close_window"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			const paramsDetail: Record<string, unknown> = { title: params.title, handle: params.handle };
			return runDesktopTool({
				toolName: "desktop_close_window",
				cwd,
				sessionId,
				kind: "actuate",
				action: "close_window",
				detail: paramsDetail,
				run: async () => {
					const actuateDetail = await closeDesktopWindow({
						title: params.title,
						handle: params.handle,
					});
					const details = mergeActuateDetails(sessionId, paramsDetail, actuateDetail);
					return {
						text: actuateResultText("close_window", details),
						details,
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_ui_snapshot",
		label: "desktop_ui_snapshot",
		description:
			"Read interactive UI controls (buttons, edits, etc.) via Windows UI Automation. Prefer this over guessing click coordinates.",
		promptSnippet: "Snapshot UI elements",
		promptGuidelines: [
			"After open_app/focus_window, call desktop_ui_snapshot to see real button names.",
			"Then use desktop_ui_click / desktop_ui_type with name/role instead of blind coordinates when possible.",
		],
		parameters: Type.Object({
			title: Type.Optional(Type.String({ description: "Window title substring (e.g. Hesap Makinesi, Notepad)" })),
			handle: Type.Optional(Type.String({ description: "Window handle from desktop_list_windows" })),
			max: Type.Optional(Type.Number({ minimum: 10, maximum: 200, description: "Max elements (default 80)" })),
		}),
		...desktopRender("desktop_ui_snapshot"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			return runDesktopTool({
				toolName: "desktop_ui_snapshot",
				cwd,
				sessionId,
				kind: "screenshot",
				run: async () => {
					const detail = await uiaSnapshot({
						title: params.title,
						handle: params.handle,
						max: params.max,
					});
					const elements = Array.isArray(detail.elements) ? detail.elements : [];
					const lines = elements.slice(0, 60).map((raw: any, i: number) => {
						const name = raw?.name || "(unnamed)";
						const role = raw?.role || "?";
						const aid = raw?.automationId ? ` id=${raw.automationId}` : "";
						const mc = raw?.modelCenter
							? ` model=(${raw.modelCenter.x},${raw.modelCenter.y})`
							: "";
						const en = raw?.enabled === false ? " disabled" : "";
						return `${i}. [${role}] "${name}"${aid}${mc}${en}`;
					});
					return {
						text: [
							`UI snapshot: ${detail.window || detail.foreground || "window"} (${elements.length} elements)`,
							...lines,
						].join("\n"),
						details: { sessionId, ...detail },
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_ui_find",
		label: "desktop_ui_find",
		description: "Find UI elements by name (substring), role, or automationId.",
		promptSnippet: "Find UI element",
		parameters: Type.Object({
			title: Type.Optional(Type.String()),
			handle: Type.Optional(Type.String()),
			name: Type.Optional(Type.String({ description: "Control name / accessible name" })),
			role: Type.Optional(Type.String({ description: "Button, Edit, MenuItem, ListItem, ..." })),
			automationId: Type.Optional(Type.String()),
			contains: Type.Optional(Type.Boolean({ description: "Substring name match (default true)" })),
		}),
		...desktopRender("desktop_ui_find"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			return runDesktopTool({
				toolName: "desktop_ui_find",
				cwd,
				sessionId,
				kind: "screenshot",
				run: async () => {
					const detail = await uiaFind(params);
					const elements = Array.isArray(detail.elements) ? detail.elements : [];
					const lines = elements.map((raw: any, i: number) => {
						return `${i}. [${raw?.role}] "${raw?.name}" model=${JSON.stringify(raw?.modelCenter || {})}`;
					});
					return {
						text: elements.length
							? `Found ${elements.length}:\n${lines.join("\n")}`
							: "No matching UI elements.",
						details: { sessionId, ...detail },
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_ui_click",
		label: "desktop_ui_click",
		description:
			"Click/invoke a UI control by accessible name, role, or automationId (preferred over coordinate clicks).",
		promptSnippet: "Click UI element by name",
		parameters: Type.Object({
			title: Type.Optional(Type.String({ description: "Parent window title" })),
			handle: Type.Optional(Type.String()),
			name: Type.Optional(Type.String({ description: "e.g. 'Bir', 'Topla', 'OK', 'File'" })),
			role: Type.Optional(Type.String({ description: "Button, MenuItem, ..." })),
			automationId: Type.Optional(Type.String()),
			contains: Type.Optional(Type.Boolean()),
			index: Type.Optional(Type.Number({ description: "Which match if multiple (default 0)" })),
		}),
		...desktopRender("desktop_ui_click"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			const paramsDetail: Record<string, unknown> = { ...params };
			return runDesktopTool({
				toolName: "desktop_ui_click",
				cwd,
				sessionId,
				kind: "actuate",
				action: "uia_invoke",
				detail: paramsDetail,
				run: async () => {
					const detail = await uiaInvoke(params);
					const el = detail.element as { name?: string; role?: string } | undefined;
					return {
						text: `UI clicked: [${el?.role || "?"}] "${el?.name || params.name || ""}"`,
						details: { sessionId, ...detail },
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_ui_type",
		label: "desktop_ui_type",
		description: "Type or set value into a UI edit control by name/role/automationId.",
		promptSnippet: "Type into UI field",
		parameters: Type.Object({
			text: Type.String({ description: "Text to enter" }),
			title: Type.Optional(Type.String()),
			handle: Type.Optional(Type.String()),
			name: Type.Optional(Type.String()),
			role: Type.Optional(Type.String({ description: "Default Edit" })),
			automationId: Type.Optional(Type.String()),
			contains: Type.Optional(Type.Boolean()),
		}),
		...desktopRender("desktop_ui_type"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			return runDesktopTool({
				toolName: "desktop_ui_type",
				cwd,
				sessionId,
				kind: "actuate",
				action: "uia_set_value",
				detail: { ...params },
				run: async () => {
					const detail = await uiaSetValue(params);
					return {
						text: `UI typed ${params.text.length} chars`,
						details: { sessionId, ...detail },
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_list_apps",
		label: "desktop_list_apps",
		description: "List known app aliases you can pass to desktop_open_app (calc, notepad, edge, ...).",
		promptSnippet: "List launchable apps",
		parameters: Type.Object({}),
		...desktopRender("desktop_list_apps"),
		async execute(_toolCallId, _params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			return runDesktopTool({
				toolName: "desktop_list_apps",
				cwd,
				sessionId,
				kind: "screenshot",
				run: async () => {
					const detail = await listDesktopApps();
					const apps = Array.isArray(detail.apps) ? detail.apps : [];
					const lines = apps.map((a: any) => `- ${a.id}: ${a.name} → ${a.target}`);
					return {
						text: `Known apps (${apps.length}):\n${lines.join("\n")}`,
						details: { sessionId, ...detail },
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_list_displays",
		label: "desktop_list_displays",
		description: "List monitors (index, id, primary, resolution). Use displayIndex/displayId on click/actuate when multi-monitor.",
		promptSnippet: "List displays",
		parameters: Type.Object({}),
		...desktopRender("desktop_list_displays"),
		async execute(_toolCallId, _params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			return runDesktopTool({
				toolName: "desktop_list_displays",
				cwd,
				sessionId,
				kind: "screenshot",
				run: async () => {
					const displays = await listDisplays();
					const lines = displays.map(
						(d) =>
							`${d.index}: id=${d.id}${d.primary ? " primary" : ""} ${d.size?.width || "?"}×${d.size?.height || "?"} ${d.label || ""}`,
					);
					return {
						text: `Displays (${displays.length}):\n${lines.join("\n")}`,
						details: { sessionId, displays },
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_dialog_set_path",
		label: "desktop_dialog_set_path",
		description:
			"Fill Open/Save file dialog path (File name field) and optionally confirm (Open/Save/Enter). Open the dialog first.",
		promptSnippet: "Set Open/Save dialog path",
		parameters: Type.Object({
			path: Type.String({ description: "Full file or folder path" }),
			confirm: Type.Optional(Type.Boolean({ description: "Click Open/Save or press Enter (default true)" })),
			title: Type.Optional(Type.String({ description: "Dialog window title if needed" })),
		}),
		...desktopRender("desktop_dialog_set_path"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			return runDesktopTool({
				toolName: "desktop_dialog_set_path",
				cwd,
				sessionId,
				kind: "actuate",
				action: "dialog_set_path",
				run: async () => {
					const detail = await dialogSetPath(params);
					return {
						text: `Dialog path set: ${params.path}${detail.confirmed ? " (confirmed)" : ""}`,
						details: { sessionId, ...detail },
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_detect_uac",
		label: "desktop_detect_uac",
		description: "Detect if a Windows UAC prompt is visible. Never automate UAC credentials — ask the user.",
		promptSnippet: "Detect UAC prompt",
		parameters: Type.Object({}),
		...desktopRender("desktop_detect_uac"),
		async execute(_toolCallId, _params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			return runDesktopTool({
				toolName: "desktop_detect_uac",
				cwd,
				sessionId,
				kind: "screenshot",
				run: async () => {
					const detail = await detectUac();
					return {
						text: detail.present
							? `UAC visible: ${detail.title}. Ask the user to approve — do not automate credentials.`
							: "No UAC prompt detected.",
						details: { sessionId, ...detail },
					};
				},
			});
		},
	});

	quake.registerTool({
		name: "desktop_task_done",
		label: "desktop_task_done",
		description:
			"Call when the desktop task is finished. Optionally close apps you opened, then end computer-use session.",
		promptSnippet: "Finish desktop task",
		parameters: Type.Object({
			summary: Type.Optional(Type.String({ description: "What was accomplished" })),
			closeTitles: Type.Optional(
				Type.Array(Type.String(), { description: "Window title substrings to close" }),
			),
		}),
		...desktopRender("desktop_task_done"),
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			const { cwd, sessionId } = await prepareContext(context);
			return runDesktopTool({
				toolName: "desktop_task_done",
				cwd,
				sessionId,
				kind: "actuate",
				action: "task_done",
				run: async () => {
					const closed: string[] = [];
					const titles = params.closeTitles || [];
					for (const t of titles) {
						try {
							await closeDesktopWindow({ title: t });
							closed.push(t);
						} catch {
							/* best effort */
						}
					}
					await endComputerUseBridgeSession();
					return {
						text: [
							params.summary || "Desktop task done.",
							closed.length ? `Closed: ${closed.join(", ")}` : "",
							"Computer-use session ended.",
						]
							.filter(Boolean)
							.join("\n"),
						details: { sessionId, closed, summary: params.summary },
					};
				},
			});
		},
	});

	quake.registerCommand("desktop", {
		description: "Masaüstü modu (@bilgisayar) — gerçek Windows masaüstü kontrolü (desktop_*)",
		handler: async (args, ctx) => {
			const task = args?.trim();
			if (task) {
				ctx.ui.setEditorText(`@bilgisayar ${task}`);
			} else {
				ctx.ui.setEditorText("@bilgisayar ");
			}
			ctx.ui.notify(
				"Masaüstü modu: @bilgisayar ile gönder. Gerçek fare/klavye kullanılır; iş bitince session otomatik kapanır.",
				"info",
			);
		},
	});

	quake.on("session_shutdown", async () => {
		for (const [cwd, sessionId] of sessionByCwd.entries()) {
			endTrajectorySession(cwd, sessionId);
			resetStepCount(cwd);
		}
		sessionByCwd.clear();
		await endComputerUseBridgeSession();
	});

	// Ajan tamamen bitince session kapat (kenar fade hemen gitsin)
	quake.on("agent_end", async () => {
		await endComputerUseBridgeSession();
	});
	// turn_end: HEMEN kapatma — model bir sonraki turda hâlâ desktop_* kullanabilir.
	// Sadece idle grace yenile; gerçek kapanış agent_end / task_done / 90s idle ile.
	quake.on("turn_end", async () => {
		if (getActiveComputerUseSessionId()) {
			scheduleComputerUseIdleEnd();
		}
	});
}