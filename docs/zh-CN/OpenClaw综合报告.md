# OpenClaw 综合报告

**报告生成日期：2026-02-08**
**文档版本：基于 docs/zh-CN/concepts/ 目录下的 30 个概念文档**

---

## 一、项目概述

OpenClaw 是一个多渠道 AI 智能体框架，允许通过单一 Gateway 网关在多个消息平台（WhatsApp、Telegram、Discord、Slack、Signal、iMessage 等）上运行 AI 智能体。

### 核心特点

- **单一 Gateway，多渠道支持**：一个守护进程管理所有消息平台连接
- **WebSocket 架构**：控制平面客户端通过 WebSocket 连接到 Gateway
- **多智能体路由**：支持多个隔离的智能体实例，每个有独立的工作区和会话
- **插件系统**：支持通过插件扩展功能（如 Mattermost）
- **移动节点支持**：iOS 和 Android 节点，支持 Canvas 界面

---

## 二、核心架构

### 2.1 Gateway 网关架构

**Gateway 网关**是 OpenClaw 的核心组件，负责：

- 维护所有消息平台的连接
- 暴露类型化的 WebSocket API（请求、响应、服务器推送事件）
- 根据 JSON Schema 验证入站帧
- 发出事件（agent、chat、presence、health、heartbeat、cron）

**关键组件：**

| 组件 | 描述 |
|------|------|
| Gateway 守护进程 | 拥有所有 Baileys WhatsApp 会话，控制每台主机只有一个实例 |
| 客户端（mac 应用/CLI/Web UI） | 通过 WebSocket 连接，发送请求并订阅事件 |
| 节点（macOS/iOS/Android） | 以 `role: node` 连接，提供设备特定的命令 |
| Canvas 主机 | 提供 agent 可编辑的 HTML 和 A2UI |

### 2.2 协议设计

OpenClaw 使用 **TypeBox** 定义 Gateway WebSocket 协议，实现：
- 运行时验证（AJV）
- JSON Schema 导出
- Swift 代码生成（macOS 应用）

**三种消息帧：**
- **Request**: `{ type: "req", id, method, params }`
- **Response**: `{ type: "res", id, ok, payload | error }`
- **Event**: `{ type: "event", event, payload, seq?, stateVersion? }`

---

## 三、智能体（Agent）系统

### 3.1 智能体运行时

OpenClaw 运行一个源自 **pi-mono** 的嵌入式智能体运行时，包含：

- **单一工作区**：`agents.defaults.workspace` 作为智能体的唯一工作目录
- **引导文件**：注入到系统提示中的工作区文件（AGENTS.md、SOUL.md、TOOLS.md、IDENTITY.md、USER.md 等）
- **内置工具**：read/exec/edit/write 等核心工具始终可用
- **Skills**：从三个位置加载（内置、托管/本地、工作区）

### 3.2 智能体循环生命周期

智能体循环是完整的运行流程：

```
接收输入 → 上下文组装 → 模型推理 → 工具执行 → 流式回复 → 持久化
```

**关键流程：**

1. `agent` RPC 验证参数并返回 `{ runId, acceptedAt }`
2. `agentCommand` 运行智能体（加载模型、Skills、调用 pi-agent-core）
3. `runEmbeddedPiAgent` 序列化运行并通过队列执行
4. 发出生命周期和流事件
5. `agent.wait` 等待运行完成

### 3.3 多智能体路由

**核心概念：每个智能体 = 完全隔离的"大脑"**

- **独立工作区**：不同的 AGENTS.md、SOUL.md、USER.md
- **独立认证**：每个智能体有自己的 auth-profiles.json
- **独立会话存储**：`~/.openclaw/agents/<agentId>/sessions/`

**路由规则（优先级从高到低）：**
1. 精确对端匹配（peer.kind + peer.id）
2. Guild 匹配（Discord）
3. Team 匹配（Slack）
4. 账户匹配（accountId）
5. 渠道匹配
6. 默认智能体

---

## 四、会话管理

### 4.1 会话键格式

- **直接聊天**：`agent:<agentId>:<mainKey>`（默认 `agent:main:main`）
- **群组**：`agent:<agentId>:<channel>:group:<id>`
- **房间/频道**：`agent:<agentId>:<channel>:channel:<id>`
- **线程**：附加 `:thread:<threadId>`

### 4.2 会话生命周期

- **重置策略**：会话重用直到过期
- **每日重置**：默认凌晨 4:00（主机本地时间）
- **空闲重置**：可选的滑动空闲窗口
- **重置触发器**：`/new` 或 `/reset` 命令

