import { app, BrowserWindow, globalShortcut } from "electron";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import { createTray } from "./tray.js";
import { EmbeddedGateway } from "./embedded-gateway.js";
import type { GatewayLike } from "./gateway-like.js";
import { SettingsManager } from "./settings.js";
import { setupIpc } from "./ipc.js";
import { TerminalWindowManager } from "./terminal-window.js";
import { setupTerminalIpc } from "./terminal-ipc.js";
import { getEffectiveConfig } from "./cydeck-config.js";
import { loadOrCreateGatewayAuth } from "./gateway-auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tray: ReturnType<typeof createTray> | null = null;
let gatewayManager: GatewayLike | null = null;
let terminalWindowManager: TerminalWindowManager | null = null;
let settingsManager: SettingsManager | null = null;
let hiddenWindow: BrowserWindow | null = null;
const TERMINAL_SHORTCUT = "CommandOrControl+Shift+T";
let registeredTerminalShortcut = false;

function unregisterTerminalShortcut(): void {
  if (registeredTerminalShortcut) {
    try {
      globalShortcut.unregister(TERMINAL_SHORTCUT);
      registeredTerminalShortcut = false;
      console.log("[App] Unregistered terminal shortcut");
    } catch (err) {
      console.warn(`[App] Failed to unregister terminal shortcut:`, err);
    }
  }
}

function registerTerminalShortcut(): void {
  if (registeredTerminalShortcut || !terminalWindowManager) {
    return;
  }

  try {
    const ok = globalShortcut.register(TERMINAL_SHORTCUT, () => {
      terminalWindowManager?.toggle();
    });
    if (ok) {
      registeredTerminalShortcut = true;
      console.log(`[App] Registered terminal shortcut: ${TERMINAL_SHORTCUT}`);
    } else {
      console.warn(`[App] Failed to register terminal shortcut: ${TERMINAL_SHORTCUT}`);
    }
  } catch (err) {
    console.warn(`[App] Error registering terminal shortcut:`, err);
  }
}

function initAppPaths(): void {
  // Chromium can fail to migrate/create cache dirs (0x5 access denied), which breaks GPU cache and spams logs.
  // Set stable, writable dirs early (must run before `app.whenReady()` and before creating any BrowserWindow).
  const profile = (process.env.OPENCLAW_PROFILE ?? (app.isPackaged ? "default" : "dev")).trim();
  const safeProfile = profile.replace(/[^a-zA-Z0-9_-]/g, "_") || "default";

  // Prefer LocalAppData for all Chromium state (avoids Roaming + cache migration edge cases).
  const localAppData = process.env.LOCALAPPDATA?.trim() || app.getPath("temp");
  const userData = path.join(localAppData, "OpenClaw", "desktop", safeProfile, "user-data");
  const cacheDir = path.join(localAppData, "OpenClaw", "desktop", safeProfile, "cache");
  const gpuCacheDir = path.join(localAppData, "OpenClaw", "desktop", safeProfile, "gpu-cache");

  for (const dir of [userData, cacheDir, gpuCacheDir]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Best-effort: Electron/Chromium will fall back if this fails.
    }
  }

  try {
    app.setPath("userData", userData);
  } catch {
    // ignore
  }

  // Some Chromium components use app.getPath("cache") instead of flags.
  try {
    app.setPath("cache", cacheDir);
  } catch {
    // ignore
  }

  // These switches avoid Chromium trying to migrate cache under a non-writable directory.
  try {
    app.commandLine.appendSwitch("disk-cache-dir", cacheDir);
    app.commandLine.appendSwitch("gpu-disk-cache-dir", gpuCacheDir);
    // Enable precise memory info for performance.memory API
    app.commandLine.appendSwitch("enable-precise-memory-info");
  } catch {
    // ignore
  }
}

initAppPaths();

