# Step 3 Demo Report

## Task

- Use fs.read to list a directory tree
- Use bash.exec to run a whitelisted command

## Tool Streaming Contract

- Tool stream includes phase=start|update|result and toolCallId (already emitted in runtime handlers)

## fs.read Output

# Directory Tree

- Path: `src/agents`
- Depth: 2
- Entries: 120 (truncated)

- 📁 src\agents\auth-profiles
  - 📄 src\agents\auth-profiles\constants.ts
  - 📄 src\agents\auth-profiles\display.ts
  - 📄 src\agents\auth-profiles\doctor.ts
  - 📄 src\agents\auth-profiles\external-cli-sync.ts
  - 📄 src\agents\auth-profiles\oauth.fallback-to-main-agent.test.ts
  - 📄 src\agents\auth-profiles\oauth.ts
  - 📄 src\agents\auth-profiles\order.ts
  - 📄 src\agents\auth-profiles\paths.ts
  - 📄 src\agents\auth-profiles\profiles.ts
  - 📄 src\agents\auth-profiles\repair.ts
  - 📄 src\agents\auth-profiles\session-override.test.ts
  - 📄 src\agents\auth-profiles\session-override.ts
  - 📄 src\agents\auth-profiles\store.ts
  - 📄 src\agents\auth-profiles\types.ts
  - 📄 src\agents\auth-profiles\usage.ts
- 📁 src\agents\cli-runner
  - 📄 src\agents\cli-runner\helpers.ts
- 📁 src\agents\pi-embedded-helpers
  - 📄 src\agents\pi-embedded-helpers\bootstrap.ts
  - 📄 src\agents\pi-embedded-helpers\errors.ts
  - 📄 src\agents\pi-embedded-helpers\google.ts
  - 📄 src\agents\pi-embedded-helpers\images.ts
  - 📄 src\agents\pi-embedded-helpers\messaging-dedupe.ts
  - 📄 src\agents\pi-embedded-helpers\openai.ts
  - 📄 src\agents\pi-embedded-helpers\thinking.ts
  - 📄 src\agents\pi-embedded-helpers\turns.ts
  - 📄 src\agents\pi-embedded-helpers\types.ts
- 📁 src\agents\pi-embedded-runner
  - 📁 src\agents\pi-embedded-runner\run
    - 📄 src\agents\pi-embedded-runner\run\attempt.test.ts
    - 📄 src\agents\pi-embedded-runner\run\attempt.ts
    - 📄 src\agents\pi-embedded-runner\run\images.test.ts
    - 📄 src\agents\pi-embedded-runner\run\images.ts
    - 📄 src\agents\pi-embedded-runner\run\params.ts
    - 📄 src\agents\pi-embedded-runner\run\payloads.test.ts
    - 📄 src\agents\pi-embedded-runner\run\payloads.ts
    - 📄 src\agents\pi-embedded-runner\run\types.ts
  - 📄 src\agents\pi-embedded-runner\abort.ts
  - 📄 src\agents\pi-embedded-runner\cache-ttl.ts
  - 📄 src\agents\pi-embedded-runner\compact.ts
  - 📄 src\agents\pi-embedded-runner\extensions.ts
  - 📄 src\agents\pi-embedded-runner\extra-params.ts
  - 📄 src\agents\pi-embedded-runner\google.test.ts
  - 📄 src\agents\pi-embedded-runner\google.ts
  - 📄 src\agents\pi-embedded-runner\history.ts
  - 📄 src\agents\pi-embedded-runner\lanes.ts
  - 📄 src\agents\pi-embedded-runner\logger.ts
  - 📄 src\agents\pi-embedded-runner\model.test.ts
  - 📄 src\agents\pi-embedded-runner\model.ts
  - 📄 src\agents\pi-embedded-runner\run.overflow-compaction.test.ts
  - 📄 src\agents\pi-embedded-runner\run.ts
  - 📄 src\agents\pi-embedded-runner\runs.ts
  - 📄 src\agents\pi-embedded-runner\sandbox-info.ts
  - 📄 src\agents\pi-embedded-runner\session-manager-cache.ts
  - 📄 src\agents\pi-embedded-runner\session-manager-init.ts
  - 📄 src\agents\pi-embedded-runner\system-prompt.ts
  - 📄 src\agents\pi-embedded-runner\tool-split.ts
  - 📄 src\agents\pi-embedded-runner\types.ts
  - 📄 src\agents\pi-embedded-runner\utils.ts