### 4.3 会话剪枝

在每次 LLM 调用前修剪旧的工具结果，**不重写磁盘历史**。

- **运行时机**：当启用 `mode: "cache-ttl"` 且最后 Anthropic 调用超过 TTL 时
- **软修剪**：裁剪过大的工具结果，保留头部+尾部
- **硬清除**：用占位符替换整个工具结果

---

## 五、消息与队列

### 5.1 消息流程

```
入站消息 → 路由/绑定 → 会话键 → 队列 → 智能体运行 → 出站回复
```

### 5.2 队列模式

| 模式 | 行为 |
|------|------|
| `steer` | 立即注入当前运行，取消待处理的工具调用 |
| `followup` | 入队，在当前运行结束后作为新轮次 |
| `collect` | 合并所有排队消息为单个后续轮次（默认） |
| `interrupt` | 中止活动运行，运行最新消息 |

### 5.3 入站处理

- **去重**：短期缓存防止重复投递
- **防抖**：快速连续消息批量合并为单个智能体轮次
- **历史注入**：待处理的群组消息以 `[Chat messages since your last reply - for context]` 前缀注入

---

## 六、上下文与压缩

### 6.1 上下文组成

- **系统提示词**：规则、工具、Skills 列表、时间/运行时、注入的工作区文件
- **对话历史**：用户消息 + 助手消息
- **工具调用/结果 + 附件**

### 6.2 上下文窗口与压缩

每个模型有**上下文窗口**限制。长时间运行的对话会累积消息，当窗口紧张时：

- **压缩**：总结较旧的历史为紧凑条目，持久化到 JSONL
- **修剪**：从内存上下文中移除旧工具结果（临时）
- **自动压缩**：会话接近模型限制时自动触发

### 6.3 上下文检查命令

- `/status`：快速查看窗口使用情况
- `/context list`：注入内容 + 大小
- `/context detail`：详细分解（工具 schema 大小、Skills 大小等）
- `/compact`：手动压缩，释放窗口空间

---

## 七、记忆系统

### 7.1 记忆文件布局

- `memory/YYYY-MM-DD.md`：每日日志（仅追加）
- `MEMORY.md`：精选的长期记忆（仅在主私人会话中加载）

### 7.2 向量记忆搜索

OpenClaw 支持在 Markdown 文件上构建向量索引：

**混合搜索（BM25 + 向量）：**
- **向量相似度**：语义匹配（"这意味着同一件事"）
- **BM25 关键词**：精确令牌（ID、代码符号、错误字符串）

### 7.3 记忆工具

- `memory_search`：语义搜索返回片段
- `memory_get`：按路径读取记忆文件内容

### 7.4 QMD 后端（实验性）

设置 `memory.backend = "qmd"` 可使用本地优先搜索侧车，结合 BM25 + 向量 + 重排序。

---

## 八、模型与提供商

### 8.1 模型选择

OpenClaw 按以下顺序选择模型：

1. **主要模型**：`agents.defaults.model.primary`
2. **回退模型**：`agents.defaults.model.fallbacks`
3. **提供商认证故障转移**：在提供商内部发生

### 8.2 支持的提供商

**内置提供商：**
- OpenAI、Anthropic、OpenAI Code (Codex)、OpenCode Zen、Google Gemini、Z.AI、Vercel AI Gateway
- OpenRouter、xAI、Groq、Cerebras、Mistral、GitHub Copilot

**自定义提供商（通过 `models.providers`）：**
- Moonshot AI (Kimi)、Kimi Coding、Qwen OAuth、Synthetic、MiniMax、Ollama

### 8.3 模型故障转移

**两阶段处理：**
1. **认证配置文件轮换**：在当前提供商内轮换
2. **模型回退**：移动到下一个模型

**冷却策略：**
- 认证/速率限制错误：1 分钟 → 5 分钟 → 25 分钟 → 1 小时
- 账单失败：5 小时 → 10 小时 → 24 小时（上限）

---

## 九、渠道支持

### 9.1 支持的渠道

| 渠道 | 状态 |
|------|------|
| WhatsApp | ✅ 通过 WhatsApp Web (Baileys) |
| Telegram | ✅ Bot 支持 (grammY) |
| Discord | ✅ Bot 支持 (channels.discord.js) |
| Slack | ✅ 原生支持 |
| Signal | ✅ 原生支持 |
| iMessage | ✅ 通过本地 imsg CLI (macOS) |
| Mattermost | ✅ 插件支持 |
| Microsoft Teams | ✅ 原生支持 |
| Matrix | ✅ 原生支持 |
| WebChat | ✅ 静态 UI，使用 Gateway WS API |

