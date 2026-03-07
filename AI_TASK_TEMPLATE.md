# AI Task Template

Use this template for any medium or large task.

```text
Goal:

Why:

Scope:

Non-goals:

Start files:

Constraints:

Expected output:

Verification:

Definition of done:
```

## Field Guidance

- `Goal`: the exact outcome wanted.
- `Why`: the product or engineering reason. This helps the agent choose sound tradeoffs.
- `Scope`: directories, modules, or surfaces that are in play.
- `Non-goals`: what must not be changed.
- `Start files`: the first files the agent should inspect before broad search.
- `Constraints`: performance, compatibility, security, style, or workflow restrictions.
- `Expected output`: code, docs, plan, review, PR comment, test, or another concrete artifact.
- `Verification`: exact commands or manual checks to run.
- `Definition of done`: the conditions that make the task complete.

## Example

```text
Goal:
Fix Windows agent spawn failures caused by shell mismatches.

Why:
CyDeck task spawn should be reliable on Windows without requiring prompt-perfect shell syntax.

Scope:
apps/windows terminal orchestration and exec compatibility.

Non-goals:
Do not redesign the terminal UI or touch unrelated Phase A planning docs.

Start files:
apps/windows/src/main/windows-agent-manager.ts
src/agents/bash-tools.exec.ts

Constraints:
Keep existing gateway behavior intact. Preserve scoped commits and add targeted tests.

Expected output:
Code changes plus tests.

Verification:
pnpm vitest run apps/windows/src/main/windows-agent-manager.test.ts
pnpm vitest run src/agents/bash-tools.exec.windows-fallback.test.ts
Manual /spawn smoke test on Windows.

Definition of done:
Bare PowerShell cmdlets no longer fail in cmd-only paths and targeted tests pass.
```

## Operator Notes

- For planning-only work, set `Expected output` to a document or checklist and say that implementation is out of scope.
- For code reviews, set `Expected output` to findings only and explicitly say no code changes.
- For multi-step initiatives, split the work into multiple task briefs instead of one giant brief.
