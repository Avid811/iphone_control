<#
.SYNOPSIS
    向指定 PID 的 Windows 控制台进程注入按键输入

.DESCRIPTION
    方法1: AttachConsole + WriteConsoleInput（传统 conhost 控制台）
    方法2: SendInput API（Windows Terminal / ConPTY，自动聚焦窗口后输入并恢复焦点）
    自动在文本末尾追加 Enter 键。

.PARAMETER TargetPid
    目标进程的 PID

.PARAMETER Text
    要发送的文本（如 "y", "n", 或更长的消息）。会自动追加 Enter。

.EXAMPLE
    .\inject-keystroke.ps1 -TargetPid 24792 -Text "y"
    .\inject-keystroke.ps1 -TargetPid 24792 -Text "n"
#>

param(
    [Parameter(Mandatory=$true)]
    [int]$TargetPid,

    [Parameter(Mandatory=$true)]
    [string]$Text
)

$code = @"
using System;
using System.Runtime.InteropServices;

public class ConsoleInjector
{
    // ========== Method 1: WriteConsoleInput (传统控制台) ==========

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AttachConsole(uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool WriteConsoleInput(
        IntPtr hConsoleInput,
        INPUT_RECORD[] lpBuffer,
        uint nLength,
        out uint lpNumberOfEventsWritten
    );

    const int STD_INPUT_HANDLE = -10;
    const int KEY_EVENT = 1;

    [StructLayout(LayoutKind.Sequential)]
    struct KEY_EVENT_RECORD
    {
        public bool bKeyDown;
        public ushort wRepeatCount;
        public ushort wVirtualKeyCode;
        public ushort wVirtualScanCode;
        public char UnicodeChar;
        public uint dwControlKeyState;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUT_RECORD
    {
        [FieldOffset(0)] public ushort EventType;
        [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
    }

    // ========== Method 2: SendInput (Windows Terminal / ConPTY) ==========

    [DllImport("user32.dll")]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("kernel32.dll")]
    static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    static extern bool BringWindowToTop(IntPtr hWnd);

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    const int INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const uint KEYEVENTF_KEYUP = 0x0002;

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUT
    {
        [FieldOffset(0)] public uint type;
        [FieldOffset(8)] public KEYBDINPUT ki;
    }

    static IntPtr foundWindow = IntPtr.Zero;
    static uint targetPidForEnum = 0;

    static bool EnumWindowCallback(IntPtr hWnd, IntPtr lParam)
    {
        uint windowPid;
        GetWindowThreadProcessId(hWnd, out windowPid);
        if (windowPid == targetPidForEnum && IsWindowVisible(hWnd))
        {
            foundWindow = hWnd;
            return false;
        }
        return true;
    }

    // ========== Method 1: WriteConsoleInput ==========

    static bool TryWriteConsoleInput(uint pid, string text)
    {
        FreeConsole();

        bool attached = false;
        for (int i = 0; i < 10; i++)
        {
            if (AttachConsole(pid)) { attached = true; break; }
            System.Threading.Thread.Sleep(100);
        }

        if (!attached) return false;

        IntPtr hStdin = GetStdHandle(STD_INPUT_HANDLE);
        if (hStdin == IntPtr.Zero || hStdin == new IntPtr(-1))
        {
            FreeConsole();
            return false;
        }

        // Send text + Enter
        int len = text.Length;
        int totalRecords = (len + 1) * 2; // +1 for Enter key
        INPUT_RECORD[] records = new INPUT_RECORD[totalRecords];

        // Send each character
        for (int i = 0; i < len; i++)
        {
            records[i * 2].EventType = KEY_EVENT;
            records[i * 2].KeyEvent.bKeyDown = true;
            records[i * 2].KeyEvent.wRepeatCount = 1;
            records[i * 2].KeyEvent.UnicodeChar = text[i];

            records[i * 2 + 1].EventType = KEY_EVENT;
            records[i * 2 + 1].KeyEvent.bKeyDown = false;
            records[i * 2 + 1].KeyEvent.wRepeatCount = 1;
            records[i * 2 + 1].KeyEvent.UnicodeChar = text[i];
        }

        // Send Enter key (VK_RETURN = 0x0D)
        int enterIdx = len * 2;
        records[enterIdx].EventType = KEY_EVENT;
        records[enterIdx].KeyEvent.bKeyDown = true;
        records[enterIdx].KeyEvent.wRepeatCount = 1;
        records[enterIdx].KeyEvent.wVirtualKeyCode = 0x0D;
        records[enterIdx].KeyEvent.UnicodeChar = '\r';

        records[enterIdx + 1].EventType = KEY_EVENT;
        records[enterIdx + 1].KeyEvent.bKeyDown = false;
        records[enterIdx + 1].KeyEvent.wRepeatCount = 1;
        records[enterIdx + 1].KeyEvent.wVirtualKeyCode = 0x0D;
        records[enterIdx + 1].KeyEvent.UnicodeChar = '\r';

        uint written = 0;
        bool success = WriteConsoleInput(hStdin, records, (uint)records.Length, out written);
        FreeConsole();

        return success;
    }

    // ========== Method 2: keybd_event (works even under UIPI) ==========

    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);

    static readonly IntPtr HWND_TOP = IntPtr.Zero;
    const uint SWP_NOSIZE = 0x0001;
    const uint SWP_NOMOVE = 0x0002;
    const uint SWP_SHOWWINDOW = 0x0040;
    const int SW_RESTORE = 9;
    const int SW_SHOW = 5;

    [DllImport("user32.dll")]
    static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    const uint GW_OWNER = 4;

    static IntPtr FindWindowForPid(uint pid)
    {
        // Try console window first
        FreeConsole();
        IntPtr consoleWnd = IntPtr.Zero;
        if (AttachConsole(pid))
        {
            consoleWnd = GetConsoleWindow();
            FreeConsole();
        }
        if (consoleWnd != IntPtr.Zero)
        {
            // If the console window has WS_EX_NOACTIVATE (PseudoConsoleWindow),
            // try to find its owner window (the actual visible terminal window)
            IntPtr owner = GetWindow(consoleWnd, GW_OWNER);
            if (owner != IntPtr.Zero && IsWindowVisible(owner))
            {
                return owner;
            }
            // If it's a regular console window (no WS_EX_NOACTIVATE), use it directly
            return consoleWnd;
        }

        // Enumerate visible windows
        foundWindow = IntPtr.Zero;
        targetPidForEnum = pid;
        EnumWindows(EnumWindowCallback, IntPtr.Zero);
        return foundWindow;
    }

    // Check if text is ASCII-only
    static bool IsAscii(string text)
    {
        foreach (char c in text)
        {
            if (c > 127) return false;
        }
        return true;
    }

    static bool TryKeybdEvent(uint pid, string text)
    {
        IntPtr targetWindow = FindWindowForPid(pid);

        if (targetWindow == IntPtr.Zero)
        {
            Console.Error.WriteLine("Error: Cannot find window for PID " + pid);
            return false;
        }

        IntPtr oldForeground = GetForegroundWindow();

        // ===== Aggressive foreground switching =====
        ShowWindow(targetWindow, SW_RESTORE);
        ShowWindow(targetWindow, SW_SHOW);
        SetWindowPos(targetWindow, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW);
        System.Threading.Thread.Sleep(50);

        const byte VK_MENU = 0x12;
        const byte VK_RETURN = 0x0D;
        const uint KEYEVENTF_KEYUP = 0x0002;
        const uint KEYEVENTF_UNICODE = 0x0004;

        keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
        keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        System.Threading.Thread.Sleep(30);

        SwitchToThisWindow(targetWindow, false);
        System.Threading.Thread.Sleep(100);
        SetForegroundWindow(targetWindow);
        System.Threading.Thread.Sleep(80);

        IntPtr currentFg = GetForegroundWindow();
        bool fgMatch = (currentFg == targetWindow);

        // Send each ASCII character directly via keybd_event
        for (int i = 0; i < text.Length; i++)
        {
            ushort ch = (ushort)text[i];
            byte scan = (byte)(ch & 0xFF);
            keybd_event(0, scan, KEYEVENTF_UNICODE, UIntPtr.Zero);
            keybd_event(0, scan, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, UIntPtr.Zero);
            System.Threading.Thread.Sleep(10);
        }

        // Send Enter key
        keybd_event(VK_RETURN, 0, 0, UIntPtr.Zero);
        keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        System.Threading.Thread.Sleep(50);

        // Restore previous foreground window
        if (oldForeground != IntPtr.Zero && oldForeground != targetWindow)
        {
            ShowWindow(oldForeground, SW_RESTORE);
            SwitchToThisWindow(oldForeground, false);
            SetForegroundWindow(oldForeground);
            System.Threading.Thread.Sleep(50);
        }

        Console.WriteLine("OK: Injected '" + text + "' + Enter into PID " + pid + " via keybd_event (fgMatch=" + fgMatch + ")");
        return true;
    }

    // Method 3: Set clipboard text and paste (for non-ASCII text)
    [DllImport("user32.dll")]
    static extern bool OpenClipboard(IntPtr hWndNewOwner);
    [DllImport("user32.dll")]
    static extern bool EmptyClipboard();
    [DllImport("user32.dll")]
    static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);
    [DllImport("user32.dll")]
    static extern bool CloseClipboard();
    [DllImport("kernel32.dll")]
    static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);
    [DllImport("kernel32.dll")]
    static extern IntPtr GlobalLock(IntPtr hMem);
    [DllImport("kernel32.dll")]
    static extern bool GlobalUnlock(IntPtr hMem);

    const uint CF_UNICODETEXT = 13;
    const uint GMEM_MOVEABLE = 0x0002;

    static bool SetClipboardText(string text)
    {
        if (!OpenClipboard(IntPtr.Zero)) return false;
        EmptyClipboard();
        int byteCount = (text.Length + 1) * 2;
        IntPtr hMem = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)(uint)byteCount);
        if (hMem != IntPtr.Zero)
        {
            IntPtr ptr = GlobalLock(hMem);
            Marshal.Copy(text.ToCharArray(), 0, ptr, text.Length);
            // Null terminator
            Marshal.WriteInt16(ptr, text.Length * 2, 0);
            GlobalUnlock(hMem);
            SetClipboardData(CF_UNICODETEXT, hMem);
        }
        CloseClipboard();
        return true;
    }

    public static bool InjectPaste(uint pid, string text)
    {
        // First set clipboard using Windows API (works in headless sessions)
        if (!SetClipboardText(text))
        {
            Console.Error.WriteLine("Error: Cannot set clipboard");
            return false;
        }
        System.Threading.Thread.Sleep(50);

        IntPtr targetWindow = FindWindowForPid(pid);

        if (targetWindow == IntPtr.Zero)
        {
            Console.Error.WriteLine("Error: Cannot find window for PID " + pid);
            return false;
        }

        IntPtr oldForeground = GetForegroundWindow();

        ShowWindow(targetWindow, SW_RESTORE);
        ShowWindow(targetWindow, SW_SHOW);
        SetWindowPos(targetWindow, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW);
        System.Threading.Thread.Sleep(50);

        const byte VK_MENU = 0x12;
        const byte VK_RETURN = 0x0D;
        const byte VK_CONTROL = 0x11;
        const byte VK_V = 0x56;
        const uint KEYEVENTF_KEYUP = 0x0002;

        keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
        keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        System.Threading.Thread.Sleep(30);

        SwitchToThisWindow(targetWindow, false);
        System.Threading.Thread.Sleep(100);
        SetForegroundWindow(targetWindow);
        System.Threading.Thread.Sleep(80);

        IntPtr currentFg = GetForegroundWindow();
        bool fgMatch = (currentFg == targetWindow);

        // Paste via Ctrl+V
        keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
        keybd_event(VK_V, 0, 0, UIntPtr.Zero);
        keybd_event(VK_V, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        System.Threading.Thread.Sleep(100);

        // Enter
        keybd_event(VK_RETURN, 0, 0, UIntPtr.Zero);
        keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        System.Threading.Thread.Sleep(50);

        if (oldForeground != IntPtr.Zero && oldForeground != targetWindow)
        {
            ShowWindow(oldForeground, SW_RESTORE);
            SwitchToThisWindow(oldForeground, false);
            SetForegroundWindow(oldForeground);
            System.Threading.Thread.Sleep(50);
        }

        Console.WriteLine("OK: Pasted from clipboard + Enter into PID " + pid + " (fgMatch=" + fgMatch + ")");
        return true;
    }

    // ========== Main entry ==========

    public static bool Inject(uint pid, string text)
    {
        // Method 1: Try WriteConsoleInput first (traditional console, less intrusive)
        if (TryWriteConsoleInput(pid, text))
        {
            Console.WriteLine("OK: Injected '" + text + "' + Enter into PID " + pid + " via WriteConsoleInput");
            return true;
        }

        // Method 2: keybd_event (Windows Terminal / ConPTY)
        return TryKeybdEvent(pid, text);
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp -ErrorAction Stop

# 判断是否纯 ASCII — 非 ASCII 文本用剪贴板粘贴法
$isAscii = ([System.Text.Encoding]::UTF8.GetByteCount($Text) -eq $Text.Length)

if (-not $isAscii) {
    # 中文等非 ASCII 文本：C# 内部用 Windows API 设剪贴板 + Ctrl+V 粘贴
    $result = [ConsoleInjector]::InjectPaste([UInt32]$TargetPid, $Text)
} else {
    # ASCII 文本：直接字符注入
    $result = [ConsoleInjector]::Inject([UInt32]$TargetPid, $Text)
}

if (-not $result) {
    Write-Error "Key injection failed."
    exit 3
}

exit 0
