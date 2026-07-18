/**
 * Windows desktop actuation for Computer-Use.
 * Uses user32 SendInput (via embedded PowerShell C#) so Win/Ctrl/Alt and mouse
 * behave like a real human keyboard/mouse — not fragile SendKeys strings.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { hostRequest } from "./desktop-host-client";

const execFileAsync = promisify(execFile);

const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 800;

function scaleToPhysical(
	coordinate: [number, number] | undefined,
	display: { width: number; height: number; x?: number; y?: number },
): { x: number; y: number } | undefined {
	if (!coordinate) return undefined;
	const [x, y] = coordinate;
	const originX = Number(display.x) || 0;
	const originY = Number(display.y) || 0;
	return {
		// Multi-monitor: model coords map onto selected display size, then offset to global screen
		x: originX + Math.round((x / TARGET_WIDTH) * display.width),
		y: originY + Math.round((y / TARGET_HEIGHT) * display.height),
	};
}

/**
 * Run a PowerShell script via a temp file (-File).
 * Avoids Windows ~8k command-line limit (our SendInput helper is large).
 */
async function powershell(script: string, timeoutMs = 45_000): Promise<string> {
	if (process.platform !== "win32") {
		throw new Error("Desktop actuation is currently supported on Windows only.");
	}
	const file = join(tmpdir(), `quake-cu-${randomBytes(8).toString("hex")}.ps1`);
	// UTF-8 with BOM helps PowerShell parse non-ASCII reliably
	writeFileSync(file, `\uFEFF${script}\n`, "utf8");
	try {
		const { stdout, stderr } = await execFileAsync(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file],
			{ windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
		);
		const err = String(stderr || "").trim();
		const out = String(stdout || "").trim();
		if (err && !out) throw new Error(err);
		if (err && /Exception|error CS|ParserError|not found|threw/i.test(err) && !out) {
			throw new Error(err);
		}
		return out;
	} finally {
		try {
			unlinkSync(file);
		} catch {
			/* ignore */
		}
	}
}

