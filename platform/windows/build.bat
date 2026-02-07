@echo off
REM OpenClaw Build Script
REM Double-click to build the project

setlocal

REM Set UTF-8 code page
chcp 65001 >nul

cd /d "%~dp0\..\..\"

echo ========================================
echo   Building OpenClaw
echo ========================================
echo.

pnpm run build

echo.
echo ========================================
echo   Build Complete!
echo ========================================
echo.

pause
