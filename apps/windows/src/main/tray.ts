import { Tray, Menu, nativeImage, app, type MenuItemConstructorOptions, type NativeImage } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import type { GatewayManager } from "./gateway.js";
import type { ChatWindowManager } from "./window.js";
import type { SettingsManager } from "./settings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the project root for icon resources
const getResourcesPath = () => {
  // In development: src/main -> apps/windows -> resources
  // In production: dist/main -> apps/windows -> resources
  if (__dirname.includes("dist\\main") || __dirname.includes("dist/main")) {
    return path.join(__dirname, "../../resources");
  }
  return path.join(__dirname, "../../resources");
};

// Create a simple colored square as fallback icon
function createFallbackIcon(color: string): NativeImage {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4); // RGBA

  for (let i = 0; i < buffer.length; i += 4) {
    // Create a solid colored square
    buffer[i] = parseInt(color.slice(1, 3), 16);     // R
    buffer[i + 1] = parseInt(color.slice(3, 5), 16); // G
    buffer[i + 2] = parseInt(color.slice(5, 7), 16); // B
    buffer[i + 3] = 255;                            // A
  }

  return nativeImage.createFromBuffer(buffer);
}

function getTrayIcon(status: GatewayManager["status"]): NativeImage {
  const resourcesPath = getResourcesPath();
  let iconPath: string;

  switch (status) {
    case "running":
      iconPath = path.join(resourcesPath, "icons", "icon-active.png");
      break;
    case "error":
      iconPath = path.join(resourcesPath, "icons", "icon-error.png");
      break;
    default:
      iconPath = path.join(resourcesPath, "icons", "icon.png");
  }

  console.log(`[Tray] Loading icon from: ${iconPath}`);

  try {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      console.log(`[Tray] Icon loaded successfully, resizing to 16x16`);
      return image.resize({ width: 16, height: 16 });
    }
    console.log(`[Tray] Icon is empty, using fallback`);
  } catch (err) {
    console.log(`[Tray] Failed to load icon from ${iconPath}:`, err);
  }

  // Fallback to colored square
  const colors = {
    stopped: "#4a9eff",  // Blue
    running: "#4aff4a",  // Green
    error: "#ff4a4a",    // Red
    starting: "#ffaa4a", // Orange
    stopping: "#ffaa4a",
  };
  const fallbackIcon = createFallbackIcon(colors[status] || colors.stopped);
  console.log(`[Tray] Using fallback icon, isEmpty: ${fallbackIcon.isEmpty()}`);
  return fallbackIcon;
}

export function createTray(
  gatewayManager: GatewayManager,
  chatWindowManager: ChatWindowManager,
  settingsManager: SettingsManager
): Tray {
  // Create initial icon with fallback
  const icon = getTrayIcon("stopped");
  console.log("[Tray] Creating tray with icon, isEmpty:", icon.isEmpty());
  console.log("[Tray] Icon size:", icon.getSize());

  const tray = new Tray(icon);
  console.log("[Tray] Tray created successfully");
  console.log("[Tray] Tray is destroyed:", tray.isDestroyed());

  // Set tooltip
  tray.setToolTip("OpenClaw - Stopped");
  console.log("[Tray] Tooltip set");

  // Update tray when gateway state changes
  gatewayManager.on("state-changed", (state) => {
    // Update icon
    const newIcon = getTrayIcon(state.status);
    if (!newIcon.isEmpty()) {
      tray.setImage(newIcon);
    }

    // Update tooltip
    const statusText = (() => {
      switch (state.status) {
        case "stopped":
          return "Stopped";
        case "starting":
          return "Starting...";
        case "running":
          return "Running";
        case "stopping":
          return "Stopping...";
        case "error":
          return "Error";
      }
    })();

    tray.setToolTip(
      state.status === "running"
        ? `OpenClaw - Running (port ${state.port})`
        : state.status === "error"
        ? `OpenClaw - Error: ${state.error || "Unknown"}`
        : `OpenClaw - ${statusText}`
    );

    // Update context menu
    updateContextMenu(tray, gatewayManager, chatWindowManager, settingsManager);
  });

  // Set initial context menu
  updateContextMenu(tray, gatewayManager, chatWindowManager, settingsManager);

  // Handle tray click
  tray.on("click", () => {
    chatWindowManager.showChatWindow();
  });

  return tray;
}

function updateContextMenu(
  tray: Tray,
  gatewayManager: GatewayManager,
  chatWindowManager: ChatWindowManager,
  settingsManager: SettingsManager
): void {
  const state = gatewayManager.getState();
  const isRunning = state.status === "running";
  const isStartingOrStopping = state.status === "starting" || state.status === "stopping";

  const menuTemplate: MenuItemConstructorOptions[] = [
    {
      label: "Open Chat",
      click: () => chatWindowManager.showChatWindow(),
    },
    { type: "separator" },
    {
      label: "Settings",
      click: () => settingsManager.openSettingsWindow(),
    },
    { type: "separator" },
    {
      label: isRunning ? "Stop Gateway" : "Start Gateway",
      enabled: !isStartingOrStopping,
      click: () => {
        if (isRunning) {
          void gatewayManager.stop();
        } else {
          void gatewayManager.start();
        }
      },
    },
    {
      label: "Restart Gateway",
      enabled: isRunning && !isStartingOrStopping,
      click: () => void gatewayManager.restart(),
    },
    {
      label: "Rotate Desktop Token",
      enabled: !isStartingOrStopping,
      click: () => {
        void (async () => {
          try {
            gatewayManager.rotateAuthToken();
            await gatewayManager.restart();
            chatWindowManager.reloadToGatewayUi();
          } catch (err) {
            console.error("[Tray] Failed to rotate desktop token:", err);
          }
        })();
      },
    },
    { type: "separator" },
    {
      label: `Status: ${state.status.toUpperCase()}`,
      enabled: false,
    },
    {
      label: isRunning ? `Port: ${state.port}` : "Not running",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        // ESM-safe: use the imported `app` from Electron.
        void gatewayManager.stop().finally(() => app.quit());
      },
    },
  ];

  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);
}
