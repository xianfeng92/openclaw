import { app, BrowserWindow, globalShortcut, powerMonitor } from "electron";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import { createTray } from "./tray.js";
import { GatewayManager } from "./gateway.js";
import { ChatWindowManager } from "./window.js";
import { SettingsManager } from "./settings.js";
import { setupIpc } from "./ipc.js";
import { TerminalWindowManager } from "./terminal-window.js";
import { setupTerminalIpc } from "./terminal-ipc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tray: ReturnType<typeof createTray> | null = null;
let gatewayManager: GatewayManager | null = null;
let chatWindowManager: ChatWindowManager | null = null;
let terminalWindowManager: TerminalWindowManager | null = null;
let settingsManager: SettingsManager | null = null;
let hiddenWindow: BrowserWindow | null = null;
const PRIMARY_INVOKE_SHORTCUT = "Alt+Space";
const FALLBACK_INVOKE_SHORTCUT = "Alt+Shift+Space";
const TERMINAL_SHORTCUT = "CommandOrControl+Shift+T";
const INVOKE_SHORTCUT_RETRY_MS = 15_000;
const INVOKE_SHORTCUTS = [PRIMARY_INVOKE_SHORTCUT, FALLBACK_INVOKE_SHORTCUT] as const;
let registeredInvokeShortcuts = new Set<string>();
let registeredTerminalShortcut = false;
let invokeHotkeyRetryTimer: ReturnType<typeof setInterval> | null = null;

function unregisterInvokeHotkeys(): void {
  for (const shortcut of registeredInvokeShortcuts) {
    try {
      globalShortcut.unregister(shortcut);
    } catch (err) {
      console.warn(`[App] Failed to unregister invoke shortcut ${shortcut}:`, err);
    }
  }
  registeredInvokeShortcuts.clear();

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

function clearInvokeHotkeyRetry(): void {
  if (invokeHotkeyRetryTimer == null) {
    return;
  }
  clearInterval(invokeHotkeyRetryTimer);
  invokeHotkeyRetryTimer = null;
}

function scheduleInvokeHotkeyRetry(): void {
  if (invokeHotkeyRetryTimer != null) {
    return;
  }
  invokeHotkeyRetryTimer = setInterval(() => {
    ensureInvokeHotkeysRegistered("retry");
  }, INVOKE_SHORTCUT_RETRY_MS);
  console.warn(
    `[App] Invoke hotkey registration incomplete; retrying every ${INVOKE_SHORTCUT_RETRY_MS}ms`,
  );
}

function registerInvokeHotkeys(): void {
  if (!chatWindowManager) {
    return;
  }

  unregisterInvokeHotkeys();

  for (const shortcut of INVOKE_SHORTCUTS) {
    try {
      const ok = globalShortcut.register(shortcut, () => {
        chatWindowManager?.showInvokeWindow();
      });
      if (!ok) {
        console.warn(`[App] Failed to register invoke shortcut: ${shortcut}`);
        continue;
      }
      registeredInvokeShortcuts.add(shortcut);
      console.log(`[App] Registered invoke shortcut: ${shortcut}`);
    } catch (err) {
      console.warn(`[App] Error registering invoke shortcut ${shortcut}:`, err);
    }
  }

  // Register terminal shortcut
  if (!registeredTerminalShortcut && terminalWindowManager) {
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

  if (registeredInvokeShortcuts.has(PRIMARY_INVOKE_SHORTCUT)) {
    clearInvokeHotkeyRetry();
    return;
  }

  if (registeredInvokeShortcuts.has(FALLBACK_INVOKE_SHORTCUT)) {
    console.warn(
      `[App] Primary invoke shortcut unavailable; using fallback: ${FALLBACK_INVOKE_SHORTCUT}`,
    );
  }
  scheduleInvokeHotkeyRetry();
}

function ensureInvokeHotkeysRegistered(reason: string): void {
  if (!chatWindowManager) {
    return;
  }

  const hasPrimary = globalShortcut.isRegistered(PRIMARY_INVOKE_SHORTCUT);
  if (hasPrimary) {
    registeredInvokeShortcuts.add(PRIMARY_INVOKE_SHORTCUT);
    clearInvokeHotkeyRetry();
    return;
  }

  const hasAnyRegistered = Array.from(INVOKE_SHORTCUTS).some((shortcut) =>
    globalShortcut.isRegistered(shortcut),
  );
  if (!hasAnyRegistered || !registeredInvokeShortcuts.has(FALLBACK_INVOKE_SHORTCUT)) {
    console.log(`[App] Re-registering invoke shortcuts (${reason})`);
  }
  registerInvokeHotkeys();
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
    // Someone tried to run a second instance, focus our window
    chatWindowManager?.showChatWindow();
  });
}

void app
  .whenReady()
  .then(() => {
  console.log("[App] Electron app ready");

  // Initialize managers
  gatewayManager = new GatewayManager();
  chatWindowManager = new ChatWindowManager(gatewayManager);
  terminalWindowManager = new TerminalWindowManager();
  settingsManager = new SettingsManager();

  console.log("[App] Managers initialized");

  // Setup terminal IPC handlers (pass gatewayManager for auth)
  setupTerminalIpc(gatewayManager);
  console.log("[App] Terminal IPC setup complete");

  // Create a hidden window to keep app alive
  // Electron requires at least one window to stay running
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

  // Create system tray
  try {
    tray = createTray(gatewayManager, chatWindowManager, settingsManager);
    console.log("[App] Tray created");
  } catch (err) {
    console.error("[App] Failed to create tray:", err);
  }

  // Setup IPC handlers
  setupIpc(gatewayManager, chatWindowManager);
  registerInvokeHotkeys();

  app.on("browser-window-focus", () => ensureInvokeHotkeysRegistered("browser-window-focus"));
  powerMonitor.on("resume", () => ensureInvokeHotkeysRegistered("power-resume"));

  console.log("[App] App setup complete, should stay running");
  })
  .catch((err) => {
    console.error("[App] app.whenReady failed:", err);
  });


app.on("before-quit", async (_event) => {
  console.log("[App] before-quit event");
  clearInvokeHotkeyRetry();
  unregisterInvokeHotkeys();
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
  chatWindowManager = null;
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
  gatewayManager: GatewayManager;
  chatWindowManager: ChatWindowManager;
  terminalWindowManager: TerminalWindowManager;
  settingsManager: SettingsManager;
};
