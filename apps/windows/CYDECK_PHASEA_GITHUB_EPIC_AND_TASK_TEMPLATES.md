# Phase A GitHub Epic + 子任务模板（CyDeck Terminal）

> 用法：直接复制下面各段到 GitHub Issue。  
> 建议标签：`epic`、`apps/windows`、`cydeck`、`phase-a`

## 1) Epic 模板（可直接发 Issue）

**Title**

`[Phase A] CyDeck Terminal Agent Orchestration 闭环（IPC / Gateway / Settings / Tests）`

**Body**

```md
## 背景
CyDeck Terminal 需要完成 Agent 编排核心闭环：终端命令 -> IPC -> Embedded Gateway -> 会话执行 -> 配置管理 -> 测试回归。

## 目标
1. `/agent`、`/spawn`、`/agents`、`/workflow` 链路稳定可用。
2. Embedded Gateway 支持关键 provider 与 agent hint。
3. Settings 与 `cydeck.json` 配置体系一致，不再走旧 OpenClaw CLI 配置路径。
4. `apps/windows` 保持 test/typecheck/build 全绿。

## 范围
- `apps/windows/src/main/*`
- `apps/windows/src/preload/*`
- `apps/windows/src/terminal/*`
- `apps/windows/resources/settings.html`
- `apps/windows/**/*.test.ts`

## 非目标
1. 不做跨平台统一重构（macOS / mobile）。
2. 不重写 `src/orchestration` 全部能力。
3. 不引入新的外部配置服务。

## 子任务
- [ ] A1: `/agent` -> `chat.send(agentHint)` 透传
- [ ] A2: Embedded Gateway agent hint + Anthropic provider 支持
- [ ] A3: `/spawn` 上下文注入真实进入 agent 启动消息
- [ ] A4: IPC 契约收敛（`attachCommand`、`workflow-run` 真执行、preload 类型）
- [ ] A5: Settings 与 `cydeck.json` 收口（读写一致）
- [ ] A6: 测试与验收门禁（unit/integration/manual）

## Epic DoD
1. 上述子任务全部完成并合入。
2. `pnpm --dir apps/windows test` 通过。
3. `pnpm --dir apps/windows typecheck` 通过。
4. `pnpm --dir apps/windows build` 通过。
5. 手工冒烟：`/config`、`/agent`、`/spawn`、`/workflow run`、Settings 页面均可用。

## 验收用例（Epic 级）
1. 终端切换 agent 后发送消息，Gateway 收到 `agentHint` 并改变 system prompt。
2. `/agents attach` 返回可直接执行的 `cd` 命令。
3. `/workflow run <name>` 返回真实执行结果（非 dry-run）。
4. Settings 保存后，`/config show` 可看到一致配置，重启后仍生效。
```

---

## 2) 子任务模板（通用）

**Title**

`[Phase A][A?] <模块> <目标>`

**Body**

```md
## 背景
<说明此任务解决的链路缺口>

## 目标
1. <目标1>
2. <目标2>

## 实现范围
- <文件/模块1>
- <文件/模块2>

## DoD
1. <功能完成条件1>
2. <功能完成条件2>
3. <错误处理/兼容条件>

## 测试项
1. 单元测试：<场景A>
2. 单元测试：<场景B>
3. 集成测试：<场景C>
4. 手工测试：<操作步骤 + 期望>

## 验收用例
1. Given <前置> When <动作> Then <结果>
2. Given <前置> When <动作> Then <结果>
```

---

## 3) 子任务实例（Phase A 已拆解版）

### A1. `/agent` -> `chat.send(agentHint)` 透传

**Title**

`[Phase A][A1] Terminal Agent Hint 透传到 Gateway chat.send`

**Body**

```md
## 背景
终端切换 agent 后，聊天请求没有稳定透传到 Gateway，导致 agent 选择对回复风格无影响。

## 目标
1. 从 terminal command handler 将当前 agent 解析为 `agentHint`。
2. `gateway-client` 在 `chat.send` 中透传 `agentHint`（空值不透传）。

## 实现范围
- `apps/windows/src/terminal/command-handler.ts`
- `apps/windows/src/terminal/gateway-client.ts`
- `apps/windows/src/terminal/gateway-client.test.ts`

## DoD
1. `/agent` 切换后发送普通消息，`chat.send.params.agentHint` 存在且正确。
2. 空白 agent 值不会污染请求参数。

## 测试项
1. 单元测试：有值时透传 `agentHint`。
2. 单元测试：空白值不透传。

## 验收用例
1. Given 当前 agent=claude When 发送消息 Then 网关请求包含 `agentHint=claude`。
2. Given agent 为空 When 发送消息 Then 请求里不包含 `agentHint` 字段。
```

### A2. Embedded Gateway agent hint + Anthropic provider

**Title**

`[Phase A][A2] Embedded Gateway 支持 agent hint prompt 与 Anthropic provider`

**Body**

```md
## 背景
Gateway 仅部分 provider 可用，且未把 agent 选择真正注入系统提示词。

## 目标
1. 维护 session 级 `agentHint`。
2. 构建并注入 agent hint system prompt。
3. 增加 Anthropic runtime provider 支持。

## 实现范围
- `apps/windows/src/main/embedded-gateway.ts`
- `apps/windows/src/main/embedded-gateway.test.ts`

## DoD
1. `chat.send` 收到 `agentHint` 后会写入 session 并影响后续消息构造。
2. Anthropic provider 可被 runtime 配置加载并成功调用。
3. 未配置时错误信息可读（明确缺少关键 env/config）。

## 测试项
1. 单元测试：agent-hint prompt 注入。
2. 单元测试：Anthropic provider 初始化与请求路径。
3. 集成测试：provider reload 后无需重启网关。

## 验收用例
1. Given `agentHint=claude` When chat.send Then provider 收到附加系统提示词。
2. Given runtime provider=anthropic When 发起聊天 Then 流式响应正常返回。
```

