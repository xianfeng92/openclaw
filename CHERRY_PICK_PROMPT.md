# Cherry-Pick 执行提示词

请按照以下步骤执行从 `main` 分支到 `desktop-mvp-slim` 分支的 cherry-pick 操作：

## 前置准备

1. 确保当前工作目录是 `C:\Users\xforg\Desktop\openclaw`
2. 确保所有本地更改已提交或暂存
3. 创建备份分支

```bash
cd C:\Users\xforg\Desktop\openclaw
git checkout desktop-mvp-slim
git pull origin desktop-mvp-slim
git branch backup-before-cherry-pick-$(date +%Y%m%d)
```

## 执行顺序

按以下优先级顺序执行 cherry-pick，每执行完一个优先级后检查是否有冲突：

### Priority 1: 安全修复 (6个)

```bash
git cherry-pick -x ff10fe8b9  # fix(security): require /etc/shells for shell env fallback
git cherry-pick -x 90383e00e  # fix(security): harden autoAllowSkills exec matching
git cherry-pick -x fefc41457  # fix(security): harden structural session path fallback
git cherry-pick -x e578521ef  # fix(security): harden session export image data-url handling
git cherry-pick -x f8524ec77  # fix(security): harden exported session html rendering
git cherry-pick -x d51a4695f  # Deny cron tool on /tools/invoke by default
```

### Priority 2: Gateway 核心修复 (5个)

```bash
git cherry-pick -x 3f5e7f815  # fix(gateway): consume allow-once approvals to prevent replay
git cherry-pick -x 83689fc83  # fix: include trusted-proxy in sharedAuthOk check
git cherry-pick -x c1fe688d4  # fix(gateway): safely extract text from content arrays
git cherry-pick -x 3129d1c48  # fix(gateway): start browser HTTP control server module
git cherry-pick -x 6f0dd6179  # fix(exec): restore two-phase approval registration flow
```

### Priority 3: Subagent/Cron 修复 (6个)

```bash
git cherry-pick -x 8d2035633  # fix(agents): include SOUL.md, IDENTITY.md, USER.md
git cherry-pick -x 2398b5137  # fix: include available_skills in isolated cron sessions
git cherry-pick -x d95ee859f  # fix(cron): use full prompt mode for isolated cron sessions
git cherry-pick -x 8c8374def  # fix(cron): treat embedded error payloads as run failures
git cherry-pick -x 5710d7252  # feat(agents): configurable default runTimeoutSeconds
git cherry-pick -x c3b3065cc  # fix(subagents): reconcile orphaned restored runs
```

### Priority 4: WhatsApp 修复 (6个)

```bash
git cherry-pick -x c6bb7b0c0  # fix(whatsapp): groupAllowFrom sender filter bypassed
git cherry-pick -x 57783680a  # fix(whatsapp): guard updateLastRoute when dmScope isolates
git cherry-pick -x 3a653082d  # fix(config): align whatsapp enabled schema with auto-enable
git cherry-pick -x 3d22af692  # fix(whatsapp): suppress reasoning/thinking content from delivery
git cherry-pick -x aef45b2ab  # fix(logging): redact phone numbers and message content
git cherry-pick -x b5881d9ef  # fix: avoid WhatsApp silent turns with final-only delivery
```

### Priority 5: Discord/其他平台修复 (5个)

```bash
git cherry-pick -x 38da3f40c  # fix(discord): suppress reasoning/thinking block payloads
git cherry-pick -x e8a4d5d9b  # fix(discord): strip reasoning tags from partial stream preview
git cherry-pick -x 1298bd4e1  # fix(matrix): skip reasoning-only messages in reply delivery
git cherry-pick -x a7518b758  # fix(feishu): pass parentPeer for topic session binding
git cherry-pick -x bc52d4a45  # fix(openrouter): skip reasoning effort injection for 'auto'
```

### Priority 6: 配置和工具修复 (8个)

```bash
git cherry-pick -x c69fc383b  # fix(config): surface helpful chown hint on EACCES
git cherry-pick -x 424ba72ca  # fix(config): add actionable guidance for dmPolicy
git cherry-pick -x f3459d71e  # fix(exec): treat shell exit codes 126/127 as failures
git cherry-pick -x 252079f00  # fix(agents): repair orphaned tool results for OpenAI
git cherry-pick -x 792bd6195  # fix: recognize Bedrock as Anthropic-compatible
git cherry-pick -x 3823587ad  # fix(agents): allow empty edit replacement text
git cherry-pick -x 58ce0a89e  # fix(cli): load plugin registry for configure/onboard
```

### Priority 7: 插件系统修复 (4个)

```bash
git cherry-pick -x bf91b347c  # fix(plugins): use manifest id as config entry key
git cherry-pick -x 75969ed5c  # fix(plugins): pass session context to before_compaction
git cherry-pick -x 588a188d6  # fix: replace stale plugin webhook routes
git cherry-pick -x d76742ff8  # fix: normalize manifest plugin ids during install
```

### Priority 8: Chrome 扩展修复 (2个)

```bash
git cherry-pick -x 67bac62c2  # fix: Chrome relay extension auto-reattach after SPA navigation
git cherry-pick -x 1237516ae  # fix(chrome-extension): finalize relay endpoint validation
```

### Priority 9: 其他修复 (8个)

```bash
git cherry-pick -x b9e587fb6  # fix(tui): guard sendMessage when disconnected
git cherry-pick -x 053b0df7d  # fix(ui): load saved locale on startup
git cherry-pick -x 7d76c241f  # fix: suppress reasoning payloads from generic channel dispatch
git cherry-pick -x aea28e26f  # fix(auto-reply): expand standalone stop phrases
git cherry-pick -x 6c1ed9493  # fix: harden queue retry debounce and add regression tests
git cherry-pick -x 9d3bd5099  # fix(otel): use protobuf OTLP exporters
git cherry-pick -x 097a6a83a  # fix(cli): replace stale doctor/restart command hints
```

## 冲突处理

如果遇到冲突：

1. 查看冲突文件：`git status`
2. 手动解决冲突
3. 标记为已解决：`git add <resolved-files>`
4. 继续：`git cherry-pick --continue`

如果需要放弃当前 cherry-pick：
```bash
git cherry-pick --abort
```

## 完成后

1. 查看 cherry-pick 的提交：
```bash
git log --oneline -20
```

2. 推送到远程（确认无误后）：
```bash
git push origin desktop-mvp-slim
```

## 注意事项

- 使用 `-x` 参数保留原始提交信息，便于追溯
- 每个优先级执行完后建议测试一下基本功能
- 如果某个提交与现有代码严重冲突，可以跳过该提交并记录下来
- 所有提交 SHA 都是短格式（8位），git 会自动补全
