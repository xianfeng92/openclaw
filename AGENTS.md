# OpenClaw AI Bootstrap

Use this file as the repository bootstrap only. Do not load the whole repository by default.

## Start Here

1. Read `AI_CONTEXT_INDEX.md` for repository map, source-of-truth docs, verified commands, and default ignore areas.
2. Read `AI_TASK_TEMPLATE.md` before handling any medium or large task.
3. Read `.ai/rules/INDEX.md` and then load only the rule files that match the current task.

## Default Ignore Areas

Ignore these unless the task explicitly requires them:

- `.openclaw/worktrees/`
- `node_modules/`
- `dist/`
- `docs/zh-CN/`
- `docs/.i18n/`
- app-local task logs and caches such as `apps/windows/.openclaw/`

## Universal Repo Rules

- Verify answers in code; do not guess.
- Keep commits scoped; use `scripts/committer "<msg>" <file...>`.
- Do not edit generated docs under `docs/zh-CN/**` unless explicitly asked.
- Do not edit `node_modules` or vendored dependency contents.
- Do not use destructive git commands unless explicitly requested.
- Do not create or modify git worktrees unless explicitly requested.
- Do not change versions, publish packages, or run release steps without explicit approval.
- When working on GitHub issues or PRs, print the full URL at the end of the task.

## Rule Routing

- Core engineering and task execution: `.ai/rules/core.md`
- Channels, routing, and extensions: `.ai/rules/channels.md`
- Docs and Mintlify: `.ai/rules/docs.md`
- Windows / CyDeck terminal work: `.ai/rules/windows.md`
- CLI and terminal output: `.ai/rules/cli-terminal.md`
- External messaging surfaces: `.ai/rules/messaging.md`
- Tool schema work: `.ai/rules/tool-schema.md`
- Dependency and package changes: `.ai/rules/dependencies.md`
- Apple platforms: `.ai/rules/apple-platforms.md`
- PR review workflow: `.ai/rules/review.md`
- Release workflow: `.ai/rules/release.md`
- Specialized repo safety and legacy guidance: `.ai/rules/reference.md`

## Task Discipline

- If the user asks for planning only, stop at planning.
- Otherwise, assume the user wants implementation plus verification.
- For non-trivial work, restate the task in terms of goal, scope, constraints, verification, and definition of done before broad exploration.
