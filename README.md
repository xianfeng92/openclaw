# Super AI Terminal

> EXFOLIATE! EXFOLIATE!

[CI](https://github.com/openclaw/openclaw/actions/workflows/ci.yml?branch=main)
· [Releases](https://github.com/openclaw/openclaw/releases)
· [Discord](https://discord.gg/clawd)
· [Docs](https://docs.openclaw.ai)
· [Getting Started](https://docs.openclaw.ai/start/getting-started)
· [Chinese Docs](https://docs.openclaw.ai/zh-CN)

A **Multi-Model Agent Orchestration** platform with a built-in Super AI Terminal. Part of the [OpenClaw](https://github.com/openclaw/openclaw) project.

Each task is routed to the best AI model for the job—planning to Claude, design to Gemini, implementation to GPT—all working together through shared context.

- **Multi-Model Orchestration**: Route tasks by type—planning to Claude, design to Gemini, implementation to GPT
- **Super Terminal**: Terminal UI (Ctrl+Shift+T) with markdown rendering, Dracula theme, and sidebar panels
- **Agent Coordination**: Multiple agents working in parallel with shared context and workflow coordination
- **Desktop Apps**: Native macOS and Windows applications

**Project Focus:** Building a **Multi-Model Agent Orchestration** system that intelligently routes tasks to the best AI model for each job.

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
| **TODO**                 | 高效交互打磨                               | 优化人机交互体验，提升操作效率。                                                                                                                           |

### Implemented Features (All Tested ✅)

| Feature | Status | Test File |
|---------|--------|-----------|
| Context Management (Obsidian sync) | ✅ Complete | `integration-test.ts` |
| Pattern Management & Recommendation | ✅ Complete | `pattern-recommendation-test.ts` |
| Workflow Management | ✅ Complete | `workflow-service-test.ts` |
| Multi-Model Code Review | ✅ Complete | `integration-test.ts` |
| Git/PR Operations | ✅ Complete | `pr-service-test.ts` |
| Babysit Loop (agent monitoring) | ✅ Complete | `babysit-loop-test.ts` |

### CyDeck 新能力摘要

> 主要面向 `apps/windows` 的 CyDeck Terminal 迭代。

- **Landing 引导式配置**：新增 `/landing` 指令组，支持初始化与维护 `SOUL.md`、`IDENTITY.md`、`USER.md`、`AGENTS.md`、`MEMORY.md`，并支持向导进度持久化、自动跳转到首个缺失步骤、`/landing start --reset` 强制重置。
- **系统提示注入**：运行时会将 Landing 文件拼装为系统上下文，并按会话类型区分注入范围（私有会话包含 `MEMORY.md`，共享会话不注入）。
- **Memory 工具化能力**：网关新增 `tools.memory.search` 与 `tools.memory.get`，支持本地记忆检索与按行读取。
- **会话记忆落盘**：支持会话记忆自动写入、`/session` 旋转写入，以及 pre-compaction flush 触发写入，统一沉淀到 `memory/*.md`。
- **命令行自动补全**：Tab 补全覆盖 slash 命令、子命令、`/config set` 键、`/landing set` 键及常用 shell 命令。
- **Memory 基准与回归对比**：新增基准数据集生成器与 JSON/Markdown 回归报告，可在 memory 策略调整后自动检测退化。

## Key Features

### Messaging Gateway
- **20+ Platforms**: WhatsApp (primary), Telegram, Discord, Slack, Signal, LINE, Matrix, Microsoft Teams, iMessage, and more
- **Single WebSocket Gateway**: Unified control plane on port 18789
- **Multi-Channel Routing**: Intelligent message routing and session management

### Super Terminal
- **Terminal UI** (Ctrl+Shift+T): xterm-based with markdown rendering and Dracula theme
- **Sidebar Panels**: Tasks, Agents, and Context management
- **Command Palette**: Quick access to all commands and workflows
- **TODO**: 高效交互打磨 — 优化人机交互体验，提升操作效率

### Multi-Model AI Orchestration (TODO)
- **Model Routing**: Intelligently assign tasks to the best AI model for the job
- **Agent Spawning**: Dynamic agent creation with tmux integration
- **Context Management**: Shared context across all models and agents
- **Workflow Management**: Parameterized command templates and automation
- **Babysit Loop**: Automatic agent monitoring and recovery

#### Task → Model Routing (TODO)

| Task Type | Recommended Model | Why |
|-----------|-------------------|-----|
| **Requirements / Planning** | Claude | Deep reasoning, structured thinking |
| **System Design / Architecture** | Claude | Long context, careful analysis |
| **UI / Visual Design** | Gemini | Multimodal, image understanding |
| **Code Implementation** | GPT | Fast generation, ecosystem |
| **Code Review** | Claude | Thorough, conservative feedback |
| **Documentation / Content** | Gemini | Creative writing, content generation |
| **Tests / Debugging** | GPT | Quick iteration, pattern matching |
| **Refactoring** | GPT | Code transformation, edits |

> **Note**: Model routing system is under development. Currently using basic agent selection via `agent-selector.ts`.

## Multi-Model Workflow Examples (TODO)

### Example: Build a Blog Website

```
User: "Help me build a blog website"

┌─────────────────────────────────────────────────────────────┐
│ Step 1: Requirements & Architecture (Claude)               │
│ • Analyze requirements                                      │
│ • Design system architecture                                │
│ • Plan database schema                                      │
│ • Define API endpoints                                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 2: UI/UX Design (Gemini)                              │
│ • Design page layouts                                       │
│ • Create color scheme & typography                          │
│ • Design component library                                  │
│ • Generate mockups                                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 3: Implementation (GPT)                               │
│ • Generate boilerplate code                                 │
│ • Implement API endpoints                                   │
│ • Build frontend components                                 │
│ • Write unit tests                                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 4: Review & Refine (Claude + GPT)                     │
│ • Code review (Claude)                                      │
│ • Bug fixes (GPT)                                           │
│ • Final polish                                              │
└─────────────────────────────────────────────────────────────┘
```

### Example: Debug a Production Issue

```
User: "Investigate the slow API response times"

┌─────────────────────────────────────────────────────────────┐
│ Claude: Analyze logs, identify root cause                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ GPT: Generate fix code, write tests                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Claude: Review the fix, verify correctness                 │
└─────────────────────────────────────────────────────────────┘
```

### Architecture
- **Plugin System**: Extensible architecture for channels and capabilities
- **Desktop Apps**: Native macOS and Windows applications
- **Profile-Based Runtime**: Multiple runtime profiles (default, dev, custom)
- **Memory Storage**: LanceDB integration for vector embeddings

## System Architecture

The platform is a **Multi-Model Agent Orchestration** system with a Super AI Terminal interface. Tasks are routed by type—planning/review to Claude, design/content to Gemini, implementation/tests to GPT—all sharing context through unified workflows.

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
│  │  Multi-Model Orchestration System                        │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ Task Router (TODO: Task Type → Best Model)         │  │  │
│  │  │ • Planning / Review → Claude                       │  │  │
│  │  │ • Design / Content → Gemini                        │  │  │
│  │  │ • Implementation / Tests → GPT                     │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
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
| **Multi-Model Orchestration** | Model routing + Workflow coordination + Context sharing | TODO |
| **Super AI Terminal** | TUI + Agent spawning + Task management | 🚧 In active development |
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

## License

MIT © Contributors
