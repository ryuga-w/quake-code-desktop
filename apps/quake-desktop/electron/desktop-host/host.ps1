# Quake Desktop persistent host — loads SendInput helpers once, then JSON-RPC on stdin/stdout.
# Protocol: one JSON request per line → one JSON response per line.
# { "id": "...", "action": "mouse_move|click|type|key|scroll|wait|open_app|focus_window|close_window|list_windows|ping", ... }

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

if (-not ("QuakeInput" -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class QuakeInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }

  public const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008, MOUSEEVENTF_RIGHTUP = 0x0010;
  public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020, MOUSEEVENTF_MIDDLEUP = 0x0040;
  public const uint MOUSEEVENTF_WHEEL = 0x0800, MOUSEEVENTF_HWHEEL = 0x1000;
  public const uint KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_EXTENDEDKEY = 0x0001, KEYEVENTF_UNICODE = 0x0004;
  public const int SW_RESTORE = 9, SW_SHOW = 5;
  public const uint WM_CLOSE = 0x0010;
  public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
  public const uint SWP_NOMOVE = 0x0002, SWP_NOSIZE = 0x0001, SWP_SHOWWINDOW = 0x0040;
  public const int ASFW_ANY = -1;

  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char ch);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr ProcessId);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  public static void MoveAbsolute(int x, int y) { SetCursorPos(x, y); }

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
    i.U.ki.wScan = (ushort)MapVirtualKey(vk, 0);
    i.U.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
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

  public static void Chord(ushort[] vks) {
    List<INPUT> list = new List<INPUT>();
    foreach (ushort vk in vks) list.Add(KeyInput(vk, false));
    for (int i = vks.Length - 1; i >= 0; i--) list.Add(KeyInput(vks[i], true));
    SendInput((uint)list.Count, list.ToArray(), Marshal.SizeOf(typeof(INPUT)));
  }

  static void TypeUnicodeChar(char ch) {
    INPUT[] inputs = new INPUT[2];
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].U.ki.wVk = 0;
    inputs[0].U.ki.wScan = ch;
    inputs[0].U.ki.dwFlags = KEYEVENTF_UNICODE;
    inputs[1].type = INPUT_KEYBOARD;
    inputs[1].U.ki.wVk = 0;
    inputs[1].U.ki.wScan = ch;
    inputs[1].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
    SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void TypeText(string text) {
    foreach (char ch in text) {
      if (ch == (char)13) continue;
      if (ch == (char)10) { KeyTap(0x0D); continue; }
      if (ch == (char)9) { KeyTap(0x09); continue; }
      // Non-ASCII / unmapped: KEYEVENTF_UNICODE (Turkish letters, symbols, etc.)
      short vkScan = VkKeyScan(ch);
      if (vkScan == -1 || ch > 127) {
        TypeUnicodeChar(ch);
        System.Threading.Thread.Sleep(6);
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
    public string handle; public string title;
    public int left, top, right, bottom; public uint pid;
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
      if (string.IsNullOrWhiteSpace(title) || title == "Program Manager") return true;
      RECT r; GetWindowRect(hWnd, out r);
      if (r.Right - r.Left < 20 || r.Bottom - r.Top < 20) return true;
      uint pid; GetWindowThreadProcessId(hWnd, out pid);
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
    if (IsIconic(hWnd)) ShowWindow(hWnd, SW_RESTORE); else ShowWindow(hWnd, SW_SHOW);
    ShowWindowAsync(hWnd, SW_RESTORE);
    BringWindowToTop(hWnd);
    SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    SetWindowPos(hWnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    IntPtr fg = GetForegroundWindow();
    uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero);
    uint thisThread = GetCurrentThreadId();
    uint targetThread = GetWindowThreadProcessId(hWnd, IntPtr.Zero);
    bool a1 = false, a2 = false;
    try {
      if (fgThread != thisThread) a1 = AttachThreadInput(thisThread, fgThread, true);
      if (targetThread != thisThread && targetThread != fgThread) a2 = AttachThreadInput(thisThread, targetThread, true);
      SetForegroundWindow(hWnd);
      BringWindowToTop(hWnd);
    } finally {
      if (a2) AttachThreadInput(thisThread, targetThread, false);
      if (a1) AttachThreadInput(thisThread, fgThread, false);
    }
    return GetForegroundWindow() == hWnd || IsWindowVisible(hWnd);
  }

  public static bool CloseWindow(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return false;
    return PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
  }

  public static string ForegroundTitle() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "";
    int len = GetWindowTextLength(h);
    if (len <= 0) return "";
    StringBuilder sb = new StringBuilder(len + 1);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }
}
"@
}

