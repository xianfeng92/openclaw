# Development Guide

Welcome to the OpenClaw development guide! This document covers everything you need to contribute to the project.

---

## Quick Start

```bash
# Clone and setup
git clone https://github.com/openclaw/openclaw.git
cd openclaw
pnpm install
pnpm build

# Run in development
pnpm openclaw onboard
pnpm gateway:watch
```

**Requirements:** Node.js ≥22, pnpm

---

## Project Structure

```
openclaw/
├── src/                    # Core source code
│   ├── cli/               # Command-line interface
│   ├── commands/          # CLI command implementations
│   ├── gateway/           # Gateway server (HTTP/WebSocket)
│   ├── channels/          # Channel integrations
│   ├── agents/            # AI agent implementations
│   ├── config/            # Configuration management
│   ├── infra/             # Infrastructure utilities
│   └── ...
├── apps/                   # Platform-specific applications
│   ├── macos/             # macOS desktop app
│   ├── windows/           # Windows desktop app
│   └── shared/            # Shared app code
├── extensions/             # Plugin extensions
├── skills/                 # AI skills and capabilities
├── docs/                   # Documentation
└── ui/                     # Web UI (Control UI, WebChat)
```

---

## Architecture Overview

OpenClaw follows a **Gateway-based architecture**:

```
┌─────────────────────────────────────────────────────┐
│                   Client Layer                       │
│  CLI  │  Web UI  │  macOS App  │  Mobile Nodes      │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│                    Gateway                           │
│         HTTP + WebSocket Control Plane              │
│                                                     │
│  • Method Router  • Auth  • Event Bus               │
└────────────────────┬────────────────────────────────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
    ┌─────────┐ ┌──────┐ ┌────────────┐
    │ Agent   │ │Tools │ │  Sessions  │
    │ Runtime │ │      │ │            │
    └─────────┘ └──────┘ └────────────┘
```

### Key Modules

| Module           | Responsibility                         | Location                               |
| ---------------- | -------------------------------------- | -------------------------------------- |
| **Gateway**      | HTTP/WS service, auth, routing, events | `src/gateway/`                         |
| **Orchestrator** | Request handling, agent invocation     | `src/gateway/server-methods/agent.ts`  |
| **Sessions**     | Session storage, transcripts           | `src/config/sessions/`                 |
| **Tools**        | Tool assembly, execution               | `src/agents/pi-tools.ts`               |
| **Channels**     | Platform integrations                  | `src/channels/`, `src/telegram/`, etc. |

### Communication Protocol

- **UI ↔ Gateway**: WebSocket frames (`req/res/event/hello-ok`)
- **Gateway HTTP**: `/tools/invoke`, `/v1/chat/completions`, `/v1/responses`
- **Gateway ↔ Agent**: In-process function calls
- **Event Bus**: `emitAgentEvent/onAgentEvent` for lifecycle events

---

## Development Commands

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Type checking
pnpm tsc          # Full type check
pnpm tsgo         # Quick type check (no emit)

# Linting and formatting
pnpm check        # Run oxlint + oxfmt
pnpm fix          # Auto-fix issues

# Tests
pnpm test               # Unit/integration tests
pnpm test:e2e           # End-to-end tests
pnpm test:live          # Live tests (requires API keys)
pnpm test:coverage      # Coverage report

# Development servers
pnpm gateway:watch      # Auto-reload gateway on TS changes
pnpm dev                # Full dev mode

# UI
pnpm ui:build           # Build web UI
pnpm ui:dev             # UI dev server

# Run CLI locally
pnpm openclaw <command>
```

---

## Testing

See [Testing](/development/testing) for complete details.

### Test Suites

| Suite            | Command          | Scope                                   |
| ---------------- | ---------------- | --------------------------------------- |
| Unit/Integration | `pnpm test`      | Pure unit tests, in-process integration |
| E2E              | `pnpm test:e2e`  | Gateway smoke tests, networking         |
| Live             | `pnpm test:live` | Real providers/models (requires keys)   |

### Before Pushing

```bash
pnpm build && pnpm check && pnpm test
```

---

## Contributing

### Getting Started

1. **Bugs & small fixes** → Open a PR!
2. **New features/architecture** → Start a [GitHub Discussion](https://github.com/openclaw/openclaw/discussions) or ask in Discord first
3. **Questions** → Discord #setup-help

### Before Submitting a PR

- Test locally with your OpenClaw instance
- Run tests: `pnpm build && pnpm check && pnpm test`
- Keep PRs focused (one thing per PR)
- Describe what & why

### AI-Assisted PRs

Built with Claude, Codex, or other AI tools? **Awesome - just mark it!**

- [ ] Mark as AI-assisted in the PR title or description
- [ ] Note the degree of testing (untested/lightly/fully)
- [ ] Include prompts or session logs if possible
- [ ] Confirm you understand what the code does

### Coding Style

- Language: TypeScript (ESM)
- Formatting: Oxlint + Oxfmt (`pnpm check`)
- Keep files under ~700 LOC when possible
- Add brief comments for non-obvious logic
- Prefer strict typing; avoid `any`

---

## Common Debugging Patterns

### Gateway Issues

```bash
# Check gateway status
openclaw gateway status

# View logs
openclaw logs

# Run diagnostics
openclaw doctor

# Verbose mode
openclaw gateway --verbose
```

### Session Debugging

Session files are stored at:

- Dev: `~/.openclaw-dev/agents/main/sessions/*.jsonl`
- Prod: `~/.openclaw/agents/main/sessions/*.jsonl`

Check `stopReason` and `errorMessage` fields for issues.

### Build Issues

```bash
# Clean build
rm -rf dist node_modules/.cache
pnpm build

# Check types
pnpm tsc
```

---

## Additional Resources

- **[Architecture](/concepts/architecture)** — Detailed system architecture
- **[Contributing](/development/contributing)** — Full contribution guidelines
- **[Troubleshooting](/troubleshooting)** — Common issues and solutions
- **[Discord](https://discord.gg/clawd)** — Community chat
- **[GitHub](https://github.com/openclaw/openclaw)** — Source code & issues

---

## Maintainers

- **Peter Steinberger** (@steipete) — Benevolent Dictator
- **Shadow** (@thewilloftheshadow) — Discord + Slack
- **Jos** (@joshp123) — Telegram, API, Nix
- **Christoph Nakazawa** (@cpojer) — JS Infra
- **Gustavo Madeira Santana** (@gumadeiras) — Multi-agents, CLI, web UI
