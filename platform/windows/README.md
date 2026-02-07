# OpenClaw Windows 平台使用指南

本项目为 OpenClaw 提供了 Windows 平台的一键配置和启动脚本。

## 目录结构

```
platform/windows/
├── setup-all.bat       # 一键环境配置（安装依赖、构建、生成 Token）
├── build.bat           # 快速构建项目
├── start-gateway.bat   # 启动 Gateway 服务
├── start-dashboard.bat # 打开 Dashboard 浏览器
├── start-all.bat       # 一键启动 Gateway + Dashboard
└── README.md           # 本文档
```

## 快速开始

### 首次使用：环境配置

双击 `setup-all.bat`，自动完成：
1. 检测 Node.js 和包管理器（pnpm/npm）
2. 安装项目依赖
3. 构建项目
4. 配置 Gateway（token 认证模式）
5. 生成 Gateway Token
6. 检查模型配置

完成后，按提示添加模型 API Key：
```bash
# 添加 Google API Key（用于 Gemini 模型）
pnpm openclaw models auth paste-token --provider google
```

### 日常使用：启动服务

**推荐方式**：双击 `start-all.bat`

这会自动：
- 在新窗口启动 Gateway（端口 19001）
- 等待 5 秒让 Gateway 初始化
- 在浏览器中打开 Dashboard

**手动方式**：
1. 双击 `start-gateway.bat` 启动 Gateway
2. 双击 `start-dashboard.bat` 打开浏览器

## Gateway Token 说明

### 什么是 Gateway Token？

Gateway Token 是用来保护你的 Gateway 服务的**身份验证密码**。

OpenClaw 的 Gateway 是一个本地 Web 服务（监听在 `ws://127.0.0.1:19001`），它提供：
- **Web Dashboard (控制界面)** - 浏览器里的聊天界面
- **WebSocket API** - 让其他应用可以连接到 Agent

```
┌─────────────┐         输入 Token          ┌──────────────┐
│  Dashboard  │ ──────────────────────────> │   Gateway    │
│  (浏览器)   │                             │  (本地服务)   │
└─────────────┘   验证通过才能连接          └──────────────┘
                                                    │
                                                    ▼
                                            ┌──────────────┐
                                            │  AI Agent    │
                                            └──────────────┘
```

### 工作流程

1. **Gateway 启动时** → 生成或读取一个 token（存放在配置文件中）
2. **Dashboard 连接时** → 需要提供正确的 token
3. **验证通过** → 才能建立 WebSocket 连接，开始聊天

### Dev 模式的 Token

本项目的启动脚本使用 `--dev` 模式，有独立的配置文件：

| 模式 | 配置文件 | Token | 用途 |
|------|----------|-------|------|
| **Dev 模式** | `%USERPROFILE%\.openclaw-dev\openclaw.json` | `openclaw-dev-token` | 开发时使用 |
| **正式模式** | `%USERPROFILE%\.openclaw\openclaw.json` | 自动生成 | 生产环境使用 |

**Dev 模式默认 Token**：`openclaw-dev-token`

### 如何连接 Dashboard

1. 打开浏览器访问 `http://127.0.0.1:19001`
2. 在连接界面填写：
   - **Gateway URL**: `ws://127.0.0.1:19001`
   - **Token**: `openclaw-dev-token`
3. 点击 **Connect**

### 查看当前 Token

```bash
# Dev 模式
type %USERPROFILE%\.openclaw-dev\openclaw.json

# 正式模式
pnpm openclaw config get gateway.auth.token
```

### 禁用 Token 验证（不推荐）

如果你是本地开发、不需要安全保护：

```bash
pnpm openclaw config set gateway.auth.mode none --dev
```

然后重启 Gateway。

## 配置说明

### 代理设置

脚本默认配置了代理（用于访问 Google 等服务）：

```batch
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890
```

如果你的代理端口不同，请编辑 `start-gateway.bat` 和 `start-all.bat` 修改端口。

| 工具 | 默认端口 |
|------|----------|
| Clash | 7890 |
| V2RayN | 10809 |

### 端口说明

| 服务 | Dev 模式端口 | 正式模式端口 |
|------|-------------|-------------|
| Gateway | 19001 | 18789 |

## 模型配置

项目已将默认模型设置为 Google Gemini：

**默认模型**: `google/gemini-3-flash-preview`

修改后需要重新构建：
```bash
# 双击 build.bat 或手动执行
pnpm run build
```

### 添加其他模型

```bash
# 查看模型状态
pnpm openclaw models status

# 添加 API Key
pnpm openclaw models auth paste-token --provider <provider>

# 设置默认模型
pnpm openclaw models set <model>
```

支持的 provider: `openai`, `anthropic`, `google`, `venice`

## 常见问题

### 1. Dashboard 连接失败 (ERR_CONNECTION_REFUSED)

**原因**：Gateway 未启动

**解决**：先运行 `start-gateway.bat`，等待 "listening on" 消息后再打开 Dashboard

### 2. Token 验证失败

**原因**：使用了错误的 token

**解决**：
- Dev 模式使用 `openclaw-dev-token`
- 确认 Gateway 和 Dashboard 使用相同的配置模式

### 3. 模型无响应

**原因**：
- 未配置 API Key
- 代理未生效（无法访问 Google）

**解决**：
```bash
# 添加 Google API Key
pnpm openclaw models auth paste-token --provider google

# 检查代理设置
```

## 相关文档

| 文件 | 说明 |
|------|------|
| `Windows_SetUp.md` | 详细安装指南 |
| `Windows_QuickStart.md` | 快速入门 |
