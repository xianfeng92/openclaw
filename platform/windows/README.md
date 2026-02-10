# OpenClaw Windows 平台使用指南

OpenClaw Windows 平台提供一键配置和启动脚本，以及原生桌面应用，快速在本地运行 AI 智能体。

---

## 一、总结

### 什么是 OpenClaw

OpenClaw 是一个多渠道 AI 智能体框架，支持 WhatsApp、Telegram、Discord、Slack 等多个消息平台。通过单一 Gateway 网关管理所有连接，提供 Web UI 和原生桌面应用。

### Windows 平台两种使用方式

| 方式         | 适用场景           | 特点                 |
| ------------ | ------------------ | -------------------- |
| **启动脚本** | 快速体验、日常使用 | 双击即用，浏览器访问 |
| **桌面应用** | 长期使用、后台运行 | 系统托盘，独立窗口   |

### 快速上手（3 步）

```bash
# 1. 首次使用：环境配置
双击 setup-all.bat

# 2. 添加 API Key
pnpm openclaw models auth paste-token --provider google

# 3. 启动服务
双击 start-all.bat
```

### 前置要求

| 软件    | 版本要求           | 检查命令         |
| ------- | ------------------ | ---------------- |
| Node.js | 18+                | `node --version` |
| pnpm    | 8+ (可用 npm 替代) | `pnpm --version` |

> **pnpm 未安装？** 使用管理员运行 `corepack enable`，或直接用 npm

---

## 二、脚本和应用

### 2.1 启动脚本

位于 `platform/windows/` 目录下，双击即可运行。

| 脚本                  | 功能                         | 使用场景         |
| --------------------- | ---------------------------- | ---------------- |
| `setup-all.bat`       | 一键环境配置                 | 首次使用         |
| `setup-env.ps1`       | PowerShell 版本配置          | 首次使用         |
| `start-all.bat`       | 一键启动 Gateway + Dashboard | 日常使用（推荐） |
| `start-gateway.bat`   | 单独启动 Gateway             | 分步启动         |
| `start-dashboard.bat` | 单独启动 Dashboard           | 分步启动         |
| `build.bat`           | 快速构建项目                 | 开发时           |

#### 首次使用流程

双击 `setup-all.bat`，自动完成：

1. 检测 Node.js 和包管理器
2. 安装项目依赖
3. 构建项目
4. 配置 Gateway（token 认证）
5. 生成 Gateway Token
6. 检查模型配置

#### 添加 API Key

```bash
# 选择一个 provider 添加
pnpm openclaw models auth paste-token --provider openai
pnpm openclaw models auth paste-token --provider google
pnpm openclaw models auth paste-token --provider anthropic
```

#### 连接 Dashboard

1. 浏览器访问 `http://127.0.0.1:19001`
2. 填写：
   - **Gateway URL**: `ws://127.0.0.1:19001`（**以启动日志为准**）
   - **Token**: `openclaw-dev-token`
3. 点击 **Connect**

### 2.2 Windows 桌面应用

基于 Electron 的原生桌面应用，提供系统托盘和独立聊天窗口。

#### 开发模式

```bash
# 在仓库根目录安装依赖（推荐）
pnpm install

# 构建 Control UI 静态资源（首次必需；产物在 dist/control-ui）
pnpm ui:build

# 进入桌面应用目录
cd apps/windows

# 开发模式
pnpm dev

# 生产构建
pnpm build:prod
```

#### 桌面应用功能

| 功能         | 说明                   |
| ------------ | ---------------------- |
| 系统托盘     | 后台运行，状态指示     |
| Gateway 控制 | 启动/停止/重启 Gateway |
| 聊天窗口     | 内嵌浏览器 UI          |
| 设置管理     | 配置文件编辑           |

#### 生产构建输出

```
dist/installer/
├── OpenClaw-<version>-x64.portable.exe    # 便携版
└── OpenClaw-Setup-<version>.exe            # 安装版
```

### 2.3 代理设置（国内用户）

编辑 `start-gateway.bat` 或 `start-all.bat`：

```batch
REM Clash 默认: 7890, V2RayN 默认: 10809
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890
```

检查代理端口：

```powershell
netstat -an | findstr "LISTEN" | findstr "7890 10808 10809"
```

### 2.4 关键文件位置

