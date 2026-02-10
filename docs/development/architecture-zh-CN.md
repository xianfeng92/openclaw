# OpenClaw Phase A 解剖报告

### 可复刻设计图 + 接口契约

> **分析目标**: 对 OpenClaw 做源码级解剖，产出可直接用于复刻的技术文档
>
> **证据原则**: 每个关键结论均附带源码路径、符号名、行号范围

---

## 目录

- [[1] 模块架构](#1-模块架构)
- [[2] 关键时序](#2-关键时序)
- [[3] 工具协议](#3-工具协议)
- [[4] 会话模型](#4-会话模型)
- [[5] 并发队列](#5-并发队列)
- [[6] 安全机制](#6-安全机制)
- [附录](#附录)

---

# [1] 模块架构

## 1.1 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户界面层                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   CLI        │  │  Web UI      │  │  macOS App   │  │  Mobile      │   │
│  │              │  │  (Hono)      │  │  (menu bar)  │  │  (iOS/Android)│   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                  │                  │                  │           │
│         └──────────────────┼──────────────────┼──────────────────┘           │
│                            │                  │                              │
│                      ┌─────▼──────────────────▼─────┐                        │
│                      │         Gateway              │                        │
│                      │    HTTP + WebSocket          │                        │
│                      │    (req/res/event/hello-ok)   │                        │
│                      └─────┬────────────────────┬─────┘                        │
│                            │                    │                              │
└────────────────────────────┼────────────────────┼──────────────────────────────┘
                             │                    │
              ┌──────────────▼────────────────────▼──────────────┐
              │                   Gateway Core                    │
              │  • Method Router  • Auth  • Event Bus            │
              └──────────────┬───────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌──────────────┐ ┌─────────────────────┐
│   Orchestrator   │ │   Sessions   │ │    Tools/Skills     │
│  agentCommand   │ │  sessions.json│ │  • exec/read/write  │
│  runEmbeddedPi  │ │  *.jsonl     │ │  • workspace skills  │
│                 │ │  文件锁      │ │  • sandbox context   │
└────────┬────────┘ └──────────────┘ └─────────────────────┘
         │
         ▼
┌─────────────────┐
│   Pi Agent      │
│  (mariozechner) │
│                 │
│ • 编排          │
│ • 重试/回退     │
│ • 流式响应      │
└─────────────────┘
```

## 1.2 模块职责

| 模块             | 职责                                              | 证据                                                                        |
| :--------------- | :------------------------------------------------ | :-------------------------------------------------------------------------- |
| **Gateway**      | HTTP/WS 服务、握手鉴权、方法路由、事件广播        | `src/gateway/server.impl.ts` :: `startGatewayServer` :: L155-L158           |
| **Orchestrator** | 接收网关请求、调用 Pi Agent、推送生命周期事件     | `src/gateway/server-methods/agent.ts` :: `agentHandlers.agent` :: L364-L398 |
| **Sessions**     | 会话元数据存储、转录记录、带锁更新                | `src/config/sessions/store.ts` :: `updateSessionStore` :: L266-L277         |
| **Tools**        | 工具集合组装、exec 工具独立 schema/审批/超时      | `src/agents/pi-tools.ts` :: `createOpenClawCodingTools` :: L115-L124        |
| **Skills**       | 技能加载、合并、生成 prompt/snapshot              | `src/agents/skills/workspace.ts` :: `loadSkillEntries` :: L99-L106          |
| **Sandbox**      | 沙箱上下文解析、工作区隔离、浏览器桥接            | `src/agents/sandbox/context.ts` :: `resolveSandboxContext` :: L42-L47       |
| **UI**           | WS 客户端、pending map 维护、tool stream 卡片渲染 | `ui/src/ui/gateway.ts` :: `GatewayBrowserClient` :: L65-L71                 |

## 1.3 通信方式

| 通信对                 | 协议                                                     | 证据                                                |
| :--------------------- | :------------------------------------------------------- | :-------------------------------------------------- |
| UI ↔ Gateway           | WebSocket 帧 (`req/res/event/hello-ok`)                  | `src/gateway/protocol/schema/frames.ts` :: L70-L163 |
| Gateway HTTP           | `/tools/invoke`, `/v1/chat/completions`, `/v1/responses` | `src/gateway/tools-invoke-http.ts` :: L108          |
| Gateway ↔ Orchestrator | 进程内函数调用                                           | `src/gateway/server-methods/agent.ts` :: L364       |
| Orchestrator → Gateway | 进程内事件总线 `emitAgentEvent/onAgentEvent`             | `src/infra/agent-events.ts` :: L57-L83              |

---

# [2] 关键时序

## 2.1 完整流程图

```
User              UI                Gateway          Orchestrator        Tool
 │                │                    │                  │               │
 │  输入消息      │                    │                  │               │
 │───────────────>│                    │                  │               │
 │                │                    │                  │               │
 │                │  WS req: agent     │                  │               │
 │                │  {message,         │                  │               │
 │                │   sessionKey,      │                  │               │
 │                │   idempotencyKey}  │                  │               │
 │                │───────────────────>│                  │               │
 │                │                    │                  │               │
 │                │                    │  agentCommand()  │               │
 │                │                    │─────────────────>│               │
 │                │                    │                  │               │
 │                │  WS res: accepted  │                  │               │
 │                │  {runId}           │                  │               │
 │                │<───────────────────│                  │               │
 │                │                    │                  │               │
 │                │                    │                  │  tool exec    │
 │                │                    │                  │──────────────>│
 │                │                    │                  │               │
 │                │                    │                  │  tool result  │
 │                │                    │                  │<──────────────│
 │                │                    │                  │               │
 │                │  WS event: tool    │                  │               │
 │                │  {runId, seq,      │                  │               │
 │                │   stream:"tool",   │                  │               │
 │                │   phase:"result"}  │                  │               │
 │                │<───────────────────│                  │               │
 │                │                    │                  │               │
 │                │  渲染工具卡片      │                  │               │
 │                │  ─────────────────>│                  │               │
 │                │                    │                  │               │
 │                │  WS event: assistant                   │               │
 │                │  {runId, seq, delta}                   │               │
 │                │<───────────────────│                  │               │
 │                │                    │                  │               │
 │                │  渲染 AI 回复      │                  │               │
 │                │  ─────────────────>│                  │               │
 │                │                    │                  │               │
 │                │  WS event: lifecycle                   │
 │                │  {phase:"end"}                         │
 │                │<───────────────────│                  │               │
 │                                    │                  │               │
 ▼                ▼                    ▼                  ▼               ▼
```

## 2.2 关键消息类型

### 请求帧

```typescript
// 证据: src/gateway/protocol/schema/frames.ts :: RequestFrameSchema :: L126-L134
interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}
```

### 响应帧

```typescript
// 证据: src/gateway/protocol/schema/frames.ts :: ResponseFrameSchema :: L136-L145
interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
}
```

### 事件帧

```typescript
// 证据: src/gateway/protocol/schema/frames.ts :: EventFrameSchema :: L147-L157
interface EventFrame {
  type: "event";
  event: string;
  payload: unknown;
  seq: number;
  stateVersion?: number;
}
```

### Agent 事件载荷

```typescript
// 证据: src/infra/agent-events.ts :: AgentEventPayload :: L5-L12
interface AgentEventPayload {
  runId: string;
  seq: number; // per-run monotonic
  stream: "tool" | "assistant" | "lifecycle" | "error" | string;
  ts: number;
  sessionKey?: string;
  data: Record<string, unknown>;
}
```

### Tool 分片

```typescript
// 证据: src/agents/pi-embedded-subscribe.handlers.tools.ts :: L74-L80
interface ToolStreamData {
  phase: "start" | "update" | "result";
  name: string;
  toolCallId: string;
  args?: unknown; // start
  partialResult?: unknown; // update
  result?: unknown; // result
  isError?: boolean; // result
}
```

## 2.3 失败/重试/超时

| 场景            | 触发位置 | 处理方式                  | 证据                                                                   |
| :-------------- | :------- | :------------------------ | :--------------------------------------------------------------------- |
| 握手超时        | WS 连接  | 定时器触发关闭            | `src/gateway/server/ws-connection.ts` :: `handshakeTimer` :: L218-L227 |
| 请求帧非法      | 消息处理 | 返回 `INVALID_REQUEST`    | `src/gateway/server/ws-connection/message-handler.ts` :: L955-L963     |
| agent.wait 超时 | 代理等待 | 返回 `{status:"timeout"}` | `src/gateway/server-methods/agent.ts` :: L491-L505                     |
| 执行失败        | 运行器   | 模型/账号回退             | `src/agents/pi-embedded-runner/run.ts` :: L523-L551                    |

---

# [3] 工具协议

## 3.1 协议结构

OpenClaw 的工具执行协议由两层组成：

```
┌─────────────────────────────────────────────────────────────┐
│                    工具执行协议                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Layer 1: 工具入参 schema (如 execSchema)                   │
│           ↓                                                 │
│  Layer 2: 运行时流事件 (stream:"tool" + phase)              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**注意**: 源码中未见单一"统一 tool RPC 协议文件"合并两层。

## 3.2 可复刻接口定义

```typescript
// ========== Gateway 帧协议 ==========

interface GatewayRequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}

interface GatewayResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ========== Agent 事件协议 ==========

interface AgentEventPayload {
  runId: string;
  seq: number; // per-run monotonic
  stream: "tool" | "assistant" | "lifecycle" | "error" | string;
  ts: number;
  sessionKey?: string;
  data: Record<string, unknown>;
}

// ========== Tool 流事件 ==========

interface ToolStreamDataStart {
  phase: "start";
  name: string;
  toolCallId: string;
  args?: unknown;
}

interface ToolStreamDataUpdate {
  phase: "update";
  name: string;
  toolCallId: string;
  partialResult?: unknown;
}

interface ToolStreamDataResult {
  phase: "result";
  name: string;
  toolCallId: string;
  result?: unknown;
  isError?: boolean;
  meta?: unknown;
}

type ToolStreamData = ToolStreamDataStart | ToolStreamDataUpdate | ToolStreamDataResult;
```

## 3.3 Streaming 规则

| 规则     | 说明                            | 证据                                                                   |
| :------- | :------------------------------ | :--------------------------------------------------------------------- |
| 分片关联 | `runId + seq` 关联整体流        | `src/infra/agent-events.ts` :: `seqByRun` :: L20-L23                   |
| 工具关联 | `toolCallId` 关联单次工具调用   | `src/agents/pi-embedded-subscribe.handlers.tools.ts` :: L78, L134-L135 |
| 工具结束 | `phase:"result"`                | `src/agents/pi-embedded-subscribe.handlers.lifecycle.ts` :: L63-L74    |
| Run 结束 | `lifecycle phase:"end"/"error"` | `src/commands/agent.ts` :: L488-L497                                   |

## 3.4 错误模型

```typescript
// 协议层错误
// 证据: src/gateway/protocol/schema/error-codes.ts :: ErrorCodes :: L3-L11
interface ProtocolError {
  code: string; // "INVALID_REQUEST", "AGENT_TIMEOUT", etc.
  message: string;
  details?: unknown;
}

// 工具层错误
// 证据: src/agents/pi-embedded-subscribe.handlers.tools.ts :: L159-L161
interface ToolError {
  phase: "result";
  isError: true;
  result?: unknown; // 错误信息
}
```

## 3.5 超时/重试

| 配置项           | 说明                            | 证据                                              |
| :--------------- | :------------------------------ | :------------------------------------------------ |
| exec.timeout     | 命令执行超时，超时后 kill       | `src/agents/bash-tools.exec.ts` :: L205-L209      |
| approval timeout | 审批请求超时，超时后走 fallback | `src/gateway/exec-approval-manager.ts` :: L51-L60 |
| 全局重试策略     | **未见统一实现**                | 【未找到/待确认】                                 |

---

# [4] 会话模型

## 4.1 对象关系

```
SessionEntry (persistent)
       │
       │ 1 ─── n
       ▼
    Run (runId/idempotencyKey, transient)
       │
       │ 1 ─── n
       ▼
    ToolCall (toolCallId, phase: start/update/result)

Session/Run ──→ WorkspaceDir
                    (resolved by sessionKey/agentId/sandbox config)
```

## 4.2 核心对象

### SessionEntry

```typescript
// 证据: src/config/sessions/types.ts :: SessionEntry :: L25-L96
type SessionEntry = {
  id: string; // sessionKey
  agentId?: string;
  title?: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  // ... 其他字段
};
```

### Run

```typescript
// 证据: src/gateway/server-methods/agent.ts :: L299, L349-L353
interface Run {
  runId: string; // = idempotencyKey
  status: "accepted" | "running" | "completed" | "error";
  sessionKey: string;
}
```

### ToolCall

```typescript
// 证据: src/agents/pi-embedded-subscribe.handlers.tools.ts :: L41, L132, L200
interface ToolCall {
  toolCallId: string;
  phase: "start" | "update" | "result";
  name: string;
  // ... args/result
}
```

**注意**: 源码中未见统一 `Step` 类型定义。

## 4.3 生命周期

| 对象     | 创建             | 更新                 | 销毁                  | 证据                                                         |
| :------- | :--------------- | :------------------- | :-------------------- | :----------------------------------------------------------- |
| Session  | `sessions.patch` | `updateSessionStore` | `sessions.delete`     | `src/gateway/server-methods/sessions.ts` :: L159, L273, L365 |
| Run      | `agent` accepted | -                    | `lifecycle end/error` | `src/gateway/server-methods/agent.ts` :: L349-L361           |
| ToolCall | `phase:"start"`  | `phase:"update"`     | `phase:"result"`      | `src/agents/pi-embedded-subscribe.handlers.tools.ts`         |

## 4.4 Workspace 隔离

| 配置       | 说明                                                          | 证据                                      |
| :--------- | :------------------------------------------------------------ | :---------------------------------------- |
| 默认路径   | `~/.openclaw/workspace`                                       | `src/agents/workspace.ts` :: L13-L17      |
| 运行时解析 | 按 `sessionKey/agentId` fallback                              | `src/agents/workspace-run.ts` :: L72-L106 |
| 沙箱隔离   | `scope(session/agent/shared)` + `workspaceAccess(none/ro/rw)` | `src/config/types.agents.ts` :: L45-L56   |

```typescript
// 证据: src/agents/sandbox/context.ts :: L46
workspaceDir = cfg.workspaceAccess === "rw" ? workspaceDir : sandboxWorkspaceDir;
```

---

# [5] 并发队列

## 5.1 Lane 队列

```typescript
// 证据: src/process/lanes.ts :: CommandLane :: L1-L5
type CommandLane =
  | "main" // 主用户请求
  | "cron" // 定时任务
  | "subagent" // 子 Agent
  | "nested"; // 嵌套调用
```

## 5.2 调度策略

| 特性     | 说明                            | 证据                                              |
| :------- | :------------------------------ | :------------------------------------------------ |
| 队列模型 | 每 lane FIFO + maxConcurrent    | `src/process/command-queue.ts` :: L51-L53         |
| 双层入队 | 先 session lane，再 global lane | `src/agents/pi-embedded-runner/run.ts` :: L92-L93 |
| 并发预算 | 配置驱动 (cron/main/subagent)   | `src/gateway/server-lanes.ts` :: L6-L9            |

## 5.3 调度循环（可复刻伪代码）

```typescript
// 证据: src/process/command-queue.ts :: drainLane/pump :: L44-L90
function drainLane(lane: CommandLane) {
  const state = {
    queue: [] as Task[],
    active: 0,
    maxConcurrent: getConfig(lane),
  };

  function pump() {
    while (state.active < state.maxConcurrent && state.queue.length > 0) {
      const entry = state.queue.shift()!;
      state.active++;

      run(entry.task)
        .then(resolve)
        .catch(reject)
        .finally(() => {
          state.active--;
          pump(); // continue drain
        });
    }
  }

  return {
    enqueue: (task) => {
      state.queue.push(task);
      pump();
    },
  };
}
```

## 5.4 冲突控制

| 机制     | 说明                              | 证据                                                 |
| :------- | :-------------------------------- | :--------------------------------------------------- |
| 并发控制 | 同 lane FIFO，maxConcurrent 限流  | `src/process/command-queue.ts` :: L52-L63            |
| 背压告警 | 等待超阈值触发诊断                | `src/process/command-queue.ts` :: L55-L59, L103-L118 |
| 竞态保护 | 文件锁 `*.lock` + stale lock 回收 | `src/config/sessions/store.ts` :: L285-L354          |
| 饥饿避免 | **未见跨 lane 公平调度器**        | 【未找到/待确认】                                    |

---

# [6] 安全机制

## 6.1 风险点清单

| 风险点         | 触发条件                                | 防护机制                                 | 证据                                                                          |
| :------------- | :-------------------------------------- | :--------------------------------------- | :---------------------------------------------------------------------------- |
| 未授权 WS 接入 | 非 connect 首帧/鉴权失败/role 无效      | 握手校验 + close(1008/1002)              | `src/gateway/server/ws-connection/message-handler.ts` :: L265-L303, L313-L336 |
| 方法越权调用   | role/scope 不匹配 method                | `authorizeGatewayMethod` 显式 scope gate | `src/gateway/server-methods.ts` :: L93-L160                                   |
| 浏览器来源伪造 | control-ui/webchat 来源不可信           | `checkBrowserOrigin`                     | `src/gateway/server/ws-connection/message-handler.ts` :: L371-L385            |
| 命令执行越权   | exec 不在 allowlist 或 ask 策略要求审批 | `requiresExecApproval` + approval 机制   | `src/infra/exec-approvals.ts` :: L1403-L1414                                  |
| 审批超时悬挂   | 审批无人处理                            | timeout → null + fallback                | `src/gateway/exec-approval-manager.ts` :: L51-L60                             |
| 沙箱越界写入   | sandbox session 写主 workspace          | `workspaceAccess`/`scope` 控制           | `src/agents/sandbox/context.ts` :: L42-L47, L53-L57                           |
| 会话并发写坏   | 多进程并发写 sessions.json              | 文件锁 + stale lock 清理                 | `src/config/sessions/store.ts` :: L293-L354                                   |

## 6.2 默认权限策略

| 配置项               | 默认值               | 证据                                                               |
| :------------------- | :------------------- | :----------------------------------------------------------------- |
| exec.security        | `deny`               | `src/infra/exec-approvals.ts` :: L59                               |
| exec.ask             | `on-miss`            | `src/infra/exec-approvals.ts` :: L61                               |
| operator.admin scope | 自动分配（未显式时） | `src/gateway/server/ws-connection/message-handler.ts` :: L359-L365 |

## 6.3 审计日志

| 配置         | 说明                                                 | 证据                                                               |
| :----------- | :--------------------------------------------------- | :----------------------------------------------------------------- |
| Raw stream   | `OPENCLAW_RAW_STREAM=1` 时写 `logs/raw-stream.jsonl` | `src/agents/pi-embedded-subscribe.raw-stream.ts` :: L6-L10         |
| 事件字段     | `ts, event, runId, sessionId, ...`                   | `src/agents/pi-embedded-subscribe.handlers.messages.ts` :: L74-L78 |
| 统一审计规范 | **未见单一规范**                                     | 【未找到/待确认】                                                  |

---

# 附录

## A) 关键源码入口索引 (Top 15)

|  #  | 文件                                                    | 说明                        | 关联章节     |
| :-: | :------------------------------------------------------ | :-------------------------- | :----------- |
|  1  | `src/gateway/server.impl.ts`                            | 网关组装总入口              | [1][2][5][6] |
|  2  | `src/gateway/server/ws-connection.ts`                   | WS 连接、challenge、超时    | [1][2][6]    |
|  3  | `src/gateway/server/ws-connection/message-handler.ts`   | 握手/鉴权/请求分发          | [1][2][6]    |
|  4  | `src/gateway/server-methods.ts`                         | method 路由与 scope 授权    | [1][6]       |
|  5  | `src/gateway/server-methods/agent.ts`                   | `agent`/`agent.wait` 主入口 | [2][4]       |
|  6  | `src/commands/agent.ts`                                 | Orchestrator 主流程         | [1][2][4]    |
|  7  | `src/agents/pi-embedded-runner/run.ts`                  | 执行器与重试/回退           | [2][5]       |
|  8  | `src/process/command-queue.ts`                          | lane 队列调度核心           | [5]          |
|  9  | `src/process/lanes.ts`                                  | lane 枚举                   | [5]          |
| 10  | `src/infra/agent-events.ts`                             | 事件总线与 seq              | [2][3]       |
| 11  | `src/agents/pi-embedded-subscribe.handlers.tools.ts`    | tool stream 事件协议        | [2][3][4]    |
| 12  | `src/agents/bash-tools.exec.ts`                         | exec schema、审批、超时     | [3][6]       |
| 13  | `src/config/sessions/types.ts`                          | SessionEntry 字段契约       | [4]          |
| 14  | `src/config/sessions/store.ts`                          | 会话持久化与锁              | [4][5][6]    |
| 15  | `ui/src/ui/gateway.ts` + `ui/src/ui/app-tool-stream.ts` | UI 协议消费与展示           | [1][2][3]    |

## B) 搜索关键词

```
startGatewayServer
handleGatewayRequest
ConnectParamsSchema
HelloOkSchema
RequestFrameSchema
ErrorCodes
AGENT_TIMEOUT
exec.approval.request
exec.approval.resolve
resolveExecApprovals
requiresExecApproval
runEmbeddedPiAgent
enqueueCommandInLane
CommandLane
workspaceAccess
scope
resolveSandboxContext
SessionEntry
updateSessionStore
toolCallId
phase
stream:"tool"
AgentEventPayload
onAgentEvent
raw-stream.jsonl
agent.wait timeout
idempotencyKey
```

## C) 可复刻最小核心清单 (20% 获得 80% 价值)

### 目标场景：桌面端 MVP (不接聊天软件)

| 模块              | 优先级 | 说明                    | 复刻复杂度    |
| :---------------- | :----: | :---------------------- | :------------ |
| **配置系统**      |   P0   | 加载/保存配置           | 低            |
| **会话管理**      |   P0   | 简化版会话存储          | 低            |
| **Pi Agent 集成** |   P0   | AI 编排核心             | 中 (依赖外部) |
| **工具协议**      |   P0   | 工具调用接口            | 低            |
| **本地 UI**       |   P1   | 聊天界面 + 工具展示     | 中            |
| **Bash 工具**     |   P1   | 命令执行 + 输出流式返回 | 低            |
| **文件工具**      |   P1   | 读写操作                | 低            |
| **审计日志**      |   P2   | 基础操作日志            | 低            |
| **浏览器工具**    |   P2   | 页面快照                | 中            |
| **Canvas 工具**   |   P3   | A2UI 渲染               | 高            |

### 可跳过 (MVP 不需要)

- 所有 `src/channels/*` — 聊天平台集成
- `src/gateway/` — WebSocket 服务 (本地 UI 可直接调用)
- `extensions/*` — 扩展通道
- 移动端 `apps/*`

---

**文档版本**: v1.1 | **生成日期**: 2025-02-07