function Write-Res($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 10
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Resolve-Vk([string]$token) {
  $t = $token.Trim().ToLowerInvariant()
  $map = @{
    backspace=0x08; tab=0x09; enter=0x0d; return=0x0d; shift=0x10; ctrl=0x11; control=0x11
    alt=0x12; esc=0x1b; escape=0x1b; space=0x20; pageup=0x21; pagedown=0x22
    end=0x23; home=0x24; left=0x25; up=0x26; right=0x27; down=0x28
    insert=0x2d; ins=0x2d; delete=0x2e; del=0x2e; win=0x5b; meta=0x5b; cmd=0x5b; lwin=0x5b; rwin=0x5c
    f1=0x70;f2=0x71;f3=0x72;f4=0x73;f5=0x74;f6=0x75;f7=0x76;f8=0x77;f9=0x78;f10=0x79;f11=0x7a;f12=0x7b
  }
  if ($map.ContainsKey($t)) { return [uint16]$map[$t] }
  if ($t -match '^[0-9]$') { return [uint16](0x30 + [int]$t) }
  if ($t -match '^[a-z]$') { return [uint16][char]::ToUpper($t[0]) }
  return $null
}

function Parse-Chord([string]$spec) {
  $parts = $spec -split '[+\-]' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  $vks = @()
  foreach ($p in $parts) {
    $vk = Resolve-Vk $p
    if ($null -eq $vk) { throw "Unknown key: $p" }
    $vks += $vk
  }
  if ($vks.Count -eq 0) { throw "Empty chord" }
  return [uint16[]]$vks
}

function Get-AppCatalog {
  return @(
    @{ id='calc'; name='Calculator / Hesap Makinesi'; target='calc.exe'; tags=@('math','hesap') },
    @{ id='notepad'; name='Notepad / Not Defteri'; target='notepad.exe'; tags=@('text') },
    @{ id='explorer'; name='File Explorer'; target='explorer.exe'; tags=@('files') },
    @{ id='paint'; name='Paint'; target='mspaint.exe'; tags=@('image') },
    @{ id='cmd'; name='Command Prompt'; target='cmd.exe'; tags=@('shell') },
    @{ id='powershell'; name='Windows PowerShell'; target='powershell.exe'; tags=@('shell') },
    @{ id='pwsh'; name='PowerShell 7'; target='pwsh.exe'; tags=@('shell') },
    @{ id='terminal'; name='Windows Terminal'; target='wt.exe'; tags=@('shell') },
    @{ id='edge'; name='Microsoft Edge'; target='msedge.exe'; tags=@('browser') },
    @{ id='chrome'; name='Google Chrome'; target='chrome.exe'; tags=@('browser') },
    @{ id='firefox'; name='Firefox'; target='firefox.exe'; tags=@('browser') },
    @{ id='settings'; name='Windows Settings'; target='ms-settings:'; tags=@('system') },
    @{ id='snipping'; name='Snipping Tool'; target='SnippingTool.exe'; tags=@('screen') },
    @{ id='wordpad'; name='WordPad'; target='write.exe'; tags=@('text') },
    @{ id='taskmgr'; name='Task Manager'; target='taskmgr.exe'; tags=@('system') },
    @{ id='control'; name='Control Panel'; target='control.exe'; tags=@('system') },
    @{ id='run'; name='Run dialog'; target='shell:AppsFolder\Microsoft.Windows.ShellExperienceHost_cw5n1h2txyewy!App'; tags=@('system'); note='prefer win+r' },
    @{ id='photos'; name='Photos'; target='ms-photos:'; tags=@('image') },
    @{ id='store'; name='Microsoft Store'; target='ms-windows-store:'; tags=@('apps') },
    @{ id='mail'; name='Mail'; target='outlookmail:'; tags=@('office') },
    @{ id='excel'; name='Excel'; target='excel.exe'; tags=@('office') },
    @{ id='word'; name='Word'; target='winword.exe'; tags=@('office') },
    @{ id='code'; name='VS Code'; target='code'; tags=@('dev') },
    @{ id='cursor'; name='Cursor'; target='cursor'; tags=@('dev') }
  )
}

function Resolve-App([string]$app) {
  $key = $app.Trim().ToLowerInvariant()
  $aliases = @{
    calc='calc.exe'; calculator='calc.exe'; 'hesap makinesi'='calc.exe'; hesapmakinesi='calc.exe'
    notepad='notepad.exe'; not='notepad.exe'; 'not defteri'='notepad.exe'
    paint='mspaint.exe'; mspaint='mspaint.exe'; explorer='explorer.exe'; files='explorer.exe'; 'dosya gezgini'='explorer.exe'
    cmd='cmd.exe'; powershell='powershell.exe'; pwsh='pwsh.exe'; terminal='wt.exe'; 'windows terminal'='wt.exe'
    edge='msedge.exe'; chrome='chrome.exe'; firefox='firefox.exe'
    settings='ms-settings:'; ayarlar='ms-settings:'
    snipping='SnippingTool.exe'; snippet='SnippingTool.exe'; wordpad='write.exe'
    taskmgr='taskmgr.exe'; 'görev yöneticisi'='taskmgr.exe'; control='control.exe'
    photos='ms-photos:'; store='ms-windows-store:'
    excel='excel.exe'; word='winword.exe'; winword='winword.exe'
    code='code'; vscode='code'; cursor='cursor'
  }
  if ($aliases.ContainsKey($key)) { return $aliases[$key] }
  foreach ($a in Get-AppCatalog) {
    if ($a.id -eq $key -or $a.name.ToLowerInvariant() -eq $key) { return $a.target }
  }
  return $app.Trim()
}

function Find-DialogRoot {
  $wins = [QuakeInput]::ListWindows()
  # Common Open/Save dialog titles (EN + TR)
  $patterns = @(
    '*Open*','*Save*','*Save As*','*Aç*','*Kaydet*','*Farklı Kaydet*',
    '*Browse*','*Gözat*','*Select Folder*','*Klasör Seç*'
  )
  foreach ($w in $wins) {
    foreach ($p in $patterns) {
      if ($w.title -like $p) {
        try {
          return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([int64]$w.handle))
        } catch {}
      }
    }
  }
  # Fallback: foreground if it looks like a dialog
  $fgTitle = [QuakeInput]::ForegroundTitle()
  foreach ($p in $patterns) {
    if ($fgTitle -like $p) {
      $fg = [QuakeInput]::GetForegroundWindow()
      try { return [System.Windows.Automation.AutomationElement]::FromHandle($fg) } catch {}
    }
  }
  return $null
}

