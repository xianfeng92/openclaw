# CLI Model 工具使用指南

## 概述

`cli_model` 工具允许 OpenClaw Agent 调用你本地的命令行 AI 工具（如 `claude`、`gpt`），即使你没有它们的 API Key。

## 使用场景

- 你有 `claude` 命令行工具但没有 Anthropic API Key
- 你有 `gpt` 命令行工具但没有 OpenAI API Key
- 想用本地工具替代昂贵的 API 调用

## 前置条件

1. **确保命令行工具可用**

在 PowerShell 7 中测试：
```powershell
claude "hello"
```

2. **PowerShell 7 在 PATH 中**

```powershell
pwsh --version
# 应该显示 7.x.x
```

## 如何使用

### 方式一：在聊天中直接使用

在 OpenClaw Dashboard 或聊天界面中，你可以这样要求 Agent：

```
请用 claude 帮我分析这段代码...
请用 gpt 翻译这段文字...
```

Agent 会自动调用 `cli_model` 工具来执行你的请求。

### 方式二：在 AGENTS.md 中添加说明

编辑你的 workspace 目录中的 `AGENTS.md` 文件，添加：

```markdown
## CLI Model 工具

当用户需要使用 Claude 或 GPT 时，使用 cli_model 工具：

- Claude: action="claude", prompt="用户的问题"
- GPT: action="gpt", prompt="用户的问题"

示例：用户说"用 claude 分析"时，调用 cli_model(action="claude", prompt="分析内容...")
```

## 工具参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| action | string | 是 | `claude` 或 `gpt` |
| prompt | string | 是 | 要发送给 AI 的问题 |

## 示例

```
用户: 用 claude 帮我写一个 Python 函数来反转字符串

Agent 会调用：
cli_model(action="claude", prompt="写一个 Python 函数来反转字符串")
```

## 故障排除

### 问题：命令执行失败

1. **检查 PowerShell 7 是否在 PATH 中**
   ```powershell
   pwsh --version
   ```

2. **检查 claude 命令是否可用**
   ```powershell
   claude "test"
   ```

3. **查看 Gateway 日志**
   ```powershell
   pnpm openclaw logs --limit 50
   ```

### 问题：响应很慢

- CLI 工具调用需要启动新的 PowerShell 进程，比 API 调用慢
- 建议仅在需要特定模型能力时使用

## 技术细节

- 工具文件：`src/agents/tools/cli-model-tool.ts`
- 超时时间：120 秒
- Shell：PowerShell 7 (`pwsh`)
- 执行方式：异步子进程
