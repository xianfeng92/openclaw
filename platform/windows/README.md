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

## Agent 系统说明

### 什么是 Agent？

Agent 是 OpenClaw 的核心概念，每个 Agent 都是一个独立的 AI 助手，拥有：
- **独立的配置**（模型、技能、身份）
- **独立的工作空间**（记忆文件、工具配置）
- **独立的会话记录**

### Agent 目录结构

```
~/.openclaw-dev/                    # Dev 模式状态目录
├── openclaw.json                   # 主配置文件
├── agents/                         # Agent 状态目录
│   ├── main/                       # main agent
│   │   ├── agent/                  # Agent 数据
│   │   │   ├── openclaw.json       # Agent 模型配置
│   │   │   ├── auth-profiles.json  # API Key 凭证
│   │   │   └── models.json         # 模型目录
│   │   └── sessions/               # 会话记录
│   └── dev/                        # dev agent
│       └── ...
└── workspace-dev/                  # 默认工作空间
    ├── AGENTS.md                   # Agent 工作指南
    ├── SOUL.md                     # Agent 身份/灵魂
    ├── TOOLS.md                    # 工具笔记
    ├── IDENTITY.md                 # 身份信息
    ├── USER.md                     # 用户信息
    └── HEARTBEAT.md                # 心跳任务
```

### Workspace 文件说明

| 文件 | 作用 |
|------|------|
| `AGENTS.md` | Agent 工作指南，定义如何处理任务、群聊行为等 |
| `SOUL.md` | Agent 的"灵魂"，定义个性、边界、价值观 |
| `TOOLS.md` | 用户维护的工具笔记（SSH、摄像头、TTS 等） |
| `IDENTITY.md` | Agent 名称、表情符号、人设 |
| `USER.md` | 用户档案（时区、偏好等） |
| `HEARTBEAT.md` | 定期后台任务（邮件、日历检查等） |
| `MEMORY.md` | 长期记忆（仅主会话加载） |

### Agent 配置文件

**主配置** (`~/.openclaw-dev/openclaw.json`)：
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "google/gemini-3-flash-preview"
      }
    },
    "list": [
      {
        "id": "dev",
        "default": true,
        "workspace": "C:\\Users\\xforg\\.openclaw\\workspace-dev",
        "identity": {
          "name": "C3-PO",
          "emoji": "🤖"
        }
      }
    ]
  }
}
```

**Agent 配置** (`~/.openclaw-dev/agents/main/agent/openclaw.json`)：
```json
{
  "model": {
    "primary": "google/gemini-3-flash-preview"
  }
}
```

**API 凭证** (`~/.openclaw-dev/agents/main/agent/auth-profiles.json`)：
```json
{
  "version": 1,
  "profiles": {
    "google:manual": {
      "type": "token",
      "provider": "google",
      "token": "你的API_Key"
    }
  }
}
```

### 创建新 Agent

```bash
# 创建新 Agent（交互式）
pnpm openclaw agents add myagent

# 创建新 Agent（指定参数）
pnpm openclaw agents add myagent --workspace "./my-workspace" --model "google/gemini-3-flash-preview"

# 列出所有 Agent
pnpm openclaw agents list

# 删除 Agent
pnpm openclaw agents delete myagent

# 更新 Agent 身份
pnpm openclaw agents identity myagent
```

### Dev 模式 vs 正式模式

| 特性 | Dev 模式 (`--dev`) | 正式模式 |
|------|-------------------|----------|
| 配置目录 | `~/.openclaw-dev/` | `~/.openclaw/` |
| 工作空间 | `workspace-dev/` | `workspace/` |
| Gateway 端口 | 19001 | 18789 |
| 默认 Token | `openclaw-dev-token` | 自动生成 |
| 用途 | 开发测试 | 生产使用 |

两个模式**完全隔离**，互不影响。

### 管理 Agent Workspace

在 Dashboard 中：
1. 进入 **Agents** 页面
2. 选择一个 Agent
3. 点击 **Files** 标签
4. 可以直接编辑 `AGENTS.md`, `SOUL.md` 等文件

或者直接编辑本地文件，刷新后生效。

### 在 Chat 中切换 Agent

**重要概念**：在 Dashboard 的 Chat 页面里，不是"选 Agent 聊天"，而是"选 SessionKey 聊天"。

#### SessionKey 格式

```
SessionKey 格式: agent:<agentId>:<sessionType>
                agent:main:main   ← main agent
                agent:dev:main    ← dev agent (C3-PO)