/** Shared C# User32 helpers for SendInput + window management. */
const USER32_CS = `
if (-not ("QuakeInput" -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class QuakeInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public InputUnion U;
  }
  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx, dy;
    public uint mouseData, dwFlags, time;
    public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk, wScan;
    public uint dwFlags, time;
    public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left, Top, Right, Bottom;
  }

  public const uint INPUT_MOUSE = 0;
  public const uint INPUT_KEYBOARD = 1;
  public const uint MOUSEEVENTF_MOVE = 0x0001;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
  public const uint MOUSEEVENTF_WHEEL = 0x0800;
  public const uint MOUSEEVENTF_HWHEEL = 0x1000;
  public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
  public const uint MAPVK_VK_TO_VSC = 0;

  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")]
  public static extern short VkKeyScan(char ch);
  [DllImport("user32.dll")]
  public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")]
  public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

  public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
  public const uint SWP_NOMOVE = 0x0002;
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_SHOWWINDOW = 0x0040;

  public const int SW_RESTORE = 9;
  public const int SW_SHOW = 5;
  public const int SW_SHOWNA = 8;
  public const uint WM_CLOSE = 0x0010;
  public const int ASFW_ANY = -1;

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  public static void MoveAbsolute(int x, int y) {
    // SetCursorPos is enough for click targeting; keep it simple and reliable.
    SetCursorPos(x, y);
  }

  public static void MouseButton(string button, bool down) {
    uint flag = 0;
    if (button == "left") flag = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
    else if (button == "right") flag = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
    else if (button == "middle") flag = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
    else flag = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = INPUT_MOUSE;
    inputs[0].U.mi.dwFlags = flag;
    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void MouseClick(string button, int times) {
    for (int i = 0; i < times; i++) {
      MouseButton(button, true);
      System.Threading.Thread.Sleep(30);
      MouseButton(button, false);
      if (i + 1 < times) System.Threading.Thread.Sleep(60);
    }
  }

  public static void Scroll(int delta, bool horizontal) {
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = INPUT_MOUSE;
    inputs[0].U.mi.dwFlags = horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL;
    inputs[0].U.mi.mouseData = unchecked((uint)delta);
    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  static INPUT KeyInput(ushort vk, bool up) {
    INPUT i = new INPUT();
    i.type = INPUT_KEYBOARD;
    i.U.ki.wVk = vk;
    i.U.ki.wScan = (ushort)MapVirtualKey(vk, MAPVK_VK_TO_VSC);
    i.U.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
    // Extended keys
    if (vk == 0x25 || vk == 0x26 || vk == 0x27 || vk == 0x28 || vk == 0x2D || vk == 0x2E ||
        vk == 0x21 || vk == 0x22 || vk == 0x23 || vk == 0x24 || vk == 0x5B || vk == 0x5C) {
      i.U.ki.dwFlags |= KEYEVENTF_EXTENDEDKEY;
    }
    return i;
  }

  public static void KeyTap(ushort vk) {
    INPUT[] inputs = new INPUT[2];
    inputs[0] = KeyInput(vk, false);
    inputs[1] = KeyInput(vk, true);
    SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void KeyDown(ushort vk) {
    INPUT[] inputs = new INPUT[1];
    inputs[0] = KeyInput(vk, false);
    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void KeyUp(ushort vk) {
    INPUT[] inputs = new INPUT[1];
    inputs[0] = KeyInput(vk, true);
    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void Chord(ushort[] vks) {
    List<INPUT> list = new List<INPUT>();
    foreach (ushort vk in vks) list.Add(KeyInput(vk, false));
    for (int i = vks.Length - 1; i >= 0; i--) list.Add(KeyInput(vks[i], true));
    SendInput((uint)list.Count, list.ToArray(), Marshal.SizeOf(typeof(INPUT)));
  }

  public static void TypeText(string text) {
    foreach (char ch in text) {
      if (ch == (char)13) continue; // CR
      if (ch == (char)10) { KeyTap(0x0D); continue; } // LF -> Enter
      if (ch == (char)9) { KeyTap(0x09); continue; } // Tab
      short vkScan = VkKeyScan(ch);
      if (vkScan == -1) {
        // Unicode fallback via clipboard is heavier; skip rare glyphs
        continue;
      }
      byte vk = (byte)(vkScan & 0xFF);
      bool shift = (vkScan & 0x100) != 0;
      bool ctrl = (vkScan & 0x200) != 0;
      bool alt = (vkScan & 0x400) != 0;
      List<INPUT> list = new List<INPUT>();
      if (shift) list.Add(KeyInput(0x10, false));
      if (ctrl) list.Add(KeyInput(0x11, false));
      if (alt) list.Add(KeyInput(0x12, false));
      list.Add(KeyInput(vk, false));
      list.Add(KeyInput(vk, true));
      if (alt) list.Add(KeyInput(0x12, true));
      if (ctrl) list.Add(KeyInput(0x11, true));
      if (shift) list.Add(KeyInput(0x10, true));
      SendInput((uint)list.Count, list.ToArray(), Marshal.SizeOf(typeof(INPUT)));
      System.Threading.Thread.Sleep(8);
    }
  }

  public class WinInfo {
    public string handle;
    public string title;
    public int left, top, right, bottom;
    public uint pid;
  }

  public static List<WinInfo> ListWindows() {
    List<WinInfo> result = new List<WinInfo>();
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      int len = GetWindowTextLength(hWnd);
      if (len <= 0) return true;
      StringBuilder sb = new StringBuilder(len + 1);
      GetWindowText(hWnd, sb, sb.Capacity);
      string title = sb.ToString();
      if (string.IsNullOrWhiteSpace(title)) return true;
      if (title == "Program Manager") return true;
      RECT r;
      GetWindowRect(hWnd, out r);
      if (r.Right - r.Left < 20 || r.Bottom - r.Top < 20) return true;
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      WinInfo w = new WinInfo();
      w.handle = hWnd.ToInt64().ToString();
      w.title = title;
      w.left = r.Left; w.top = r.Top; w.right = r.Right; w.bottom = r.Bottom;
      w.pid = pid;
      result.Add(w);
      return true;
    }, IntPtr.Zero);
    return result;
  }

  public static bool FocusWindow(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return false;
    try { AllowSetForegroundWindow(ASFW_ANY); } catch {}
    if (IsIconic(hWnd)) ShowWindow(hWnd, SW_RESTORE);
    else ShowWindow(hWnd, SW_SHOW);
    ShowWindowAsync(hWnd, SW_RESTORE);
    BringWindowToTop(hWnd);
    // Temporarily topmost then restore — forces Z-order above fullscreen browsers
    SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    SetWindowPos(hWnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);

    IntPtr fg = GetForegroundWindow();
    uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero);
    uint thisThread = GetCurrentThreadId();
    uint targetThread = GetWindowThreadProcessId(hWnd, IntPtr.Zero);
    bool attached1 = false;
    bool attached2 = false;
    try {
      if (fgThread != thisThread) attached1 = AttachThreadInput(thisThread, fgThread, true);
      if (targetThread != thisThread && targetThread != fgThread)
        attached2 = AttachThreadInput(thisThread, targetThread, true);
      SetForegroundWindow(hWnd);
      BringWindowToTop(hWnd);
    } finally {
      if (attached2) AttachThreadInput(thisThread, targetThread, false);
      if (attached1) AttachThreadInput(thisThread, fgThread, false);
    }
    // Success if we are foreground OR window is visible/restored (UWP may still report other FG)
    IntPtr now = GetForegroundWindow();
    return now == hWnd || IsWindowVisible(hWnd);
  }

  // GetWindowThreadProcessId with ProcessId out overload already exists; add IntPtr ProcessId=0 overload via unused
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr ProcessId);

  public static bool CloseWindow(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return false;
    return PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
  }
}
"@ -ReferencedAssemblies System.Windows.Forms
}
`;

