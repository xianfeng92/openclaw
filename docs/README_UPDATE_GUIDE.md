# README 更新规范

每当完成一个功能实现后，必须更新 README.md 以反映项目当前状态。

## 更新时机

在以下情况必须更新 README：
1. **完成一个新的 Feature** - 功能完整实现并测试通过后
2. **完成一个 Phase** - 按照计划完成一个阶段后
3. **重大架构变更** - 影响项目整体结构的变化
4. **新增/移除核心功能** - 影响用户体验的功能变化

## 更新内容

### 1. Current Project Status 表格

更新项目状态表格，添加/修改对应的工作流行：

| 工作流名称 | 状态 | 说明 |
|-----------|------|------|
| Super Terminal Evol | Step N: [功能名] complete | 简短描述已完成的内容 |

### 2. Key Features 部分

如果是用户可见的功能，添加到 Key Features 列表：

```markdown
## Key Features

- ...existing features...
- **[新功能名]**: 简短描述 (Added: YYYY-MM-DD)
```

### 3. 版本日期

更新 Snapshot 日期为当前日期

## 状态定义

- **Planning**: 功能规划阶段
- **In Progress**: 正在实现中
- **Step N: [功能名] complete**: 完成第 N 步
- **Complete**: 功能完全实现
- **On Hold**: 暂停开发
- **Cancelled**: 已取消

## 工作流程

```bash
# 1. 完成功能开发
# 2. 运行测试确保功能正常
pnpm test

# 3. 更新 README
# 编辑 README.md

# 4. 提交变更
git add README.md
git commit -m "docs: update README for [feature name] completion"

# 5. 继续下一个功能
```

## 当前进度

### Super Terminal Evolution

| Step | 功能 | 状态 | 完成日期 |
|------|------|------|----------|
| 1 | 侧边栏 UI (Tasks/Agents/Context 面板) | ✅ Complete | 2026-02-25 |
| 2 | Obsidian 上下文同步 | ⏳ In Progress | - |
| 3 | 上下文编排器 | ⏳ Planned | - |
| 4 | 代码审查器 | ⏳ Planned | - |
| 5 | Babysit 循环 | ⏳ Planned | - |
| 6 | 清理与优化 | ⏳ Planned | - |
