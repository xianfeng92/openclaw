@echo off
REM OpenClaw 一键环境配置脚本 (批处理版本)
REM 双击此脚本完成首次环境配置

setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ========================================
echo   OpenClaw 一键环境配置
echo ========================================
echo.

REM 检测可用的包管理器
echo [1/7] 检查包管理器...
where pnpm >nul 2>&1
if %errorlevel% equ 0 (
    set PKG=pnpm
    echo   使用 pnpm
) else (
    set PKG=npm
    echo   pnpm 不可用，使用 npm
)
echo.

REM 检查 Node.js
echo [2/7] 检查 Node.js...
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo   Node.js 版本: %NODE_VER%
echo.

REM 安装依赖
echo [3/7] 安装项目依赖...
call %PKG% install
if %errorlevel% neq 0 (
    echo   错误: 依赖安装失败
    pause
    exit /b 1
)
echo   依赖安装完成
echo.

REM 编译项目
echo [4/7] 编译项目...
call %PKG% run build
if %errorlevel% neq 0 (
    echo   错误: 编译失败
    pause
    exit /b 1
)
echo   编译完成
echo.

REM 配置 Gateway
echo [5/7] 配置 Gateway...
call %PKG% openclaw config set gateway.auth.mode token
call %PKG% openclaw config set gateway.mode local
call %PKG% openclaw config set plugins.slots.memory none
echo   Gateway 配置完成
echo.

REM 生成 Token
echo [6/7] 生成 Gateway Token...
call %PKG% openclaw doctor --generate-gateway-token
echo.
echo   Token 已生成，正在获取...
echo.
for /f "tokens=*" %%i in ('%PKG% openclaw config get gateway.auth.token') do set TOKEN=%%i
echo   你的 Token: %TOKEN%
echo   请保存此 Token，连接 Dashboard 时需要
echo.

REM 检查模型配置
echo [7/7] 检查模型配置...
call %PKG% openclaw models status --plain
echo.

echo ========================================
echo   环境配置完成！
echo ========================================
echo.
echo 下一步操作:
echo   1. 添加模型 API Key:
echo      %PKG% openclaw models auth paste-token --provider ^<provider^>
echo.
echo   2. 设置默认模型:
echo      %PKG% openclaw models set ^<model^>
echo.
echo   3. 启动 Gateway:
echo      双击 start-gateway.bat
echo.
echo   4. 启动 Dashboard:
echo      双击 start-dashboard.bat
echo.
pause
