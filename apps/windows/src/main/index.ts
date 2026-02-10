import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import { createTray } from "./tray.js";
import { GatewayManager } from "./gateway.js";
import { ChatWindowManager } from "./window.js";
import { SettingsManager } from "./settings.js";
import { setupIpc } from "./ipc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tray: ReturnType<typeof createTray> | null = null;
let gatewayManager: GatewayManager | null = null;
let chatWindowManager: ChatWindowManager | null = null;
let settingsManager: SettingsManager | null = null;
let hiddenWindow: BrowserWindow | null = null;

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
  settingsManager = new SettingsManager();

  console.log("[App] Managers initialized");

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

  console.log("[App] App setup complete, should stay running");
  })
  .catch((err) => {
    console.error("[App] app.whenReady failed:", err);
  });


app.on("before-quit", async (_event) => {
  console.log("[App] before-quit event");

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
  settingsManager: SettingsManager;
};
