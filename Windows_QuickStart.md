# OpenClaw Windows 快速上手

> 在 Windows 上运行 OpenClaw：Dashboard → Gateway → Agent → Model

---

## 前置要求

- **Node.js** 18+
- **pnpm**（或使用 npm）
- **PowerShell** 或 **CMD**

---

## 五分钟快速开始

### 1️⃣ 安装依赖

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm install
```

### 2️⃣ 生成 Gateway Token

```powershell
pnpm openclaw config set gateway.auth.mode token
pnpm openclaw config set gateway.mode local
pnpm openclaw doctor --generate-gateway-token
pnpm openclaw config get gateway.auth.token
```

**复制输出的 token**，后面会用。

### 3️⃣ 配置模型 API Key

**选一个你有的：**

```powershell
# OpenAI
pnpm openclaw models auth paste-token --provider openai

# Google Gemini
pnpm openclaw models auth paste-token --provider google

# Anthropic Claude
pnpm openclaw models auth paste-token --provider anthropic
```

### 4️⃣ 启动服务

**方式 A：双击启动脚本**（最简单）

```
双击 start-gateway.bat
```

**方式 B：命令行启动**

```powershell
pnpm run gateway
```

### 5️⃣ 打开 Dashboard

**新开一个终端：**

```powershell
pnpm openclaw dashboard
```

### 6️⃣ 连接 Gateway

在浏览器中：
1. 打开 `http://localhost:3000`（Dashboard 会自动打开）
2. 找到 Gateway 连接配置：
   - **Gateway URL**: `ws://127.0.0.1:18789`
   - **Gateway Token**: 粘贴第 2 步获取的 token
3. 点击 **Connect**

---

## 常见问题速查表

| 问题 | 解决方案 |
|------|----------|
| 发消息没反应 | 检查 [网络代理](#网络代理配置) |
| `disconnected (1008)` | Token 不对，重新生成 |
| `No API key found` | 配置 API Key |
| 端口被占用 | `taskkill /F /IM node.exe` |
| PowerShell 乱码 | 已自动处理，无需操作 |

---

## 详细配置

### 网络代理配置

**如果你在国内，或者使用 VPN**，需要配置代理：

```powershell
# 查看你的代理端口（常见：7890, 10808, 10809）
netstat -an | findstr "LISTEN" | findstr "7890"

# 启动时设置代理
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
pnpm run gateway
```

**或编辑** `start-gateway.bat`，修改端口号后双击运行。

### 禁用流式输出

如果你希望消息一次性显示，不跳动：

编辑 `.openclaw/openclaw.json`：

```json
{
  "agents": {
    "defaults": {
      "models": {
        "google/gemini-3-flash-preview": {
          "streaming": false
        }
      }
    }
  }
}
```

---

## 运维命令

```powershell
# 查看日志
pnpm openclaw logs --limit 50 --plain

# 停止 gateway
pnpm run gateway stop
# 或
taskkill /F /IM node.exe

# 重新编译（修改代码后）
pnpm run build

# 查看模型状态
pnpm openclaw models status --plain
```

---

## 完整初始化脚本（一次性执行）

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm install
pnpm openclaw config set plugins.slots.memory none
pnpm openclaw config set gateway.auth.mode token
pnpm openclaw config set gateway.mode local
pnpm openclaw doctor --generate-gateway-token
pnpm openclaw config get gateway.auth.token
pnpm run build
```

---

## 需要帮助？

- **查看日志**：`pnpm openclaw logs --limit 100`
- **检查状态**：`pnpm openclaw doctor`
- **重置配置**：删除 `C:\Users\xforg\.openclaw` 目录后重新配置
