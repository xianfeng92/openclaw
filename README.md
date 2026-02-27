# OpenClaw - Super AI Terminal

> EXFOLIATE! EXFOLIATE!

[CI](https://github.com/openclaw/openclaw/actions/workflows/ci.yml?branch=main)
· [Releases](https://github.com/openclaw/openclaw/releases)
· [Discord](https://discord.gg/clawd)
· [Docs](https://docs.openclaw.ai)
· [Getting Started](https://docs.openclaw.ai/start/getting-started)
· [Chinese Docs](https://docs.openclaw.ai/zh-CN)

**OpenClaw** is a multi-platform messaging gateway with a built-in Super AI Terminal. Connect to 20+ messaging platforms (WhatsApp, Telegram, Discord, Slack, and more), orchestrate AI agents with context awareness, manage workflows, and automate—all from your terminal.

- **Multi-Platform Gateway**: Single WebSocket gateway managing all messaging channels
- **Super Terminal**: Terminal UI (Ctrl+Shift+T) with markdown rendering, Dracula theme, and sidebar panels
- **AI Orchestration**: Agent spawning, context management, pattern tracking, and workflow automation
- **Desktop Apps**: Native macOS and Windows applications

**Project Focus:** Building a **Super AI Terminal** with intelligent orchestration capabilities.

**Requirements:** Node.js 22+ (package baseline: `>=22.22.0`)

## Quick Start

```bash
# Install (npm)
npm install -g openclaw@latest

# Recommended first-run setup
openclaw onboard --install-daemon

# Check gateway
openclaw gateway status

# Open dashboard (Control UI)
openclaw dashboard
```

Alternative installers:

- macOS/Linux: `curl -fsSL https://openclaw.ai/install.sh | bash`
- Windows (PowerShell): `iwr -useb https://openclaw.ai/install.ps1 | iex`

## Current Project Status (Snapshot: 2026-02-26)

| Workstream               | Status                                    | Notes                                                                                                                                                   |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop MVP Slim         | Phase 0-5 complete                        | Added Super Terminal (Ctrl+Shift+T) with markdown rendering, Dracula theme, and enhanced UX.                                                            |
| Slim mode strategy       | Locked                                    | `OPENCLAW_DESKTOP_MVP_SLIM` / `CLAWDBOT_DESKTOP_MVP_SLIM` drive runtime slim gating; plugin ecosystem is disabled in slim mode (architecture retained). |
| Minimal toolset strategy | Locked                                    | Opt-in only (`desktopMvpMinimalToolset` or env flag); not default-on.                                                                                   |
| Project Neuro            | P0 complete, P1 complete, P2-001 complete | Event contracts, privacy baseline, context ingest/snapshot, action loop, undo/policy/retention/reliability, and heuristic preview are shipped.          |
| **Super Terminal Core**  | **All backend features complete**         | Context Management, Pattern Management, Workflow, Code Review, Git/PR operations, Babysit Loop.                                                       |
| **Super Terminal UI**   | **Sidebar + Terminal complete**           | Terminal with Dracula theme, sidebar with Tasks/Agents/Context panels.                                                                                  |
| Next focus               | Agent spawning & tmux integration         | Connecting backend orchestration to terminal UI.                                                                                                       |

### Implemented Features (All Tested ✅)

| Feature | Status | Test File |
|---------|--------|-----------|
| Context Management (Obsidian sync) | ✅ Complete | `integration-test.ts` |
| Pattern Management & Recommendation | ✅ Complete | `pattern-recommendation-test.ts` |
| Workflow Management | ✅ Complete | `workflow-service-test.ts` |
| Multi-Model Code Review | ✅ Complete | `integration-test.ts` |
| Git/PR Operations | ✅ Complete | `pr-service-test.ts` |
| Babysit Loop (agent monitoring) | ✅ Complete | `babysit-loop-test.ts` |

## Key Features

### Messaging Gateway
- **20+ Platforms**: WhatsApp (primary), Telegram, Discord, Slack, Signal, LINE, Matrix, Microsoft Teams, iMessage, and more
- **Single WebSocket Gateway**: Unified control plane on port 18789
- **Multi-Channel Routing**: Intelligent message routing and session management

### Super Terminal
- **Terminal UI** (Ctrl+Shift+T): xterm-based with markdown rendering and Dracula theme
- **Sidebar Panels**: Tasks, Agents, and Context management
- **Command Palette**: Quick access to all commands and workflows

### AI Orchestration
- **Agent Spawning**: Dynamic agent creation with tmux integration
- **Context Management**: Obsidian sync for business context, customers, projects, meetings, and decisions
- **Pattern Tracking**: Recognize and recommend effective patterns
- **Workflow Management**: Parameterized command templates and automation
- **Code Review**: Multi-model code review with PR integration
- **Babysit Loop**: Automatic agent monitoring and recovery

### Architecture
- **Plugin System**: Extensible architecture for channels and capabilities
- **Desktop Apps**: Native macOS and Windows applications
- **Profile-Based Runtime**: Multiple runtime profiles (default, dev, custom)
- **Memory Storage**: LanceDB integration for vector embeddings

## System Architecture

OpenClaw is evolving into a **Super AI Terminal** while maintaining backward compatibility with its messaging gateway roots.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Super AI Terminal                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  TUI (Terminal UI)                                       │  │
│  │  - xterm + markdown + Dracula theme                      │  │
│  │  - Sidebar: Tasks/Agents/Context                         │  │
│  │  - Command Palette, Block commands                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Orchestration System                                    │  │
│  │  - Context Manager (Obsidian sync)                       │  │
│  │  - Task Registry + Babysit Loop                          │  │
│  │  - Workflow Service + Command Palette                    │  │
│  │  - Code Review + Git/PR Integration                      │  │
│  │  - Agent Spawning (tmux)                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          ↕ WebSocket                           │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│                    Shared Core (复用层)                         │
│  - Config (schema, paths, sessions)                           │
│  - Protocol (WebSocket client, types)                         │
│  - Infra (runtime, logging, networking, device pairing)       │
│  - Gateway Client (connection, events)                        │
└─────────────────────────────────────────────────────────────────┘
                          ↕ WebSocket
┌─────────────────────────────────────────────────────────────────┐
│                    Gateway (Port 18789)                         │
│  - Session Management                                         │
│  - Agent Coordination                                         │
│  - Multi-channel Routing (WhatsApp, Telegram, Discord...)     │
│  - Plugin System                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Architecture Layers

| Layer | Purpose | Status |
|-------|---------|--------|
| **Super AI Terminal** | TUI + Orchestration + Context-aware AI | 🚧 In active development |
| **Shared Core** | Config, Protocol, Infrastructure | ✅ Stable |
| **Gateway** | Multi-channel messaging + Agent coordination | ✅ Stable |

### Module Organization

```
src/
├── terminal/           # Terminal UI components (TUI)
├── orchestration/      # Orchestration system (Super Terminal)
│   ├── context-manager.ts    # Context management
│   ├── task-registry.ts      # Task lifecycle
│   ├── workflow-service.ts   # Workflow automation
│   ├── code-reviewer.ts      # Code review
│   ├── babysit-loop.ts       # Agent monitoring
│   └── tmux-manager.ts       # Agent spawning
├── cli/                # CLI commands
├── config/             # Configuration (shared)
├── infra/              # Infrastructure (shared)
├── gateway/            # Gateway protocol & client
└── channels/           # Channel implementations
```

### Design Principles

1. **Layered Architecture**: Super Terminal → Shared Core → Gateway
2. **WebSocket Communication**: All layers communicate via WebSocket protocol
3. **Shared Foundation**: Terminal and Gateway both reuse core modules
4. **Desktop MVP Slim Mode**: Runtime feature gating for minimal surface area
5. **Plugin Extensibility**: Both Terminal and Gateway support plugins

## Technology Stack

- **TypeScript** (ESM modules, ES2023 target)
- **Node.js** 22+ runtime
- **Pi Agent Framework** (@mariozechner/pi-*) for AI interactions
- **xterm** for terminal UI
- **Hono** for web framework
- **Baileys** for WhatsApp Web API
- **sqlite-vec** for vector database
- **Vitest** for testing (70% coverage threshold)

## Core Commands

### Setup & Management
```bash
openclaw onboard [--install-daemon]    # First-run setup
openclaw gateway status                 # Check gateway status
openclaw dashboard                      # Open web dashboard
openclaw status [--all]                 # System status check
openclaw doctor                         # Troubleshooting
```

### Agent & Terminal
```bash
openclaw tui                            # Launch Super Terminal
openclaw agent                          # Run AI agents
openclaw agents list                    # List configured agents
```

### Messaging
```bash
openclaw channels status                # List all channels
openclaw message send                   # Send message
```

### Configuration
```bash
openclaw config set <key> <value>       # Set configuration
openclaw config get <key>               # Get configuration
```

### Development
```bash
pnpm dev                                # Development mode
pnpm build                              # Build project
pnpm check                              # TypeScript + lint + format
pnpm test                               # Run tests
pnpm test:coverage                      # Coverage report
```

## Development

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
pnpm install
pnpm build
pnpm check
pnpm test
```

Run in development:

```bash
pnpm dev
```

---

## Development Workflow Standards

### Project Goal
Build a **Super AI Terminal** with intelligent orchestration capabilities.

### Feature Development Workflow

**Every new feature MUST follow this process:**

```
1. Implement Feature
   ↓
2. Write Functional Tests
   ↓
3. Verify Compilation
   ↓
4. Run Tests (All Pass)
   ↓
5. Deliver
```

### Delivery Standards

| Requirement | Description |
|-------------|-------------|
| **Compilation** | Code must compile without errors |
| **Functional Tests** | Each feature must have tests verifying core functionality |
| **Test Coverage** | Tests must cover happy path and edge cases |
| **No Broken Builds** | Never commit code that fails to compile |

### Testing Structure

```
tests/
├── integration-test.ts       # Main integration tests (run all)
├── terminal-test-setup.ts    # Test data setup
├── babysit-loop-test.ts      # Babysit loop tests
├── pattern-recommendation-test.ts
├── pr-service-test.ts
└── workflow-service-test.ts
```

### Running Tests

```bash
# Run all integration tests
npx tsx tests/integration-test.ts

# Run specific test suite
npx tsx tests/pattern-recommendation-test.ts

# Setup test data
npx tsx tests/terminal-test-setup.ts

# Build verification
npx tsdown --no-config apps/windows/src/preload/terminal-api.ts -f cjs -d apps/windows/dist/preload
```

### Feature Checklist

Before marking a feature complete:

- [ ] Code compiles (`pnpm build`)
- [ ] Integration tests pass (`npx tsx tests/integration-test.ts`)
- [ ] Feature-specific tests pass
- [ ] Documentation updated (if needed)
- [ ] No console errors or warnings

---

## Documentation

- [Getting Started](https://docs.openclaw.ai/start/getting-started)
- [Channels](https://docs.openclaw.ai/channels)
- [Control UI](https://docs.openclaw.ai/web/control-ui)
- [Dashboard](https://docs.openclaw.ai/web/dashboard)
- [Gateway Configuration](https://docs.openclaw.ai/gateway/configuration)
- [Windows Platform](https://docs.openclaw.ai/platforms/windows)
- [Development](https://docs.openclaw.ai/development)
- [Troubleshooting](https://docs.openclaw.ai/troubleshooting)
- [Chinese Docs](https://docs.openclaw.ai/zh-CN)

## License

MIT © [OpenClaw contributors](https://github.com/openclaw/openclaw/graphs/contributors)
