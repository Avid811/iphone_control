@echo off
echo ===================================
echo   Stopping Claude Bridge Server
echo ===================================
echo.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000.*LISTENING" 2^>nul') do (
    echo Found PID %%a on port 3000, killing...
    taskkill /F /PID %%a >nul 2>&1
    echo Server stopped.
    goto :done
)
echo No server found on port 3000.
:done
echo.
pause