### 9.2 群组支持

- **群组策略**：`open` | `disabled` | `allowlist`
- **提及限制**：默认需要 @ 提及才会响应
- **独立会话**：每个群组有独立的会话键
- **工具限制**：可按群组/工具限制

---

## 十、配置与工作区

### 10.1 工作区结构

```
~/.openclaw/workspace/
├── AGENTS.md          # 智能体操作指南
├── SOUL.md            # 人设、语气、边界
├── TOOLS.md           # 本地工具说明
├── IDENTITY.md        # 智能体名称/风格
├── USER.md            # 用户档案和偏好
├── HEARTBEAT.md        # 心跳检查清单
├── BOOT.md            # Gateway 重启时执行
├── memory/            # 每日记忆日志
├── skills/            # 工作区特定技能
└── canvas/            # Canvas UI 文件
```

### 10.2 Git 备份（推荐）

将工作区放入**私有** git 仓库便于备份和恢复：

```bash
cd ~/.openclaw/workspace
git init
git add AGENTS.md SOUL.md TOOLS.md IDENTITY.md USER.md HEARTBEAT.md memory/
git commit -m "Add agent workspace"
```

---

## 十一、流式传输与分块

### 11.1 两种流式传输层

- **分块流式传输**：发出已完成的块作为普通渠道消息
- **草稿流式传输（仅 Telegram）**：用部分文本更新草稿气泡

### 11.2 分块控制

- `blockStreamingDefault`：`on|off`（默认关闭）
- `blockStreamingBreak`：`text_end`（边生成边发）或 `message_end`（最后刷新）
- `blockStreamingChunk`：控制块大小（默认 800–1200 字符）

---

## 十二、安全与沙箱

### 12.1 沙箱隔离

- **模式**：`off`、`non-main`、`all`
- **范围**：`session`（每会话容器）或 `shared`（共享容器）
- **工作区访问**：`rw`、`ro`、`none`

### 12.2 工具策略

- **允许列表/拒绝列表**：控制可用工具
- **每智能体配置**：每个智能体可有独立的工具限制
- **每群组限制**：特定群组的工具限制

---

## 十三、OAuth 与 认证

### 13.1 支持的 OAuth

- **OpenAI Codex (ChatGPT OAuth)**
- **Anthropic**（setup-token 流程）
- **Google Vertex/Antigravity/Gemini CLI**
- **GitHub Copilot**

### 13.2 认证存储

- **认证配置文件**：`~/.openclaw/agents/<agentId>/agent/auth-profiles.json`
- **会话粘性**：每个会话固定选定的认证配置文件
- **令牌刷新**：自动刷新过期令牌

---

## 十四、开发者相关

### 14.1 协议开发

- **TypeBox 模式**：定义 WebSocket 协议
- **JSON Schema**：从 TypeBox 生成
- **Swift 代码生成**：用于 macOS 应用

### 14.2 插件系统

- **插件钩子**：`before_agent_start`、`agent_end`、`before_compaction`、`after_compaction`
- **消息钩子**：`message_received`、`message_sending`、`message_sent`
- **会话钩子**：`session_start`、`session_end`
- **网关钩子**：`gateway_start`、`gateway_stop`

---

## 十五、术语表

| 中文 | 英文 | 说明 |
|------|------|------|
| 智能体 | Agent | AI 助手 |
| 渠道 | Channel | 消息平台 |
| 工作区 | Workspace | Agent 的文件系统工作目录 |
| 会话 | Session | 对话历史上下文 |
| 绑定 | Binding | 消息到智能体的路由规则 |
| 心跳 | Heartbeat | 定期健康检查 |
| 沙箱 | Sandbox | 隔离执行环境 |
| 压缩 | Compaction | 总结旧历史以节省上下文 |
| 修剪 | Pruning | 移除旧工具结果以减少上下文膨胀 |

---

## 总结

OpenClaw 是一个功能丰富的多渠道 AI 智能体框架，具有以下核心优势：

1. **统一管理**：单一 Gateway 网关管理所有消息平台
2. **灵活路由**：支持多智能体、多账户、多工作区
3. **持久记忆**：基于 Markdown 的记忆系统和向量搜索
4. **可扩展性**：插件系统和 Skills 机制
5. **安全性**：沙箱隔离和工具策略控制

适用于需要在不同消息平台上统一部署 AI 智能体的场景，支持个人用户、团队和企业级部署。

---

**文档来源**：本报告基于 `docs/zh-CN/concepts/` 目录下的 30 个概念文档编译而成。