| 类型     | 路径                           |
| -------- | ------------------------------ |
| 启动脚本 | `platform/windows/*.bat`       |
| 桌面应用 | `apps/windows/`                |
| 配置目录 | `%USERPROFILE%\.openclaw-dev\` |

---

## 三、常见问题

### 连接问题

| 问题                     | 解决方案                                   |
| ------------------------ | ------------------------------------------ |
| `ERR_CONNECTION_REFUSED` | Gateway 未启动，先运行 `start-gateway.bat` |
| `disconnected (1008)`    | Token 不匹配，使用 `openclaw-dev-token`    |
| 端口被占用               | `taskkill /F /IM node.exe`                 |
| 代理未生效               | 检查代理端口设置                           |

### pnpm 未找到

**方案 A**：管理员运行 corepack enable

```powershell
# 以管理员身份运行 PowerShell
corepack enable
```

**方案 B**：使用 corepack pnpm 前缀

```powershell
corepack pnpm install
corepack pnpm run build
```

**方案 C**：使用 npm 替代

```powershell
npm install
npm run build
npm run gateway
```

### 桌面应用 Not Found

桌面应用的聊天窗口打开 Gateway 提供的 Control UI（默认 `http://127.0.0.1:19001/`）。

如果显示 `Not Found`，通常是因为尚未构建 Control UI 静态资源：

```bash
pnpm ui:build
```

### 模型无响应

| 原因           | 解决方案                                                      |
| -------------- | ------------------------------------------------------------- |
| 未配置 API Key | `pnpm openclaw models auth paste-token --provider <provider>` |
| 代理未生效     | 检查代理设置                                                  |

### Gateway Token 说明

| 模式     | 配置目录                       | 默认 Token           | 端口  |
| -------- | ------------------------------ | -------------------- | ----- |
| Dev 模式 | `%USERPROFILE%\.openclaw-dev\` | `openclaw-dev-token` | 19001 |
| 正式模式 | `%USERPROFILE%\.openclaw\`     | 自动生成             | 18789 |

查看/禁用 Token：

```bash
# 查看 Token
pnpm openclaw config get gateway.auth.token

# 禁用验证（不推荐）
pnpm openclaw config set gateway.auth.mode none --dev
```

### 查看日志和诊断

```powershell
# 查看日志
pnpm openclaw logs --limit 100 --plain
pnpm openclaw logs --follow

# 诊断工具
pnpm openclaw doctor
pnpm openclaw status --all
```

---

## 进阶功能

### Agent 系统

每个 Agent 都是一个独立的 AI 助手，拥有独立的配置、工作空间和会话记录。

**Workspace 文件说明**：

| 文件          | 作用                     |
| ------------- | ------------------------ |
| `AGENTS.md`   | Agent 工作指南           |
| `SOUL.md`     | Agent 个性、边界、价值观 |
| `TOOLS.md`    | 工具笔记                 |
| `IDENTITY.md` | 名称、表情符号、人设     |
| `USER.md`     | 用户档案                 |
| `MEMORY.md`   | 长期记忆                 |

**创建新 Agent**：

```bash
pnpm openclaw agents add myagent
pnpm openclaw agents list
pnpm openclaw agents delete myagent
```

### 插件系统

```bash
# 列出插件
pnpm openclaw plugins list

# 启用 memory 插件
pnpm openclaw plugins enable memory-core
pnpm openclaw config set plugins.slots.memory memory-core

# 重启 Gateway
pnpm openclaw gateway restart --dev
```

### CLI Model 工具（无 API Key 使用 Claude/GPT）

如果你有 `claude` 或 `gpt` 命令行工具但没有 API Key，可以使用 `cli_model` 工具：

**前提条件**：

- PowerShell 7 已安装并在 PATH 中
- `claude` 或 `gpt` 命令可用

**使用方式**：
在聊天中直接要求 Agent 使用特定模型：

```
请用 claude 帮我分析这段代码...
请用 gpt 翻译这段文字...
```

Agent 会自动调用 `cli_model` 工具来执行你的请求。

详细说明：[CLI Model 工具文档](../../../docs/cli-model-tool.md)

---

## 相关文档

- [项目主文档](../../../README.md)
- [中文文档](../../../docs/zh-CN)
- [OpenClaw 综合报告](../../../docs/zh-CN/OpenClaw综合报告.md)
- [CLI Model 工具文档](../../../docs/cli-model-tool.md)
