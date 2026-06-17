@echo off
echo ===================================
echo   Build inject-keystroke.exe
echo ===================================
echo.

REM ---- Check if MSVC compiler is available ----
where cl.exe >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Microsoft Visual C++ compiler (cl.exe) not found in PATH.
    echo.
    echo Options:
    echo   1. Run from "Developer Command Prompt for VS"
    echo   2. Or use gcc:  gcc -O2 inject-keystroke.c -o inject-keystroke.exe
    echo   3. Or fall back to PowerShell inject-keystroke.ps1
    echo.
    pause
    exit /b 1
)

echo Compiling with MSVC...
cl /nologo /O2 inject-keystroke.c /link kernel32.lib user32.lib

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Build successful: inject-keystroke.exe
) else (
    echo.
    echo Build failed! Try:
    echo   gcc -O2 inject-keystroke.c -o inject-keystroke.exe
)

pause
