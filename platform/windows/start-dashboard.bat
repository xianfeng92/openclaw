@echo off
REM OpenClaw Dashboard 启动脚本
REM 双击此脚本启动 Dashboard（浏览器界面）

setlocal

cd /d "%~dp0"

echo ========================================
echo   Starting OpenClaw Dashboard
echo ========================================
echo.

npm run openclaw dashboard

endlocal
