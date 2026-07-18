import sys
import json
import time
import base64
from io import BytesIO

try:
    from PIL import ImageGrab, ImageDraw, ImageFont
    import uiautomation as auto
    import pyautogui
    import win32gui
    import win32con
    import win32api
    import win32clipboard
except ImportError as e:
    print(json.dumps({"status": "error", "message": f"Missing library: {str(e)}"}))
    sys.exit(1)

SCHEMA_VERSION = "quake.os.observe.v4"
MAX_ELEMENTS = 120
INTERACTIVE_CONTROL_TYPES = {
    auto.ControlType.ButtonControl,
    auto.ControlType.EditControl,
    auto.ControlType.ListItemControl,
    auto.ControlType.TabItemControl,
    auto.ControlType.MenuItemControl,
    auto.ControlType.CheckBoxControl,
    auto.ControlType.HyperlinkControl,
    auto.ControlType.ComboBoxControl,
    auto.ControlType.RadioButtonControl,
    auto.ControlType.DocumentControl,
}

pyautogui.FAILSAFE = False


def rect_to_bounds(rect):
    return [int(rect.left), int(rect.top), int(rect.right), int(rect.bottom)]


def rect_to_center(rect):
    return [int((rect.left + rect.right) / 2), int((rect.top + rect.bottom) / 2)]


def safe_get_text(control):
    try:
        name = control.Name
        return name if name else "Unknown"
    except Exception:
        return "Unknown"


def safe_get_hwnd(control, fallback=0):
    try:
        hwnd = int(control.NativeWindowHandle or 0)
        return hwnd or fallback
    except Exception:
        return fallback


def safe_get_process_name(hwnd):
    try:
        _, pid = win32gui.GetWindowThreadProcessId(hwnd)
        return str(pid)
    except Exception:
        return None


def safe_get_automation_id(control):
    try:
        value = control.AutomationId
        return str(value) if value else None
    except Exception:
        return None


def safe_is_enabled(control):
    try:
        return bool(control.IsEnabled)
    except Exception:
        return None


def safe_has_keyboard_focus(control):
    try:
        return bool(control.HasKeyboardFocus)
    except Exception:
        return None


def safe_get_value_preview(control):
    try:
        value = control.GetValuePattern().Value
        if value is None:
            return None
        return str(value)[:120]
    except Exception:
        return None


def get_clipboard_text():
    try:
        win32clipboard.OpenClipboard()
        if not win32clipboard.IsClipboardFormatAvailable(win32con.CF_UNICODETEXT):
            return None
        data = win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
        return str(data) if data is not None else None
    except Exception:
        return None
    finally:
        try:
            win32clipboard.CloseClipboard()
        except Exception:
            pass


def enum_candidate_children(window):
    try:
        return window.GetChildren()
    except Exception:
        return []


def get_focused_control_info(foreground_hwnd):
    try:
        control = auto.GetFocusedControl()
        if not control:
            return None
        rect = control.BoundingRectangle
        bounds = rect_to_bounds(rect)
        if bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
            return None
        hwnd = safe_get_hwnd(control, foreground_hwnd)
        top_level = None
        try:
            top_level = control.GetTopLevelControl()
        except Exception:
            top_level = None
        return {
            "name": safe_get_text(control),
            "type": getattr(control, "ControlTypeName", "Unknown"),
            "hwnd": hwnd,
            "bounds": bounds,
            "center": rect_to_center(rect),
            "windowTitle": safe_get_text(top_level) if top_level else None,
            "automationId": safe_get_automation_id(control),
            "isEnabled": safe_is_enabled(control),
            "hasKeyboardFocus": safe_has_keyboard_focus(control),
            "valuePreview": safe_get_value_preview(control),
        }
    except Exception:
        return None