function Try-Focus([string]$hwndStr, [string]$titleHint) {
  $shell = New-Object -ComObject WScript.Shell
  if ($hwndStr) {
    try {
      $h = [IntPtr]::new([int64]$hwndStr)
      if ([QuakeInput]::FocusWindow($h)) { return $true }
    } catch {}
  }
  if ($titleHint) {
    try { if ($shell.AppActivate($titleHint)) { return $true } } catch {}
  }
  return $false
}

# --- UI Automation (Accessibility) ---
$script:UiaReady = $false
function Ensure-Uia {
  if ($script:UiaReady) { return }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $script:UiaReady = $true
}

function Get-UiaRoot([string]$title, [string]$handle) {
  Ensure-Uia
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  if ($handle) {
    try {
      $hwnd = [IntPtr]::new([int64]$handle)
      $el = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
      if ($el) { return $el }
    } catch {}
  }
  if ($title) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty, $title
    )
    $exact = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($exact) { return $exact }
    # substring match via EnumWindows handle
    $wins = [QuakeInput]::ListWindows()
    $m = $wins | Where-Object { $_.title -like "*$title*" } | Select-Object -First 1
    if ($m) {
      try {
        return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([int64]$m.handle))
      } catch {}
    }
  }
  # focused window
  $fg = [QuakeInput]::GetForegroundWindow()
  if ($fg -ne [IntPtr]::Zero) {
    try { return [System.Windows.Automation.AutomationElement]::FromHandle($fg) } catch {}
  }
  return $root
}

