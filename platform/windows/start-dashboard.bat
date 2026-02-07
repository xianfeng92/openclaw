@echo off
REM OpenClaw Dashboard Startup Script
REM Double-click to start Dashboard (browser UI)

setlocal

REM Set UTF-8 code page
chcp 65001 >nul

REM Change to project root directory (platform/windows -> project root)
cd /d "%~dp0\..\..\"

echo ========================================
echo   Starting OpenClaw Dashboard
echo ========================================
echo.

pnpm openclaw dashboard

endlocal
