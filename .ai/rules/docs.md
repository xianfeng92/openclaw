# Docs Rules

## Source Of Truth

- Primary docs live in `docs/`.
- Generated Chinese docs under `docs/zh-CN/**` should not be edited unless explicitly requested.

## Linking

- Internal docs links should be root-relative and omit `.md` and `.mdx`.
- Section links should use anchors on root-relative paths.
- README links should use full `https://docs.openclaw.ai/...` URLs.
- When replying with docs links, use full docs URLs when the operator expects copyable links.

## Content Rules

- Use generic placeholders for hosts, users, device names, and secrets.
- Avoid headings that create unstable Mintlify anchors.

## Workflow

- Update English docs first.
- Only run the Chinese docs pipeline when the task explicitly requires translation updates.
