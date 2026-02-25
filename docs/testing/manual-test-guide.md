# OpenClaw Super Terminal - 测试指南

本文档包含所有已实现功能的测试说明。请在终端中逐一测试这些功能。

---

## 测试环境准备

### 前置条件
- [x] Git 已安装
- [x] Node.js 已安装
- [ ] GitHub CLI (gh) 已安装并认证 (用于 PR 功能测试)

### 启动终端
```bash
npm run dev
```
然后按 `Ctrl+Shift+T` 打开超级终端。

---

## Feature 1: 模式管理系统 (Pattern Management)

### 测试命令

#### 1.1 列出所有模式
```
/pattern list
```
**预期结果**: 显示已保存的模式列表

#### 1.2 保存新模式
```
/pattern save "BugFix Template" coding "First understand expected behavior, then find root cause, then fix. Test after fixing."
```
**预期结果**: 模式保存成功，显示生成的 ID

#### 1.3 应用模式到任务
```
/pattern apply <pattern-id-or-name> "Fix login crash"
```
**预期结果**: 显示增强后的提示词

#### 1.4 评分模式效果
```
/pattern rate <pattern-id-or-name> success
```
**预期结果**: 模式效果分数更新

#### 1.5 模式推荐 (自动触发)
```
/spawn "Fix bug in user authentication"
```
**预期结果**: 在创建任务时显示推荐的模式

---

## Feature 2: 上下文管理 (Context Management)

### 测试命令

#### 2.1 列出上下文
```
/context list
```
**预期结果**: 显示客户、项目、会议、决策、模式

#### 2.2 搜索上下文
```
/context search "payment"
```
**预期结果**: 显示与 payment 相关的上下文

#### 2.3 加载 Obsidian 上下文
```
/context load <vault-path>
```
**预期结果**: 从 Obsidian vault 加载上下文

#### 2.4 显示上下文摘要
```
/context summary
```
**预期结果**: 显示各类条目数量

#### 2.5 清除上下文
```
/context clear
```
**预期结果**: 上下文缓存已清除

---

## Feature 3: PR 自动创建 (PR Auto-Creation)

### 测试命令

#### 3.1 查看 Git 状态
```
/pr status
```
**预期结果**: 显示当前分支、变更文件

#### 3.2 创建 PR (需要 gh CLI)
```
/pr create "Test PR feature" --draft
```
**预期结果**:
1. 自动提交变更
2. 推送到远程
3. 创建 PR (草稿)

#### 3.3 列出 PR
```
/pr list
```
**预期结果**: 显示 open PRs 列表

#### 3.4 查看 PR 详情
```
/pr view <pr-number>
```
**预期结果**: 显示 PR 详情

---

## Feature 4: 代码审查 (Code Review)

### 测试命令

#### 4.1 审查当前变更
```
/review diff
```
**预期结果**: 显示多模型审查结果
- Codex: 边缘情况、逻辑错误
- Gemini: 安全问题、性能
- Claude: 架构、可维护性

#### 4.2 审查特定分支
```
/review diff --branch develop
```
**预期结果**: 审查 develop 分支的变更

#### 4.3 查看审查状态
```
/review status
```
**预期结果**: 显示审查系统状态

---

## Feature 5: 工作流管理 (Workflow Management)

### 测试命令

#### 5.1 创建工作流
```
/workflow create "Build and Test" "/spawn Run tests" "!npm run build" "/delay 1000"
```
**预期结果**: 工作流创建成功

#### 5.2 列出工作流
```
/workflow list
```
**预期结果**: 显示所有工作流

#### 5.3 显示工作流详情
```
/workflow show "Build and Test"
```
**预期结果**: 显示工作流步骤

#### 5.4 运行工作流
```
/workflow run "Build and Test"
```
**预期结果**: 显示要执行的步骤

#### 5.5 删除工作流
```
/workflow delete "Build and Test"
```
**预期结果**: 工作流已删除

---

## Feature 6: 快捷操作与别名 (Quick Actions & Aliases)

### 测试命令

#### 6.1 列出快捷操作
```
/alias list
```
**预期结果**: 显示内置快捷操作
- 🔧 Quick Fix
- ✨ Add Feature
- 🧪 Run Tests
- 📊 Status
- 📚 Load Context

#### 6.2 创建别名
```
/alias create "qf" "/spawn Quick fix --agent codex"
```
**预期结果**: 别名创建成功

#### 6.3 使用别名
```
/qf
```
**预期结果**: 执行对应的命令

#### 6.4 删除别名
```
/alias delete "qf"
```
**预期结果**: 别名已删除

---

## Feature 7: 任务生命周期 (Task Lifecycle)

### 测试命令

#### 7.1 列出任务
```
/tasks --status running
```
**预期结果**: 显示运行中的任务

#### 7.2 标记任务完成
```
/task complete <task-id> success <pattern-id>
```
**预期结果**: 任务标记为完成，模式效果自动更新

---

## Feature 8: 侧边栏面板 (Sidebar Panels)

### 测试步骤

