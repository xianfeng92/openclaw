# 🦞 OpenClaw — Personal AI Assistant

> **EXFOLIATE! EXFOLIATE!**

[CI](https://github.com/openclaw/openclaw/actions/workflows/ci.yml?branch=main)
· [Releases](https://github.com/openclaw/openclaw/releases)
· [Discord](https://discord.gg/clawd)
· [Docs](https://docs.openclaw.ai)
· [Getting Started](https://docs.openclaw.ai/start/getting-started)

A personal AI assistant you run on your own devices. Works on WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Teams, and more.

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

---

## Documentation

- **[Getting Started](https://docs.openclaw.ai/start/getting-started)** — Installation, onboarding, first message
- **[Channels](https://docs.openclaw.ai/channels)** — WhatsApp, Telegram, Slack, Discord, etc.
- **[Concepts](https://docs.openclaw.ai/concepts)** — Architecture, sessions, models
- **[Troubleshooting](https://docs.openclaw.ai/troubleshooting)** — Common issues and solutions
- **[Development](https://docs.openclaw.ai/development)** — Contributing, building, debugging

---

## License

MIT © [OpenClaw contributors](https://github.com/openclaw/openclaw/graphs/contributors)
