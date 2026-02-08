# 🦞 OpenClaw — Personal AI Assistant

> **EXFOLIATE! EXFOLIATE!**

[CI](https://github.com/openclaw/openclaw/actions/workflows/ci.yml?branch=main)
· [Releases](https://github.com/openclaw/openclaw/releases)
· [Discord](https://discord.gg/clawd)
· [Docs](https://docs.openclaw.ai)
· [中文文档](docs/zh-CN)
· [Getting Started](https://docs.openclaw.ai/start/getting-started)

A personal AI assistant you run on your own devices. Works on WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Teams, Matrix, and more.

**Requirements:** Node.js ≥22

---

## Quick Start

```bash
# Install
npm install -g openclaw@latest

# Onboarding wizard (recommended)
openclaw onboard

# Start gateway
openclaw gateway

# Talk to the assistant
openclaw agent --message "Hello"
```

Full setup guide: [docs.openclaw.ai/start/getting-started](https://docs.openclaw.ai/start/getting-started)

---

## Development

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
pnpm install
pnpm build
pnpm openclaw onboard
```

See [Development Guide](https://docs.openclaw.ai/development) for details.

### Windows

For Windows-specific setup and desktop app development, see [platform/windows](platform/windows).

---

## Documentation

- **[Getting Started](https://docs.openclaw.ai/start/getting-started)** — Installation, onboarding, first message
- **[Channels](https://docs.openclaw.ai/channels)** — WhatsApp, Telegram, Slack, Discord, etc.
- **[Concepts](https://docs.openclaw.ai/concepts)** — Architecture, sessions, models
- **[中文文档](docs/zh-CN)** — 中文概念文档和综合报告
- **[Windows 平台](platform/windows)** — Windows 一键启动脚本和桌面应用
- **[Troubleshooting](https://docs.openclaw.ai/troubleshooting)** — Common issues and solutions
- **[Development](https://docs.openclaw.ai/development)** — Contributing, building, debugging

## Key Features

- **Single Gateway, Multi-Channel** — One daemon manages all messaging platform connections
- **WebSocket Architecture** — Control plane clients connect via WebSocket (macOS app, Windows app, CLI, Web UI)
- **Multi-Agent Routing** — Support multiple isolated agent instances with independent workspaces
- **Plugin System** — Extend functionality with plugins (Mattermost, custom tools)
- **Desktop Apps** — Native macOS and Windows applications with system tray support
- **Mobile Nodes** — iOS and Android nodes with Canvas interface support

---

## License

MIT © [OpenClaw contributors](https://github.com/openclaw/openclaw/graphs/contributors)
