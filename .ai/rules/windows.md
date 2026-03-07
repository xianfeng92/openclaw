# Windows And CyDeck Rules

## Scope

Apply these rules for `apps/windows/**` and Windows-specific terminal, spawn, or exec behavior in shared code.

## Command Rules

- Prefer commands that are explicit about shell expectations.
- In cmd-only paths, do not emit bare PowerShell cmdlets without a wrapper.
- When a task involves shell execution, inspect both the caller and the execution layer.

## Files To Check Together

- `apps/windows/src/main/**`
- `apps/windows/src/preload/**`
- `apps/windows/src/terminal/**`
- Any shared exec or agent infrastructure under `src/agents/**`

## Validation

- Add targeted tests for shell compatibility, spawn, IPC, and settings wiring.
- Include at least one manual Windows smoke path when behavior is user-visible.
