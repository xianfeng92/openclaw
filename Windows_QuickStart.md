# OpenClaw Windows 快速上手

> 在 Windows 上运行 OpenClaw：Dashboard → Gateway → Agent → Model

---

## 前置要求

- **Node.js** 18+
- **包管理器**：pnpm（推荐）或 npm
- **PowerShell** 或 **CMD**

> **如果 `pnpm` 命令不可用**，见下方 [故障排除](#pnpm-命令未找到)

---

## 推荐启动路径（最短闭环）

> 这是验证 OpenClaw 正常工作的最快方式，按顺序执行即可。

### 终端 A：启动 Gateway

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm run gateway
```

**✅ 确认启动成功**：看到类似以下日志
```
[gateway] listening on ws://127.0.0.1:19001
```

**⚠️ 端口说明**：端口可能因模式（slim/dev）不同而变化，**以日志中 `listening on ws://...` 为准**。

---

### 终端 B：启动 Dashboard

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm openclaw dashboard
```

**✅ 确认启动成功**：浏览器自动打开 `http://localhost:3000`

---

### 连接 Gateway

在 Dashboard 中：
1. 找到 Gateway 连接配置
2. **Gateway URL**: 填写日志中的地址，例如 `ws://127.0.0.1:19001`（**以启动日志为准**）
3. **Gateway Token**: 填写你的 token（首次配置见下方）
4. 点击 **Connect**

**✅ 确认连接成功**：Dashboard 显示 "Connected" 状态

---

### 首次配置（只需一次）

如果还没有配置过，执行以下步骤：

#### 1. 安装依赖

```powershell
cd C:\Users\xforg\Desktop\openclaw
pnpm install
```

#### 2. 配置 Gateway

```powershell
pnpm openclaw config set gateway.auth.mode token
pnpm openclaw config set gateway.mode local
pnpm openclaw doctor --generate-gateway-token
pnpm openclaw config get gateway.auth.token
```

**复制输出的 token**，连接 Dashboard 时需要。

#### 3. 配置模型 API Key

```powershell
# OpenAI
pnpm openclaw models auth paste-token --provider openai

# Google Gemini
pnpm openclaw models auth paste-token --provider google

# Anthropic Claude
pnpm openclaw models auth paste-token --provider anthropic
```

#### 4. 编译项目

```powershell
pnpm run build
```

---

## 测试验证

发送一条**必须触发工具**的测试消息，例如：

> "当前目录下有什么文件？"

**✅ 成功标志**：
- Agent 读取了目录
- Dashboard 显示文件列表

---

## 常见问题速查表

| 问题 | 解决方案 |
|------|----------|
| 发消息没反应 | 检查 [网络代理配置](#网络代理配置) |
| `disconnected (1008)` | Token 不对，重新生成 |
| `No API key found` | 配置 API Key |
| 端口被占用 | `taskkill /F /IM node.exe` |
| 端口不是 18789/19001 | **以启动日志为准**，使用日志中的地址 |
| 连接后没反应 | 检查模型 API Key 是否有效 |
| `pnpm` 命令不可用 | 使用 `corepack pnpm` 或 `npm` 替代 |

---

## pnpm 命令未找到

**症状**：
```
'pnpm' 不是内部或外部命令
corepack enable: EPERM: operation not permitted
```

**解决方案**（三选一）：

**方案 A**：管理员运行 corepack enable
```powershell
# 右键 PowerShell → "以管理员身份运行"
corepack enable
```

**方案 B**：使用 corepack pnpm 前缀
```powershell
corepack pnpm install
corepack pnpm run gateway
```

**方案 C**：使用 npm 替代
```powershell
npm install
npm run build
npm run gateway
```

---

## 网络代理配置

**如果你在国内，或者使用 VPN**，需要配置代理：

```powershell
# 查看你的代理端口（常见：7890, 10808, 10809）
netstat -an | findstr "LISTEN" | findstr "7890"

# 启动时设置代理
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
pnpm run gateway
```

**或使用启动脚本**：编辑 `start-gateway.bat` 修改端口号后双击运行。

---

## 其他启动方式

### 使用启动脚本（带代理）

```batch
start-gateway.bat
```

### 开发模式

```powershell
pnpm dev
```

---

## 运维命令

```powershell
# 查看日志
pnpm openclaw logs --limit 50 --plain

# 停止 gateway
taskkill /F /IM node.exe

# 重新编译（修改代码后）
pnpm run build

# 查看模型状态
pnpm openclaw models status --plain
```

---

## 需要帮助？

- **查看日志**：`pnpm openclaw logs --limit 100`
- **检查状态**：`pnpm openclaw doctor`
- **详细文档**：[Windows_SetUp.md](Windows_SetUp.md)
