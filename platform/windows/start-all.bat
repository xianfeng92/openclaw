@echo off
REM OpenClaw One-Click Startup Script
REM Launch Gateway and Dashboard simultaneously

setlocal

REM Set UTF-8 code page
chcp 65001 >nul

REM ========== Proxy Settings ==========
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890
REM ===============================

cd /d "%~dp0.."

echo ========================================
echo   OpenClaw Quick Start
echo ========================================
echo.
echo Starting Gateway and Dashboard...
echo.

REM Start Gateway (new window)
start "OpenClaw Gateway" cmd /k "chcp 65001 >nul && cd /d \"%~dp0\" && set HTTPS_PROXY=%HTTPS_PROXY% && set HTTP_PROXY=%HTTP_PROXY% && echo Starting Gateway... && pnpm run gateway:dev"

REM Wait 3 seconds for Gateway to start
timeout /t 3 /nobreak >nul

REM Start Dashboard (new window)
start "OpenClaw Dashboard" cmd /k "chcp 65001 >nul && cd /d \"%~dp0\" && echo Starting Dashboard... && pnpm openclaw dashboard"

echo.
echo ========================================
echo   Launch Complete!
echo ========================================
echo.
echo Gateway and Dashboard are running in new windows
echo.
echo To connect Dashboard:
echo   1. Check Gateway window, copy the listening on address
echo   2. Enter Gateway URL and Token in Dashboard
echo   3. Click Connect
echo.

endlocal
