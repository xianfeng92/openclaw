# CyDeck Terminal Phase 3 执行报告

更新时间：2026-03-03  
范围：`apps/windows`（内嵌 Gateway 协议收敛与聊天链路稳定性）

## 1. 目标与结果

Phase 3 目标：
1. 将 `EmbeddedGateway` 收敛到 CyDeck 必需协议面（`connect` / `chat.send` / 事件流）。
2. 明确 token 校验、会话隔离、异常关闭处理、状态机变迁。
3. 保持 `TerminalGatewayClient` 现有调用协议兼容。

执行结果：已完成，协议闭环与关键场景测试通过。

## 2. 实现明细

## 2.1 Embedded Gateway 重构
文件：`apps/windows/src/main/embedded-gateway.ts`

关键改动：
1. 协议面收敛：
   1. 仅保留 `connect`、`chat.send`、`chat` 事件流。
   2. 对未知方法返回 `404`，未认证请求返回 `401`。
2. 鉴权强化：
   1. connect 时同时兼容 `auth.token` 与 `params.auth.token`。
   2. token 比较改为 `timingSafeEqual`，避免字符串直接比较。
3. 协议兼容校验：
   1. 校验 `minProtocol/maxProtocol` 与当前协议版本（3）兼容性。
   2. 不兼容时返回 `426`。
4. 会话隔离：
   1. 会话由“连接级命名空间 + sessionKey”组成，不同 websocket 互不污染。
   2. 连接关闭时清理对应会话。
5. 异常关闭处理：
   1. 每个连接维护 `activeRuns` 的 `AbortController`。
   2. websocket 异常关闭时中止 in-flight chat，防止悬挂任务。
6. 状态机收敛：
   1. `starting -> running -> stopping -> stopped`。
   2. 启动失败或运行时 server error 进入 `error`。
   3. 重复状态不重复发事件。
7. 事件流兼容：
   1. `chat.send` 先回 `res`（`runId`, `status`）。
   2. 流式输出通过 `event: chat` 推送 `delta/final/error/aborted`。
8. 安全边界：
   1. WebSocket Server 绑定到 `127.0.0.1`，仅本机访问。

## 2.2 测试新增
文件：`apps/windows/src/main/embedded-gateway.test.ts`

覆盖场景（6项）：
1. 无效 token connect 拒绝（401）。
2. 协议版本不兼容拒绝（426）。
3. 未 connect 前 `chat.send` 拒绝；connect 后 fallback 事件流可达。
4. 同 `sessionKey` 在不同连接下保持会话隔离。
5. websocket 异常断开可中止 in-flight chat（Abort 生效）。
6. 状态变迁事件覆盖（starting/running/stopping/stopped）。

## 3. 验证结果

执行命令：
1. `pnpm --dir apps/windows test`
2. `pnpm --dir apps/windows build`
3. `pnpm --dir apps/windows typecheck`

结果：
1. `test`：通过（3 files, 20 tests passed）。
2. `build`：通过（main/preload/terminal/preload-terminal 全通过）。
3. `typecheck`：失败，仍为既有历史类型债（`terminal-ipc` 动态导入、`terminal/*` 的 `window.terminalAPI` 类型分裂等），非本阶段新增协议逻辑导致。

## 4. 兼容性结论

与 `TerminalGatewayClient` 的兼容性：
1. connect 帧结构兼容（`type=req`, `method=connect`, `params.auth.token`）。
2. chat.send 调用兼容（`sessionKey`, `message`, `deliver`, `idempotencyKey`）。
3. 事件消费兼容（`event=chat`, `payload.runId/state/text/sessionKey/seq`）。

结论：Phase 3 交付可满足“保持 Terminal 现有聊天链路习惯不变”的要求。

## 5. 后续建议（进入 Phase 4）

1. 删除/收口废弃路径（`window.ts`、旧 window IPC、无效引用）。
2. 输出最终“保留 OpenClaw 依赖清单”。
3. 若要清空 TypeScript 噪音，单列一个“类型债收敛”子阶段。
