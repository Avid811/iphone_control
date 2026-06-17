<#
.SYNOPSIS
    向指定 PID 的 Windows 控制台进程注入按键输入（PowerShell 备用方案）

.DESCRIPTION
    优先使用 inject-keystroke.exe (C版本，更可靠)。
    此 PowerShell 版本作为备用，通过 Windows API P/Invoke 实现。

.PARAMETER Pid
    目标进程的 PID

.PARAMETER Text
    要发送的文本（如 "y", "n", 或更长的消息）

.EXAMPLE
    .\inject-keystroke.ps1 -Pid 24792 -Text "y"
    .\inject-keystroke.ps1 -Pid 24792 -Text "n"
#>

param(
    [Parameter(Mandatory=$true)]
    [int]$Pid,

    [Parameter(Mandatory=$true)]
    [string]$Text
)

# 使用 C# Add-Type 调用 Windows API
$code = @"
using System;
using System.Runtime.InteropServices;

public class ConsoleInjector
{
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

    public static bool Inject(uint pid, string text)
    {
        FreeConsole();

        bool attached = false;
        for (int i = 0; i < 10; i++)
        {
            if (AttachConsole(pid))
            {
                attached = true;
                break;
            }
            System.Threading.Thread.Sleep(100);
        }

        if (!attached)
        {
            Console.Error.WriteLine("Error: Cannot attach to console of PID " + pid);
            return false;
        }

        IntPtr hStdin = GetStdHandle(STD_INPUT_HANDLE);
        if (hStdin == IntPtr.Zero || hStdin == new IntPtr(-1))
        {
            Console.Error.WriteLine("Error: Cannot get stdin handle");
            FreeConsole();
            return false;
        }

        int len = text.Length;
        INPUT_RECORD[] records = new INPUT_RECORD[len * 2];

        for (int i = 0; i < len; i++)
        {
            // KeyDown
            records[i * 2].EventType = KEY_EVENT;
            records[i * 2].KeyEvent.bKeyDown = true;
            records[i * 2].KeyEvent.wRepeatCount = 1;
            records[i * 2].KeyEvent.UnicodeChar = text[i];

            // KeyUp
            records[i * 2 + 1].EventType = KEY_EVENT;
            records[i * 2 + 1].KeyEvent.bKeyDown = false;
            records[i * 2 + 1].KeyEvent.wRepeatCount = 1;
            records[i * 2 + 1].KeyEvent.UnicodeChar = text[i];
        }

        uint written = 0;
        bool success = WriteConsoleInput(hStdin, records, (uint)records.Length, out written);

        FreeConsole();

        if (!success)
        {
            Console.Error.WriteLine("Error: WriteConsoleInput failed");
            return false;
        }

        Console.WriteLine("OK: Injected '" + text + "' (" + written + " records) into PID " + pid);
        return true;
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp -ErrorAction Stop

$result = [ConsoleInjector]::Inject([uint]$Pid, $Text)

if (-not $result) {
    Write-Error "Key injection failed."
    exit 3
}

exit 0
