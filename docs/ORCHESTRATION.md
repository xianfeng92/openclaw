# OpenClaw Agent Orchestration System

## 概述

OpenClaw Agent Orchestration System 是一个多 Agent 任务管理系统，支持：

- **任务隔离**: 每个 Agent 在独立的 tmux 会话中运行
- **Git 隔离**: 使用 git worktree 为每个任务创建独立工作环境
- **任务跟踪**: 持久化的任务注册表，记录所有任务状态
- **自动监控**: 后台监控循环，自动检测任务超时和会话死亡
- **DoD 检查**: 任务完成时自动验证 Definition of Done

## 前置要求

```bash
# 确保 tmux 已安装
tmux -V

# 确保 git 已安装
git --version
```

## 命令参考

### `/spawn` - 创建新任务

在独立的 tmux 会话中启动一个新的 Agent 任务。

```bash
/spawn <description> [--agent <type>] [--branch <name>]
```

**参数：**
- `description`: 任务描述（必需）
- `--agent <claude|codex|gemini>`: 指定 Agent 类型（可选，默认自动选择）
- `--branch <name>`: 指定分支名（可选，默认自动生成）

**示例：**

```bash
# 使用自动选择的 Agent 创建任务
/spawn "Add user authentication feature"

# 指定 Agent 类型
/spawn "Fix login bug" --agent codex

# 指定分支名
/spawn "Refactor payment module" --branch feature/payment-refactor
```

**自动 Agent 选择规则：**
- `claude`: 功能实现、重构、审查、性能、安全
- `codex`: Bug 修复、测试生成
- `gemini`: 文档、研究

### `/agents` - 管理 Agent

管理运行中的 Agent 任务。

```bash
/agents <subcommand> [args]
```

**子命令：**

#### `list` - 列出运行中的 Agent
```bash
/agents list
```

显示所有运行中的任务，包括：
- 任务 ID 和描述
- Agent 类型
- 启动时间
- tmux 会话名
- Git 分支

#### `kill` - 终止任务
```bash
/agents kill <task-id>
```

终止指定任务，会：
- 关闭 tmux 会话
- 清理 git worktree
- 更新任务状态为 failed

#### `attach` - 获取会话连接命令
```bash
/agents attach <task-id>
```

显示连接到 Agent tmux 会话的命令。

**注意：** 在另一个终端中运行显示的命令来连接会话。按 `Ctrl+B` 然后 `D` 来分离而不结束会话。

#### `redirect` - 发送消息到 Agent
```bash
/agents redirect <task-id> <message>
```

向运行中的 Agent 发送消息以重定向其工作。

#### `output` - 查看会话输出
```bash
/agents output <task-id>
```

显示 Agent tmux 会话的最近输出（最近 50 行）。

### `/tasks` - 列出任务

列出所有任务，支持过滤。

```bash
/tasks [--status <status>] [--agent <type>] [--limit <n>]
```

**参数：**
- `--status <pending|running|completed|failed|blocked>`: 按状态过滤
- `--agent <claude|codex|gemini>`: 按 Agent 类型过滤
- `--limit <n>`: 限制显示数量

**示例：**

```bash
# 显示所有任务
/tasks

# 只显示运行中的任务
/tasks --status running

# 显示 Claude Agent 的失败任务
/tasks --agent claude --status failed

# 显示最近 10 个任务
/tasks --limit 10
```

## 工作流程

### 典型使用流程

```bash
# 1. 创建新任务
/spawn "Implement dark mode toggle"

# 系统响应:
# Spawning task task-20250225-001...
#   Agent: 🤖 Claude
#   Branch: orchestral/task-20250225
#   Worktree: /path/to/repo/.openclaw/worktrees/task-20250225-001
#   Session: claw-task-20250225-001
#   Attach with: tmux attach -t claw-task-20250225-001
# ✓ Task task-20250225-001 spawned successfully

# 2. 查看运行中的任务
/agents list

# 3. 如果需要，重定向 Agent
/agents redirect task-20250225-001 "Stop and just add the toggle button first"

# 4. 查看 Agent 的输出
/agents output task-20250225-001

# 5. 如果需要，手动连接到会话
/agents attach task-20250225-001
# (在另一个终端运行显示的 tmux 命令)

# 6. 查看所有任务状态
/tasks --status running
```

### 直接连接会话

如果你想直接与 Agent 交互：

```bash
# 获取连接命令
/agents attach task-20250225-001

# 在另一个终端中运行
tmux attach -t claw-task-20250225-001

# 完成后分离（不结束会话）
# 按 Ctrl+B，然后 D
```

## 数据存储

### 任务注册表

任务数据存储在 `~/.openclaw/active-tasks.json`：

