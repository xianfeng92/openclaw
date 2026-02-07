@echo off
REM OpenClaw Gateway Startup Script with Proxy
REM This script sets proxy environment variables before starting the gateway

setlocal

REM Proxy settings - adjust if your VPN uses a different port
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890

REM Change to the OpenClaw directory
cd /d "%~dp0"

REM Start the gateway
echo Starting OpenClaw Gateway with proxy...
echo HTTPS_PROXY=%HTTPS_PROXY%
echo HTTP_PROXY=%HTTP_PROXY%
echo.
npm run gateway

endlocal
