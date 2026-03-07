# CLI And Terminal Rules

## Scope

Apply these rules for:

- `src/cli/**`
- `src/terminal/**`
- terminal-oriented Windows app work under `apps/windows/src/terminal/**`

## Output And Progress

- Use `src/cli/progress.ts` for CLI progress output; do not hand-roll progress bars or spinners.
- Keep status output compatible with `src/terminal/table.ts`.
- Prefer ANSI-safe wrapping and pasteable output for status surfaces.

## Change Discipline

- When changing a CLI command, keep help text, parsing, runtime behavior, and tests in sync.
- When changing terminal behavior, inspect command handlers, adapters, and transport edges together.
