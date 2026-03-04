# CyDeck Terminal (Windows)

Electron-based desktop terminal for CyDeck, with an embedded local gateway for AI chat.

## Features

- System tray status and gateway controls (start/stop/restart/rotate token)
- Terminal window toggle with `Ctrl+Shift+T`
- Embedded gateway (`127.0.0.1`) for local chat transport
- Landing workflow for `SOUL.md` / `IDENTITY.md` / `USER.md` / `AGENTS.md` / `MEMORY.md`
- Landing-based system prompt injection with private/shared session boundary
- Session memory runtime (`memory_search`, `memory_get`, auto snapshot write, pre-compaction flush)
- Session rotation snapshot on `/session new` or `/session <key>`
- Tab autocomplete for slash commands, subcommands, config keys, landing keys, and shell commands
- `/config` command flow (show/set/validate/reset/path)
- Settings window for provider/API key updates

## Command Highlights

```bash
# Landing bootstrap
/landing init
/landing start
/landing resume
/landing cancel
/landing set identity.name CyDeck
/landing add memory User prefers concise replies in Chinese
/landing status

# Session and memory lifecycle
/session new
/session default

# Config
/config show
/config set ai.defaultProvider google
/config apply
```

## Landing + Prompt Injection

CyDeck can manage and inject these workspace files:

- `SOUL.md`
- `IDENTITY.md`
- `USER.md`
- `AGENTS.md`
- `MEMORY.md`

Behavior:

- `AGENTS.md` / `SOUL.md` / `IDENTITY.md` / `USER.md` are always loaded into system prompt context.
- `MEMORY.md` is injected only for private sessions.
- Private sessions: `default`, `main`, `direct` (and keys without shared markers).
- Shared sessions (contains `group`, `channel`, `subagent`, `cron`) do not inject `MEMORY.md`.
- `/landing start` auto-jumps to the first missing wizard step.
- Wizard progress is persisted in state dir, and `/landing resume` restores progress after restart.

## Session Memory Runtime

Memory runtime reads and writes markdown memory files in workspace:

- Search scope: `MEMORY.md` + `memory/**/*.md`
- Tool endpoints: `tools.memory.search`, `tools.memory.get`
- Path guardrails: `memory_get` only allows `MEMORY.md` or `memory/*.md` paths
- Snapshot file format: `memory/YYYY-MM-DD-<session>.md`
- Snapshot reasons:
  - `session-memory` (auto write)
  - `pre-compaction-flush` (before message trimming)
  - `session-rotate` (manual/session switch write)

## Development

```bash
pnpm install
pnpm --dir apps/windows dev
```

## Build

```bash
pnpm --dir apps/windows build
pnpm --dir apps/windows build:prod
```

## Memory Benchmark (Regression Guard)

Use this workflow when tuning memory search/snapshot/compaction strategy:

```bash
# 1) create/refresh baseline
pnpm --dir apps/windows memory:benchmark:baseline

# 2) after strategy changes, compare against baseline
pnpm --dir apps/windows memory:benchmark:regression
```

Artifacts are written under `.local/cydeck-memory-benchmark/`:

- `baseline.json`
- `latest/memory-benchmark.report.json`
- `latest/memory-benchmark.report.md`
- `latest/memory-benchmark.comparison.json`
- `latest/memory-benchmark.comparison.md`

## Project Structure

```text
apps/windows/
├── src/
│   ├── main/
│   │   ├── index.ts               # App lifecycle + managers
│   │   ├── embedded-gateway.ts    # In-process gateway server
│   │   ├── landing.ts             # Landing file workflow + prompt builder
│   │   ├── memory-runtime.ts      # MEMORY file search/get/snapshot runtime
│   │   ├── memory-test-framework.ts # Memory efficiency/loss/compression harness
│   │   ├── memory-benchmark.ts    # Benchmark dataset + regression report
│   │   ├── memory-benchmark-cli.ts # Benchmark CLI entry
│   │   ├── gateway-like.ts        # Shared gateway interface
│   │   ├── terminal-window.ts     # Terminal BrowserWindow
│   │   ├── terminal-ipc.ts        # Terminal IPC handlers
│   │   ├── cydeck-config.ts       # Config loading/validation
│   │   ├── cydeck-config-ipc.ts   # Config mutation helpers
│   │   ├── tray.ts                # Tray + context menu
│   │   ├── settings.ts            # Settings window + persistence
│   │   └── ipc.ts                 # Generic gateway/settings IPC
│   ├── preload/
│   │   ├── index.ts               # Settings/control preload bridge
│   │   └── terminal-api.ts        # Terminal preload bridge
│   └── terminal/
│       ├── autocomplete.ts        # Tab completion logic
│       ├── command-handler.ts     # Slash/shell/message command routing
│       └── terminal.ts            # Terminal renderer UI
├── resources/
└── package.json
```
