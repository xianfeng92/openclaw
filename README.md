# OpenClaw - Super AI Terminal

> EXFOLIATE! EXFOLIATE!

[CI](https://github.com/openclaw/openclaw/actions/workflows/ci.yml?branch=main)
· [Releases](https://github.com/openclaw/openclaw/releases)
· [Discord](https://discord.gg/clawd)
· [Docs](https://docs.openclaw.ai)
· [Getting Started](https://docs.openclaw.ai/start/getting-started)
· [Chinese Docs](https://docs.openclaw.ai/zh-CN)

**OpenClaw Super Terminal** is a personal AI terminal with orchestration capabilities.
Manage context from Obsidian, orchestrate AI agents, track effective patterns, and automate workflows—all from your terminal.

**Project Focus:** Building a **Super AI Terminal** with Zoe-style orchestration.

**Requirements:** Node.js 22+ (package baseline: `>=22.12.0`)

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

- Single gateway, multi-channel routing
- WebSocket-based control plane (CLI, desktop apps, web UI)
- Multi-agent sessions and workspace isolation
- Tooling and automation support (`exec`, browser/canvas, cron, nodes, approvals)
- Plugin architecture for extra channels and integrations
- Desktop apps (macOS, Windows) and mobile node support

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
