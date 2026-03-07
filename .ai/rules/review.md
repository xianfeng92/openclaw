# PR Review Rules

## Review Mode

- If the task is a PR review, do not change code.
- Do not switch branches.
- Use `gh pr view` and `gh pr diff` as the primary inputs.

## Output Format

- Findings first, ordered by severity.
- Include file references.
- Keep summaries brief and secondary.
- If there are no findings, say so explicitly and mention any residual risk or missing validation.
