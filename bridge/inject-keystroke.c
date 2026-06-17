/**
 * inject-keystroke.c — 向 Windows 控制台进程注入按键输入
 *
 * 用于向正在运行的 Claude Code 控制台进程发送文本（如确认权限的 "y"）。
 * 使用 AttachConsole + WriteConsoleInput API。
 *
 * 编译:
 *   cl /nologo /O2 inject-keystroke.c /link kernel32.lib user32.lib
 *   或使用 build-inject.bat
 *
 * 用法:
 *   inject-keystroke.exe <PID> <text>
 *   例如: inject-keystroke.exe 24792 "y"
 *         inject-keystroke.exe 24792 "n"
 *         inject-keystroke.exe 24792 "继续"    （支持中文字符）
 *
 * 返回值:
 *   0 - 成功
 *   1 - 参数错误
 *   2 - 无法附加到目标控制台
 *   3 - 写入失败
 */

#include <windows.h>
#include <stdio.h>

int main(int argc, char *argv[]) {
    if (argc < 3) {
        fprintf(stderr, "Usage: %s <PID> <text>\n", argv[0]);
        fprintf(stderr, "  Inject keystrokes into a console process.\n");
        fprintf(stderr, "  Example: %s 24792 y\n", argv[0]);
        return 1;
    }

    DWORD pid = (DWORD)atoi(argv[1]);
    const char *text = argv[2];

    // 1. 从当前控制台分离（如果有的话）
    FreeConsole();

    // 2. 附加到目标进程的控制台
    //    注意：可能不会立即成功，需要重试多次
    BOOL attached = FALSE;
    for (int attempt = 0; attempt < 10; attempt++) {
        if (AttachConsole(pid)) {
            attached = TRUE;
            break;
        }
        Sleep(100);
    }

    if (!attached) {
        fprintf(stderr, "Error: Cannot attach to console of PID %lu (error %lu)\n",
                pid, GetLastError());
        return 2;
    }

    // 3. 获取控制台输入缓冲区句柄
    HANDLE hStdin = GetStdHandle(STD_INPUT_HANDLE);
    if (hStdin == INVALID_HANDLE_VALUE || hStdin == NULL) {
        fprintf(stderr, "Error: Cannot get stdin handle (error %lu)\n", GetLastError());
        FreeConsole();
        return 3;
    }

    // 4. 将文本转换为 INPUT_RECORD 数组并写入
    int len = (int)strlen(text);
    int numRecords = len * 2;  // 每个字符需要 KeyDown + KeyUp

    INPUT_RECORD *records = (INPUT_RECORD *)calloc(numRecords, sizeof(INPUT_RECORD));
    if (!records) {
        fprintf(stderr, "Error: Out of memory\n");
        FreeConsole();
        return 3;
    }

    for (int i = 0; i < len; i++) {
        // KeyDown event
        records[i * 2].EventType = KEY_EVENT;
        records[i * 2].Event.KeyEvent.bKeyDown = TRUE;
        records[i * 2].Event.KeyEvent.wRepeatCount = 1;
        records[i * 2].Event.KeyEvent.wVirtualKeyCode = 0;
        records[i * 2].Event.KeyEvent.wVirtualScanCode = 0;
        records[i * 2].Event.KeyEvent.uChar.UnicodeChar = (WCHAR)text[i];
        records[i * 2].Event.KeyEvent.dwControlKeyState = 0;

        // KeyUp event
        records[i * 2 + 1].EventType = KEY_EVENT;
        records[i * 2 + 1].Event.KeyEvent.bKeyDown = FALSE;
        records[i * 2 + 1].Event.KeyEvent.wRepeatCount = 1;
        records[i * 2 + 1].Event.KeyEvent.wVirtualKeyCode = 0;
        records[i * 2 + 1].Event.KeyEvent.wVirtualScanCode = 0;
        records[i * 2 + 1].Event.KeyEvent.uChar.UnicodeChar = (WCHAR)text[i];
        records[i * 2 + 1].Event.KeyEvent.dwControlKeyState = 0;
    }

    // 5. 写入控制台输入缓冲区
    DWORD written = 0;
    BOOL success = WriteConsoleInputW(hStdin, records, numRecords, &written);

    // 6. 清理
    free(records);
    FreeConsole();

    if (!success) {
        fprintf(stderr, "Error: WriteConsoleInput failed (error %lu)\n", GetLastError());
        return 3;
    }

    if (written != (DWORD)numRecords) {
        fprintf(stderr, "Warning: Only wrote %lu of %d records\n", written, numRecords);
    }

    fprintf(stdout, "OK: Injected '%s' (%d records) into PID %lu\n", text, written, pid);
    return 0;
}
