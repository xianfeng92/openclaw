# OpenClaw Super Terminal - Orchestral Commands (Windows)

在 OpenClaw Super Terminal 中使用编排命令来管理多 Agent 任务。

## 启动方式

在 Windows 桌面应用中按 `Ctrl+Shift+T` 打开 Super Terminal。

## Windows 轻量级模式

Windows 上的编排命令使用**轻量级模式**，不需要 tmux：

- 自动创建 Git worktree 隔离环境
- 任务数据持久化存储在 `.openclaw/tasks.json`
- 你可以在 worktree 目录中直接工作

## 可用命令

### `/spawn` - 创建新任务

创建一个独立的 Git worktree 并设置任务环境。

```bash
/spawn <description> [--agent <claude|codex|gemini>] [--branch <name>]
```

**示例：**

```bash
/spawn "Add user authentication feature"
/spawn "Fix login bug" --agent codex
/spawn "Refactor payment module" --branch feature/payment-refactor
```

**输出示例：**

```
🚀 Spawning Agent Task
Description: Add user authentication feature
Agent: claude
Creating task...
✓ Task task-1740451200000 created

📋 Task Created
Worktree: C:\path\to\repo\.openclaw\worktrees\task-1740451200000
Branch: orchestral/task-174045

To work on this task:
  cd "C:\path\to\repo\.openclaw\worktrees\task-1740451200000"
  Then implement: Add user authentication feature
```

### `/agents` - 管理 Agent

#### `list` - 列出运行中的任务

```bash
/agents list
```

#### `kill` - 终止任务并清理 worktree

```bash
/agents kill <task-id>
```

#### `attach` - 获取 worktree 路径

```bash
/agents attach <task-id>
```

显示任务的 worktree 路径，方便你快速切换到该目录。

#### `redirect` - 更新任务描述

```bash
/agents redirect <task-id> <new description>
```

### `/tasks` - 列出所有任务

```bash
/tasks [--status <running|completed|failed>] [--agent <claude|codex|gemini>]
```

## 工作流程

### 1. 创建任务

```bash
/spawn "Implement dark mode toggle"
```

这会：
1. 创建新的 Git 分支 `orchestral/task-xxx`
2. 创建独立的 worktree 目录
3. 自动安装依赖（如果检测到 package.json）

### 2. 开始工作

```bash
# 获取 worktree 路径
/agents attach task-xxx

# 在另一个终端中切换到 worktree
cd "C:\path\to\.openclaw\worktrees\task-xxx"

# 开始实现功能
```

### 3. 查看所有任务

```bash
/tasks
```

### 4. 完成后清理

```bash
/agents kill task-xxx
```

这会：
1. 删除 worktree
2. 更新任务状态

## 数据存储

任务数据存储在项目根目录的 `.openclaw/tasks.json`：

```json
[
  {
    "id": "task-1740451200000",
    "agent": "claude",
    "description": "Add user authentication",
    "repo": "C:\\path\\to\\repo",
    "worktree": "C:\\path\\to\\repo\\.openclaw\\worktrees\\task-1740451200000",
    "branch": "orchestral/task-174045",
    "startedAt": 1740451200000,
    "status": "running"
  }
]
```

## 完整命令列表

| 命令 | 描述 |
|------|------|
| `/help` | 显示帮助信息 |
| `/clear` | 清屏 |
| `/status` | 显示终端和网关状态 |
| `/spawn <desc>` | 创建新的 Agent 任务 |
| `/agents list` | 列出运行中的任务 |
| `/agents kill <id>` | 终止任务并清理 worktree |
| `/agents attach <id>` | 获取 worktree 路径 |
| `/tasks` | 列出所有任务 |
| `!<command>` | 执行 Shell 命令 |

## Git Worktree 工作流程

使用编排命令后的典型 Git 工作流程：

```bash
# 1. 创建任务
/spawn "New feature"

# 2. 切换到 worktree
cd .openclaw/worktrees/task-xxx

# 3. 进行开发工作
# ... 编码 ...

# 4. 提交更改
git add .
git commit -m "Implement feature"

# 5. 合并回主分支
git checkout main
git merge orchestral/task-xxx

# 6. 清理任务
/agents kill task-xxx
```

## 与 TUI 模式的区别

| 特性 | Windows Super Terminal | TUI (需要 tmux) |
|------|----------------------|------------------|
| 隔离方式 | Git worktree | tmux + Git worktree |
| 会话管理 | 轻量级（无后台会话） | 完整（tmux 会话） |
| 平台支持 | Windows + macOS/Linux | macOS/Linux (WSL) |
| 依赖管理 | 自动检测并安装 | 自动检测并安装 |

## 故障排除

### Worktree 创建失败

如果 worktree 创建失败，检查：

1. 是否在 Git 仓库中
2. 是否有未提交的更改
3. 是否有同名分支

```bash
# 检查 Git 状态
git status

# 检查是否在仓库中
git rev-parse --show-toplevel
```

### 依赖安装失败

如果依赖安装失败，手动进入 worktree 安装：

```bash
cd .openclaw/worktrees/task-xxx
npm install
# 或
pnpm install
```

### 清理失败的 worktree

```bash
# 手动删除 worktree
git worktree list
git worktree remove .openclaw/worktrees/task-xxx
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+T` | 打开/关闭终端 |
| `Enter` | 执行命令 |
| `Tab` | 自动补全 |
| `Ctrl+C` | 中断输入 |
| `Ctrl+L` | 清屏 |
| `↑/↓` | 浏览历史 |
