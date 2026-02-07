# OpenClaw 一键环境配置脚本
# 使用方法：在 PowerShell 中运行 .\setup-env.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OpenClaw 一键环境配置" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查 Node.js
Write-Host "[1/7] 检查 Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    $versionNumber = [int]($nodeVersion -replace '\.', '').Substring(0, 2)
    if ($versionNumber -lt 18) {
        Write-Host "  错误: Node.js 版本需要 >= 18，当前版本: $nodeVersion" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Node.js 版本: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  错误: 未安装 Node.js，请先安装 Node.js 18+" -ForegroundColor Red
    exit 1
}

# 检查 pnpm 或使用 npm
Write-Host "[2/7] 检查包管理器..." -ForegroundColor Yellow
$useNpm = $false
try {
    $pnpmVersion = pnpm --version 2>$null
    Write-Host "  pnpm 版本: $pnpmVersion" -ForegroundColor Green
} catch {
    Write-Host "  pnpm 不可用，使用 npm" -ForegroundColor Yellow
    $useNpm = $true
}

$pkgCmd = if ($useNpm) { "npm" } else { "pnpm" }
Write-Host "  使用包管理器: $pkgCmd" -ForegroundColor Green

# 安装依赖
Write-Host "[3/7] 安装项目依赖..." -ForegroundColor Yellow
& $pkgCmd install
if ($LASTEXITCODE -ne 0) {
    Write-Host "  错误: 依赖安装失败" -ForegroundColor Red
    exit 1
}
Write-Host "  依赖安装完成" -ForegroundColor Green

# 编译项目
Write-Host "[4/7] 编译项目..." -ForegroundColor Yellow
& $pkgCmd run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "  错误: 编译失败" -ForegroundColor Red
    exit 1
}
Write-Host "  编译完成" -ForegroundColor Green

# 配置 Gateway
Write-Host "[5/7] 配置 Gateway..." -ForegroundColor Yellow
& $pkgCmd openclaw config set gateway.auth.mode token
& $pkgCmd openclaw config set gateway.mode local
& $pkgCmd openclaw config set plugins.slots.memory none
Write-Host "  Gateway 配置完成" -ForegroundColor Green

# 生成 Token
Write-Host "[6/7] 生成 Gateway Token..." -ForegroundColor Yellow
& $pkgCmd openclaw doctor --generate-gateway-token | Out-Null
$token = & $pkgCmd openclaw config get gateway.auth.token
Write-Host "  Token 已生成" -ForegroundColor Green
Write-Host "  你的 Token: $token" -ForegroundColor White
Write-Host "  请保存此 Token，连接 Dashboard 时需要" -ForegroundColor Yellow

# 检查模型配置
Write-Host "[7/7] 检查模型配置..." -ForegroundColor Yellow
$modelStatus = & $pkgCmd openclaw models status --plain 2>&1
Write-Host "  模型状态:" -ForegroundColor White
Write-Host $modelStatus

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  环境配置完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步操作:" -ForegroundColor Yellow
Write-Host "  1. 添加模型 API Key:" -ForegroundColor White
Write-Host "     $pkgCmd openclaw models auth paste-token --provider <provider>" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. 设置默认模型:" -ForegroundColor White
Write-Host "     $pkgCmd openclaw models set <model>" -ForegroundColor Gray
Write-Host ""
Write-Host "  3. 启动 Gateway:" -ForegroundColor White
Write-Host "     双击 start-gateway.bat 或运行 $pkgCmd run gateway" -ForegroundColor Gray
Write-Host ""
Write-Host "  4. 启动 Dashboard:" -ForegroundColor White
Write-Host "     $pkgCmd openclaw dashboard" -ForegroundColor Gray
Write-Host ""
