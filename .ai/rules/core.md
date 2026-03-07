# Core AI Rules

## Working Model

- Verify in code; do not guess.
- Start with the smallest relevant file set, then widen search only if needed.
- Prefer explicit task briefs for medium and large work.
- If the user asks for planning only, stop at planning. Otherwise, implement and verify.

## Repo Safety

- Keep commits scoped with `scripts/committer`.
- Do not use destructive git commands unless explicitly requested.
- Do not modify git worktrees unless explicitly requested.
- Do not edit `node_modules`.
- Do not change versions or publish without explicit approval.

## Search Discipline

- Ignore `.openclaw/worktrees/`, `node_modules/`, `dist/`, `docs/zh-CN/`, `docs/.i18n/`, and app-local caches unless the task explicitly targets them.
- Prefer source files and source-of-truth docs over generated mirrors or historical planning docs.

## Verification

- Prefer targeted tests first.
- Record the exact verification commands used.
- If you could not run a needed check, say so explicitly.