const VK: Record<string, number> = {
	backspace: 0x08,
	tab: 0x09,
	enter: 0x0d,
	return: 0x0d,
	shift: 0x10,
	ctrl: 0x11,
	control: 0x11,
	alt: 0x12,
	pause: 0x13,
	capslock: 0x14,
	esc: 0x1b,
	escape: 0x1b,
	space: 0x20,
	pageup: 0x21,
	pagedown: 0x22,
	end: 0x23,
	home: 0x24,
	left: 0x25,
	up: 0x26,
	right: 0x27,
	down: 0x28,
	insert: 0x2d,
	ins: 0x2d,
	delete: 0x2e,
	del: 0x2e,
	win: 0x5b,
	meta: 0x5b,
	cmd: 0x5b,
	super: 0x5b,
	lwin: 0x5b,
	rwin: 0x5c,
	apps: 0x5d,
	f1: 0x70,
	f2: 0x71,
	f3: 0x72,
	f4: 0x73,
	f5: 0x74,
	f6: 0x75,
	f7: 0x76,
	f8: 0x77,
	f9: 0x78,
	f10: 0x79,
	f11: 0x7a,
	f12: 0x7b,
	numlock: 0x90,
	scrolllock: 0x91,
	";": 0xba,
	"=": 0xbb,
	",": 0xbc,
	"-": 0xbd,
	".": 0xbe,
	"/": 0xbf,
	"`": 0xc0,
	"[": 0xdb,
	"\\": 0xdc,
	"]": 0xdd,
	"'": 0xde,
};

function resolveVk(token: string): number | undefined {
	const t = token.trim().toLowerCase();
	if (!t) return undefined;
	if (VK[t] != null) return VK[t];
	if (/^f([1-9]|1[0-2])$/.test(t)) return 0x70 + (Number(t.slice(1)) - 1);
	if (/^[0-9]$/.test(t)) return 0x30 + Number(t);
	if (/^[a-z]$/.test(t)) return t.toUpperCase().charCodeAt(0);
	return undefined;
}

function parseKeyChord(spec: string): number[] {
	const parts = spec
		.split(/[+\-]/)
		.map((p) => p.trim())
		.filter(Boolean);
	const vks: number[] = [];
	for (const p of parts) {
		const vk = resolveVk(p);
		if (vk == null) throw new Error(`Unknown key in chord: "${p}" (full: ${spec})`);
		vks.push(vk);
	}
	if (!vks.length) throw new Error(`Empty key chord: ${spec}`);
	return vks;
}

/** Well-known app aliases → shell targets. */
const APP_ALIASES: Record<string, string> = {
	calc: "calc.exe",
	calculator: "calc.exe",
	"hesap makinesi": "calc.exe",
	hesapmakinesi: "calc.exe",
	notepad: "notepad.exe",
	not: "notepad.exe",
	"not defteri": "notepad.exe",
	paint: "mspaint.exe",
	mspaint: "mspaint.exe",
	explorer: "explorer.exe",
	files: "explorer.exe",
	cmd: "cmd.exe",
	powershell: "powershell.exe",
	pwsh: "pwsh.exe",
	terminal: "wt.exe",
	"windows terminal": "wt.exe",
	edge: "msedge.exe",
	chrome: "chrome.exe",
	firefox: "firefox.exe",
	word: "winword.exe",
	excel: "excel.exe",
	settings: "ms-settings:",
	ayarlar: "ms-settings:",
	snipping: "SnippingTool.exe",
	snippet: "SnippingTool.exe",
};