function Get-ControlTypeName($el) {
  try {
    $ct = $el.Current.ControlType
    if ($null -eq $ct) { return "unknown" }
    $prog = $ct.ProgrammaticName
    if ($prog -match '\.(\w+)$') { return $Matches[1] }
    return $prog
  } catch { return "unknown" }
}

function Element-ToNode($el, [int]$index) {
  $rect = $el.Current.BoundingRectangle
  $name = [string]$el.Current.Name
  $aid = [string]$el.Current.AutomationId
  $role = Get-ControlTypeName $el
  $enabled = [bool]$el.Current.IsEnabled
  $offscreen = [bool]$el.Current.IsOffscreen
  $cx = [int](($rect.Left + $rect.Right) / 2)
  $cy = [int](($rect.Top + $rect.Bottom) / 2)
  $value = $null
  try {
    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($vp) { $value = [string]$vp.Current.Value }
  } catch {}
  return @{
    index = $index
    name = $name
    automationId = $aid
    role = $role
    enabled = $enabled
    offscreen = $offscreen
    value = $value
    bounds = @{
      left = [int]$rect.Left; top = [int]$rect.Top
      right = [int]$rect.Right; bottom = [int]$rect.Bottom
      width = [int]$rect.Width; height = [int]$rect.Height
    }
    center = @{ x = $cx; y = $cy }
  }
}

function Test-Interactive($el) {
  $role = Get-ControlTypeName $el
  $interactive = @(
    'Button','Edit','CheckBox','RadioButton','ComboBox','ListItem','MenuItem',
    'TabItem','Hyperlink','TreeItem','Slider','Spinner','SplitButton','DataItem',
    'Document','Text','Custom','Pane'
  )
  if ($interactive -notcontains $role) {
    # still keep if named and has Invoke/Value
    if ([string]::IsNullOrWhiteSpace($el.Current.Name) -and [string]::IsNullOrWhiteSpace($el.Current.AutomationId)) {
      return $false
    }
  }
  if ($el.Current.IsOffscreen) { return $false }
  $r = $el.Current.BoundingRectangle
  if ($r.Width -lt 2 -or $r.Height -lt 2) { return $false }
  return $true
}

function Find-UiaElements($root, [string]$name, [string]$role, [string]$automationId, [bool]$contains, [int]$max) {
  Ensure-Uia
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $results = New-Object System.Collections.Generic.List[object]
  $stack = New-Object System.Collections.Stack
  $stack.Push($root)
  $n = 0
  while ($stack.Count -gt 0 -and $results.Count -lt $max) {
    $el = $stack.Pop()
    $n++
    if ($n -gt 8000) { break }
    try {
      if (Test-Interactive $el) {
        $ok = $true
        $elName = [string]$el.Current.Name
        $elAid = [string]$el.Current.AutomationId
        $elRole = Get-ControlTypeName $el
        if ($name) {
          if ($contains) {
            if ($elName -notlike "*$name*") { $ok = $false }
          } else {
            if ($elName -ne $name) { $ok = $false }
          }
        }
        if ($ok -and $role -and ($elRole -ne $role)) { $ok = $false }
        if ($ok -and $automationId -and ($elAid -ne $automationId)) { $ok = $false }
        # If no filters, include all interactive
        if (-not $name -and -not $role -and -not $automationId) { $ok = $true }
        if ($ok) { $results.Add($el) | Out-Null }
      }
    } catch {}
    try {
      $child = $walker.GetFirstChild($el)
      while ($null -ne $child) {
        $stack.Push($child)
        $child = $walker.GetNextSibling($child)
      }
    } catch {}
  }
  return $results
}