def collect_observation():
    root = auto.GetRootControl()
    elements = []
    windows = []
    element_id = 1

    try:
        foreground_hwnd = int(win32gui.GetForegroundWindow())
    except Exception:
        foreground_hwnd = 0

    focused_element = get_focused_control_info(foreground_hwnd)

    for window in root.GetChildren():
        try:
            if window.IsOffscreen:
                continue
            rect = window.BoundingRectangle
            bounds = rect_to_bounds(rect)
            if bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
                continue

            hwnd = safe_get_hwnd(window)
            title = safe_get_text(window)
            window_info = {
                "hwnd": hwnd,
                "title": title,
                "type": window.ControlTypeName,
                "bounds": bounds,
                "center": rect_to_center(rect),
                "isForeground": hwnd == foreground_hwnd,
                "process": safe_get_process_name(hwnd),
            }
            windows.append(window_info)

            elements.append({
                "id": element_id,
                "name": title,
                "type": window.ControlTypeName,
                "hwnd": hwnd,
                "bounds": bounds,
                "center": rect_to_center(rect),
                "windowTitle": title,
                "isWindow": True,
                "automationId": safe_get_automation_id(window),
                "isEnabled": safe_is_enabled(window),
                "hasKeyboardFocus": safe_has_keyboard_focus(window),
                "valuePreview": safe_get_value_preview(window),
            })
            element_id += 1

            for child in enum_candidate_children(window):
                if element_id > MAX_ELEMENTS:
                    break
                try:
                    if child.IsOffscreen or child.ControlType not in INTERACTIVE_CONTROL_TYPES:
                        continue
                    child_rect = child.BoundingRectangle
                    child_bounds = rect_to_bounds(child_rect)
                    if child_bounds[2] <= child_bounds[0] or child_bounds[3] <= child_bounds[1]:
                        continue
                    child_hwnd = safe_get_hwnd(child, hwnd)
                    elements.append({
                        "id": element_id,
                        "name": safe_get_text(child),
                        "type": child.ControlTypeName,
                        "hwnd": child_hwnd,
                        "bounds": child_bounds,
                        "center": rect_to_center(child_rect),
                        "windowTitle": title,
                        "isWindow": False,
                        "automationId": safe_get_automation_id(child),
                        "isEnabled": safe_is_enabled(child),
                        "hasKeyboardFocus": safe_has_keyboard_focus(child),
                        "valuePreview": safe_get_value_preview(child),
                    })
                    element_id += 1
                except Exception:
                    continue
        except Exception:
            continue

    screenshot = capture_and_label(elements)
    active_window = next((w for w in windows if w["isForeground"]), None)
    clipboard_text = get_clipboard_text()
    return {
        "status": "success",
        "schemaVersion": SCHEMA_VERSION,
        "capturedAt": int(time.time() * 1000),
        "activeWindow": active_window,
        "focusedElement": focused_element,
        "clipboard": {
            "hasText": clipboard_text is not None,
            "text": clipboard_text,
            "preview": clipboard_text[:200] if clipboard_text else None,
        },
        "windows": windows,
        "elements": elements,
        "screenshot": screenshot,
    }


def capture_and_label(elements):
    screenshot = ImageGrab.grab()
    draw = ImageDraw.Draw(screenshot)
    try:
        font = ImageFont.truetype("arial.ttf", 15)
    except Exception:
        font = ImageFont.load_default()

    for el in elements:
        x, y = el["bounds"][0], el["bounds"][1]
        draw.rectangle([x, y, x + 28, y + 20], fill="#0a7f2e", outline="white")
        draw.text((x + 3, y + 2), str(el["id"]), fill="white", font=font)

    buffered = BytesIO()
    screenshot.save(buffered, format="PNG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")


def control_from_hwnd(hwnd):
    try:
        return auto.ControlFromHandle(int(hwnd))
    except Exception:
        return None


def result_ok(action, method, message, extra=None):
    payload = {
        "status": "success",
        "ok": True,
        "action": action,
        "method": method,
        "result": message,
    }
    if extra:
        payload.update(extra)
    return payload


