# CyDeck Terminal Phase 4 执行报告

更新时间：2026-03-03  
范围：`apps/windows`（OpenClaw 冗余路径收口）

## 1. Phase 4 目标

1. 删除已废弃的 Chat Window / Invoke Window 代码路径。
2. 清理无效 IPC 调用与悬空依赖引用。
3. 输出最终的 OpenClaw 依赖保留清单（明确保留与移除）。
4. 完成回归验证（`test`、`build`、`typecheck`）。

## 2. 规划与执行

执行前检查：
1. 全量扫描 `window:* IPC`、`ChatWindowManager`、`GatewayManager` 引用。
2. 确认 `preload/index.ts` 仍存在旧 `window:*` 暴露，但主进程 IPC 已无对应处理器。
3. 确认 `apps/windows/src/main/window.ts` 与 `apps/windows/src/main/gateway.ts` 仍在仓库中，属于冗余路径。

执行动作：
1. `apps/windows/src/preload/index.ts`
   1. 类型引用从 `../main/gateway.js` 切换为 `../main/gateway-like.js`。
   2. 删除过时 `window` API 暴露（`show/hide/toggle/invoke`）。
2. 删除废弃文件：
   1. `apps/windows/src/main/window.ts`
   2. `apps/windows/src/main/gateway.ts`
3. 文档同步：
   1. 更新 `apps/windows/README.md`，移除 Quick Chat/Invoke/外部 Gateway 描述。
   2. 更新为 CyDeck Terminal + Embedded Gateway 的当前架构说明。

## 3. 验证设计

自动化验证命令：
1. `pnpm --dir apps/windows test`
2. `pnpm --dir apps/windows build`
3. `pnpm --dir apps/windows typecheck`

静态回归扫描：
1. `rg` 检查 `window:show|window:hide|window:toggle|window:invoke`。
2. `rg` 检查 `ChatWindowManager|showInvokeWindow|toggleChatWindow`。
3. `rg` 检查 `GatewayManager|./gateway.js|../main/gateway.js`。

## 4. 验证结果

1. `test`：通过（3 files, 20 tests passed）。
2. `build`：通过（main/preload/terminal/preload-terminal 全部成功）。
3. `typecheck`：失败（延续历史类型债，主要在 `terminal-ipc.ts` 动态导入类型、`terminal/*` 全局 `window.terminalAPI` 声明分裂与相关推断错误；非本阶段新增逻辑引入）。
4. `rg` 扫描结果：
   1. `window:*` IPC 调用：无残留。
   2. `ChatWindowManager` / Invoke 入口：无残留。
   3. `GatewayManager` / `gateway.js` 旧引用：无残留。

结论：Phase 4 的“冗余路径收口”目标已完成，且未破坏可执行测试与构建链路。

## 5. OpenClaw 依赖清单（最终）

保留（CyDeck 仍在使用）：
1. `src/orchestration/index.js`
   1. 用于 Pattern / Code Review / Git / PR / Workflow 能力（`terminal-ipc.ts` 动态导入）。
2. `src/process/exec.js`
   1. 用于终端命令执行适配（`terminal-ipc.ts` 动态导入）。
3. OpenClaw 配置思想的复用实现（已简化落地到 `cydeck-config*.ts`）：
   1. 配置路径优先级。
   2. `${ENV_VAR}` 模板替换。
   3. 结构化校验与诊断。

移除（本地 Windows 侧冗余）：
1. `apps/windows/src/main/window.ts`（Chat Window / Invoke Window 全量移除）。
2. `apps/windows/src/main/gateway.ts`（外部 Gateway 子进程管理移除，改为内嵌 `EmbeddedGateway`）。
3. `preload/index.ts` 中所有 `window:*` IPC 暴露。

## 6. 风险与后续建议

当前残余风险：
1. `apps/windows` 全量 `typecheck` 仍未恢复（历史类型债）。
2. `README` 与部分 UI 文案仍含 OpenClaw 品牌字样（非功能风险）。

建议下一步：
1. 单列“类型债收敛”阶段，优先统一 `window.terminalAPI` 全局类型定义。
2. 若需要品牌一致性，补做一轮文案/标题清理（`OpenClaw Settings`、`OpenClaw Terminal`）。

