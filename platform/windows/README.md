# OpenClaw Windows 平台

Windows 平台的一键安装和启动脚本。

## 快速开始

### 1. 一键环境配置

首次使用，双击运行：
```
setup-all.bat
```

或使用 PowerShell：
```powershell
.\setup-env.ps1
```

### 2. 添加模型 API Key

```powershell
pnpm openclaw models auth paste-token --provider <provider>
```

支持的 provider: `openai`, `anthropic`, `google`, `venice`

### 3. 一键启动

双击运行：
```
start-all.bat
```

## 脚本说明

| 脚本 | 功能 | 使用场景 |
|------|------|----------|
| `setup-all.bat` | 一键配置环境 | 首次安装 |
| `setup-env.ps1` | 一键配置环境 | 首次安装（PowerShell） |
| `start-all.bat` | 一键启动 Gateway + Dashboard | 日常使用 |
| `start-gateway.bat` | 启动 Gateway | 单独启动 Gateway |
| `start-dashboard.bat` | 启动 Dashboard | 单独启动 Dashboard |

## 文档

- [Windows_QuickStart.md](Windows_QuickStart.md) - 快速上手指南
- [Windows_SetUp.md](Windows_SetUp.md) - 完整配置指南

## 代理配置

如需使用代理，编辑 `start-gateway.bat` 或 `start-all.bat`，修改端口：

```batch
REM Clash 默认: 7890, V2RayN 默认: 10809
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890
```