def result_fail(action, reason, message, retry=True, fallback=None):
    return {
        "status": "error",
        "ok": False,
        "action": action,
        "failureReason": reason,
        "message": message,
        "retrySuggested": retry,
        "fallbackSuggested": fallback,
    }


VK_NAME_MAP = {
    "enter": win32con.VK_RETURN,
    "return": win32con.VK_RETURN,
    "tab": win32con.VK_TAB,
    "esc": win32con.VK_ESCAPE,
    "escape": win32con.VK_ESCAPE,
    "space": win32con.VK_SPACE,
    "backspace": win32con.VK_BACK,
    "delete": win32con.VK_DELETE,
    "del": win32con.VK_DELETE,
    "up": win32con.VK_UP,
    "down": win32con.VK_DOWN,
    "left": win32con.VK_LEFT,
    "right": win32con.VK_RIGHT,
    "home": win32con.VK_HOME,
    "end": win32con.VK_END,
    "pageup": win32con.VK_PRIOR,
    "pagedown": win32con.VK_NEXT,
    "pgup": win32con.VK_PRIOR,
    "pgdn": win32con.VK_NEXT,
    "ctrl": win32con.VK_CONTROL,
    "control": win32con.VK_CONTROL,
    "shift": win32con.VK_SHIFT,
    "alt": win32con.VK_MENU,
}


def resolve_vk(key):
    key = str(key).lower()
    if key in VK_NAME_MAP:
        return VK_NAME_MAP[key]
    if len(key) == 1:
        try:
            vk = win32api.VkKeyScan(key)
            if vk != -1:
                return vk & 0xff
        except Exception:
            pass
        return ord(key.upper())
    return None


def post_virtual_key(hwnd, key, keyup=False):
    vk = resolve_vk(key)
    if vk is None:
        raise ValueError(f"Unsupported key: {key}")
    msg = win32con.WM_KEYUP if keyup else win32con.WM_KEYDOWN
    win32gui.PostMessage(int(hwnd), msg, vk, 0)


def try_uia_set_value(hwnd, text):
    ctrl = control_from_hwnd(hwnd)
    if not ctrl:
        return False, "control_not_found"
    try:
        ctrl.GetValuePattern().SetValue(text)
        return True, "uia_value_pattern"
    except Exception:
        pass
    try:
        ctrl.SendKeys(text, waitTime=0.01)
        return True, "uia_sendkeys"
    except Exception:
        return False, "uia_unavailable"


def try_wm_settext(hwnd, text):
    try:
        win32gui.SendMessage(int(hwnd), win32con.WM_SETTEXT, 0, text)
        return True, "wm_settext"
    except Exception:
        return False, "wm_settext_failed"


def try_wm_char(hwnd, text):
    try:
        for char in text:
            win32gui.PostMessage(int(hwnd), win32con.WM_CHAR, ord(char), 0)
        return True, "wm_char"
    except Exception:
        return False, "wm_char_failed"


def ghost_type(hwnd, text):
    for method in (try_uia_set_value, try_wm_settext, try_wm_char):
        ok, method_name = method(hwnd, text)
        if ok:
            return result_ok("ghost_type", method_name, f"Ghost typed into HWND {hwnd}", {"hwnd": int(hwnd)})
    return result_fail(
        "ghost_type",
        "window_rejected_background_text",
        f"Unable to background-type into HWND {hwnd}",
        True,
        "type",
    )


def ghost_click(hwnd, x, y):
    try:
        point = win32gui.ScreenToClient(int(hwnd), (int(x), int(y)))
        lparam = win32api.MAKELONG(point[0], point[1])
        win32gui.PostMessage(int(hwnd), win32con.WM_MOUSEMOVE, 0, lparam)
        win32gui.PostMessage(int(hwnd), win32con.WM_LBUTTONDOWN, win32con.MK_LBUTTON, lparam)
        win32gui.PostMessage(int(hwnd), win32con.WM_LBUTTONUP, 0, lparam)
        return result_ok(
            "ghost_click",
            "postmessage_mouse",
            f"Ghost clicked HWND {hwnd} at screen ({x}, {y}) / client {point}",
            {"hwnd": int(hwnd), "screen": [int(x), int(y)], "client": [int(point[0]), int(point[1])]},
        )
    except Exception as e:
        return result_fail(
            "ghost_click",
            "background_click_failed",
            str(e),
            True,
            "click",
        )


