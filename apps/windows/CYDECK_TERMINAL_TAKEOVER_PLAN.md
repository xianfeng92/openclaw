# CyDeck Terminal 接管执行文档（OpenClaw 冗余清理）

更新时间：2026-03-03  
分支：`cydeck_terminal`  
范围：`apps/windows`（主进程、Terminal 渲染层、配置层）

## 1. 接管审计结论

### 1.1 Claude 已做但未完工的改动
1. 已部分移除 Chat Window / Invoke Window 入口。
2. 已新增 `EmbeddedGateway` 草稿，并把 `index.ts` 切到内嵌网关。
3. 已在 `command-handler.ts` 增加 `/config` 命令入口。

### 1.2 当前阻塞（必须先修）
1. `apps/windows/src/main/embedded-gateway.ts`：类型命名冲突、未定义变量、协议事件结构不完整，无法作为生产网关。
2. `apps/windows/src/main/ipc.ts` 与 `apps/windows/src/main/tray.ts`：仍依赖 `GatewayManager` 类型，和 `EmbeddedGateway` 不一致。
3. `apps/windows/src/terminal/command-handler.ts`：`handleConfigCommand` 未实现，`/config` 入口为半成品。
4. `apps/windows/src/terminal/config.ts`：合并默认值与类型约束存在多个错误，无法可靠复用。
5. 存在临时/噪音文件：`temp1.txt`、`temp2.txt`、`terminal.ts.bak`、`fix-input-event.mjs`、`patch-init.py`、`replace-init.mjs`、`nul` 等。

### 1.3 现状验证
1. 已执行：`pnpm --dir apps/windows typecheck`。
2. 结果：失败，且错误来源包含上面 1.2 中新增/改坏的文件，当前分支不满足“可持续迭代”前提。

## 2. 目标与边界

### 2.1 目标
1. 在保持 CyDeck Terminal 现有核心能力可用的前提下，移除不需要的 OpenClaw 代码路径。
2. 落地可复用的 CyDeck 配置系统（优先复用 OpenClaw 的路径解析与环境变量替换思想，而不是整套大配置）。
3. 提供可用的 `/config` 管理命令（查看、校验、设置、重置、路径查询）。
4. 网关改造为“可控且可验证”的内嵌方案，不破坏消息链路。

### 2.2 用户已明确决策
1. Chat Window / Invoke Window：完全移除。
2. Gateway：内嵌。
3. AI 聊天（非命令消息）：保留。
4. OpenClaw workspace/config 灵魂：优先复用。

### 2.3 非目标
1. 不重写 `src/orchestration` 全部能力。
2. 不做跨平台（macOS/mobile）统一重构。
3. 不引入新的外部配置服务。

## 3. 分阶段执行计划

## Phase 0：稳定基线（先修可构建性）
1. 建立 `GatewayLike` 接口（`start/stop/restart/getState/getAuthToken/isRunning/rotateAuthToken/on/off`），统一 `index.ts`、`ipc.ts`、`tray.ts`、`terminal-ipc.ts` 依赖。
2. 先让编译链可运行，再继续功能新增。
3. 清理明确无业务价值的临时文件。

交付物：
1. 基线构建通过（至少 `apps/windows` 可 build/typecheck 到可接受状态）。
2. 无半成品入口（例如调用不存在函数）。

## Phase 1：CyDeck 配置模块（提取并简化）
1. 新建 `apps/windows/src/main/cydeck-config.ts`（放主进程，避免 renderer 直接访问磁盘）。
2. 复用 OpenClaw 思路：
   1. 路径优先级：`CYDECK_CONFIG_PATH` -> `CYDECK_STATE_DIR/cydeck.json` -> 默认用户目录。
   2. `${ENV_VAR}` 替换（参考 `src/config/env-substitution.ts` 的严格行为）。
   3. 最小默认配置：`ai`、`workspace`、`gateway`、`ui`。
3. 加入最小校验器：必填字段、provider 枚举、端口范围、workspace 路径合法性。

交付物：
1. `load/save/validate/getEffectiveConfig` 稳定 API。
2. 失败路径返回结构化错误，不吞错。

