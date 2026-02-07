@echo off
REM OpenClaw Dashboard Startup Script
REM Double-click to start Dashboard (browser UI)

setlocal

REM Set UTF-8 code page
chcp 65001 >nul

cd /d "%~dp0.."

echo ========================================
echo   Starting OpenClaw Dashboard
echo ========================================
echo.

npm run openclaw dashboard

endlocal