1. 启动终端
2. 按 `Ctrl+B` 切换侧边栏
3. 验证以下面板:
   - **Tasks 面板**: 显示任务列表
   - **Agents 面板**: 显示运行中的 agent
   - **Context 面板**: 显示上下文信息
4. 验证 10 秒自动刷新

---

## Feature 9: Babysit 循环 (Babysit Loop)

### 验证方法

Babysit 循环在 Gateway 启动时自动启动，每 10 分钟检查一次：

1. 查看日志输出，确认 "babysit loop started"
2. 创建一个测试任务
3. 手动杀死对应的 tmux session
4. 等待最多 10 分钟
5. 验证任务是否被自动重试

---

## Feature 10: 模式推荐系统 (Pattern Recommendation)

### 测试步骤

```
/spawn "Fix XSS vulnerability in comments"
```
**预期结果**:
1. 任务被归类为 "security"
2. 推荐相关模式（如果存在）
3. 显示模式效果分数

---

## Feature 11: 任务分类 (Task Categorization)

### 测试不同类型的任务

| 任务描述 | 预期分类 |
|---------|---------|
| `Fix login crash` | bugfix |
| `Add user profile` | feature |
| `Refactor code` | refactor |
| `Write tests` | test |
| `Fix XSS vulnerability` | security |
| `Optimize queries` | performance |
| `Document API` | docs |

---

## Feature 12: Git 集成命令

### 测试命令

#### 12.1 Git 状态
```
/pr status
```
**预期结果**: 显示分支、变更文件

#### 12.2 快捷提交
```
/git commit "Auto commit"
```
**预期结果**: 自动暂存并提交

#### 12.3 查看日志
```
/git log 5
```
**预期结果**: 显示最近 5 条提交

---

## 终端快捷键

| 快捷键 | 功能 |
|-------|------|
| `Ctrl+Shift+T` | 打开/关闭超级终端 |
| `Ctrl+B` | 切换侧边栏 |
| `Ctrl+L` | 清屏 |
| `Tab` | 命令补全 |
| `Arrow Up/Down` | 命令历史 |
| `Ctrl+C` | 中断操作 |

---

## 帮助命令

```
/help          - 显示所有命令
/orchestral     - 显示编排命令帮助
/pattern help   - 显示模式命令帮助
/review help    - 显示审查命令帮助
/workflow help  - 显示工作流命令帮助
```

---

## 测试检查清单

### 基础功能
- [ ] 终端正常启动
- [ ] 帮助命令显示正确
- [ ] 快捷键工作正常

### 上下文功能
- [ ] `/context list` 显示正确
- [ ] `/context search` 返回相关结果
- [ ] 上下文在 spawn 时被注入

### 模式功能
- [ ] `/pattern list` 显示所有模式
- [ ] `/pattern save` 保存新模式
- [ ] `/pattern rate` 更新效果分数
- [ ] Spawn 时推荐模式

### PR 功能
- [ ] `/pr status` 显示 git 状态
- [ ] `/pr create` 创建 PR (需要 gh)
- [ ] `/pr list` 列出 PR

### 审查功能
- [ ] `/review diff` 运行审查
- [ ] 显示三个模型的结果
- [ ] 严重程度分类正确

### 工作流功能
- [ ] `/workflow create` 创建工作流
- [ ] `/workflow run` 显示步骤
- [ ] `/workflow delete` 删除工作流

### Agent 编排
- [ ] `/spawn` 创建任务
- [ ] `/agents list` 列出 agents
- [ ] `/tasks` 显示任务列表
- [ ] Babysit 循环在运行

---

## 已知限制

1. **GitHub CLI**: PR 功能需要 `gh` CLI 已安装并认证
2. **Agent 调用**: 当前审查是模拟的，需要连接实际 AI 服务
3. **Obsidian**: 上下文加载需要有效的 Obsidian vault 路径

---

## 测试报告模板

测试完成后，请填写以下报告：

| Feature | 状态 | 备注 |
|---------|------|------|
| Pattern Management | ⬜ Pass / ❌ Fail | |
| Context Management | ⬜ Pass / ❌ Fail | |
| PR Auto-Creation | ⬜ Pass / ❌ Fail | |
| Code Review | ⬜ Pass / ❌ Fail | |
| Workflow Management | ⬜ Pass / ❌ Fail | |
| Quick Actions | ⬜ Pass / ❌ Fail | |
| Sidebar Panels | ⬜ Pass / ❌ Fail | |
| Task Categorization | ⬜ Pass / ❌ Fail | |
| Git Integration | ⬜ Pass / ❌ Fail | |
| Keyboard Shortcuts | ⬜ Pass / ❌ Fail | |

---

## 自动化测试

运行自动化测试:

```bash
# 模式推荐测试
node --import tsx/esm tests/pattern-recommendation-test.ts

# PR 服务测试
node --import tsx/esm tests/pr-service-test.ts

# 工作流测试
node --import tsx/esm tests/workflow-service-test.ts
```

---

## 联系与反馈

如发现问题，请创建 issue 或在项目 repository 中报告。
