# AI Context Index

## Purpose

Use this file as the first-stop map for coding agents and operators working with AI in this repository.

## First Files To Read

- Repository bootstrap: `AGENTS.md`
- Task prompt format: `AI_TASK_TEMPLATE.md`
- AI evaluation set: `AI_EVALS.md`
- Analysis and rationale: `AI_COLLABORATION_QUALITY.md`
- Scoped AI rules: `.ai/rules/INDEX.md`

## Default Ignore Areas

These paths are high-noise by default and should be ignored unless the task explicitly targets them:

- `.openclaw/worktrees/`
- `node_modules/`
- `dist/`
- `coverage/`
- `docs/zh-CN/`
- `docs/.i18n/`
- `apps/windows/.openclaw/`

## Source Of Truth By Area

### Core product and code

- Main code: `src/`
- Windows app: `apps/windows/`
- Extensions: `extensions/`
- UI: `ui/`

### AI collaboration system

- Bootstrap: `AGENTS.md`
- Context map: `AI_CONTEXT_INDEX.md`
- Task brief template: `AI_TASK_TEMPLATE.md`
- Eval corpus: `AI_EVALS.md`
- Scoped rules: `.ai/rules/*.md`

### Documentation

- Primary docs: `docs/`
- Docs rules: `.ai/rules/docs.md`
- Generated translation docs: `docs/zh-CN/` and `docs/.i18n/` (not authoritative for default coding tasks)

### PR and issue workflows

- PR submission doc: `docs/help/submitting-a-pr.md`
- Issue submission doc: `docs/help/submitting-an-issue.md`
- Review workflow rules: `.ai/rules/review.md`

### Release workflow

- Release reference: `docs/reference/RELEASING.md`
- macOS release notes: `docs/platforms/mac/release.md`
- Release rules: `.ai/rules/release.md`

## Verified Commands

Use these first before inventing alternatives:

- Install deps: `pnpm install`
- Build: `pnpm build`
- Type checks: `pnpm tsgo`
- Lint and format checks: `pnpm check`
- Tests: `pnpm test`
- Targeted vitest: `pnpm vitest run <path-to-test>`
- Dev CLI: `pnpm openclaw ...`
- Scoped commit: `bash scripts/committer "<msg>" <file...>`

## Verified Windows Search Patterns

Prefer explicit PowerShell forms when working on Windows:

- File search: `Get-ChildItem -Recurse -File`
- Text search: `Get-ChildItem -Recurse -File | Select-String -Pattern "..."`
- File preview: `Get-Content <path> -TotalCount 200`

If a bare PowerShell cmdlet is sent through a cmd-only path, use a PowerShell wrapper or a repository-safe fallback.

## High-Risk Areas

Load more context before editing these:

- `src/agents/`
- `src/infra/`
- `src/routing/`
- `src/channels/`
- `apps/windows/src/main/`
- `apps/windows/src/terminal/`

## Decision Rules

- If touching shared routing or channel behavior, inspect both built-in channels and extensions.
- If touching docs, follow Mintlify link rules and avoid editing generated Chinese docs unless asked.
- If touching Windows terminal behavior, inspect main, preload, renderer/terminal, and tests together.
- If reviewing a PR, do not change branches or code unless the task explicitly moves from review to landing.

## Where To Put New AI Assets

- Reusable rules: `.ai/rules/`
- Reusable prompts and templates: repository root `AI_*.md` files unless a subdirectory is clearly better
- Evaluation tasks: `AI_EVALS.md` or future `.ai/evals/`
