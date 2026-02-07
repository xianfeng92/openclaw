@echo off
REM OpenClaw Dashboard Startup Script
REM Opens the browser UI - Gateway must be running first!
REM Double-click to start Dashboard (browser UI)

setlocal

REM Set UTF-8 code page
chcp 65001 >nul

REM Set port to match Gateway (19001 for dev mode)
set OPENCLAW_GATEWAY_PORT=19001

REM Change to project root directory (platform/windows -> project root)
cd /d "%~dp0\..\..\"

echo ========================================
echo   Starting OpenClaw Dashboard
echo ========================================
echo.
echo NOTE: Make sure Gateway is running first!
echo       (Double-click start-gateway.bat)
echo.
echo For Dev Mode (--dev), use this token:
echo   openclaw-dev-token
echo.

pnpm openclaw dashboard

endlocal
