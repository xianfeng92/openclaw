# CyDeck Terminal Phase 1 执行报告

更新时间：2026-03-03  
范围：`apps/windows`（CyDeck 配置模块抽取与主进程接入）

## 1. 目标与完成情况

Phase 1 目标：
1. 建立 CyDeck 专用配置模块。
2. 复用 OpenClaw 的配置路径优先级与环境变量模板替换思路。
3. 提供稳定 API：`load/save/validate/getEffectiveConfig`。
4. 将配置接入主进程启动链路（网关端口、自动启动、工作区）。

完成情况：已完成。

## 2. 设计与实现

## 2.1 配置模块（新建）
文件：`apps/windows/src/main/cydeck-config.ts`

已实现：
1. 配置路径优先级：
   1. `CYDECK_CONFIG_PATH`
   2. `CYDECK_STATE_DIR/cydeck.json`
   3. 默认用户目录下的 `cydeck/cydeck.json`
2. 环境变量模板替换：
   1. 支持 `${ENV_VAR}`（仅大写变量名）
   2. 支持 `$${ENV_VAR}` 转义为字面量 `${ENV_VAR}`
   3. 缺失变量产生结构化诊断（不再静默）
3. 最小配置结构：
   1. `ai`
   2. `workspace`
   3. `gateway`
   4. `ui`
4. 结构化诊断：
   1. `read_failed`
   2. `parse_failed`
   3. `write_failed`
   4. `missing_env_var`
   5. `invalid_field`
   6. `workspace_path_invalid`
   7. `workspace_not_found`
5. 稳定 API：
   1. `loadCyDeckConfig`
   2. `saveCyDeckConfig`
   3. `validateCyDeckConfig`
   4. `getEffectiveConfig`
   5. `getRuntimeProviderConfig`

## 2.2 主进程接入
文件：`apps/windows/src/main/index.ts`

已接入：
1. 启动时读取 `getEffectiveConfig()`。
2. 网关端口优先级：
   1. `OPENCLAW_GATEWAY_PORT` / `OPENCLAW_PORT`
   2. `cydeck.json` 中 `gateway.port`
3. `gateway.autoStart` 生效（可关闭自动启动）。
4. `workspace.autoCreate` 生效（自动创建工作区目录）。
5. 配置诊断输出到日志（error/warn 分级）。

## 2.3 Embedded Gateway 配置化
文件：`apps/windows/src/main/embedded-gateway.ts`

已实现：
1. 支持通过 `runtimeProvider` 注入模型配置（不再只读环境变量）。
2. 对未支持 provider（当前非 `openai`）返回明确不可用原因。
3. 未配置 AI 时 fallback 文案更清晰。
4. 仍保留环境变量 fallback，避免破坏兼容。

## 2.4 测试基础设施
新增：
1. `apps/windows/vitest.config.ts`
2. `apps/windows/package.json` 增加 `test` 脚本

## 2.5 单元测试
新增：
1. `apps/windows/src/main/cydeck-config.test.ts`

覆盖点（7 个用例）：
1. 配置路径优先级（`CYDECK_CONFIG_PATH` > `CYDECK_STATE_DIR`）。
2. 默认路径拼接（`<stateDir>/cydeck.json`）。
3. 缺省配置文件自动创建。
4. `${ENV_VAR}` 替换与 `$${ENV_VAR}` 转义。
5. 缺失环境变量的结构化诊断。
6. 端口范围校验（非法端口报错）。
7. `getEffectiveConfig` 的 workspace 绝对路径解析与告警。

## 3. 验证结果

执行命令：
1. `pnpm --dir apps/windows test`
2. `pnpm --dir apps/windows build`
3. `pnpm --dir apps/windows typecheck`

结果：
1. `test`：通过（1 file, 7 tests passed）。
2. `build`：通过（main/preload/terminal/preload-terminal 全部成功）。
3. `typecheck`：失败，但失败项为既有历史问题，主要集中在：
   1. `src/main/terminal-ipc.ts` 动态导入与 any 类型
   2. `src/terminal/*` 的 `window.terminalAPI` 全局声明与接口不一致
   3. `src/main/windows-agent-manager.ts` 的状态比较类型问题

结论：
1. Phase 1 新增功能已通过独立测试与构建验证。
2. 全量 typecheck 仍需在后续阶段（建议 Phase 2/3）统一清债。

## 4. 风险与后续

当前风险：
1. 非 `openai` provider 尚未在 Embedded Gateway 内实现对应协议适配。
2. 全量 TypeScript 类型债较大，影响后续重构效率。

建议进入 Phase 2 时优先事项：
1. 在 IPC 中补齐配置读写能力：`terminal:config-*`。
2. 实现 `/config` 子命令闭环：`show/set/validate/reset/path`。
3. 逐步收敛 `window.terminalAPI` 类型定义分裂问题，降低 typecheck 噪音。