### A3. `/spawn` 上下文注入 agent 启动消息

**Title**

`[Phase A][A3] Windows Agent Manager 注入上下文到 spawn 启动消息`

**Body**

```md
## 背景
`/spawn` 虽有 context 参数，但未真正写入 agent 启动 message，编排价值不足。

## 目标
1. 将 `agent/useContext/relevantContext` 合成可读的启动消息头。
2. 在 agent 启动参数中使用合成后的 message。

## 实现范围
- `apps/windows/src/main/windows-agent-manager.ts`
- `apps/windows/src/main/windows-agent-manager.test.ts`

## DoD
1. context 被裁剪/格式化后写入 agent message。
2. 不传 context 时行为与原先一致。

## 测试项
1. 单元测试：含 context + agent 时 message 拼装正确。
2. 单元测试：空 context 时不注入冗余文本。

## 验收用例
1. Given 启用上下文注入 When spawn Then agent 启动消息含上下文块。
```

### A4. IPC 契约收敛（attach/workflow/preload）

**Title**

`[Phase A][A4] Terminal IPC 契约收敛与 workflow-run 真执行`

**Body**

```md
## 背景
前后端 IPC 返回字段不一致，`workflow-run` 仅 dry-run，不满足实际执行需求。

## 目标
1. `/agents attach` 返回 `attachCommand` 并前端兼容旧字段。
2. `terminal:workflow-run` 从 dry-run 切换为真实执行步骤。
3. preload 类型与 IPC 返回契约对齐。

## 实现范围
- `apps/windows/src/main/terminal-ipc.ts`
- `apps/windows/src/main/terminal-ipc.test.ts`
- `apps/windows/src/terminal/orchestral-commands.ts`
- `apps/windows/src/terminal/command-handler.ts`
- `apps/windows/src/preload/terminal-api.ts`

## DoD
1. attach 命令渲染稳定，不依赖单一字段名。
2. workflow 返回逐步执行结果（含成功/失败/统计）。
3. preload 不再依赖 `any` 漂移关键结果类型。

## 测试项
1. 单元测试：attach 返回 `attachCommand`。
2. 集成测试：workflow-run 执行 command/spawn/delay/confirm 路径。

## 验收用例
1. Given 工作流存在 When `/workflow run` Then 终端展示真实执行结果而非计划预览。
```

### A5. Settings 与 `cydeck.json` 收口

**Title**

`[Phase A][A5] Settings 改为直接读写 cydeck.json 并提供 settings:get`

**Body**

```md
## 背景
Settings 仍走旧的 OpenClaw CLI `config set` 流程，与 CyDeck `/config` 配置体系分裂。

## 目标
1. Settings 保存改为直接写入 `cydeck.json`。
2. 新增 `settings:get`，设置页加载真实配置。
3. 复用共享配置文档读写模块，避免实现分叉。

## 实现范围
- `apps/windows/src/main/cydeck-config-document.ts` (new)
- `apps/windows/src/main/settings.ts`
- `apps/windows/src/main/ipc.ts`
- `apps/windows/src/preload/index.ts`
- `apps/windows/resources/settings.html`
- `apps/windows/src/main/settings.test.ts` (new)

## DoD
1. Settings 保存后 `/config show` 可见同一份配置变化。
2. Settings 页面打开时优先显示当前 `cydeck.json` 实际值。
3. 无需 `openclaw config set` 外部命令依赖。

## 测试项
1. 单元测试：saveSettings 写入 provider/baseUrl/apiKey/gateway 配置。
2. 单元测试：loadSettings 返回当前默认 provider 的有效配置。
3. 单元测试：非法 provider/port 被拒绝。

## 验收用例
1. Given Settings 保存 provider 为 anthropic When 执行 `/config show` Then defaultProvider=anthropic。
2. Given 手工修改 cydeck.json When 打开 Settings Then UI 显示更新后的值。
```

### A6. 测试与回归门禁

**Title**

`[Phase A][A6] apps/windows 回归门禁补齐（test/typecheck/build + 手工矩阵）`

**Body**

```md
## 背景
Phase A 多模块并行改动，需要统一回归门禁防止交叉回归。

## 目标
1. 自动化门禁保持全绿。
2. 核心手工场景有固定验收矩阵。

## 实现范围
- `apps/windows/src/main/*.test.ts`
- `apps/windows/src/terminal/*.test.ts`
- `apps/windows/CYDECK_PHASEA_GITHUB_EPIC_AND_TASK_TEMPLATES.md`

## DoD
1. `pnpm --dir apps/windows test` 通过。
2. `pnpm --dir apps/windows typecheck` 通过。
3. `pnpm --dir apps/windows build` 通过。
4. 手工冒烟矩阵全部勾选。

## 测试项
1. 自动化：test/typecheck/build。
2. 手工：`/config`、`/agent`、`/agents attach`、`/workflow run`、Settings 保存+重启。

## 验收用例
1. Given 全部子任务完成 When 执行门禁命令 Then 三套命令均成功退出。
```
