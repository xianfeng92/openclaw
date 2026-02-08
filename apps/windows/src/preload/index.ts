import { contextBridge, ipcRenderer } from "electron";
import type { GatewayState } from "../main/gateway.js";
import type { SettingsData } from "../main/settings.js";

export interface ElectronAPI {
  gateway: {
    getState(): Promise<GatewayState>;
    start(): Promise<{ success: boolean; error?: string }>;
    stop(): Promise<{ success: boolean; error?: string }>;
    restart(): Promise<{ success: boolean; error?: string }>;
    onStateChanged(callback: (state: GatewayState) => void): () => void;
  };
  window: {
    show(): Promise<void>;
    hide(): Promise<void>;
    toggle(): Promise<void>;
  };
  saveSettings(data: SettingsData): Promise<{ success: boolean; error?: string }>;
}

const api: ElectronAPI = {
  gateway: {
    getState: () => ipcRenderer.invoke("gateway:get-state"),
    start: () => ipcRenderer.invoke("gateway:start"),
    stop: () => ipcRenderer.invoke("gateway:stop"),
    restart: () => ipcRenderer.invoke("gateway:restart"),
    onStateChanged: (callback) => {
      const listener = (_event: unknown, state: GatewayState) => callback(state);
      ipcRenderer.on("gateway:state-changed", listener);
      ipcRenderer.send("gateway:subscribe");
      return () => {
        ipcRenderer.off("gateway:state-changed", listener);
      };
    },
  },
  window: {
    show: () => ipcRenderer.invoke("window:show"),
    hide: () => ipcRenderer.invoke("window:hide"),
    toggle: () => ipcRenderer.invoke("window:toggle"),
  },
  saveSettings: (data) => ipcRenderer.invoke("settings:save", data),
};

// Expose under two keys:
// - `window.electron` for existing code paths
// - `window.__openclawDesktop` to avoid collisions with pages that define/overwrite `window.electron`
contextBridge.exposeInMainWorld("electron", api);
contextBridge.exposeInMainWorld("__openclawDesktop", api);

// `ElectronAPI` is already exported as an interface above.
