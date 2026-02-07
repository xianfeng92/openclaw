@echo off
REM OpenClaw 一键启动脚本
REM 同时启动 Gateway 和 Dashboard

setlocal

REM ========== 代理设置 ==========
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890
REM ===============================

cd /d "%~dp0"

echo ========================================
echo   OpenClaw 一键启动
echo ========================================
echo.
echo 正在启动 Gateway 和 Dashboard...
echo.

REM 启动 Gateway（新窗口）
start "OpenClaw Gateway" cmd /k "cd /d \"%~dp0\" && set HTTPS_PROXY=%HTTPS_PROXY% && set HTTP_PROXY=%HTTP_PROXY% && echo 正在启动 Gateway... && npm run gateway"

REM 等待 3 秒让 Gateway 启动
timeout /t 3 /nobreak >nul

REM 启动 Dashboard（新窗口）
start "OpenClaw Dashboard" cmd /k "cd /d \"%~dp0\" && echo 正在启动 Dashboard... && npm run openclaw dashboard"

echo.
echo ========================================
echo   启动完成！
echo ========================================
echo.
echo Gateway 和 Dashboard 已在新窗口中启动
echo.
echo 连接 Dashboard:
echo   1. 查看 Gateway 窗口，复制日志中的 listening on 地址
echo   2. 在 Dashboard 中填入 Gateway URL 和 Token
echo   3. 点击 Connect
echo.

endlocal