```

#### 切换方法

在 Chat 页面**右上角**有一个 **Session 下拉框**：

| Session Key | 对应的 Agent |
|-------------|-------------|
| `agent:main:main` | main（通用助手） |
| `agent:dev:main` | dev (C3-PO，调试专用） |

选择不同的 SessionKey 就等于与不同的 Agent 聊天。

#### 如果下拉框里没有想要的 Agent

新 Agent 需要先"激活"（创建至少一个 session）才会出现在列表里。

**解决方法**：在 CLI 里触发一次创建 session：

```bash
# 用 dev agent 发一条消息，创建 session
pnpm openclaw --dev --agent dev --message "hi"

# 用 main agent 发一条消息，创建 session
pnpm openclaw --dev --agent main --message "hi"
```

然后刷新 Dashboard，Session 下拉框里就会出现对应的 `agent:dev:main` 或 `agent:main:main`。

#### 通过 URL 直接访问

也可以直接在浏览器地址栏指定 Agent：

| Agent | URL |
|-------|-----|
| main | `http://127.0.0.1:19001/chat?session=agent:main:main` |
| dev (C3-PO) | `http://127.0.0.1:19001/chat?session=agent:dev:main` |

### 设置默认 Agent

默认 Agent 由配置文件中的 `default: true` 决定：

**主配置** (`~/.openclaw-dev/openclaw.json`)：
```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "default": true    ← 设置为默认
      },
      {
        "id": "dev",
        "default": false
      }
    ]
  }
}
```

修改后需要重启 Gateway 并刷新 Dashboard。

### Agent 个性差异

| Agent | 个性特点 | 适用场景 |
|-------|----------|----------|
| **main** | 通用助手，简洁专业 | 日常任务、通用问答 |
| **dev (C3-PO)** | 焦虑、戏剧化、专注于调试 | 代码调试、错误分析 |

**C3-PO 回复示例**：
```
"Oh my! The database connection has failed!
The odds of successfully navigating this error are approximately
3,720 to 1! But let us examine the logs like ancient manuscripts..."
```

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

### 为 Dev 模式添加 API Key

由于 Dev 模式使用独立配置，需要单独添加：

1. **方式一**：在 Dev 模式下运行命令
   ```bash
   pnpm openclaw --dev models auth paste-token --provider google
   ```

2. **方式二**：直接编辑文件
   ```bash
   # 编辑 Dev 模式的 auth 配置
   notepad %USERPROFILE%\.openclaw-dev\agents\main\agent\auth-profiles.json
   ```

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

### 4. Error: unknown agent id

**原因**：
- Dashboard 的 Agents 列表里包含了 `session.mainKey`（通常是 `main`）
- 但你的配置里没有把 `main` 作为一个已配置的 agent（`agents.list[]` 为空或不包含 `main`）

这会导致 UI 里能选到 `main`，但在 **Files** 页面加载 core files 时后端校验失败，从而返回 `unknown agent id`。

**解决**：
1. 升级到包含该修复的 OpenClaw 版本，然后重启 Gateway，再刷新 Dashboard
2. 临时 workaround（二选一）：
   - 在配置里显式添加 `agents.list`，并包含 `main`（然后在 Dashboard 中点击 **Reload Config**）
   - 或者把 Dashboard 切换到一个已在 `agents.list[]` 中配置的 agent id

示例（`openclaw.json`，如果已有 `agents.list` 就把 `main` 追加进去）：
```json
{
  "agents": {
    "list": [{ "id": "main" }]
  }
}
```

### 5. Files 页面显示 "No configured models"

**原因**：Agent 配置中缺少模型设置

**解决**：在 Agent 配置中添加：
```json
{
  "model": {
    "primary": "google/gemini-3-flash-preview"
  }
}
```

## 相关文档

| 文件 | 说明 |
|------|------|
| `Windows_SetUp.md` | 详细安装指南 |
| `Windows_QuickStart.md` | 快速入门 |
