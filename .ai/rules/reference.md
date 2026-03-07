# Specialized Reference Rules

Load this file only when the task touches these areas.

## Dependency And Packaging Guardrails

- Never update the Carbon dependency without explicit operator approval.
- Any dependency listed in `pnpm.patchedDependencies` must use an exact version.
- Patching dependencies or vendored code requires explicit approval.

## CLI And Terminal Guardrails

- Use `src/cli/progress.ts` for CLI progress output; do not hand-roll progress bars or spinners.
- Keep status output compatible with `src/terminal/table.ts`.

## Session And Messaging Guardrails

- When asked to inspect an agent session file, prefer `~/.openclaw/agents/<agentId>/sessions/*.jsonl` over generic session files.
- Never send partial or streaming replies to external messaging channels; only final replies should go out there.

## Apple And Remote Runtime Guardrails

- Do not rebuild the macOS app over SSH.
- For macOS gateway debugging, prefer the app or project scripts over ad-hoc sessions.

## Publish Guardrails

- Run release and publish work only with explicit approval.
- 1Password-based npm publish flows should run in a fresh tmux session.

## Tool Schema Guardrails

- Avoid `Type.Union`, `anyOf`, `oneOf`, and `allOf` in tool input schemas.
- Prefer `Type.Optional(...)` over `... | null`.
- Avoid raw `format` property names in tool schemas when validators may treat them as reserved.

## High-Signal Lessons

- Keep generated docs and operator-owned docs out of default formatting and retrieval flows.
- Prefer runtime-configurable behavior over hardcoded desktop gates.
- Treat local-only shortcuts and long-lived tool capabilities as security-sensitive surfaces.
