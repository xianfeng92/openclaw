# Channels And Extensions Rules

## Shared Change Rule

If a change touches routing, message delivery, allowlists, pairing, onboarding, or shared command gating, inspect both:

- Built-in channels under `src/telegram`, `src/discord`, `src/slack`, `src/signal`, `src/imessage`, `src/web`, `src/channels`, `src/routing`
- Extension channels under `extensions/*`

## Plugin Dependency Rule

- Keep plugin-only runtime dependencies in the extension package.
- Do not move extension-only dependencies into the root package unless core code needs them.

## Validation

- Call out which channel surfaces were reviewed.
- Add or update tests where shared behavior changes.