function Invoke-UiaElement($el) {
  Ensure-Uia
  # Prefer InvokePattern
  try {
    $ip = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    if ($ip) { $ip.Invoke(); return @{ method = "invoke" } }
  } catch {}
  try {
    $tp = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    if ($tp) { $tp.Toggle(); return @{ method = "toggle" } }
  } catch {}
  try {
    $sp = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    if ($sp) { $sp.Select(); return @{ method = "select" } }
  } catch {}
  # Fallback: click center
  $rect = $el.Current.BoundingRectangle
  $cx = [int](($rect.Left + $rect.Right) / 2)
  $cy = [int](($rect.Top + $rect.Bottom) / 2)
  [QuakeInput]::MoveAbsolute($cx, $cy)
  Start-Sleep -Milliseconds 30
  [QuakeInput]::MouseClick("left", 1)
  return @{ method = "click"; physical = @{ x = $cx; y = $cy } }
}

function Set-UiaValue($el, [string]$text) {
  Ensure-Uia
  try {
    $el.SetFocus()
  } catch {}
  try {
    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($vp -and -not $vp.Current.IsReadOnly) {
      $vp.SetValue($text)
      return @{ method = "value_pattern"; length = $text.Length }
    }
  } catch {}
  # Select all + type
  try { $el.SetFocus() } catch {}
  Start-Sleep -Milliseconds 40
  [QuakeInput]::Chord([uint16[]]@(0x11, 0x41)) # ctrl+a
  Start-Sleep -Milliseconds 20
  [QuakeInput]::TypeText($text)
  return @{ method = "type"; length = $text.Length }
}

