# Tool Schema Rules

## Scope

Apply these rules for tool definition and schema work, especially under:

- `src/agents/**`
- `src/gateway/**`
- tool input schema definitions

## Schema Guardrails

- Avoid `Type.Union`, `anyOf`, `oneOf`, and `allOf` in tool input schemas.
- Prefer `Type.Optional(...)` over `... | null`.
- Keep the top-level schema as an object with explicit properties.
- Avoid raw `format` property names when validators may treat them as reserved.

## Design Goal

- Favor schemas that are narrow, explicit, and validator-friendly over highly dynamic shapes.
