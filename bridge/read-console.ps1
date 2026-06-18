<#
.SYNOPSIS
    截取指定 PID 的控制台窗口截图（PNG base64）
    注：现代终端（Windows Terminal / ConPTY）不暴露文本读取API，
    窗口截图是目前唯一能可靠获取终端内容的方式。
#>
param(
    [Parameter(Mandatory=$true)]
    [int]$TargetPid
)

$code = @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

public class WindowCapture
{
    [DllImport("kernel32.dll")] static extern bool FreeConsole();
    [DllImport("kernel32.dll")] static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

    const uint GW_OWNER = 4;
    const int SW_RESTORE = 9;

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    public static string CaptureBase64(uint pid)
    {
        IntPtr wnd = IntPtr.Zero;
        FreeConsole();
        if (AttachConsole(pid)) {
            IntPtr cw = GetConsoleWindow();
            FreeConsole();
            if (cw != IntPtr.Zero) {
                IntPtr owner = GetWindow(cw, GW_OWNER);
                wnd = (owner != IntPtr.Zero && IsWindowVisible(owner)) ? owner : cw;
            }
        }
        if (wnd == IntPtr.Zero) return "";

        if (IsIconic(wnd)) { ShowWindow(wnd, SW_RESTORE); System.Threading.Thread.Sleep(200); }
        IntPtr oldFg = GetForegroundWindow();
        SwitchToThisWindow(wnd, false); System.Threading.Thread.Sleep(80);
        SetForegroundWindow(wnd); System.Threading.Thread.Sleep(80);

        RECT rect;
        if (!GetWindowRect(wnd, out rect)) return "";

        int w = rect.Right - rect.Left;
        int h = rect.Bottom - rect.Top;
        if (w <= 0 || h <= 0) return "";

        using (Bitmap bmp = new Bitmap(w, h))
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(w, h));
            using (MemoryStream ms = new MemoryStream())
            {
                bmp.Save(ms, ImageFormat.Png);
                return Convert.ToBase64String(ms.ToArray());
            }
        }
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp -ReferencedAssemblies 'System.Drawing' -ErrorAction Stop

$b64 = [WindowCapture]::CaptureBase64([UInt32]$TargetPid)

if ($b64) {
    Write-Output $b64
} else {
    Write-Error "Cannot capture window for PID $TargetPid"
    exit 1
}