function Invoke-Action($req) {
  $action = [string]$req.action
  switch ($action) {
    "ping" { return @{ pong = $true; t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } }
    "mouse_move" {
      $x = [int]$req.x; $y = [int]$req.y
      [QuakeInput]::MoveAbsolute($x, $y)
      return @{ physical = @{ x = $x; y = $y } }
    }
    "click" {
      if ($null -ne $req.x -and $null -ne $req.y) {
        [QuakeInput]::MoveAbsolute([int]$req.x, [int]$req.y)
        Start-Sleep -Milliseconds 40
      }
      $button = if ($req.button) { [string]$req.button } else { "left" }
      $times = if ($req.times) { [int]$req.times } else { 1 }
      [QuakeInput]::MouseClick($button, $times)
      return @{ action = "click"; button = $button; times = $times; physical = @{ x = [int]$req.x; y = [int]$req.y } }
    }
    "type" {
      $text = [string]$req.text
      if (-not $text) { throw "type requires text" }
      [QuakeInput]::TypeText($text)
      return @{ length = $text.Length; method = "type" }
    }
    "paste" {
      $text = [string]$req.text
      if ($null -eq $text) { $text = "" }
      # Clipboard paste: robust for long / mixed Unicode text
      Set-Clipboard -Value $text
      Start-Sleep -Milliseconds 50
      [QuakeInput]::Chord([uint16[]]@(0x11, 0x56)) # Ctrl+V
      Start-Sleep -Milliseconds 40
      return @{ length = $text.Length; method = "paste" }
    }
    "key" {
      $key = [string]$req.key
      $vks = Parse-Chord $key
      [QuakeInput]::Chord($vks)
      return @{ key = $key; vks = @($vks) }
    }
    "scroll" {
      if ($null -ne $req.x -and $null -ne $req.y) {
        [QuakeInput]::MoveAbsolute([int]$req.x, [int]$req.y)
      }
      $delta = [int]$req.delta
      $horizontal = [bool]$req.horizontal
      [QuakeInput]::Scroll($delta, $horizontal)
      return @{ delta = $delta; horizontal = $horizontal }
    }
    "wait" {
      $ms = [int]([double]$req.duration * 1000)
      if ($ms -lt 0) { $ms = 0 }
      if ($ms -gt 100000) { $ms = 100000 }
      Start-Sleep -Milliseconds $ms
      return @{ duration = $req.duration }
    }
    "open_app" {
      $app = [string]$req.app
      $target = Resolve-App $app
      $args = if ($req.args) { [string]$req.args } else { "" }
      if ($target -match '^[a-zA-Z][a-zA-Z0-9+.-]*:') {
        Start-Process $target
      } elseif ($args) {
        Start-Process -FilePath $target -ArgumentList $args
      } else {
        Start-Process -FilePath $target
      }
      Start-Sleep -Milliseconds 1200
      $activate = ""
      if ($target -match 'calc' -or $app -match 'calc|hesap') { $activate = "Hesap Makinesi" }
      elseif ($target -match 'notepad' -or $app -match 'notepad|not defteri') { $activate = "Not Defteri" }
      if ($activate) {
        $null = Try-Focus "" $activate
        Start-Sleep -Milliseconds 150
      }
      return @{ app = $app; target = $target; status = "ok"; foreground = [QuakeInput]::ForegroundTitle() }
    }
    "focus_window" {
      $wantTitle = if ($req.title) { [string]$req.title } else { "" }
      $wantHandle = if ($req.handle) { [string]$req.handle } else { "" }
      $ok = $false; $hStr = ""; $tStr = ""
      # Up to 3 attempts — recover from focus steal (browser/UWP)
      for ($attempt = 0; $attempt -lt 3 -and -not $ok; $attempt++) {
        if ($attempt -gt 0) { Start-Sleep -Milliseconds (120 * $attempt) }
        $wins = [QuakeInput]::ListWindows()
        $match = $null
        if ($wantHandle) { $match = $wins | Where-Object { $_.handle -eq $wantHandle } | Select-Object -First 1 }
        if (-not $match -and $wantTitle) { $match = $wins | Where-Object { $_.title -like "*$wantTitle*" } | Select-Object -First 1 }
        if ($match) {
          $ok = Try-Focus $match.handle $match.title
          $hStr = $match.handle; $tStr = $match.title
        }
        if (-not $ok -and $wantTitle) {
          $ok = Try-Focus "" $wantTitle
          if ($ok) { $tStr = $wantTitle }
        }
        if (-not $ok -and $wantTitle) {
          $key = $wantTitle.ToLowerInvariant()
          $cands = @()
          if ($key -match 'hesap|calculator|calc') {
            $cands += Get-Process -Name ApplicationFrameHost -EA SilentlyContinue | Where-Object { $_.MainWindowTitle -match 'Hesap|Calculator' }
          }
          $cands += Get-Process | Where-Object { $_.MainWindowTitle -and ($_.MainWindowTitle -like "*$wantTitle*") }
          foreach ($p in $cands) {
            if ($p.MainWindowHandle -ne 0) {
              $hStr = ([int64]$p.MainWindowHandle).ToString()
              $tStr = $p.MainWindowTitle
              $ok = Try-Focus $hStr $tStr
              if ($ok) { break }
            }
          }
        }
        if ($ok) {
          $fg = [QuakeInput]::ForegroundTitle()
          if ($wantTitle -and $fg -and ($fg -notlike "*$wantTitle*") -and ($tStr -and $fg -notlike "*$tStr*")) {
            # Foreground title mismatch — retry
            $ok = $false
          }
        }
      }
      if (-not $ok) { throw "Window not found / focus failed: $wantTitle $wantHandle" }
      Start-Sleep -Milliseconds 80
      return @{ focused = $true; handle = $hStr; title = $tStr; foreground = [QuakeInput]::ForegroundTitle(); attempts = $attempt + 1 }
    }
    "close_window" {
      $wantTitle = if ($req.title) { [string]$req.title } else { "" }
      $wantHandle = if ($req.handle) { [string]$req.handle } else { "" }
      $closed = $false; $hStr = ""; $tStr = ""
      $wins = [QuakeInput]::ListWindows()
      $match = $null
      if ($wantHandle) { $match = $wins | Where-Object { $_.handle -eq $wantHandle } | Select-Object -First 1 }
      if (-not $match -and $wantTitle) { $match = $wins | Where-Object { $_.title -like "*$wantTitle*" } | Select-Object -First 1 }
      if ($match) {
        $h = [IntPtr]::new([int64]$match.handle)
        $closed = [QuakeInput]::CloseWindow($h)
        $hStr = $match.handle; $tStr = $match.title
      }
      if (-not $closed -and $wantTitle) {
        $key = $wantTitle.ToLowerInvariant()
        if ($key -match 'hesap|calculator|calc') {
          Get-Process -Name CalculatorApp -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
          $closed = $true; $tStr = $wantTitle
        } elseif ($key -match 'notepad|not defteri') {
          Get-Process -Name notepad -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
          $closed = $true; $tStr = $wantTitle
        }
      }
      if (-not $closed) { throw "Window not found: $wantTitle $wantHandle" }
      Start-Sleep -Milliseconds 200
      return @{ closed = $true; handle = $hStr; title = $tStr }
    }
    "list_windows" {
      $wins = [QuakeInput]::ListWindows()
      $arr = @()
      foreach ($w in $wins) {
        $arr += @{
          handle = $w.handle; title = $w.title
          left = $w.left; top = $w.top; right = $w.right; bottom = $w.bottom; pid = $w.pid
        }
      }
      return @{ windows = $arr; count = $arr.Count; foreground = [QuakeInput]::ForegroundTitle() }
    }
    "foreground" {
      return @{ title = [QuakeInput]::ForegroundTitle() }
    }
    "uia_snapshot" {
      $title = if ($req.title) { [string]$req.title } else { "" }
      $handle = if ($req.handle) { [string]$req.handle } else { "" }
      $max = if ($req.max) { [int]$req.max } else { 80 }
      if ($max -lt 1) { $max = 40 }
      if ($max -gt 200) { $max = 200 }
      $root = Get-UiaRoot $title $handle
      $rootName = try { [string]$root.Current.Name } catch { "" }
      $list = Find-UiaElements $root "" "" "" $true $max
      $nodes = @()
      $i = 0
      foreach ($el in $list) {
        $nodes += Element-ToNode $el $i
        $i++
      }
      # Prefer interactive-looking first: buttons/edits with names
      $nodes = $nodes | Sort-Object {
        $score = 0
        if ($_.name) { $score += 2 }
        if ($_.role -in @('Button','Edit','CheckBox','MenuItem','ListItem','Hyperlink')) { $score += 3 }
        if (-not $_.enabled) { $score -= 5 }
        -$score
      }
      return @{
        window = $rootName
        foreground = [QuakeInput]::ForegroundTitle()
        count = $nodes.Count
        elements = @($nodes)
      }
    }
    "uia_find" {
      $title = if ($req.title) { [string]$req.title } else { "" }
      $handle = if ($req.handle) { [string]$req.handle } else { "" }
      $name = if ($req.name) { [string]$req.name } else { "" }
      $role = if ($req.role) { [string]$req.role } else { "" }
      $aid = if ($req.automationId) { [string]$req.automationId } else { "" }
      $contains = if ($null -ne $req.contains) { [bool]$req.contains } else { $true }
      $max = if ($req.max) { [int]$req.max } else { 20 }
      $root = Get-UiaRoot $title $handle
      $list = Find-UiaElements $root $name $role $aid $contains $max
      $nodes = @()
      $i = 0
      foreach ($el in $list) {
        $nodes += Element-ToNode $el $i
        $i++
      }
      return @{ count = $nodes.Count; elements = @($nodes); foreground = [QuakeInput]::ForegroundTitle() }
    }
    "uia_invoke" {
      $title = if ($req.title) { [string]$req.title } else { "" }
      $handle = if ($req.handle) { [string]$req.handle } else { "" }
      $name = if ($req.name) { [string]$req.name } else { "" }
      $role = if ($req.role) { [string]$req.role } else { "" }
      $aid = if ($req.automationId) { [string]$req.automationId } else { "" }
      $contains = if ($null -ne $req.contains) { [bool]$req.contains } else { $true }
      $index = if ($null -ne $req.index) { [int]$req.index } else { 0 }
      if (-not $name -and -not $aid -and -not $role) { throw "uia_invoke requires name, automationId, or role" }
      $root = Get-UiaRoot $title $handle
      $list = Find-UiaElements $root $name $role $aid $contains 30
      if ($list.Count -eq 0) { throw "UIA element not found: name=$name role=$role id=$aid" }
      if ($index -ge $list.Count) { $index = 0 }
      $el = $list[$index]
      $node = Element-ToNode $el $index
      $how = Invoke-UiaElement $el
      Start-Sleep -Milliseconds 80
      return @{ element = $node; result = $how; foreground = [QuakeInput]::ForegroundTitle() }
    }
    "uia_set_value" {
      $title = if ($req.title) { [string]$req.title } else { "" }
      $handle = if ($req.handle) { [string]$req.handle } else { "" }
      $name = if ($req.name) { [string]$req.name } else { "" }
      $role = if ($req.role) { [string]$req.role } else { "Edit" }
      $aid = if ($req.automationId) { [string]$req.automationId } else { "" }
      $text = if ($null -ne $req.text) { [string]$req.text } else { "" }
      $contains = if ($null -ne $req.contains) { [bool]$req.contains } else { $true }
      $root = Get-UiaRoot $title $handle
      $list = Find-UiaElements $root $name $role $aid $contains 20
      if ($list.Count -eq 0 -and $role -eq "Edit") {
        $list = Find-UiaElements $root $name "" $aid $contains 20
      }
      if ($list.Count -eq 0) { throw "UIA edit/control not found: name=$name id=$aid" }
      $el = $list[0]
      $node = Element-ToNode $el 0
      $how = Set-UiaValue $el $text
      return @{ element = $node; result = $how; foreground = [QuakeInput]::ForegroundTitle() }
    }
    "list_apps" {
      $apps = Get-AppCatalog
      return @{ apps = $apps; count = $apps.Count }
    }
    "dialog_set_path" {
      Ensure-Uia
      $path = [string]$req.path
      if (-not $path) { throw "dialog_set_path requires path" }
      $confirm = if ($null -ne $req.confirm) { [bool]$req.confirm } else { $true }
      $root = Find-DialogRoot
      if (-not $root) {
        # also try explicit title
        if ($req.title) { $root = Get-UiaRoot ([string]$req.title) "" }
      }
      if (-not $root) { throw "Open/Save dialog not found. Open the dialog first." }
      $dialogName = try { [string]$root.Current.Name } catch { "dialog" }
      # File name edit: common automation ids / names
      $edit = $null
      foreach ($aid in @('1148','1001','FileNameControlHost')) {
        $list = Find-UiaElements $root "" "Edit" $aid $false 5
        if ($list.Count -gt 0) { $edit = $list[0]; break }
      }
      if (-not $edit) {
        foreach ($nm in @('File name:','File name','Dosya adı:','Dosya adı','File name:')) {
          $list = Find-UiaElements $root $nm "Edit" "" $true 5
          if ($list.Count -gt 0) { $edit = $list[0]; break }
        }
      }
      if (-not $edit) {
        $list = Find-UiaElements $root "" "Edit" "" $true 10
        if ($list.Count -gt 0) { $edit = $list[0] }
      }
      if (-not $edit) { throw "File name field not found in dialog: $dialogName" }
      $how = Set-UiaValue $edit $path
      Start-Sleep -Milliseconds 100
      $confirmed = $false
      if ($confirm) {
        foreach ($btn in @('Open','Save','Aç','Kaydet','OK','Tamam','Select Folder','Klasör Seç')) {
          try {
            $btns = Find-UiaElements $root $btn "Button" "" $true 5
            if ($btns.Count -gt 0) {
              $null = Invoke-UiaElement $btns[0]
              $confirmed = $true
              break
            }
          } catch {}
        }
        if (-not $confirmed) {
          [QuakeInput]::Chord([uint16[]]@(0x0D)) # Enter
          $confirmed = $true
        }
      }
      return @{
        dialog = $dialogName
        path = $path
        setValue = $how
        confirmed = $confirmed
        foreground = [QuakeInput]::ForegroundTitle()
      }
    }
    "detect_uac" {
      $wins = [QuakeInput]::ListWindows()
      $uac = $wins | Where-Object {
        $_.title -match 'User Account Control|Kullanıcı Hesabı Denetimi|Do you want to allow'
      } | Select-Object -First 1
      return @{
        present = [bool]$uac
        title = if ($uac) { $uac.title } else { $null }
        note = if ($uac) { "UAC requires the user - do not automate credentials." } else { $null }
      }
    }
    default { throw "Unsupported action: $action" }
  }
}

# Ready signal
Write-Res @{ ok = $true; ready = $true; pid = $PID }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $id = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $detail = Invoke-Action $req
    Write-Res @{ id = $id; ok = $true; detail = $detail }
  } catch {
    Write-Res @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
}