// Prevent app from quitting when no windows are open.
// On Windows we want the app to keep running in the tray.
app.on("window-all-closed", () => {
  // no-op
});

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone tried to run a second instance, focus terminal
    terminalWindowManager?.show();
  });
}

void app
  .whenReady()
  .then(() => {
    console.log("[App] Electron app ready");

    // Load CyDeck config and map it to runtime values for gateway/workspace.
    const effectiveConfig = getEffectiveConfig();
    for (const issue of effectiveConfig.issues) {
      const prefix = issue.severity === "error" ? "error" : "warn";
      console[issue.severity === "error" ? "error" : "warn"](
        `[Config:${prefix}] ${issue.message}`,
      );
    }

    const auth = loadOrCreateGatewayAuth();
    const portOverride = process.env.OPENCLAW_GATEWAY_PORT || process.env.OPENCLAW_PORT;
    const parsedOverride = portOverride ? Number.parseInt(portOverride, 10) : Number.NaN;
    const gatewayPort = Number.isInteger(parsedOverride)
      ? parsedOverride
      : effectiveConfig.config.gateway.port;

    gatewayManager = new EmbeddedGateway(gatewayPort, auth.token, {
      runtimeProvider: effectiveConfig.runtimeProvider,
    });

    if (effectiveConfig.workspacePath && effectiveConfig.config.workspace.autoCreate) {
      try {
        fs.mkdirSync(effectiveConfig.workspacePath, { recursive: true });
      } catch (err) {
        console.warn("[App] Failed to create workspace directory:", err);
      }
    }

    terminalWindowManager = new TerminalWindowManager();
    settingsManager = new SettingsManager();
    console.log("[App] Managers initialized");

    if (effectiveConfig.config.gateway.autoStart) {
      void gatewayManager.start().catch((err) => {
        console.error("[App] Failed to start embedded gateway:", err);
      });
    } else {
      console.log("[App] Gateway autoStart is disabled in CyDeck config");
    }

    // Setup terminal IPC handlers (pass gatewayManager for auth).
    setupTerminalIpc(gatewayManager);
    console.log("[App] Terminal IPC setup complete");

    // Create a hidden window to keep app alive.
    // Electron requires at least one window to stay running.
    hiddenWindow = new BrowserWindow({
      width: 100,
      height: 100,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    void hiddenWindow
      .loadURL("data:text/html;charset=utf-8,<html><body>Hidden</body></html>")
      .catch((err) => {
        console.error("[App] Failed to load hidden window:", err);
      });
    console.log("[App] Hidden window created");

    // Create system tray.
    try {
      tray = createTray(gatewayManager, terminalWindowManager, settingsManager);
      console.log("[App] Tray created");
    } catch (err) {
      console.error("[App] Failed to create tray:", err);
    }

    // Setup IPC handlers.
    setupIpc(gatewayManager);
    registerTerminalShortcut();

    console.log("[App] App setup complete, should stay running");
  })
  .catch((err) => {
    console.error("[App] app.whenReady failed:", err);
  });


app.on("before-quit", async (_event) => {
  console.log("[App] before-quit event");
  unregisterTerminalShortcut();
  globalShortcut.unregisterAll();

  // Cleanup
  if (gatewayManager) {
    try {
      await gatewayManager.stop();
    } catch (err) {
      console.error("[App] Error stopping gateway:", err);
    }
  }

  settingsManager?.close();
  tray?.destroy();
});

app.on("quit", () => {
  console.log("[App] App quitting");
  tray = null;
  gatewayManager = null;
  terminalWindowManager = null;
  settingsManager = null;
});

// Also handle process exit
process.on("SIGINT", () => {
  console.log("[App] Received SIGINT, quitting...");
  app.quit();
});

process.on("SIGTERM", () => {
  console.log("[App] Received SIGTERM, quitting...");
  app.quit();
});

// Export for type usage
export type AppContext = {
  gatewayManager: GatewayLike;
  terminalWindowManager: TerminalWindowManager;
  settingsManager: SettingsManager;
};
