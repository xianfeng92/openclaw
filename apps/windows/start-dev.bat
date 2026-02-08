@echo off
REM OpenClaw Windows Desktop App - Development Launcher
echo Starting OpenClaw Desktop (Development Mode)...
echo.

REM Build the app
call pnpm build
if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
)

REM Run Electron
echo.
echo Launching Electron...
call pnpm dev

pause
