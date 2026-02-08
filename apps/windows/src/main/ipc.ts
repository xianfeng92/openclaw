import { ipcMain } from "electron";
import type { GatewayManager, GatewayState } from "./gateway.js";
import type { ChatWindowManager } from "./window.js";
import type { SettingsData } from "./settings.js";
import { saveSettings } from "./settings.js";

export function setupIpc(
  gatewayManager: GatewayManager,
  chatWindowManager: ChatWindowManager
): void {
  // Get gateway state
  ipcMain.handle("gateway:get-state", (): GatewayState => {
    return gatewayManager.getState();
  });

  // Start gateway
  ipcMain.handle("gateway:start", async (): Promise<{ success: boolean; error?: string }> => {
    try {
      await gatewayManager.start();
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("[IPC] gateway:start error:", errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // Stop gateway
  ipcMain.handle("gateway:stop", async (): Promise<{ success: boolean; error?: string }> => {
    try {
      await gatewayManager.stop();
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("[IPC] gateway:stop error:", errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // Restart gateway
  ipcMain.handle("gateway:restart", async (): Promise<{ success: boolean; error?: string }> => {
    try {
      await gatewayManager.restart();
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("[IPC] gateway:restart error:", errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // Show chat window
  ipcMain.handle("window:show", (): void => {
    chatWindowManager.showChatWindow();
  });

  // Hide chat window
  ipcMain.handle("window:hide", (): void => {
    chatWindowManager.hideChatWindow();
  });

  // Toggle chat window
  ipcMain.handle("window:toggle", (): void => {
    chatWindowManager.toggleChatWindow();
  });

  // Subscribe to gateway state changes
  ipcMain.on("gateway:subscribe", (event) => {
    const listener = (state: GatewayState) => {
      event.sender.send("gateway:state-changed", state);
    };
    gatewayManager.on("state-changed", listener);

    // Send current state
    event.sender.send("gateway:state-changed", gatewayManager.getState());

    // Cleanup when window closes
    event.sender.on("destroyed", () => {
      gatewayManager.off("state-changed", listener);
    });
  });

  // Save settings
  ipcMain.handle("settings:save", async (_event, data: SettingsData): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await saveSettings(data);

      // Restart gateway if save was successful
      if (result.success) {
        // Stop and restart gateway
        if (gatewayManager.isRunning()) {
          await gatewayManager.stop();
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        await gatewayManager.start();
      }

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("[IPC] settings:save error:", errorMessage);
      return { success: false, error: errorMessage };
    }
  });
}
