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
- 本文档以“无全局 `pnpm`，仅 `corepack`”环境为准

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

## 7) UI 拉起验证记录（按用户指定顺序）

记录时间：2026-02-07

### 7.1 Step 1：优先尝试裸 `pnpm`

- 执行：`corepack enable` → 失败（权限不足）
- 错误：`EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpm'`
- 再验证：`pnpm -v` → 失败（`pnpm` 未被识别）
- 结论：当前环境无法把全局 shim 写入 `C:\Program Files\nodejs`，裸 `pnpm` 不可用

### 7.2 Step 2：执行 `pnpm install && pnpm ui:build && pnpm dev`

- 原命令执行结果：失败（`pnpm` 未识别）
- 等效替代（可执行）：
  - `corepack pnpm install` ✅
  - `corepack pnpm --dir ui build` ✅
  - `corepack pnpm dev` ❌（脚本内部调用裸 `pnpm`）

`pnpm dev` 关键报错：

```text
[openclaw] Building TypeScript (dist is stale).
'pnpm' is not recognized as an internal or external command,
operable program or batch file.
```

### 7.3 Step 3：若提示缺 daemon/引导则执行 onboard

- 执行：`corepack pnpm openclaw onboard --install-daemon`
- 结果：同样失败于 `scripts/run-node.mjs` 内部裸 `pnpm` 调用（非 daemon 缺失本身）

### 7.4 Step 4：UI 实际可访问地址与关键日志

- UI 启动（替代方式）：`corepack pnpm --dir ui dev --host 127.0.0.1 --port 5173`
- UI 地址：`http://127.0.0.1:5173/`
- UI 日志关键行：

```text
VITE v7.3.1 ready in 365 ms
➜ Local:   http://127.0.0.1:5173/
```

- 网关端口现状：`127.0.0.1:18789` 在监听（已有进程）

## 8) 当前失败栈与建议修复点

- 失败栈 1（`corepack enable`）：
  - `EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpm'`
  - 原因：无权限写入系统 Node 目录

- 失败栈 2（`pnpm dev` / `pnpm openclaw onboard`）：
  - `'pnpm' is not recognized as an internal or external command`
  - 原因：脚本硬编码依赖裸 `pnpm`（非 `corepack pnpm`）

- 建议修复点（最小改动）：
  1. `scripts/run-node.mjs`：将 Windows 分支从 `cmd /c pnpm exec tsdown --no-clean` 改为优先 `corepack pnpm exec tsdown --no-clean`（或检测 `pnpm` 不存在时 fallback 到 `corepack pnpm`）
  2. `scripts/ui.js`：`resolveRunner()` 在找不到 `pnpm` 时，fallback 到 `corepack` + `pnpm` 子命令
  3. 统一仓库脚本策略：文档与脚本都支持“无全局 pnpm，仅 corepack”的环境

## 9) 修复后统一启动命令（无全局 pnpm）

- 安装依赖：`corepack pnpm install`
- 开发链路（gateway + ui）：`corepack pnpm dev`
- 首次引导：`corepack pnpm openclaw onboard --install-daemon`
