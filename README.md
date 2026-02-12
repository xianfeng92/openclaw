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

## 需求实现（已完成 TODO）

| 需求分组                   | 已完成 TODO                                                                       | 状态   | 主要结果                                                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop MVP Slim / Phase 0 | 分支与基线治理（专用分支、同步主线、定义绿线）                                    | 已完成 | 使用 `desktop-mvp-slim` 作为执行分支，并建立 `pnpm check/build/ui:build/test` 绿线。                                                                                                 |
| Desktop MVP Slim / Phase 1 | 安全加固（auth bypass、`cli_model`、`fs_read`、日志泄露）                         | 已完成 | 修复本地直连鉴权风险，收敛工具执行风险，补齐边界校验并移除敏感日志片段。                                                                                                             |
| Desktop MVP Slim / Phase 2 | 类型与规范门禁修复                                                                | 已完成 | 修复类型与状态字段问题，`pnpm check` 通过。                                                                                                                                          |
| Desktop MVP Slim / Phase 3 | Windows 桌面鉴权 UX（token store、gateway spawn、preload 注入、token 轮换）       | 已完成 | 在保持鉴权开启的前提下实现“无感鉴权”，并支持托盘一键轮换 token。                                                                                                                     |
| Desktop MVP Slim / Phase 3 | macOS Dashboard 令牌安全（移除 query token/password，改为 tokenless auth bridge） | 已完成 | 停止通过 URL query 传递密钥，改用无 query 的桥接式鉴权。                                                                                                                             |
| Desktop MVP Slim / Phase 3 | 桌面鉴权文档补充                                                                  | 已完成 | 新增 Desktop Auth 恢复与运维说明，覆盖 token 生命周期与故障恢复。                                                                                                                    |
| Project Neuro / P0-001     | 架构范围与 Windows 技术基线冻结                                                   | 已完成 | 通过 ADR 0001 固化范围和基线：https://docs.openclaw.ai/prd/project-neuro-adr-0001-scope-freeze-windows-baseline                                                                      |
| Project Neuro / P0-002     | 事件契约定稿（`context.event.v1`/`suggestion.card.v1`/`suggestion.feedback.v1`）  | 已完成 | 完成 schema、类型导出、验证测试与 ADR 0002：https://docs.openclaw.ai/prd/project-neuro-adr-0002-event-contracts-v1                                                                   |
| Project Neuro / P0-003     | Redaction baseline（`block/mask/hash`）+ source filters + regression corpus       | 已完成 | 新增红线回归语料与测试，完成 ADR 0003：https://docs.openclaw.ai/prd/project-neuro-adr-0003-redaction-baseline-source-filters                                                         |
| Project Neuro / P0-004     | Context capture v1（clipboard + active window + ring buffer bounds）              | 已完成 | 新增捕获服务、适配器与内存 ring buffer 边界控制，完成 ADR 0004：https://docs.openclaw.ai/prd/project-neuro-adr-0004-context-capture-v1-ring-buffer                                   |
| Project Neuro / P0-005     | Gateway ingest endpoint + validation + per-session volatile snapshot cache        | 已完成 | 新增 `neuro.context.ingest`/`neuro.context.snapshot` RPC、协议校验与会话级快照查询，完成 ADR 0005：https://docs.openclaw.ai/prd/project-neuro-adr-0005-gateway-ingest-snapshot-cache |

### 总结

- 已完成的 TODO 主要集中在两条线：`Desktop MVP Slim` 的安全与鉴权闭环，以及 `Project Neuro` 的 P0 基础能力（P0-001 到 P0-005）。
- `Project Neuro` 的 P0 已推进到 `TODO-P0-005`，下一优先级为 `TODO-P0-006`：invoke fast-path shell (`Alt+Space`) + streaming bridge。

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
