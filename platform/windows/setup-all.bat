@echo off
REM OpenClaw One-Click Setup Script
REM Double-click to configure environment

setlocal enabledelayedexpansion

REM Set UTF-8 code page for proper character display
chcp 65001 >nul

cd /d "%~dp0\..\..\\"

echo ========================================
echo   OpenClaw Environment Setup
echo ========================================
echo.

REM Detect package manager
echo [1/7] Checking package manager...
where pnpm >nul 2>&1
if %errorlevel% equ 0 (
    set PKG=pnpm
    echo   Using pnpm
) else (
    set PKG=npm
    echo   pnpm not available, using npm
)
echo.

REM Check Node.js
echo [2/7] Checking Node.js...
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo   Node.js version: %NODE_VER%
echo.

REM Install dependencies
echo [3/7] Installing dependencies...
call %PKG% install
if %errorlevel% neq 0 (
    echo   Error: Dependency installation failed
    pause
    exit /b 1
)
echo   Dependencies installed
echo.

REM Build project
echo [4/7] Building project...
call %PKG% run build
if %errorlevel% neq 0 (
    echo   Error: Build failed
    pause
    exit /b 1
)
echo   Build complete
echo.

REM Configure Gateway
echo [5/7] Configuring Gateway...
call %PKG% openclaw config set gateway.auth.mode token
call %PKG% openclaw config set gateway.mode local
call %PKG% openclaw config set plugins.slots.memory none
echo   Gateway configured
echo.

REM Generate Token
echo [6/7] Generating Gateway Token...
call %PKG% openclaw doctor --generate-gateway-token
echo.
echo   Token generated, retrieving...
echo.
for /f "tokens=*" %%i in ('%PKG% openclaw config get gateway.auth.token') do set TOKEN=%%i
echo   Your Token: %TOKEN%
echo   Save this token for Dashboard connection
echo.

REM Check model configuration
echo [7/7] Checking model configuration...
call %PKG% openclaw models status --plain
echo.

echo ========================================
echo   Setup Complete!
echo ========================================
echo.
echo Next steps:
echo   1. Add model API Key:
echo      %PKG% openclaw models auth paste-token --provider ^<provider^>
echo.
echo   2. Set default model:
echo      %PKG% openclaw models set ^<model^>
echo.
echo   3. Start Gateway:
echo      Double-click platform\windows\start-gateway.bat
echo.
echo   4. Start Dashboard:
echo      Double-click platform\windows\start-dashboard.bat
echo.
pause
