# Cherry-Pick Analysis: main → desktop-mvp-slim

> 生成时间: 2026-02-24
> 分析范围: main 分支上 5464 个领先于 desktop-mvp-slim 的提交（本报告分析其中重要的 50 个）

## 分支差异概览

```
main 分支:          097a6a83a - fix(cli): replace stale doctor/restart command hints
desktop-mvp-slim:   2228168c8 - docs: update upstream pick report for next security batch
共同祖先:            4c1da23a7

差异:
  main 领先 desktop-mvp-slim:  5464 个提交 ← 主要需要 cherry-pick 的方向
  desktop-mvp-slim 领先 main:   156 个提交 (主要是安全修复)
```

**重要发现**:
- `main` 分支包含了大量新功能和修复（5464个），这些是从 desktop-mvp-slim 分支创建后添加的
- `desktop-mvp-slim` 分支领先 156 个提交，主要是安全相关的修复
- 本报告分析 main 上**值得 cherry-pick** 到 desktop-mvp-slim 的关键提交

---

## 推荐 Cherry-Pick 的提交

### Priority 1: 安全相关修复 (HIGH)

| Commit SHA | Title | 文件 | 说明 |
|------------|-------|------|------|
| ff10fe8b9 | fix(security): require /etc/shells for shell env fallback | src/infra/shell-env.ts | 要求 shell 环境回退使用 /etc/shells 验证 |
| 90383e00e | fix(security): harden autoAllowSkills exec matching | src/infra/exec-approvals-allowlist.ts | 加固自动允许技能的执行匹配 |
| fefc41457 | fix(security): harden structural session path fallback | src/config/sessions/paths.ts | 加固会话路径回退 |
| e578521ef | fix(security): harden session export image data-url handling | src/media/base64.ts, src/agents/tool-images.ts | 加固会话导出的 data-url 处理 |
| f8524ec77 | fix(security): harden exported session html rendering | src/auto-reply/reply/export-html/template.js | 加固导出的 HTML 会话渲染 |
| d51a4695f | Deny cron tool on /tools/invoke by default | src/security/dangerous-tools.ts | 默认拒绝通过 /tools/invoke 调用 cron 工具 |

### Priority 2: Gateway 核心修复 (HIGH)

| Commit SHA | Title | 文件 | 说明 |
|------------|-------|------|------|
| 3f5e7f815 | fix(gateway): consume allow-once approvals to prevent replay | src/gateway/exec-approval-manager.ts | 消耗一次性审批以防止重放 |
| 83689fc83 | fix: include trusted-proxy in sharedAuthOk check | src/gateway/server/ws-connection/auth-context.ts | 在共享认证检查中包含可信代理 |
| c1fe688d4 | fix(gateway): safely extract text from content arrays | src/gateway/agent-prompt.ts | 安全地从内容数组提取文本 |
| 3129d1c48 | fix(gateway): start browser HTTP control server module | src/gateway/server-browser.ts | 启动浏览器 HTTP 控制服务器模块 |
| 6f0dd6179 | fix(exec): restore two-phase approval registration flow | src/agents/bash-tools.exec-approval-request.ts | 恢复两阶段审批注册流程 |

### Priority 3: Subagent/Cron 修复 (MEDIUM-HIGH)

| Commit SHA | Title | 文件 | 说明 |
|------------|-------|------|------|
| 8d2035633 | fix(agents): include SOUL.md, IDENTITY.md, USER.md | src/agents/workspace.ts | 在子代理/cron 引导中包含身份文件 |
| 2398b5137 | fix: include available_skills in isolated cron sessions | src/agents/system-prompt.ts | 在隔离 cron 会话中包含可用技能 |
| d95ee859f | fix(cron): use full prompt mode for isolated cron sessions | src/agents/pi-embedded-runner/run/attempt.ts | 为隔离 cron 会话使用完整提示模式 |
| 8c8374def | fix(cron): treat embedded error payloads as run failures | src/cron/isolated-agent/run.ts | 将嵌入错误负载视为运行失败 |
| 5710d7252 | feat(agents): configurable default runTimeoutSeconds | src/agents/subagent-spawn.ts, src/config/types.agent-defaults.ts | 可配置的子代理默认运行超时 |
| c3b3065cc | fix(subagents): reconcile orphaned restored runs | - | 协调孤立的恢复运行 |

### Priority 4: WhatsApp 修复 (MEDIUM)

