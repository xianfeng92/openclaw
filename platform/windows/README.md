# OpenClaw Windows 平台使用指南

OpenClaw Windows 平台提供一键配置和启动脚本，快速在本地运行 AI 智能体。

---

## 快速开始

### 前置要求

| 软件 | 版本要求 | 检查命令 |
|------|----------|----------|
| Node.js | 18+ | `node --version` |
| pnpm | 8+ (可用 npm 替代) | `pnpm --version` |

> **pnpm 未安装？** 使用管理员运行 `corepack enable`，或直接用 npm

### 首次使用：环境配置

双击运行：
```
setup-all.bat
```

或 PowerShell：
```powershell
.\setup-env.ps1
```

自动完成：
1. 检测 Node.js 和包管理器
2. 安装项目依赖
3. 构建项目
4. 配置 Gateway（token 认证）
5. 生成 Gateway Token
6. 检查模型配置

### 添加 API Key

```bash
# 选择一个 provider 添加
pnpm openclaw models auth paste-token --provider openai
pnpm openclaw models auth paste-token --provider google
pnpm openclaw models auth paste-token --provider anthropic
```

### 日常使用：启动服务

**推荐方式**：双击 `start-all.bat`

自动启动 Gateway + Dashboard

**手动方式**：
1. 双击 `start-gateway.bat` 启动 Gateway
2. 双击 `start-dashboard.bat` 打开浏览器

---

## 脚本说明

| 脚本 | 功能 |
|------|------|
| `setup-all.bat` | 一键环境配置（首次使用） |
| `setup-env.ps1` | PowerShell 版本的环境配置 |
| `start-all.bat` | 一键启动 Gateway + Dashboard |
| `start-gateway.bat` | 单独启动 Gateway |
| `start-dashboard.bat` | 单独启动 Dashboard |
| `build.bat` | 快速构建项目 |

---

## Gateway Token 说明

### 什么是 Token

Gateway Token 是保护本地服务的身份验证密码：

```
Dashboard (浏览器) --Token--> Gateway (本地服务) --> AI Agent
```

### Dev 模式 Token

| 模式 | 配置目录 | 默认 Token | 端口 |
|------|----------|-----------|------|
| Dev 模式 | `%USERPROFILE%\.openclaw-dev\` | `openclaw-dev-token` | 19001 |
| 正式模式 | `%USERPROFILE%\.openclaw\` | 自动生成 | 18789 |

### 连接 Dashboard

1. 浏览器访问 `http://127.0.0.1:19001`
2. 填写：
   - **Gateway URL**: `ws://127.0.0.1:19001`（**以启动日志为准**）
   - **Token**: `openclaw-dev-token`
3. 点击 **Connect**

### 查看/禁用 Token

```bash
# 查看 Token
pnpm openclaw config get gateway.auth.token

# 禁用验证（不推荐）
pnpm openclaw config set gateway.auth.mode none --dev
```

---

## 代理设置

### 代理端口配置

编辑 `start-gateway.bat` 或 `start-all.bat`：

```batch
REM Clash 默认: 7890, V2RayN 默认: 10809
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890
```

### 检查代理端口

```powershell
netstat -an | findstr "LISTEN" | findstr "7890 10808 10809"
```

---

## Agent 系统

### 什么是 Agent

每个 Agent 都是一个独立的 AI 助手，拥有：
- 独立的配置（模型、技能、身份）
- 独立的工作空间
- 独立的会话记录

### Workspace 文件说明

| 文件 | 作用 |
|------|------|
| `AGENTS.md` | Agent 工作指南 |
| `SOUL.md` | Agent 个性、边界、价值观 |
| `TOOLS.md` | 工具笔记 |
| `IDENTITY.md` | 名称、表情符号、人设 |
| `USER.md` | 用户档案 |
| `MEMORY.md` | 长期记忆 |

### 切换 Agent

在 Chat 页面右上角 **Session 下拉框**：

| Session Key | Agent |
|-------------|-------|
| `agent:main:main` | main（通用助手） |
| `agent:dev:main` | dev (C3-PO，调试专用) |

