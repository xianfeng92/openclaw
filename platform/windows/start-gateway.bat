@echo off
REM OpenClaw Gateway Startup Script
REM Double-click to start Gateway service

setlocal

REM Set UTF-8 code page
chcp 65001 >nul

REM ========== Proxy Settings ==========
REM If using VPN/proxy, modify the port below
REM Clash default: 7890, V2RayN default: 10809
REM Comment out (add REM) if not needed
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890
REM ===============================

REM OpenClaw environment variables
set OPENCLAW_SKIP_CHANNELS=1
set CLAWDBOT_SKIP_CHANNELS=1

REM Change to project root directory (platform/windows -> project root)
cd /d "%~dp0\..\..\"

echo ========================================
echo   Starting OpenClaw Gateway
echo ========================================
echo.
echo Proxy settings:
echo   HTTPS_PROXY=%HTTPS_PROXY%
echo   HTTP_PROXY=%HTTP_PROXY%
echo.
echo Starting Gateway...
echo.
echo After successful startup, copy the listening on address from log
echo (e.g., ws://127.0.0.1:19001)
echo Use this address in Dashboard connection
echo.
echo Press Ctrl+C to stop Gateway
echo ========================================
echo.

node scripts/run-node.mjs --dev gateway

endlocal