| Commit SHA | Title | 文件 | 说明 |
|------------|-------|------|------|
| c6bb7b0c0 | fix(whatsapp): groupAllowFrom sender filter bypassed | src/config/group-policy.ts | 修复 WhatsApp groupAllowFrom 发送者过滤绕过 |
| 57783680a | fix(whatsapp): guard updateLastRoute when dmScope isolates | src/web/auto-reply/monitor/process-message.ts | 当 dmScope 隔离时保护 updateLastRoute |
| 3a653082d | fix(config): align whatsapp enabled schema with auto-enable | src/config/types.whatsapp.ts | 对齐 WhatsApp 启用架构与自动启用 |
| 3d22af692 | fix(whatsapp): suppress reasoning/thinking content from delivery | - | 从 WhatsApp 传递中抑制推理/思考内容 |
| aef45b2ab | fix(logging): redact phone numbers and message content | src/web/outbound.ts | 从 WhatsApp 日志中脱敏电话号码和消息内容 |
| b5881d9ef | fix: avoid WhatsApp silent turns with final-only delivery | src/web/auto-reply/monitor/process-message.ts | 避免使用 final-only 传递时 WhatsApp 静默轮次 |

### Priority 5: Discord/其他平台修复 (MEDIUM)

| Commit SHA | Title | 文件 | 说明 |
|------------|-------|------|------|
| 38da3f40c | fix(discord): suppress reasoning/thinking block payloads | src/discord/monitor/message-handler.process.ts | 从 Discord 传递中抑制推理/思考块 |
| e8a4d5d9b | fix(discord): strip reasoning tags from partial stream preview | - | 从 Discord 部分流预览中剥离推理标签 |
| 1298bd4e1 | fix(matrix): skip reasoning-only messages in reply delivery | - | 跳过 Matrix 中仅推理消息的回复传递 |
| a7518b758 | fix(feishu): pass parentPeer for topic session binding | extensions/feishu/src/bot.ts | 为主题会话绑定传递 parentPeer |
| bc52d4a45 | fix(openrouter): skip reasoning effort injection for 'auto' | src/agents/models-config.providers.ts | 为 'auto' 路由模型跳过推理努力注入 |

### Priority 6: 配置和工具修复 (MEDIUM)

| Commit SHA | Title | 文件 | 说明 |
|------------|-------|------|------|
| c69fc383b | fix(config): surface helpful chown hint on EACCES | src/config/io.ts | 在 EACCES 时显示有用的 chown 提示 |
| 424ba72ca | fix(config): add actionable guidance for dmPolicy | src/config/io.ts | 为 dmPolicy open allowFrom 不匹配添加可操作指导 |
| f3459d71e | fix(exec): treat shell exit codes 126/127 as failures | src/agents/bash-tools.exec-runtime.ts | 将 shell 退出码 126/127 视为失败 |
| 252079f00 | fix(agents): repair orphaned tool results for OpenAI | src/agents/transcript-policy.ts | 修复 OpenAI 历史截断后的孤立工具结果 |
| 792bd6195 | fix: recognize Bedrock as Anthropic-compatible | src/agents/transcript-policy.ts | 将 Bedrock 识别为 Anthropic 兼容 |
| 3823587ad | fix(agents): allow empty edit replacement text | src/agents/pi-tools.read.ts | 允许空编辑替换文本 |
| 58ce0a89e | fix(cli): load plugin registry for configure/onboard | src/cli/program/preaction.ts | 为 configure/onboard 命令加载插件注册表 |

### Priority 7: 插件系统修复 (MEDIUM)

| Commit SHA | Title | 文件 | 说明 |
|------------|-------|------|------|
| bf91b347c | fix(plugins): use manifest id as config entry key | src/plugins/install.ts | 使用清单 id 作为配置条目键 |
| 75969ed5c | fix(plugins): pass session context to before_compaction | src/agents/pi-embedded-subscribe.handlers.compaction.ts | 将会话上下文传递给 before_compaction 钩子 |
| 588a188d6 | fix: replace stale plugin webhook routes | - | 替换过时的插件 webhook 路由 |
| d76742ff8 | fix: normalize manifest plugin ids during install | - | 在安装期间规范化清单插件 id |

### Priority 8: Chrome 扩展修复 (LOW)

| Commit SHA | Title | 文件 | 说明 |
|------------|-------|------|------|
| 67bac62c2 | fix: Chrome relay extension auto-reattach after SPA navigation | assets/chrome-extension/background.js | SPA 导航后自动重新附加 |
| 1237516ae | fix(chrome-extension): finalize relay endpoint validation | assets/chrome-extension/options.js | 完成 relay 端点验证 |

### Priority 9: 其他修复 (LOW)