function resolveAppTarget(app: string): string {
	const raw = app.trim();
	const key = raw.toLowerCase();
	if (APP_ALIASES[key]) return APP_ALIASES[key];
	// already an executable or URI
	return raw;
}

/**
 * Prefer persistent desktop host (fast). Fall back to one-shot PowerShell on host failure.
 */
export async function actuateDesktop(
	action: string,
	params: Record<string, unknown>,
	display: { width: number; height: number },
): Promise<Record<string, unknown>> {
	try {
		return await actuateViaHost(action, params, display);
	} catch (hostErr) {
		// One-shot fallback for drag / host crash recovery
		if (action === "drag") return actuateViaOneshot(action, params, display);
		try {
			return await actuateViaOneshot(action, params, display);
		} catch {
			throw hostErr instanceof Error ? hostErr : new Error(String(hostErr));
		}
	}
}

async function actuateViaHost(
	action: string,
	params: Record<string, unknown>,
	display: { width: number; height: number },
): Promise<Record<string, unknown>> {
	const coordinate = Array.isArray(params.coordinate)
		? (params.coordinate as [number, number])
		: undefined;
	const physical = scaleToPhysical(coordinate, display);

	switch (action) {
		case "mouse_move": {
			if (!physical) throw new Error("mouse_move requires coordinate");
			const detail = await hostRequest("mouse_move", { x: physical.x, y: physical.y });
			return { coordinate, physical, ...detail };
		}
		case "left_click":
		case "right_click":
		case "middle_click":
		case "double_click":
		case "click": {
			const button =
				action === "right_click" ? "right" : action === "middle_click" ? "middle" : "left";
			const times = action === "double_click" ? 2 : 1;
			const detail = await hostRequest("click", {
				x: physical?.x,
				y: physical?.y,
				button,
				times,
			});
			return { action, button, times, coordinate, physical, ...detail };
		}
		case "type": {
			const text = String(params.text ?? "");
			if (!text) throw new Error("type requires text");
			// Long / complex text: clipboard paste is more reliable than per-keystroke
			const preferPaste =
				params.method === "paste" ||
				params.paste === true ||
				text.length > 80 ||
				(/[\u0100-\uFFFF]/.test(text) && text.length > 24);
			const detail = preferPaste
				? await hostRequest("paste", { text })
				: await hostRequest("type", { text });
			return { length: text.length, ...detail };
		}
		case "paste": {
			const text = String(params.text ?? "");
			const detail = await hostRequest("paste", { text });
			return { length: text.length, ...detail };
		}
		case "key": {
			const key = String(params.text ?? params.key ?? "");
			if (!key) throw new Error("key requires text/key");
			const detail = await hostRequest("key", { key });
			return { key, ...detail };
		}
		case "scroll": {
			const direction = String(params.scroll_direction ?? "down").toLowerCase();
			const amount = Math.max(1, Math.min(50, Number(params.scroll_amount ?? 3)));
			const unit = 120 * amount;
			let delta = 0;
			let horizontal = false;
			if (direction === "up") delta = unit;
			else if (direction === "down") delta = -unit;
			else if (direction === "left") {
				delta = -unit;
				horizontal = true;
			} else if (direction === "right") {
				delta = unit;
				horizontal = true;
			} else delta = -unit;
			const detail = await hostRequest("scroll", {
				x: physical?.x,
				y: physical?.y,
				delta,
				horizontal,
			});
			return { direction, amount, coordinate, physical, ...detail };
		}
		case "wait": {
			const duration = Number(params.duration ?? 1);
			const detail = await hostRequest("wait", { duration });
			return { duration, ...detail };
		}
		case "open_app": {
			const app = String(params.app ?? params.target ?? params.text ?? "").trim();
			if (!app) throw new Error("open_app requires app (e.g. calc, notepad, chrome)");
			const args = String(params.args ?? "").trim();
			const detail = await hostRequest("open_app", { app, args: args || undefined });
			return { app, args: args || undefined, ...detail };
		}
		case "focus_window": {
			const title = String(params.title ?? params.name ?? params.text ?? "").trim();
			const handle = String(params.handle ?? params.id ?? "").trim();
			if (!title && !handle) throw new Error("focus_window requires title or handle");
			const detail = await hostRequest("focus_window", { title, handle });
			return { focused: true, ...detail };
		}
		case "close_window": {
			const title = String(params.title ?? params.name ?? params.text ?? "").trim();
			const handle = String(params.handle ?? params.id ?? "").trim();
			if (!title && !handle) throw new Error("close_window requires title or handle");
			const detail = await hostRequest("close_window", { title, handle });
			return { closed: true, ...detail };
		}
		case "list_windows_native": {
			const detail = await hostRequest("list_windows", {});
			return detail;
		}
		case "uia_snapshot":
		case "uia_find":
		case "uia_invoke":
		case "uia_set_value":
		case "list_apps":
		case "dialog_set_path":
		case "detect_uac": {
			const detail = await hostRequest(action, params);
			return detail;
		}
		case "drag":
			// Host does not implement drag yet — fall through to oneshot
			throw new Error("drag uses oneshot path");
		default:
			throw new Error(`Unsupported actuate action: ${action}`);
	}
}

