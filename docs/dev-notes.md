# Desktop MVP 瘦身改造：Baseline 运行记录

记录时间：2026-02-07
仓库：`openclaw/openclaw`

## 1) 从 README 确认的启动/构建方式

- 安装依赖：`pnpm install`
- 构建 UI：`pnpm ui:build`
- 构建产物：`pnpm build`
- 开发启动：`pnpm dev` 或 `pnpm openclaw ...`
- 首次引导：`pnpm openclaw onboard --install-daemon`

## 2) 本机环境与实际执行

- `node -v` => `v22.21.0`
- `corepack pnpm -v` => `10.23.0`
- 已补充用户级 `pnpm` shim，`pnpm -v` 可直接使用

## 3) Baseline 验证记录

### 3.1 安装依赖

- 命令：`corepack pnpm install`
- 结果：成功

### 3.2 构建（按仓库脚本）

- 命令：`corepack pnpm build`
- 结果：失败
- 失败原因：脚本内部调用裸 `pnpm ...`，当前环境未直接提供 `pnpm` 命令。

### 3.3 构建（手动等效主流程）

- 命令：`corepack pnpm exec tsdown`
- 结果：成功（`dist/*` 正常生成）

补充：`canvas:a2ui:bundle` 在本机 WSL/bash 环境下执行失败（`node: command not found`），该问题与本次 MVP 剪枝目标无关，后续以最小必要构建链路为准继续推进。

### 3.4 测试

- 命令：`corepack pnpm test`
- 结果：失败
- 失败原因：`scripts/test-parallel.mjs` 内调用 `pnpm.cmd`，本机不可解析。

- 命令：`corepack pnpm exec vitest run`
- 结果：执行完成但存在失败用例
- 主要失败类型：
  - Windows 下 symlink 权限（`EPERM: operation not permitted, symlink ...`）
  - 个别 worker 异常退出导致的 Vitest 汇总失败

## 4) Baseline 结论

- 仓库可在本机完成依赖安装，并可通过 `tsdown` 完成核心 TypeScript 构建。
- 当前默认 `pnpm build` / `pnpm test` 在该 Windows 环境存在命令分发问题（脚本内裸 `pnpm` / `pnpm.cmd`），属于环境与脚本兼容问题，非 MVP 核心能力本身不可构建。
- 下一步（Step 1）将进行“第一刀剪枝”：移除非 MVP 模块并同步修复引用，目标是保证瘦身后构建可通过。

## 5) MVP 阶段验收策略（当前执行）

- 优先“可用验收”而非全量单测全绿：`pnpm check` + `pnpm build` + 关键 smoke。
- 关键 smoke（桌面 MVP）：
  - 启动网关/UI（开发模式）
  - 发送 1 条任务消息
  - 确认 event stream（`runId/seq/stream`）可见
  - 确认 tool streaming（`start/update/result` + `toolCallId`）可见
- 对 Windows 下受系统权限影响的 symlink 测试，先做条件跳过，后续在稳定阶段回补兼容性修复。

## 6) Step 1（第一刀剪枝）执行记录

- 采用“禁用优先”策略，先改入口注册，再决定是否物理删目录。
- 已禁用项（桌面 MVP 默认开启）：
  - Gateway 启动阶段禁用 channel sidecars（聊天渠道不启动）
  - Gateway 启动阶段禁用 plugin services（第三方扩展服务不启动）
  - Gateway 插件加载强制 `plugins.enabled=false`（扩展生态入口关闭）
- 现状说明：
  - `apps/` 下仅有 `macos` 与 `shared`，无 `apps/mobile` 目录
  - 仓库 `extensions/` 当前为空
- 本步验证命令：
  - `corepack pnpm exec tsdown`
  - `corepack pnpm build`