| Commit SHA | Title | 文件 | 说明 |
|------------|-------|------|------|
| b9e587fb6 | fix(tui): guard sendMessage when disconnected | src/tui/gateway-chat.ts | 断开连接时保护 sendMessage |
| 053b0df7d | fix(ui): load saved locale on startup | ui/src/i18n/lib/translate.ts | 启动时加载保存的语言环境 |
| 7d76c241f | fix: suppress reasoning payloads from generic channel dispatch | src/auto-reply/reply/dispatch-from-config.ts | 从通用通道分发中抑制推理负载 |
| aea28e26f | fix(auto-reply): expand standalone stop phrases | src/auto-reply/reply/abort.ts | 扩展独立停止短语 |
| 6c1ed9493 | fix: harden queue retry debounce and add regression tests | src/agents/subagent-announce-queue.ts | 加固队列重试防抖 |
| 9d3bd5099 | fix(otel): use protobuf OTLP exporters | extensions/diagnostics-otel/src/service.ts | 使用 protobuf OTLP 导出器 |
| 097a6a83a | fix(cli): replace stale doctor/restart command hints | - | 替换过时的 doctor/restart 命令提示 |

---

## 不推荐 Cherry-Pick 的提交

以下提交主要与以下场景相关，可以根据需要跳过：

1. **测试相关** (以 `test:` 开头，仅测试更新)
2. **文档相关** (以 `docs:` 或 `chore:` 开头)
3. **发布相关** (以 `chore(release):` 开头)
4. **Lockfile 更新** (lockfile 同步)
5. **不相关平台的功能** (如你不需要的功能)

---

## 执行计划

### 方案 A: 批量 Cherry-Pick (推荐)

```bash
# 切换到 desktop-mvp-slim 分支
git checkout desktop-mvp-slim

# 创建备份分支
git branch backup-before-cherry-pick

# 按优先级批量 cherry-pick
# Priority 1: 安全修复
git cherry-pick ff10fe8b9 90383e00e fefc41457 e578521ef f8524ec77 d51a4695f

# Priority 2: Gateway 核心修复
git cherry-pick 3f5e7f815 83689fc83 c1fe688d4 3129d1c48 6f0dd6179

# Priority 3: Subagent/Cron 修复
git cherry-pick 8d2035633 2398b5137 d95ee859f 8c8374def 5710d7252 c3b3065cc

# Priority 4: WhatsApp 修复
git cherry-pick c6bb7b0c0 57783680a 3a653082d 3d22af692 aef45b2ab b5881d9ef

# Priority 5-7: 其他修复 (根据需求选择性应用)
```

### 方案 B: 使用 git cherry-pick -x 保留原始信息

```bash
# 保留原始提交信息
git cherry-pick -x <commit-sha>
```

### 方案 C: 创建补丁文件

```bash
# 从 main 分支创建补丁
git format-patch --root desktop-mvp-slim..main --stdout > /tmp/main-to-desktop.patch

# 在 desktop-mvp-slim 上应用补丁
git checkout desktop-mvp-slim
git am /tmp/main-to-desktop.patch
```

---

## 潜在冲突点

根据文件修改分析，以下文件可能产生冲突：

1. **src/infra/shell-env.ts** - 桌面 mvp slim 可能有不同的 shell 环境配置
2. **src/config/io.ts** - 可能已有不同的配置处理逻辑
3. **src/gateway/** - 多个网关相关修改
4. **src/agents/bash-tools.exec-*** - 执行相关修改
5. **src/agents/workspace.ts** - 工作区配置
6. **src/config/sessions/** - 会话配置

---

## 快速命令参考

```bash
# 查看提交详情
git show <commit-sha>

# 查看 commit 修改的文件
git show <commit-sha> --stat

# 测试 cherry-pick (不实际提交)
git cherry-pick --no-commit <commit-sha>
git reset --hard HEAD  # 如果需要放弃

# 放弃当前的 cherry-pick
git cherry-pick --abort

# 继续有冲突的 cherry-pick
git cherry-pick --continue
```

---

## 统计摘要

main 分支领先 desktop-mvp-slim 共 **5464** 个提交，本报告筛选了其中 **50** 个值得 cherry-pick 的提交：

| 优先级 | 提交数 | 类别 |
|--------|--------|------|
| Priority 1 | 6 | 安全修复 |
| Priority 2 | 5 | Gateway 核心 |
| Priority 3 | 6 | Subagent/Cron |
| Priority 4 | 6 | WhatsApp |
| Priority 5 | 5 | Discord/平台 |
| Priority 6 | 8 | 配置/工具 |
| Priority 7 | 4 | 插件系统 |
| Priority 8 | 2 | Chrome 扩展 |
| Priority 9 | 8 | 其他 |
| **总计** | **50** | (从 5464 个中筛选) |

---

## 建议

1. **优先应用 Priority 1 和 Priority 2** 的提交，这些是核心安全和稳定性修复
2. **根据实际使用场景选择** 其他优先级的提交
3. **在执行前创建备份分支**
4. **逐个应用或小批量应用**，便于排查冲突
5. **测试每个批量应用后** 的功能是否正常
