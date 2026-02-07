# OpenClaw Windows SetUp (End-to-End)

适用场景：在 Windows PowerShell 本地跑通 OpenClaw Dashboard -> Gateway -> Agent -> Model 的完整链路。

仓库路径：`C:\Users\xforg\Desktop\openclaw`

## 0. 先说结论（你当前卡点）

如果 Dashboard 里“发命令不执行”，最常见是两类问题：

1. 网关连接鉴权失败（`1008 unauthorized: gateway token missing/mismatch`）
2. Agent 没有模型认证（日志里会看到 `No API key found for provider "anthropic"`）

你这次属于第 2 类为主，连接已成功后仍不执行，是因为模型认证缺失。

## 1. 准备环境

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm install
```

## 2. 修复已知配置阻塞（只需一次）

如果执行 `openclaw config set ...` 报：
`Config validation failed: plugins.slots.memory: plugin not found: memory-core`

先执行：

```powershell
pnpm openclaw config set plugins.slots.memory none
```

## 3. 配置 Gateway 鉴权（Dashboard 连接用）

```powershell
pnpm openclaw config set gateway.auth.mode token
pnpm openclaw config set gateway.mode local
pnpm openclaw doctor --generate-gateway-token
pnpm openclaw config get gateway.auth.token
```

期望：
- `gateway.auth.mode` 是 `token`
- `gateway.auth.token` 能读到非空值

### 3.1 token 生成与设置（重点）

在哪个终端执行：
- 在你本机的 PowerShell 终端执行（仓库目录 `C:\Users\xforg\Desktop\openclaw`），不是浏览器控制台。

如何生成：

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm openclaw doctor --generate-gateway-token
pnpm openclaw config get gateway.auth.token
```

如何设置到 Dashboard：
1. 打开 Dashboard 的 `Overview` 页面
2. 在 `Gateway Token` 输入框粘贴上一步输出的 token
3. 点击 `Connect`

如何验证是否真的带上 token：
- 运行：

```powershell
pnpm openclaw logs --limit 120 --plain
```

- 若日志出现 `authProvided:"none"` / `token_missing`，说明前端没带 token（通常是没在 Overview 点 Connect 或本地缓存脏数据）。
- 若 token 正常，连接后不应再出现上面的 missing 提示。

## 4. 配置模型认证（Agent 执行用，关键）

你可以选其一：

### 方案 A：交互式（推荐）

```powershell
pnpm openclaw models auth add
```

按提示选择 provider（例如 `anthropic`），再粘贴 token。

### 方案 B：直接粘贴 token（更可控）

```powershell
pnpm openclaw models auth paste-token --provider anthropic
```

重要：这一步只会写入认证资料，不会自动切换默认模型。
如果你想改用 OpenAI，需要再执行 `models set`。

例如：

```powershell
pnpm openclaw models auth paste-token --provider openai
pnpm openclaw models set openai/gpt-5-mini
```

然后执行状态检查：

```powershell
pnpm openclaw models status --plain
```

如果 `anthropic` 仍显示 missing/expired，命令不会真正执行。

## 5. 启动网关 + Dashboard

终端 A（保持运行）：

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm openclaw gateway run --bind loopback --port 18789 --force
```

终端 B：

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm openclaw dashboard
```

Dashboard `Overview` 填：
- `Gateway URL`: `ws://127.0.0.1:18789`
- `Token`: 第 3 步拿到的 `gateway.auth.token`
- 点击 `Connect`

## 6. 验证链路是否真的通了

先在聊天里发无副作用命令，例如：
- `pwd`
- `dir C:\Users\xforg\Desktop\openclaw`

同时在终端 C 看日志：

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm openclaw logs --limit 200 --plain
```

判定标准：
- 若看到 `No API key found for provider "anthropic"`：模型认证没配好，回到第 4 步。
- 若看到 `token missing` / `token_mismatch`：Dashboard token 不一致，回到第 3 步并清理浏览器缓存。

## 7. Dashboard 侧常见故障

### 7.1 `disconnected (1008): unauthorized: gateway token missing`

处理：
1. 确认用的是 `pnpm openclaw config get gateway.auth.token` 的值
2. 清掉旧缓存后重连（浏览器 DevTools Console）：

```js
localStorage.removeItem("openclaw.control.settings.v1")
```

3. 刷新页面，重新粘贴 token，点 Connect

4. 可选快速导入 token（通过 URL，仅本机调试建议）：

```text
http://127.0.0.1:18789/?token=<你的gateway.auth.token>
```

打开后 token 会导入到 UI 设置，再点 `Connect`。

### 7.2 发消息后排队不执行

优先看 `pnpm openclaw logs --plain`，基本都能定位到：
- 模型认证缺失/过期
- provider 不可用
- agent 配置异常

如果日志或会话里反复出现 `Request timed out.`（且 `usage` 基本为 0），通常不是“命令本身失败”，而是模型请求在网络层没有真正连通（常见是到 `api.openai.com:443` 连接超时）。

### 7.3 已配置 OpenAI token，但仍显示 `anthropic/claude-opus-4-6`

原因：默认模型还在 `anthropic`，而不是认证写入失败。

处理：

```powershell
pnpm openclaw models set openai/gpt-5-mini
pnpm openclaw models status --json
```

确认点：
- `defaultModel` 应为 `openai/...`
- `missingProvidersInUse` 不应再包含 `anthropic`

## 8. 源码里“模型认证脚本/入口”在哪里

### CLI 入口（Windows 主路径）
- `src/cli/models-cli.ts`
- `src/commands/models/auth.ts`
- `src/commands/models/auth-order.ts`

你会用到的命令主要是：
- `pnpm openclaw models auth add`
- `pnpm openclaw models auth login --provider <id>`
- `pnpm openclaw models auth setup-token --provider anthropic`
- `pnpm openclaw models auth paste-token --provider <id>`
- `pnpm openclaw models status --plain`

### 自动化脚本（主要用于 Linux/服务器，不是 Windows 必须）
- `scripts/setup-auth-system.sh`
- `scripts/claude-auth-status.sh`
- `scripts/auth-monitor.sh`
- `scripts/mobile-reauth.sh`
- `scripts/systemd/openclaw-auth-monitor.service`
- `scripts/systemd/openclaw-auth-monitor.timer`
- `scripts/termux-quick-auth.sh`
- `scripts/termux-auth-widget.sh`

说明：这些脚本依赖 bash/systemd/termux（如 `systemctl`, `termux-*`），Windows 本地一般不直接使用。

## 9. 最小可执行命令清单（复制即用，含作用说明）

```powershell
# 进入仓库目录（后续命令都在这里执行）
cd C:\Users\xforg\Desktop\openclaw

