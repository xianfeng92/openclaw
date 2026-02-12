/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from "electron";
import type { GatewayState } from "../main/gateway.js";
import type { SettingsData } from "../main/settings.js";

type DesktopGatewayAuth = {
  token: string;
  port: number;
};

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function isLoopbackWsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "ws:" || url.protocol === "wss:" ? isLoopbackHost(url.hostname) : false;
  } catch {
    return false;
  }
}

function getDesktopGatewayAuthSync(): DesktopGatewayAuth | null {
  try {
    const res = ipcRenderer.sendSync("gateway:get-auth-sync") as unknown;
    if (!res || typeof res !== "object") {
      return null;
    }
    const record = res as Record<string, unknown>;
    const token = typeof record.token === "string" ? record.token : null;
    const port = typeof record.port === "number" ? record.port : null;
    if (!token || !token.trim() || !port || !Number.isFinite(port) || port <= 0) {
      return null;
    }
    return { token: token.trim(), port };
  } catch {
    return null;
  }
}

function seedControlUiAuth(auth: DesktopGatewayAuth): void {
  // Only seed auth for the local gateway Control UI origin.
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return;
  }
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") {
    return;
  }
  if (!isLoopbackHost(window.location.hostname)) {
    return;
  }
  if (window.location.port !== String(auth.port)) {
    return;
  }

  const KEY = "openclaw.control.settings.v1";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const desiredGatewayUrl = `${proto}://127.0.0.1:${auth.port}`;

  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

    const next: Record<string, unknown> = { ...parsed };
    const currentToken = typeof parsed.token === "string" ? parsed.token : "";
    if (!currentToken.trim() || currentToken.trim() !== auth.token) {
      next.token = auth.token;
    }

    const currentGatewayUrl = typeof parsed.gatewayUrl === "string" ? parsed.gatewayUrl : "";
    if (!currentGatewayUrl.trim() || isLoopbackWsUrl(currentGatewayUrl)) {
      next.gatewayUrl = desiredGatewayUrl;
    }

    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Best-effort: if localStorage is corrupted or blocked, do not crash the renderer.
  }
}

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
    invoke(): Promise<void>;
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
    invoke: () => ipcRenderer.invoke("window:invoke"),
  },
  saveSettings: (data) => ipcRenderer.invoke("settings:save", data),
};

// Expose under two keys:
// - `window.electron` for existing code paths
// - `window.__openclawDesktop` to avoid collisions with pages that define/overwrite `window.electron`
contextBridge.exposeInMainWorld("electron", api);
contextBridge.exposeInMainWorld("__openclawDesktop", api);

// `ElectronAPI` is already exported as an interface above.

// Tokenless desktop UX: seed the Control UI's localStorage token for loopback origins only.
// Keep this out of the window globals; only the Control UI reads from localStorage.
const trySeed = () => {
  const auth = getDesktopGatewayAuthSync();
  if (auth) {
    seedControlUiAuth(auth);
  }
};

trySeed();

// In case the preload is not re-executed on navigation, retry on load events.
try {
  window.addEventListener("DOMContentLoaded", () => trySeed());
  window.addEventListener("pageshow", () => trySeed());
} catch {
  // ignore
}
