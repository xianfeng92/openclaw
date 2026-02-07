# OpenClaw Windows 设置指南

在 Windows PowerShell 本地运行 OpenClaw Dashboard -> Gateway -> Agent -> Model 的完整链路。

仓库路径：`C:\Users\xforg\Desktop\openclaw`

---

## 快速诊断

如果 Dashboard 里"发消息不执行"，最常见问题是：

| 问题症状 | 可能原因 | 解决方案 |
|---------|---------|---------|
| `disconnected (1008): unauthorized` | Gateway token 缺失/不匹配 | 第 3 节 |
| `No API key found for provider` | 模型认证未配置 | 第 4 节 |
| `Request timed out` / `fetch failed` | 网络无法访问 API | 第 6 节（使用代理） |
| 端口被占用 | 旧进程未停止 | 第 8 节 |
| `buffer has text: false` | 代理未配置或端口错误 | 检查代理设置 |

---

## 1. 准备环境

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm install
```

---

## 2. 修复已知配置问题（只需一次）

如果执行 `openclaw config set ...` 报错：
```
Config validation failed: plugins.slots.memory: plugin not found: memory-core
```

先执行：

```powershell
pnpm openclaw config set plugins.slots.memory none
```

---

## 3. 配置 Gateway 鉴权

### 3.1 生成 Token

```powershell
cd C:\Users\xforg\Desktop\openclaw

# 启用 token 鉴权模式
pnpm openclaw config set gateway.auth.mode token

# 设置本地模式
pnpm openclaw config set gateway.mode local

# 生成 gateway token
pnpm openclaw doctor --generate-gateway-token

# 查看 token（复制保存）
pnpm openclaw config get gateway.auth.token
```

### 3.2 连接 Dashboard

1. 打开 Dashboard 的 `Overview` 页面
2. `Gateway URL`: 填 `ws://127.0.0.1:18789`
3. `Gateway Token`: 粘贴上一步获取的 token
4. 点击 `Connect`

### 3.3 验证连接

```powershell
pnpm openclaw logs --limit 50 --plain
```

- 若日志出现 `authProvided:"none"` / `token_missing` → token 未正确传递，清理浏览器缓存重试
- 若无错误提示 → 连接成功

---

## 4. 配置模型认证

### 4.1 方式一：交互式添加（推荐）

```powershell
pnpm openclaw models auth add
```

按提示选择 provider（如 `anthropic`、`openai`），粘贴 API key。

### 4.2 方式二：直接粘贴 Token

```powershell
# OpenAI
pnpm openclaw models auth paste-token --provider openai
pnpm openclaw models set openai/gpt-4o-mini

# Anthropic Claude
pnpm openclaw models auth paste-token --provider anthropic
pnpm openclaw models set anthropic/claude-opus-4-6
```

### 4.3 验证认证状态

```powershell
pnpm openclaw models status --plain
```

确认：
- `defaultModel` 显示你设置的模型
- 没有显示 `missing` 或 `expired` 的 provider

---

## 5. 启动服务

### 5.1 方式一：使用启动脚本（推荐）

如果需要使用代理（VPN），直接双击运行：

```batch
start-gateway.bat
```

或在命令行：

```cmd
start-gateway.bat
```

### 5.2 方式二：直接启动 Gateway

**不需要代理时：**

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm run gateway
```

**需要代理时（PowerShell）：**

```powershell
cd C:\Users\xforg\Desktop\openclaw
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
pnpm run gateway
```

保持此终端运行。

### 5.2 终端 B：启动 Dashboard

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm openclaw dashboard
```

---

## 6. 网络代理配置（如需要）

### 6.1 问题说明

Node.js 不会自动使用系统代理或 VPN。如果你的网络需要通过代理访问 API（如 Google、OpenAI 等），必须手动配置代理环境变量。

**常见症状**：
- `Request timed out`
- `fetch failed sending request`
- 可以访问 `api.venice.ai` 但无法访问 `generativelanguage.googleapis.com`

### 6.2 使用启动脚本（推荐）

项目提供了带代理配置的启动脚本：

```batch
# 直接双击运行，或命令行执行：
start-gateway.bat
```

脚本默认代理端口为 `7890`（Clash 等常见代理软件的默认端口）。如果你的代理使用不同端口，编辑 `start-gateway.bat` 修改端口号。

### 6.3 手动配置代理

如果不想使用启动脚本，可以手动设置环境变量：

**PowerShell：**
```powershell
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
pnpm run gateway
```

