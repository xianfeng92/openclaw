# Dependency And Package Rules

## Scope

Apply these rules for:

- `package.json`
- lockfile, patch, override, and vendored dependency work
- packaging or publish-related dependency changes

## Guardrails

- Never update the Carbon dependency without explicit operator approval.
- Any dependency listed in `pnpm.patchedDependencies` must use an exact version.
- Patching dependencies or vendored code requires explicit approval.
- Do not move extension-only runtime dependencies into the root package unless core code needs them.

## Workflow

- Prefer normal package updates over vendoring or patching.
- If package changes affect install or publish behavior, inspect both root and extension package metadata.
