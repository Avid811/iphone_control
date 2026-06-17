@echo off
title Claude Bridge Server
cd /d "%~dp0"

echo ===================================
echo   Claude Bridge Server
echo ===================================
echo.

REM ---- Kill existing process on port 3000 ----
echo [1/3] Checking port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000.*LISTENING" 2^>nul') do (
    echo   Found PID %%a on port 3000, killing...
    taskkill /F /PID %%a >nul 2>&1
)
echo   Port 3000 is free.
echo.

REM ---- Install dependencies ----
echo [2/3] Installing dependencies...
call npm install --silent >nul 2>&1
echo   Done.
echo.

REM ---- Get LAN IP ----
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr "192.168." 2^>nul') do set LANIP=%%a
set LANIP=%LANIP: =%
if "%LANIP%"=="" set LANIP=192.168.x.x

REM ---- Start server in background ----
echo [3/3] Starting server in background...
echo.
echo ==========================================
echo   iPhone Safari open:
echo.
echo   LAN:  http://%LANIP%:3000
echo   Tailscale: http://100.105.91.55:3000
echo ==========================================
echo.

REM Launch node.js in a hidden window, detached from this cmd
REM The server keeps running even after this window closes
powershell -WindowStyle Hidden -Command "Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden"

echo Server started in background!
echo You can safely close this window - server keeps running.
echo Run stop.bat to stop the server.
echo.
echo This window will auto-close in 5 seconds...

timeout /t 5 /nobreak >nul
exit
