# CyDeck Terminal Phase 5 执行报告

更新时间：2026-03-03  
范围：`apps/windows`（TypeScript 类型债一次性收敛）

## 1. 目标

1. 将 `apps/windows` 的 `typecheck` 从失败收敛到通过。
2. 统一 `window.terminalAPI` 全局类型来源，消除声明分裂。
3. 修复 `terminal-ipc` 的隐式 `any` 与动态导入类型问题。
4. 修复剩余业务类型错误，不改变既有功能行为。

## 2. 修复策略

1. 全局类型收敛优先：把 `Window.terminalAPI` 声明收敛到单一 `d.ts` 文件。
2. 模块导入问题次之：将 `terminal-ipc` 的外部动态导入改为 helper 包装，避免 `TS2307`。
3. 局部业务类型最后处理：修复具体行的联合类型/返回字段不匹配。

## 3. 代码改动

1. 新增统一全局声明：
   1. `apps/windows/src/terminal/global.d.ts`
   2. 定义唯一 `Window.terminalAPI: TerminalAPI`。
2. 移除重复/冲突声明：
   1. `apps/windows/src/terminal/command-handler.ts`
   2. `apps/windows/src/terminal/orchestral-commands.ts`
   3. `apps/windows/src/terminal/terminal.ts`
   4. `apps/windows/src/terminal/sidebar.ts`
3. `terminal-ipc` 类型与动态导入修复：
   1. 新增 `importOrchestrationModule` / `importProcessExecModule` helper。
   2. 补充 `AgentTask`、`PatternRecommendation` 等本地类型。
   3. 修复 `orchestral-tasks` 里的 filter/sort/map 隐式 `any`。
4. 业务类型修复：
   1. `windows-agent-manager.ts`：`clearCompletedTasks` 状态判断与实际状态枚举对齐。
   2. `terminal.ts`：状态栏 tasks 文本与命令面板空值类型修复。
   3. `command-handler.ts`：`contextSearch` 联合类型字段访问改为安全 narrowing；`workflowRun` 使用 `result.result`。
   4. `preload/terminal-api.ts`：review comment `severity` 改为字面量联合类型。
   5. `orchestral-commands.ts`：`/tasks show` 调用修正为 `setHideCompletedTasks()`。

## 4. 验证结果

执行命令：
1. `pnpm --dir apps/windows typecheck`
2. `pnpm --dir apps/windows test`
3. `pnpm --dir apps/windows build`

结果：
1. `typecheck`：通过（`tsc --noEmit` 零错误）。
2. `test`：通过（3 files, 20 tests passed）。
3. `build`：通过（main / preload / terminal / preload-terminal 均成功）。

## 5. 结论

Phase 5 目标已完成：`apps/windows` 类型检查恢复为可持续状态，且测试与构建链路均保持通过。