def physical_click(x, y):
    try:
        pyautogui.click(int(x), int(y))
        return result_ok("click", "pyautogui_click", f"Physical click at ({x}, {y})")
    except Exception as e:
        return result_fail("click", "physical_click_failed", str(e), False, None)


def physical_double_click(x, y):
    try:
        pyautogui.doubleClick(int(x), int(y))
        return result_ok("double_click", "pyautogui_double_click", f"Physical double click at ({x}, {y})", {"x": int(x), "y": int(y)})
    except Exception as e:
        return result_fail("double_click", "physical_double_click_failed", str(e), False, None)


def physical_right_click(x, y):
    try:
        pyautogui.rightClick(int(x), int(y))
        return result_ok("right_click", "pyautogui_right_click", f"Physical right click at ({x}, {y})", {"x": int(x), "y": int(y)})
    except Exception as e:
        return result_fail("right_click", "physical_right_click_failed", str(e), False, None)


def physical_move(x, y, duration_ms=None):
    try:
        duration = max(float(duration_ms or 0) / 1000.0, 0.0)
        pyautogui.moveTo(int(x), int(y), duration=duration)
        return result_ok("move", "pyautogui_move", f"Moved cursor to ({x}, {y})", {"x": int(x), "y": int(y), "durationMs": int(duration_ms or 0)})
    except Exception as e:
        return result_fail("move", "physical_move_failed", str(e), False, None)


def physical_drag(x, y, to_x, to_y, duration_ms=None):
    try:
        duration = max(float(duration_ms or 0) / 1000.0, 0.0)
        pyautogui.moveTo(int(x), int(y), duration=0)
        pyautogui.dragTo(int(to_x), int(to_y), duration=duration, button="left")
        return result_ok(
            "drag",
            "pyautogui_drag",
            f"Dragged from ({x}, {y}) to ({to_x}, {to_y})",
            {"from": [int(x), int(y)], "to": [int(to_x), int(to_y)], "durationMs": int(duration_ms or 0)},
        )
    except Exception as e:
        return result_fail("drag", "physical_drag_failed", str(e), False, None)


def physical_type(text):
    try:
        pyautogui.write(text, interval=0.02)
        return result_ok("type", "pyautogui_type", "Physical typing performed")
    except Exception as e:
        return result_fail("type", "physical_type_failed", str(e), False, None)


def physical_press(key):
    try:
        pyautogui.press(key)
        return result_ok("press", "pyautogui_press", f"Pressed {key}")
    except Exception as e:
        return result_fail("press", "physical_press_failed", str(e), False, None)


def physical_hotkey(keys):
    try:
        if not keys or not isinstance(keys, list):
            return result_fail("hotkey", "invalid_keys", "hotkey requires a non-empty keys array", False, None)
        pyautogui.hotkey(*keys)
        return result_ok("hotkey", "pyautogui_hotkey", f"Pressed hotkey: {'+'.join(keys)}", {"keys": keys})
    except Exception as e:
        return result_fail("hotkey", "physical_hotkey_failed", str(e), False, None)


def ghost_press(hwnd, key):
    try:
        post_virtual_key(hwnd, key, keyup=False)
        post_virtual_key(hwnd, key, keyup=True)
        return result_ok("ghost_press", "postmessage_key", f"Ghost pressed {key} on HWND {int(hwnd)}", {"hwnd": int(hwnd), "key": key})
    except Exception as e:
        return result_fail("ghost_press", "background_press_failed", str(e), True, "press")