## Phase 2：`/config` UI 命令 + IPC
1. 新增 IPC：`terminal:config-get`、`terminal:config-set`、`terminal:config-validate`、`terminal:config-reset`、`terminal:config-path`。
2. 在 `command-handler.ts` 实现：
   1. `/config` 显示摘要。
   2. `/config show`。
   3. `/config set <key> <value>`。
   4. `/config validate`。
   5. `/config reset`。
3. 输出风格与现有终端 UI 一致（系统色、成功/错误提示）。

交付物：
1. `/config` 命令可用且可恢复。
2. 配置错误有可读提示。

## Phase 3：内嵌 Gateway 收敛
1. `EmbeddedGateway` 只保留 CyDeck 必需协议面（`connect`、`chat.send`、事件流）。
2. 明确 token 校验、会话隔离、异常关闭、状态机变迁。
3. 补充兼容：保持 `TerminalGatewayClient` 现有调用习惯不变。

交付物：
1. 文本消息链路稳定（连接、流式返回、异常恢复）。
2. 不再依赖外部 Gateway 进程。

## Phase 4：OpenClaw 冗余收口
1. 删除已废弃路径：`apps/windows/src/main/window.ts`、不再使用的 IPC window 事件。
2. 清理无效引用和死代码。
3. 最终输出“保留的 OpenClaw 依赖清单”。

交付物：
1. 明确的保留/移除清单。
2. 回归结果全部通过。

## 4. 测试设计

## 4.1 自动化测试
1. 单元测试：配置路径解析。
2. 单元测试：`${ENV}` 替换与缺失变量报错。
3. 单元测试：配置校验（非法 provider、非法端口、空 key）。
4. 单元测试：`/config` 参数解析。
5. 集成测试：IPC 配置读写。
6. 集成测试：`EmbeddedGateway` 的 connect/chat.send 基本回路。

建议落地文件：
1. `apps/windows/src/main/cydeck-config.test.ts`
2. `apps/windows/src/main/embedded-gateway.test.ts`
3. `apps/windows/src/terminal/command-handler.config.test.ts`

## 4.2 手工回归矩阵（必须逐项勾选）
1. 启动应用后托盘正常，`Ctrl+Shift+T` 可开关终端。
2. `!echo hello`、`!git status` 正常。
3. 普通文本消息可触发 AI 回复。
4. `/spawn`、`/agents list`、`/tasks`、`/context summary` 不回归。
5. `/config show`、`/config set`、`/config validate`、`/config reset` 可用。
6. 重启应用后配置持久化正确。

## 4.3 执行命令（每阶段最少）
1. `pnpm --dir apps/windows typecheck`
2. `pnpm --dir apps/windows build`
3. 若新增测试：`pnpm --dir apps/windows test`（或 `vitest <target>`）

## 5. 验证与验收标准

## 5.1 功能验收
1. 不存在 Chat Window / Invoke Window 入口与快捷键。
2. 内嵌 Gateway 可稳定服务聊天。
3. `/config` 全链路可用。
4. 既有 Terminal 能力不回归。

## 5.2 代码验收
1. `apps/windows` 无悬空调用、无明显死代码。
2. 依赖边界清晰：只保留 CyDeck 必需的 OpenClaw 模块引用。
3. 无临时文件与备份文件进入最终提交。

## 5.3 运行验收
1. 冷启动与重启稳定。
2. 错误提示可读且可定位。
3. token/配置读取路径符合预期。

## 6. 风险与回滚

1. 风险：内嵌 Gateway 协议实现偏差导致渲染端握手失败。  
   对策：先做协议最小闭环测试，再切默认路径。
2. 风险：配置写入权限或路径不一致。  
   对策：在 `/config path` 显示实际路径，并在写入失败时返回系统错误。
3. 风险：清理冗余时误删仍被引用模块。  
   对策：删除前先 `rg` 全仓引用并执行构建。
4. 回滚策略：每个 Phase 独立提交，若回归仅回退最近 Phase。

## 7. 下一步执行顺序（接管后）

1. 先完成 Phase 0，把当前分支恢复到可构建。
2. 再做 Phase 1 与 Phase 2，把配置系统与 `/config` 一次打通。
3. 最后做 Phase 3 与 Phase 4，完成内嵌网关收敛与冗余清理。