- 📁 src\agents\pi-extensions
  - 📁 src\agents\pi-extensions\context-pruning
    - 📄 src\agents\pi-extensions\context-pruning\extension.ts
    - 📄 src\agents\pi-extensions\context-pruning\pruner.ts
    - 📄 src\agents\pi-extensions\context-pruning\runtime.ts
    - 📄 src\agents\pi-extensions\context-pruning\settings.ts
    - 📄 src\agents\pi-extensions\context-pruning\tools.ts
  - 📄 src\agents\pi-extensions\compaction-safeguard-runtime.ts
  - 📄 src\agents\pi-extensions\compaction-safeguard.test.ts
  - 📄 src\agents\pi-extensions\compaction-safeguard.ts
  - 📄 src\agents\pi-extensions\context-pruning.test.ts
  - 📄 src\agents\pi-extensions\context-pruning.ts
- 📁 src\agents\sandbox
  - 📄 src\agents\sandbox\browser-bridges.ts
  - 📄 src\agents\sandbox\browser.ts
  - 📄 src\agents\sandbox\config-hash.ts
  - 📄 src\agents\sandbox\config.ts
  - 📄 src\agents\sandbox\constants.ts
  - 📄 src\agents\sandbox\context.ts
  - 📄 src\agents\sandbox\docker.ts
  - 📄 src\agents\sandbox\manage.ts
  - 📄 src\agents\sandbox\prune.ts
  - 📄 src\agents\sandbox\registry.ts
  - 📄 src\agents\sandbox\runtime-status.ts
  - 📄 src\agents\sandbox\shared.ts
  - 📄 src\agents\sandbox\tool-policy.test.ts
  - 📄 src\agents\sandbox\tool-policy.ts
  - 📄 src\agents\sandbox\types.docker.ts
  - 📄 src\agents\sandbox\types.ts
  - 📄 src\agents\sandbox\workspace.ts
- 📁 src\agents\schema
  - 📄 src\agents\schema\clean-for-gemini.ts
  - 📄 src\agents\schema\typebox.ts
- 📁 src\agents\skills
  - 📄 src\agents\skills\bundled-context.ts
  - 📄 src\agents\skills\bundled-dir.test.ts
  - 📄 src\agents\skills\bundled-dir.ts
  - 📄 src\agents\skills\config.ts
  - 📄 src\agents\skills\env-overrides.ts
  - 📄 src\agents\skills\frontmatter.test.ts
  - 📄 src\agents\skills\frontmatter.ts
  - 📄 src\agents\skills\plugin-skills.ts
  - 📄 src\agents\skills\refresh.test.ts
  - 📄 src\agents\skills\refresh.ts
  - 📄 src\agents\skills\serialize.ts
  - 📄 src\agents\skills\types.ts
  - 📄 src\agents\skills\workspace.ts
- 📁 src\agents\test-helpers
  - 📄 src\agents\test-helpers\fast-coding-tools.ts
  - 📄 src\agents\test-helpers\fast-core-tools.ts
- 📁 src\agents\tools
  - 📄 src\agents\tools\agent-step.ts
  - 📄 src\agents\tools\agents-list-tool.ts
  - 📄 src\agents\tools\browser-tool.schema.ts
  - 📄 src\agents\tools\browser-tool.test.ts
  - 📄 src\agents\tools\browser-tool.ts
  - 📄 src\agents\tools\canvas-tool.ts
  - 📄 src\agents\tools\common.test.ts
  - 📄 src\agents\tools\common.ts
  - 📄 src\agents\tools\cron-tool.test.ts

## bash.exec Output

` ext
Path

---

C:\Users\xforg\Desktop\openclaw
`
