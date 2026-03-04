# CyDeck Terminal (Windows)

Electron-based desktop terminal for CyDeck, with an embedded local gateway for AI chat.

## Features

- System tray status and gateway controls (start/stop/restart/rotate token)
- Terminal window toggle with `Ctrl+Shift+T`
- Embedded gateway (`127.0.0.1`) for local chat transport
- `/config` command flow (show/set/validate/reset/path)
- Settings window for provider/API key updates

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
│   └── terminal/                  # Terminal renderer UI
├── resources/
└── package.json
```
