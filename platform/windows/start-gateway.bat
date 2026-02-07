@echo off
REM OpenClaw Gateway 启动脚本
REM 双击此脚本启动 Gateway 服务
REM 如需代理，请修改下方的代理端口

setlocal

REM ========== 代理设置 ==========
REM 如果使用 VPN/代理软件，请修改为对应的端口
REM Clash 默认: 7890, V2RayN 默认: 10809
REM 不需要代理则将下面两行注释掉（加 REM 前缀）
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890
REM ===============================

cd /d "%~dp0"

echo ========================================
echo   Starting OpenClaw Gateway
echo ========================================
echo.
echo 代理设置:
echo   HTTPS_PROXY=%HTTPS_PROXY%
echo   HTTP_PROXY=%HTTP_PROXY%
echo.
echo 正在启动 Gateway...
echo.
echo 启动成功后，请复制日志中的 listening on 地址
echo （例如: ws://127.0.0.1:19001）
echo 用于 Dashboard 连接
echo.
echo 按 Ctrl+C 停止 Gateway
echo ========================================
echo.

npm run gateway

endlocal