```json
{
  "version": 1,
  "lastUpdated": 1740451200000,
  "tasks": [
    {
      "id": "task-20250225-001",
      "tmuxSession": "claw-task-20250225-001",
      "agent": "claude",
      "description": "Add user authentication",
      "repo": "/path/to/repo",
      "worktree": "/path/to/repo/.openclaw/worktrees/task-20250225-001",
      "branch": "orchestral/task-20250225-001",
      "startedAt": 1740451200000,
      "status": "running",
      "notifyOnComplete": true,
      "retryCount": 0,
      "maxRetries": 3
    }
  ]
}
```

### Git Worktree

每个任务的 worktree 存储在项目目录下：

```
repo/
├── .openclaw/
│   └── worktrees/
│       ├── task-20250225-001/
│       └── task-20250225-002/
```

## 任务状态

| 状态 | 图标 | 描述 |
|------|------|------|
| `pending` | ⏳ | 任务已创建，等待启动 |
| `running` | 🔄 | 任务正在运行 |
| `completed` | ✅ | 任务成功完成 |
| `failed` | ❌ | 任务失败 |
| `blocked` | 🚫 | 任务被阻塞 |

## DoD 检查

任务完成时会进行以下检查：

- **PR Created**: 检查是否已创建 Pull Request
- **Branch Synced**: 检查分支是否与远程同步
- **CI Passed**: 检查 CI 是否通过
- **Screenshots**: （可选）UI 相关任务的截图

## 监控

系统会自动监控运行中的任务：

- **会话死亡检测**: 如果 tmux 会话意外终止，任务会被标记为失败
- **超时检测**: 任务运行超过 1 小时（默认）会被标记为超时
- **状态更新**: 任务状态变化时触发事件通知

## 故障排除

### tmux 不可用

```
error: tmux is not available. Please install tmux first.
```

**解决方案：**
```bash
# macOS
brew install tmux

# Ubuntu/Debian
sudo apt-get install tmux

# Windows (WSL)
sudo apt-get install tmux
```

### 非 Git 仓库

如果当前目录不是 Git 仓库，spawn 命令仍会工作，但不会创建 worktree。

### 会话已存在

```
error: Session already exists
```

**解决方案：** 使用 `/agents kill <task-id>` 先终止旧任务。

### Worktree 创建失败

```
error: failed to create worktree: ...
```

**解决方案：** 检查 Git 仓库状态，确保没有未提交的更改或冲突。

## 高级用法

### 批量任务管理

```bash
# 查看所有失败的任务
/tasks --status failed

# 终止所有运行中的任务（需要手动执行）
/agents list  # 获取所有任务 ID
/agents kill task-001
/agents kill task-002
# ...
```

### 与主会话并行工作

你可以在主 OpenClaw 会话中继续工作，同时让 Agent 在后台执行任务：

```bash
# 在主会话中
/spawn "Write unit tests for auth module"

# 继续在主会话中做其他事情...

# 稍后检查任务状态
/agents list
/tasks --status completed
```

### 清理旧任务

```bash
# 删除已完成任务的 worktree
/agents kill task-xxx  # 这会清理 worktree

# 或手动清理
git worktree list
git worktree remove <worktree-path>
```

## 配置

任务数据存储位置可通过环境变量配置：

```bash
# 更改状态目录
export OPENCLAW_STATE_DIR=/path/to/state
```

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                         OpenClaw TUI                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   /spawn    │  │  /agents    │  │      /tasks         │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                     │            │
│         └────────────────┴─────────────────────┘            │
│                            │                                │
│                     ┌──────▼───────┐                       │
│                     │ Orchestral   │                       │
│                     │  Commands    │                       │
│                     └──────┬───────┘                       │
└────────────────────────────┼───────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
    ┌────▼─────┐        ┌─────▼──────┐       ┌─────▼──────┐
    │   Tmux   │        │  Git       │       │  Task      │
    │ Manager  │        │  Worktree  │       │  Registry  │
    └────┬─────┘        └─────┬──────┘       └─────┬──────┘
         │                     │                     │
    ┌────▼─────┐        ┌─────▼──────┐       ┌─────▼──────┐
    │ tmux     │        │ git        │       │ ~/.openclaw│
    │ sessions │        │ worktrees  │       │ /tasks.json│
    └──────────┘        └────────────┘       └────────────┘
```

## API 参考

### 任务类型

```typescript
type TaskStatus = "pending" | "running" | "completed" | "failed" | "blocked";
type AgentType = "claude" | "codex" | "gemini";

interface ActiveTask {
  id: string;                    // task-YYYYMMDD-NNN
  tmuxSession?: string;          // claw-{id}
  agent: AgentType;
  description: string;
  repo: string;
  worktree?: string;
  branch?: string;
  startedAt: number;
  status: TaskStatus;
  spawnedBy?: string;
  notifyOnComplete: boolean;
  retryCount: number;
  maxRetries: number;
  pr?: number;
  completedAt?: number;
  checks?: DoDChecks;
  error?: string;
}
```

## 反馈与贡献

如有问题或建议，请通过以下方式反馈：

- GitHub Issues: [openclaw/issues]
- 文档: [openclaw/docs]