def ghost_hotkey(hwnd, keys):
    try:
        if not keys or not isinstance(keys, list):
            return result_fail("ghost_hotkey", "invalid_keys", "ghost_hotkey requires a non-empty keys array", False, None)
        for key in keys[:-1]:
            post_virtual_key(hwnd, key, keyup=False)
        post_virtual_key(hwnd, keys[-1], keyup=False)
        post_virtual_key(hwnd, keys[-1], keyup=True)
        for key in reversed(keys[:-1]):
            post_virtual_key(hwnd, key, keyup=True)
        return result_ok("ghost_hotkey", "postmessage_hotkey", f"Ghost hotkey on HWND {int(hwnd)}", {"hwnd": int(hwnd), "keys": keys})
    except Exception as e:
        return result_fail("ghost_hotkey", "background_hotkey_failed", str(e), True, "hotkey")


def physical_send_keys(keys):
    try:
        if isinstance(keys, list):
            for key in keys:
                pyautogui.press(key)
        else:
            pyautogui.press(keys)
        return result_ok("send_keys", "pyautogui_send_keys", "Sent key sequence", {"keys": keys})
    except Exception as e:
        return result_fail("send_keys", "physical_send_keys_failed", str(e), False, None)


def physical_scroll(amount):
    try:
        pyautogui.scroll(int(amount))
        return result_ok("scroll", "pyautogui_scroll", f"Scrolled {int(amount)}", {"amount": int(amount)})
    except Exception as e:
        return result_fail("scroll", "physical_scroll_failed", str(e), False, None)


def physical_hover(x, y, duration_ms=None):
    try:
        duration = max(float(duration_ms or 0) / 1000.0, 0.0)
        pyautogui.moveTo(int(x), int(y), duration=duration)
        return result_ok("hover", "pyautogui_hover", f"Hovered at ({x}, {y})", {"x": int(x), "y": int(y), "durationMs": int(duration_ms or 0)})
    except Exception as e:
        return result_fail("hover", "physical_hover_failed", str(e), False, None)


def ghost_scroll(hwnd, amount):
    try:
        amount = int(amount)
        win32gui.PostMessage(int(hwnd), win32con.WM_MOUSEWHEEL, amount << 16, 0)
        return result_ok("ghost_scroll", "postmessage_wheel", f"Ghost scrolled HWND {int(hwnd)} by {amount}", {"hwnd": int(hwnd), "amount": amount})
    except Exception as e:
        return result_fail("ghost_scroll", "background_scroll_failed", str(e), True, "scroll")


def clipboard_shortcut(action_name, keys):
    before_text = get_clipboard_text()
    try:
        pyautogui.hotkey(*keys)
        time.sleep(0.12)
        after_text = get_clipboard_text()
        return result_ok(
            action_name,
            "pyautogui_hotkey",
            f"Executed {action_name}",
            {
                "keys": keys,
                "clipboardBefore": before_text,
                "clipboardAfter": after_text,
                "clipboardChanged": before_text != after_text,
            },
        )
    except Exception as e:
        return result_fail(action_name, f"{action_name}_failed", str(e), False, None)


def try_activate_window(hwnd):
    try:
        hwnd = int(hwnd)
        if not win32gui.IsWindow(hwnd):
            return False, "window_not_found"
        try:
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        except Exception:
            pass
        try:
            win32gui.BringWindowToTop(hwnd)
        except Exception:
            pass
        win32gui.SetForegroundWindow(hwnd)
        try:
            win32gui.SetActiveWindow(hwnd)
        except Exception:
            pass
        return True, "win32_foreground"
    except Exception:
        return False, "window_activation_failed"


def activate_window(hwnd):
    ok, method = try_activate_window(hwnd)
    if ok:
        return result_ok("activate_window", method, f"Activated HWND {int(hwnd)}", {"hwnd": int(hwnd)})
    return result_fail("activate_window", method, f"Unable to activate HWND {int(hwnd)}", True, None)