或直接 URL 访问：
```
http://127.0.0.1:19001/chat?session=agent:main:main
```

### 创建新 Agent

```bash
# 交互式创建
pnpm openclaw agents add myagent

# 指定参数
pnpm openclaw agents add myagent --workspace "./my-workspace" --model "google/gemini-3-flash-preview"

# 列出/删除
pnpm openclaw agents list
pnpm openclaw agents delete myagent
```

---

## 模型配置

### 支持的 Provider

| Provider | 模型示例 |
|----------|----------|
| OpenAI | `gpt-4o`, `gpt-5-mini` |
| Anthropic | `claude-opus-4-6`, `claude-sonnet-4-6` |
| Google | `gemini-2-flash`, `gemini-3-flash-preview` |
| Venice | 多种模型 |

### 常用命令

```bash
# 查看状态
pnpm openclaw models status --plain

# 设置默认模型
pnpm openclaw models set google/gemini-3-flash-preview
```

---

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| `ERR_CONNECTION_REFUSED` | Gateway 未启动，先运行 `start-gateway.bat` |
| `disconnected (1008)` | Token 不匹配，使用 `openclaw-dev-token` |
| `No API key found` | 配置 API Key |
| 端口被占用 | `taskkill /F /IM node.exe` |
| `pnpm` 不可用 | 使用管理员运行 `corepack enable`，或用 `npm` |
| 代理未生效 | 检查代理端口设置 |

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

---

## 进阶配置

### 查看日志

```powershell
pnpm openclaw logs --limit 100 --plain
pnpm openclaw logs --follow
```

### 诊断工具

```powershell
pnpm openclaw doctor
pnpm openclaw status --all
```

### 插件系统

```bash
# 列出插件
pnpm openclaw plugins list

# 启用 LanceDB 高级内存
pnpm openclaw plugins enable memory-lancedb
```

---

## Windows 桌面应用

OpenClaw 提供 Windows 桌面应用（基于 Electron），包含系统托盘、Gateway 控制、聊天界面等功能。

### 桌面应用开发

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

### 常见问题：打开页面显示 Not Found

桌面应用的“聊天窗口”本质上是打开/嵌入 Gateway 提供的 Control UI（默认 `http://127.0.0.1:19001/`）。

如果你已经启动 Gateway，但浏览器或桌面应用窗口显示 `Not Found`，通常是因为尚未构建 Control UI 静态资源：

```bash
pnpm ui:build
```

补充：如果你配置了 `gateway.controlUi.basePath`（例如 `/openclaw`），那么对应的页面路径也会变为 `http://127.0.0.1:19001/openclaw/`。

### 桌面应用功能

| 功能 | 说明 |
|------|------|
| 系统托盘 | 后台运行，状态指示 |
| Gateway 控制 | 启动/停止/重启 Gateway |
| 聊天窗口 | 内嵌浏览器 UI |
| 设置管理 | 配置文件编辑 |

### 生产构建输出

```
dist/installer/
├── OpenClaw-<version>-x64.portable.exe    # 便携版
└── OpenClaw-Setup-<version>.exe            # 安装版
```

### 关键文件位置

| 类型 | 路径 |
|------|------|
| 启动脚本 | `platform/windows/*.bat` |
| 桌面应用 | `apps/windows/` |
| 配置目录 | `%USERPROFILE%\.openclaw-dev\` |

---

## 目录结构

```
platform/windows/
├── setup-all.bat       # 一键环境配置
├── setup-env.ps1       # PowerShell 环境配置
├── build.bat           # 构建项目
├── start-gateway.bat   # 启动 Gateway
├── start-dashboard.bat # 启动 Dashboard
├── start-all.bat       # 一键启动全部
└── README.md           # 本文档
```

---

## 相关文档

- [项目主文档](../../../README.md)
- [中文文档](../../../docs/zh-CN)
- [OpenClaw 综合报告](../../../docs/zh-CN/OpenClaw综合报告.md)
