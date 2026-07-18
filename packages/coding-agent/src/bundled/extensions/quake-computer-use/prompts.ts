import { COMPUTER_USE_INJECTION_GUIDELINES } from "./claude-passthrough.js";

export function buildComputerUseRoutingGuidelines(): string[] {
	return [
		"CRITICAL: For any web URL (google.com, localhost, docs, forms) you MUST use browser_* tools only — never desktop_* / computer / external Chrome.",
		"The in-app browser (right panel Tarayıcı) is the only browser surface. Do not open Chrome/Edge via desktop automation for web tasks unless the user explicitly asks for the OS browser.",
		"If browser_* fails once, retry browser_navigate — do not fall back to computer-use for websites.",
		"desktop_* and computer are ONLY for native OS apps (Explorer, Excel, Notepad, Calculator, installers, system dialogs, desktop UI).",
		"While desktop_* tools run, the real OS mouse moves (no fake agent cursor overlay).",
		"Ground clicks using 1280×800 coordinates from screenshots / tool details.",
		"HUMAN-LIKE DESKTOP CONTROL:",
		"1) Opening apps: ALWAYS prefer desktop_open_app (e.g. app='calc', 'notepad', 'explorer', 'msedge') instead of Win+type. It launches the process reliably.",
		"2) After open_app, desktop_wait 1–2s, then desktop_list_windows and/or desktop_screenshot to verify the window appeared.",
		"3) Focus the target with desktop_focus_window (title substring) before typing or clicking inside it.",
		"4) PREFER desktop_ui_snapshot then desktop_ui_click(name=...) / desktop_ui_type — real accessibility names beat blind coordinates.",
		"5) Closing apps: use desktop_close_window with the window title (or handle from list_windows). Do NOT only say you closed it.",
		"6) Keys: use desktop_key with real combos — win, win+e, win+d, ctrl+c, alt+f4, enter, escape, tab.",
		"7) Coordinate clicks (desktop_click) only as fallback when UIA cannot find the control; use modelCenter from ui_snapshot if needed.",
		"8) After every critical step, verify with desktop_ui_snapshot or desktop_screenshot. Never claim success without verification.",
		"9) If the user says to stop computer use: stop desktop_* tools; close apps if needed.",
		"10) Work like a careful human: observe → act → verify. Prefer 1–3 solid actions over many random clicks.",
		"11) Turkish / Unicode text is supported via desktop_type (Unicode SendInput). Long text is auto-pasted via clipboard.",
		"12) If focus is stolen (browser on top), re-call desktop_focus_window — host retries automatically.",
		"CRITICAL FINISH: when done call desktop_task_done (optionally closeTitles) OR stop desktop_* so the session ends.",
		"Do not leave apps open unless the user asked to keep them open.",
		"App aliases: desktop_list_apps then desktop_open_app(id). Multi-monitor: desktop_list_displays; pass displayIndex on clicks if needed.",
		"Open/Save dialogs: after dialog opens, desktop_dialog_set_path(path). If UAC appears, desktop_detect_uac and ask the user — never automate credentials.",
		"Honest limits: games, DirectX, custom canvas, DRM, UAC passwords are out of scope — fail soft and tell the user.",
		"User message may include @bilgisayar / [MASAÜSTÜ MODU] — that means mandatory desktop_* usage for that turn.",
		"Do not ask the user to open a Computer-Use side panel; act directly on the real desktop. There is no agent cursor overlay — use the real mouse.",
		"Do not use desktop_* for web content — use browser_take_screenshot / browser_snapshot instead.",
		...COMPUTER_USE_INJECTION_GUIDELINES,
	];
}