# 安装依赖，确保 CLI/网关/前端命令能跑
pnpm install

# 解除已知配置校验阻塞（memory-core 缺失时必须先做）
pnpm openclaw config set plugins.slots.memory none

# 启用网关 token 鉴权（Dashboard 连接网关需要）
pnpm openclaw config set gateway.auth.mode token

# 让网关以本地模式运行（本机 loopback）
pnpm openclaw config set gateway.mode local

# 生成并写入 gateway token（供 Dashboard 粘贴）
pnpm openclaw doctor --generate-gateway-token

# 写入模型 provider 的认证 token（示例：anthropic；如需 openai 改 provider 即可）
pnpm openclaw models auth paste-token --provider anthropic

# 切换默认模型到有认证的 provider（否则仍可能继续使用 anthropic）
pnpm openclaw models set openai/gpt-5-mini

# 检查模型认证状态，确认 provider 不再 missing/expired
pnpm openclaw models status --plain

# 设置代理（替换为你的代理地址）
  $env:HTTP_PROXY="http://127.0.0.1:7890"
  $env:HTTPS_PROXY="http://127.0.0.1:7890"


pnpm run build

# 启动网关服务（保持该终端常驻）
pnpm openclaw gateway run --bind loopback --port 18789 --force
```

另开一个终端：

```powershell
# 启动 Dashboard（在网页里填 ws://127.0.0.1:18789 + 第 6 步生成的 token）
cd C:\Users\xforg\Desktop\openclaw
pnpm openclaw dashboard
```

## 10. 深度排查：`Request timed out.` 但 token 看起来都对

这个场景下，要先确认是否是网络连通性问题（而不是 UI 或工具事件问题）。

### 10.1 直接测到 OpenAI 的 TCP/HTTPS 连通

```powershell
Test-NetConnection api.openai.com -Port 443
```

判定：
- `TcpTestSucceeded: True`：基础连通正常。
- `TcpTestSucceeded: False`：本机到 OpenAI 出口不通（代理/防火墙/网络策略问题），此时 Dashboard 一定会表现为"发消息不执行或一直转圈"。

### 10.2 用 Node 原生 fetch 复现连接超时（可选）

```powershell
node -e "fetch('https://api.openai.com/v1/models').catch(e=>{console.error(e?.cause?.code,e?.cause?.message||e.message)})"
```

若输出 `UND_ERR_CONNECT_TIMEOUT`，说明是网络连接超时，不是 OpenClaw token 配置错误。

### 10.3 为什么 `models status --probe` 可能误导

`models status --probe` 目前可能在某些超时场景下显示 `status: ok`，但实际对话仍会 `Request timed out.`。
原因是 probe 只看"调用是否抛异常"，而某些超时会以普通 assistant 错误消息返回（未抛异常）。

实操建议：
- 以真实对话回路为准（Dashboard Chat 或 `pnpm openclaw agent --local --message "回复 ok"`）。
- 一旦看到连续 `Request timed out.`，优先排查网络到 `api.openai.com:443`。

## 11. 重启网关服务（开发调试常用）

### 11.1 停止当前运行的网关

当端口被占用或需要重启服务时：

```powershell
# 方法1：使用 pnpm 停止（推荐）
pnpm run gateway stop

# 方法2：如果方法1不可用，直接结束进程
taskkill /PID <进程ID> /F
```

### 11.2 重新启动网关

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm run dev
```

### 11.3 常见错误处理

**错误提示**：
```
Gateway failed to start: gateway already running (pid 3968)
Port 18789 is already in use.
```

**处理方法**：
1. 执行 `pnpm run gateway stop` 停止旧服务
2. 或执行 `taskkill /PID 3968 /F` 强制结束进程（替换 3968 为实际进程ID）
3. 重新执行 `pnpm run dev` 启动服务