/** Legacy one-shot PowerShell path (fallback / drag). */
async function actuateViaOneshot(
	action: string,
	params: Record<string, unknown>,
	display: { width: number; height: number },
): Promise<Record<string, unknown>> {
	const coordinate = Array.isArray(params.coordinate)
		? (params.coordinate as [number, number])
		: undefined;
	const physical = scaleToPhysical(coordinate, display);

	if (action === "drag") {
		const start = Array.isArray(params.start_coordinate)
			? scaleToPhysical(params.start_coordinate as [number, number], display)
			: undefined;
		const end = physical;
		if (!start || !end) throw new Error("drag requires start_coordinate and coordinate");
		await powershell(`
${USER32_CS}
[QuakeInput]::MoveAbsolute(${start.x}, ${start.y})
Start-Sleep -Milliseconds 40
[QuakeInput]::MouseButton('left', $true)
Start-Sleep -Milliseconds 50
[QuakeInput]::MoveAbsolute(${end.x}, ${end.y})
Start-Sleep -Milliseconds 40
[QuakeInput]::MouseButton('left', $false)
`);
		return { start_coordinate: params.start_coordinate, coordinate, start, end };
	}

	if (action === "mouse_move") {
		if (!physical) throw new Error("mouse_move requires coordinate");
		await powershell(`${USER32_CS}; [QuakeInput]::MoveAbsolute(${physical.x}, ${physical.y})`);
		return { coordinate, physical };
	}

	if (action === "type") {
		const text = String(params.text ?? "");
		const b64 = Buffer.from(text, "utf8").toString("base64");
		await powershell(
			`${USER32_CS}; $t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')); [QuakeInput]::TypeText($t)`,
		);
		return { length: text.length };
	}

	if (action === "key") {
		const key = String(params.text ?? params.key ?? "");
		const vks = parseKeyChord(key);
		await powershell(`${USER32_CS}; [QuakeInput]::Chord([uint16[]]@(${vks.join(",")}))`);
		return { key, vks };
	}

	if (action === "list_windows_native") {
		const out = await powershell(`
${USER32_CS}
$wins = [QuakeInput]::ListWindows()
$wins | ForEach-Object { ($_ | ConvertTo-Json -Compress) }
`);
		const windows = out
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.parse(line);
				} catch {
					return null;
				}
			})
			.filter(Boolean);
		return { windows, count: windows.length };
	}

	void display;
	throw new Error(`Oneshot unsupported or failed for action: ${action}`);
}

export async function readCursorPosition(display: {
	width: number;
	height: number;
}): Promise<{ x: number; y: number }> {
	if (process.platform === "win32") {
		const out = await powershell(`
Add-Type -AssemblyName System.Windows.Forms
$p = [System.Windows.Forms.Cursor]::Position
Write-Output ($p.X.ToString() + ',' + $p.Y.ToString())
`);
		const [px, py] = out.split(",").map(Number);
		return {
			x: Math.round((px / display.width) * TARGET_WIDTH),
			y: Math.round((py / display.height) * TARGET_HEIGHT),
		};
	}
	return { x: Math.round(TARGET_WIDTH / 2), y: Math.round(TARGET_HEIGHT / 2) };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
