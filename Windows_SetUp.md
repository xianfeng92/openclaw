# OpenClaw Windows 完整指南

> 在 Windows PowerShell 本地运行 OpenClaw 的完整配置与故障排除文档

**快速上手？** → 查看 [Windows_QuickStart.md](Windows_QuickStart.md)

---

## 目录

1. [系统要求](#1-系统要求)
2. [安装步骤](#2-安装步骤)
3. [配置 Gateway](#3-配置-gateway)
4. [配置模型](#4-配置模型)
5. [启动服务](#5-启动服务)
6. [网络代理配置](#6-网络代理配置)
7. [故障排除](#7-故障排除)
8. [进阶配置](#8-进阶配置)

---

## 1. 系统要求

### 1.1 必需软件

| 软件 | 版本要求 | 用途 |
|------|----------|------|
| Node.js | 18+ | 运行时环境 |
| pnpm | 8+ | 包管理器（可用 npm 替代） |
| PowerShell | 5.1+ | 命令行工具 |

### 1.2 可选软件

| 软件 | 用途 |
|------|------|
| Git | 版本控制 |
| VPN/代理软件 | 访问 Google/OpenAI API |

### 1.3 验证环境

```powershell
# 检查 Node.js 版本
node --version  # 应 >= 18

# 检查 pnpm 版本
pnpm --version

# 检查 PowerShell 版本
$PSVersionTable.PSVersion
```

---

## 2. 安装步骤

### 2.1 克隆项目

```powershell
cd C:\Users\xforg\Desktop
git clone https://github.com/openclaw/openclaw.git
cd openclaw
```

### 2.2 安装依赖

```powershell
pnpm install
```

### 2.3 首次配置修复

如果后续配置报错 `memory-core plugin not found`，执行：

```powershell
pnpm openclaw config set plugins.slots.memory none
```

### 2.4 编译项目

```powershell
pnpm run build
```

---

## 3. 配置 Gateway

### 3.1 Gateway 工作原理

```
Dashboard (浏览器) → Gateway (本地服务) → Agent → Model API
```

Gateway 是本地服务，负责：
- 接收来自 Dashboard 的消息
- 管理 Agent 运行
- 调用 Model API
- 返回响应给 Dashboard

### 3.2 设置鉴权模式

```powershell
# 启用 token 鉴权
pnpm openclaw config set gateway.auth.mode token

# 设置本地模式
pnpm openclaw config set gateway.mode local
```

### 3.3 生成 Token

```powershell
pnpm openclaw doctor --generate-gateway-token
```

### 3.4 查看 Token

```powershell
pnpm openclaw config get gateway.auth.token
```

**复制输出的 token**，连接 Dashboard 时需要。

### 3.5 Token 存储

Token 存储在：
- 全局：`C:\Users\xforg\.openclaw\openclaw.json`
- Agent 级：`C:\Users\xforg\.openclaw\agents\main\agent\openclaw.json`

---

## 4. 配置模型

### 4.1 支持的模型提供商

| Provider | 模型示例 | 说明 |
|----------|----------|------|
| OpenAI | `gpt-4o`, `gpt-5-mini` | 需要 OpenAI API Key |
| Anthropic | `claude-opus-4-6`, `claude-sonnet-4-6` | 需要 Anthropic API Key |
| Google | `gemini-2-flash`, `gemini-3-flash-preview` | 需要代理访问 |
| Venice | 多种模型 | 通过 Venice API 访问 |

### 4.2 添加 API Key

**方式一：交互式添加**

```powershell
pnpm openclaw models auth add
```

**方式二：直接粘贴**

```powershell
# OpenAI
pnpm openclaw models auth paste-token --provider openai

# Anthropic
pnpm openclaw models auth paste-token --provider anthropic

# Google
pnpm openclaw models auth paste-token --provider google

# Venice
pnpm openclaw models auth paste-token --provider venice
```

### 4.3 设置默认模型

```powershell
# OpenAI
pnpm openclaw models set openai/gpt-5-mini

# Google Gemini
pnpm openclaw models set google/gemini-3-flash-preview

# Anthropic
pnpm openclaw models set anthropic/claude-opus-4-6
```

### 4.4 验证配置

```powershell
pnpm openclaw models status --plain
```

确认输出：
- `defaultModel: <你设置的模型>`
- 没有 `missing` 或 `expired` 状态

### 4.5 API Key 存储位置

- Windows: `C:\Users\xforg\.openclaw\agents\main\agent\auth-profiles.json`
- 文件会被加密存储，不会上传到 Git

---

## 5. 启动服务

### 5.1 启动方式对比

| 方式 | 优点 | 缺点 | 推荐场景 |
|------|------|------|----------|
| **start-gateway.bat** | 自动配置代理，双击即用 | 需手动修改端口 | 日常开发 |
| **pnpm run gateway** | 简单直接 | 需手动设置代理 | 无需代理时 |
| **手动配置代理后启动** | 灵活控制 | 每次需设置变量 | 调试时 |

### 5.2 使用启动脚本（推荐）

```batch
# 双击运行，或：
start-gateway.bat
```

**启动脚本内容**：`start-gateway.bat`

```batch
@echo off
REM OpenClaw Gateway Startup Script with Proxy

setlocal
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890

cd /d "%~dp0"
echo Starting OpenClaw Gateway with proxy...
echo HTTPS_PROXY=%HTTPS_PROXY%
echo HTTP_PROXY=%HTTP_PROXY%

npm run gateway

endlocal
```

### 5.3 直接启动

**无需代理时：**

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm run gateway
```

**需要代理时：**

```powershell
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
pnpm run gateway
```

### 5.4 启动 Dashboard

**新开一个终端：**

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm openclaw dashboard
```

浏览器会自动打开 Dashboard 界面。

### 5.5 连接 Dashboard

1. 在 Dashboard 中找到 Gateway 配置区域
2. **Gateway URL**: **以启动日志为准**，例如：
   - 日志显示 `listening on ws://127.0.0.1:19001` → 填 `ws://127.0.0.1:19001`
   - 日志显示 `listening on ws://127.0.0.1:18789` → 填 `ws://127.0.0.1:18789`
   - **端口可能因模式（slim/dev）不同而变化，务必以启动日志为准**
3. **Gateway Token**: 粘贴第 3.4 节获取的 token
4. 点击 **Connect**

**✅ 确认连接成功**：Dashboard 显示 "Connected" 状态

---

## 6. 网络代理配置

### 6.1 为什么需要代理？

Node.js 不会自动使用系统代理。如果你的网络：
- 需要翻墙访问 Google/OpenAI
- 使用公司网络有限制

则需要手动配置代理。

### 6.2 常见代理软件端口

| 软件 | 默认端口 |
|------|----------|
| Clash | 7890 |
| V2RayN | 10809 |
| Clash Verge | 7890 或 7891 |

### 6.3 检查代理端口

```powershell
netstat -an | findstr "LISTEN" | findstr "7890 10808 10809"
```

### 6.4 测试代理连接

```powershell
# 测试通过代理访问 Google API
curl --proxy "http://127.0.0.1:7890" -s "https://generativelanguage.googleapis.com/v1beta/models"

# 测试通过代理访问 OpenAI API
curl --proxy "http://127.0.0.1:7890" -s "https://api.openai.com/v1/models"
```

### 6.5 设置系统环境变量（永久）

如果希望每次启动自动配置代理：

**方法一：设置用户环境变量**

```powershell
[System.Environment]::SetEnvironmentVariable("HTTP_PROXY", "http://127.0.0.1:7890", "User")
[System.Environment]::SetEnvironmentVariable("HTTPS_PROXY", "http://127.0.0.1:7890", "User")
```

**方法二：通过系统设置**

1. 右键「此电脑」→「属性」
2. 「高级系统设置」→「环境变量」
3. 添加用户变量：
   - `HTTP_PROXY` = `http://127.0.0.1:7890`
   - `HTTPS_PROXY` = `http://127.0.0.1:7890`

---

## 7. 故障排除

### 7.1 连接问题

| 症状 | 原因 | 解决方案 |
|------|------|----------|
| `disconnected (1008): unauthorized` | Token 不匹配 | 重新生成 token |
| `authProvided:"none"` | Token 未传递 | 清浏览器缓存，重连 |
| `Connection refused` | Gateway 未启动 | 启动 gateway |
| `Port 18789 in use` | 旧进程未停止 | `taskkill /F /IM node.exe` |

### 7.2 API 问题

| 症状 | 原因 | 解决方案 |
|------|------|----------|
| `No API key found for provider` | 未配置 API Key | 执行 `pnpm openclaw models auth add` |
| `Request timed out` | 无法访问 API | 配置代理 |
| `fetch failed` | 网络错误 | 检查代理设置 |
| `buffer has text: false` | Agent 无输出 | 检查模型配置 |

### 7.3 编译问题

| 症状 | 原因 | 解决方案 |
|------|------|----------|
| `Cannot find module` | 未安装依赖 | `pnpm install` |
| `TS compilation failed` | 代码错误 | 检查修改 |
| `port already in use` | 旧进程占用 | `taskkill /F /IM node.exe` |

### 7.4 PowerShell 编码问题

**症状**：错误信息显示乱码

**原因**：PowerShell 使用 UTF-16 LE 编码

**解决方案**：代码已自动处理。如仍有问题：

```powershell
# 设置 PowerShell 输出编码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001
```

### 7.5 消息重复显示

**症状**：同一消息显示两次

**状态**：已修复（`src/gateway/server-methods/chat.ts`）

### 7.6 pnpm 命令未找到问题

**症状**：
```
'pnpm' 不是内部或外部命令
corepack enable: EPERM: operation not permitted
```

**原因**：Node.js 的 corepack 尝试启用 pnpm，但因为权限问题（尤其是安装在 Program Files 时）失败。

---

### 方案 A：管理员权限运行 corepack enable

```powershell
# 以管理员身份运行 PowerShell
corepack enable
```

---

### 方案 B：使用 corepack pnpm 前缀

```powershell
# 所有 pnpm 命令改为 corepack pnpm
corepack pnpm install
corepack pnpm run build
corepack pnpm run gateway
```

---

### 方案 C：使用 npm 替代（临时方案）

如果上述方案都不可行，可以使用 npm：

```powershell
npm install
npm run build
npm run gateway
```

**注意**：npm 可能比 pnpm 慢，但功能完全兼容。

---

### 7.7 查看日志

```powershell
# 实时日志
pnpm openclaw logs --follow

# 最近 100 条
pnpm openclaw logs --limit 100 --plain

# 按级别过滤
pnpm openclaw logs --level error
```

---

## 8. 进阶配置

### 8.1 配置流式输出

编辑 `.openclaw/openclaw.json`：

```json
{
  "agents": {
    "defaults": {
      "models": {
        "google/gemini-3-flash-preview": {
          "alias": "gemini-flash",
          "streaming": false
        }
      }
    }
  }
}
```

### 8.2 配置工作目录

```powershell
pnpm openclaw config set agents.defaults.workspace "C:\\Users\\xforg\\workspace"
```

### 8.3 配置思考级别

```powershell
pnpm openclaw config set agents.defaults.reasoningLevel "medium"
```

### 8.4 配置详细程度

```powershell
pnpm openclaw config set agents.defaults.verboseDefault "info"
```

### 8.5 重置配置

```powershell
# 删除配置目录
Remove-Item -Recurse -Force C:\Users\xforg\.openclaw

# 重新配置
pnpm openclaw config set gateway.auth.mode token
pnpm openclaw doctor --generate-gateway-token
```

---

## 附录

### A. 常用命令速查

```powershell
# 配置相关
pnpm openclaw config set <key> <value>    # 设置配置
pnpm openclaw config get <key>             # 查看配置
pnpm openclaw config list                   # 列出所有配置

# 模型相关
pnpm openclaw models list-providers         # 列出 providers
pnpm openclaw models list                   # 列出所有模型
pnpm openclaw models status --plain        # 查看认证状态
pnpm openclaw models set <model>           # 设置默认模型

# 运行相关
pnpm run build                             # 编译
pnpm run gateway                           # 启动 gateway
pnpm run gateway stop                      # 停止 gateway
pnpm openclaw dashboard                    # 启动 dashboard

# 日志相关
pnpm openclaw logs --limit 100 --plain    # 查看日志
pnpm openclaw logs --follow                # 实时日志
pnpm openclaw doctor                        # 诊断工具
```

### B. 目录结构

```
C:\Users\xforg\Desktop\openclaw\
├── src/                    # 源代码
├── dist/                   # 编译输出
├── ui/                     # 前端代码
├── .openclaw/              # 配置目录
│   ├── openclaw.json       # 全局配置
│   └── agents/             # Agent 配置
│       └── main/agent/
│           ├── openclaw.json
│           └── auth-profiles.json
├── start-gateway.bat      # 启动脚本
└── Windows_QuickStart.md  # 快速上手指南
```

### C. 相关文档

- [Windows_QuickStart.md](Windows_QuickStart.md) - 快速上手
- [README.md](../README.md) - 项目 README
- [docs/](../docs/) - 详细文档

### D. 获取帮助

- GitHub Issues: https://github.com/openclaw/openclaw/issues
- 查看日志：`pnpm openclaw logs --limit 200`
- 诊断工具：`pnpm openclaw doctor`
