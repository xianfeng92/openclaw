# OpenClaw - Personal AI Assistant

> EXFOLIATE! EXFOLIATE!

[CI](https://github.com/openclaw/openclaw/actions/workflows/ci.yml?branch=main)
· [Releases](https://github.com/openclaw/openclaw/releases)
· [Discord](https://discord.gg/clawd)
· [Docs](https://docs.openclaw.ai)
· [Getting Started](https://docs.openclaw.ai/start/getting-started)
· [Chinese Docs](https://docs.openclaw.ai/zh-CN)

OpenClaw is a personal AI assistant you run on your own devices.
One Gateway can serve multiple channels (WhatsApp, Telegram, Discord, Slack, Google Chat, Signal, iMessage/WebChat), with additional channels available via plugins.

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

## Current Project Status (Snapshot: 2026-02-25)

| Workstream               | Status                                    | Notes                                                                                                                                                   |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop MVP Slim         | Phase 0-5 complete                        | Added Super Terminal (Ctrl+Shift+T) with markdown rendering, Dracula theme, and enhanced UX.                                                            |
| Slim mode strategy       | Locked                                    | `OPENCLAW_DESKTOP_MVP_SLIM` / `CLAWDBOT_DESKTOP_MVP_SLIM` drive runtime slim gating; plugin ecosystem is disabled in slim mode (architecture retained). |
| Minimal toolset strategy | Locked                                    | Opt-in only (`desktopMvpMinimalToolset` or env flag); not default-on.                                                                                   |
| Project Neuro            | P0 complete, P1 complete, P2-001 complete | Event contracts, privacy baseline, context ingest/snapshot, action loop, undo/policy/retention/reliability, and heuristic preview are shipped.          |
| Next focus               | TBD                                       | Awaiting roadmap definition.                                                                                                                            |

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