**CMD：**
```cmd
set HTTP_PROXY=http://127.0.0.1:7890
set HTTPS_PROXY=http://127.0.0.1:7890
npm run gateway
```

### 6.4 验证代理配置

```powershell
# 测试 Google API 连接（通过代理）
curl --proxy "http://127.0.0.1:7890" -s "https://generativelanguage.googleapis.com/v1beta/models"

# 测试 OpenAI API 连接（通过代理）
curl --proxy "http://127.0.0.1:7890" -s "https://api.openai.com/v1/models"
```

### 6.5 常见代理端口

| 软件 | 默认端口 |
|-----|---------|
| Clash | 7890 |
| Clash (另一个) | 10808, 10809 |
| V2RayN | 10809 |
| 其他 | 查看 VPN 软件设置 |

### 6.6 检查本地代理端口

```powershell
# 查看监听中的端口
netstat -an | findstr "LISTEN" | findstr "7890 10808 10809"
```

---

## 7. 常见问题排查

### 7.1 网络连通性测试

```powershell
# 测试 OpenAI API 连接
Test-NetConnection api.openai.com -Port 443

# 测试 Anthropic API 连接
Test-NetConnection api.anthropic.com -Port 443
```

- `TcpTestSucceeded: True` → 网络正常
- `TcpTestSucceeded: False` → 需要配置代理或 VPN

### 7.2 查看详细日志

```powershell
pnpm openclaw logs --limit 200 --plain
```

### 7.3 清除浏览器缓存

如果连接问题持续，在浏览器 DevTools Console 执行：

```javascript
localStorage.removeItem("openclaw.control.settings.v1")
```

然后刷新页面重新连接。

---

## 8. 重启网关服务

### 8.1 停止运行的网关

```powershell
# 方法1：使用 pnpm
pnpm run gateway stop

# 方法2：强制结束进程（替换 PID 为实际进程ID）
taskkill /PID 3968 /F
```

### 8.2 重新编译并启动

修改代码后需要重新编译：

```powershell
cd C:\Users\xforg\Desktop\openclaw

# 停止旧服务
pnpm run gateway stop

# 重新编译
pnpm run build

# 重新启动
pnpm openclaw gateway run --bind loopback --port 18789 --force
```

### 8.3 常见端口占用错误

```
Gateway failed to start: gateway already running (pid 3968)
Port 18789 is already in use.
```

**解决方法**：
1. 执行 `taskkill /PID 3968 /F`（替换 3968 为实际 PID）
2. 重新启动网关

---

## 9. 完整命令清单（复制即用）

```powershell
# ========== 初始化配置 ==========
cd C:\Users\xforg\Desktop\openclaw
pnpm install
pnpm openclaw config set plugins.slots.memory none
pnpm openclaw config set gateway.auth.mode token
pnpm openclaw config set gateway.mode local

# ========== 生成 Gateway Token ==========
pnpm openclaw doctor --generate-gateway-token
pnpm openclaw config get gateway.auth.token

# ========== 配置模型认证（选一个） ==========
# OpenAI
pnpm openclaw models auth paste-token --provider openai
pnpm openclaw models set openai/gpt-5-mini

# Google Gemini
pnpm openclaw models auth paste-token --provider google
pnpm openclaw models set google/gemini-3-flash-preview

# Anthropic
pnpm openclaw models auth paste-token --provider anthropic
pnpm openclaw models set anthropic/claude-opus-4-6

# ========== 验证配置 ==========
pnpm openclaw models status --plain

# ========== 编译 ==========
pnpm run build
```

启动 Gateway（三选一）：

```powershell
# 方式一：使用启动脚本（推荐，自动配置代理）
start-gateway.bat

# 方式二：直接启动（无需代理时）
pnpm run gateway

# 方式三：手动配置代理后启动
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
pnpm run gateway
```

另开终端启动 Dashboard：

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm openclaw dashboard
```

---

## 10. 源码参考

### 模型认证相关源码

- `src/cli/models-cli.ts` - CLI 入口
- `src/commands/models/auth.ts` - 认证命令
- `src/commands/models/auth-order.ts` - 认证流程

### 常用命令

```powershell
pnpm openclaw models auth add              # 交互式添加认证
pnpm openclaw models auth paste-token      # 粘贴 token
pnpm openclaw models status --plain        # 查看认证状态
pnpm openclaw models set <model>           # 设置默认模型
pnpm openclaw models list-providers        # 列出所有 provider
```