def focus_window(hwnd):
    ok, method = try_activate_window(hwnd)
    if ok:
        return result_ok("focus_window", method, f"Focused HWND {int(hwnd)}", {"hwnd": int(hwnd)})
    return result_fail("focus_window", method, f"Unable to focus HWND {int(hwnd)}", True, None)


def require_params(action_name, params, *keys):
    missing = [key for key in keys if params.get(key) is None]
    if missing:
        return result_fail(action_name, "missing_params", f"{action_name} requires params: {', '.join(missing)}", False, None)
    return None


def perform_action(action_type, params):
    if action_type == "ghost_click":
        missing = require_params(action_type, params, "hwnd", "x", "y")
        return missing or ghost_click(params["hwnd"], params["x"], params["y"])
    if action_type == "ghost_type":
        missing = require_params(action_type, params, "hwnd", "text")
        return missing or ghost_type(params["hwnd"], params["text"])
    if action_type == "click":
        missing = require_params(action_type, params, "x", "y")
        return missing or physical_click(params["x"], params["y"])
    if action_type == "double_click":
        missing = require_params(action_type, params, "x", "y")
        return missing or physical_double_click(params["x"], params["y"])
    if action_type == "right_click":
        missing = require_params(action_type, params, "x", "y")
        return missing or physical_right_click(params["x"], params["y"])
    if action_type == "move":
        missing = require_params(action_type, params, "x", "y")
        return missing or physical_move(params["x"], params["y"], params.get("durationMs"))
    if action_type == "hover":
        missing = require_params(action_type, params, "x", "y")
        return missing or physical_hover(params["x"], params["y"], params.get("durationMs"))
    if action_type == "drag":
        missing = require_params(action_type, params, "x", "y", "toX", "toY")
        return missing or physical_drag(params["x"], params["y"], params["toX"], params["toY"], params.get("durationMs"))
    if action_type == "type":
        missing = require_params(action_type, params, "text")
        return missing or physical_type(params["text"])
    if action_type == "press":
        missing = require_params(action_type, params, "key")
        return missing or physical_press(params["key"])
    if action_type == "ghost_press":
        missing = require_params(action_type, params, "hwnd", "key")
        return missing or ghost_press(params["hwnd"], params["key"])
    if action_type == "hotkey":
        return physical_hotkey(params.get("keys"))
    if action_type == "ghost_hotkey":
        missing = require_params(action_type, params, "hwnd")
        return missing or ghost_hotkey(params["hwnd"], params.get("keys"))
    if action_type == "send_keys":
        return physical_send_keys(params.get("keys") or params.get("key"))
    if action_type == "scroll":
        return physical_scroll(params.get("amount", -600))
    if action_type == "ghost_scroll":
        missing = require_params(action_type, params, "hwnd")
        return missing or ghost_scroll(params["hwnd"], params.get("amount", -600))
    if action_type == "focus_window":
        missing = require_params(action_type, params, "hwnd")
        return missing or focus_window(params["hwnd"])
    if action_type == "activate_window":
        missing = require_params(action_type, params, "hwnd")
        return missing or activate_window(params["hwnd"])
    if action_type == "copy":
        return clipboard_shortcut("copy", ["ctrl", "c"])
    if action_type == "paste":
        return clipboard_shortcut("paste", ["ctrl", "v"])
    if action_type == "select_all":
        return clipboard_shortcut("select_all", ["ctrl", "a"])
    return result_fail(action_type, "unknown_action", f"Unknown action: {action_type}", False, None)


def main():
    if len(sys.argv) < 2:
        try:
            print(json.dumps(collect_observation()))
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}))
    else:
        try:
            cmd = json.loads(sys.argv[1])
            print(json.dumps(perform_action(cmd["action"], cmd.get("params", {}))))
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e), "ok": False}))


if __name__ == "__main__":
    main()
