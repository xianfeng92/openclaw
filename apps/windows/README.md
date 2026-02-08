# OpenClaw Desktop for Windows

Electron-based desktop application for OpenClaw on Windows.

## Features

- **System Tray** - Status indicator with context menu
- **Quick Chat Window** - Opens the Web UI (http://127.0.0.1:19001)
- **Gateway Control** - Start, stop, restart the OpenClaw Gateway
- **Status Monitoring** - Real-time gateway status updates

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build for production
pnpm build:prod
```

## Project Structure

```
apps/windows/
├── src/
│   ├── main/           # Electron main process
│   │   ├── index.ts    # Application entry point
│   │   ├── tray.ts     # System tray management
│   │   ├── gateway.ts  # Gateway process management
│   │   ├── window.ts   # Chat window management
│   │   └── ipc.ts      # IPC communication handlers
│   └── preload/        # Preload scripts
│       └── index.ts    # Context bridge setup
├── resources/
│   └── icons/          # Tray and app icons
├── dist/               # Build output
└── package.json
```

## Architecture

### Main Process Components

- **index.ts** - Application lifecycle, single instance lock
- **tray.ts** - System tray icon, context menus, status updates
- **gateway.ts** - Spawns and manages the OpenClaw Gateway subprocess
- **window.ts** - Manages the chat window (BrowserWindow)
- **ipc.ts** - IPC handlers for renderer communication

### Preload Script

Exposes safe APIs to the renderer via `contextBridge`:
- `window.electron.gateway.*` - Gateway control
- `window.electron.window.*` - Window control

## Gateway Process

The desktop app starts the Gateway using:
```bash
node scripts/run-node.mjs --dev gateway start
```

The Gateway runs as a subprocess with:
- `OPENCLAW_PROFILE=dev`
- Stdio piped for logging
- Automatic restart on crash (TODO)

## Icons

Add tray icons to `resources/icons/`:
- `icon.png` - Default/stopped state
- `icon-active.png` - Running state (green)
- `icon-error.png` - Error state (red)
- `icon.ico` - Windows app icon

## Building

```bash
pnpm build:prod
```

Output: `dist/installer/OpenClaw Setup X.X.X.exe`

## TODO

- [ ] Add proper icons (convert from macOS assets)
- [ ] Add auto-start on boot option
- [ ] Add native notifications
- [ ] Add keyboard shortcut (Ctrl+Shift+O)
- [ ] Add settings window
- [ ] Add auto-update support
- [ ] Add crash reporter
- [ ] Add logs viewer
