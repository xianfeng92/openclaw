/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from "electron";

export interface TerminalAPI {
  // Shell execution
  execShell: (command: string) => Promise<{ runId: string }>;
  abortShell: (runId: string) => Promise<{ success: boolean }>;
  onShellOutput: (
    callback: (data: { runId: string; type: string; data: string; exitCode?: number | null }) => void,
  ) => () => void;

  // Gateway info
  getGatewayInfo: () => Promise<{ port?: number; token?: string }>;

  // Get auth sync (for bootstrap)
  getGatewayAuthSync: () => { token: string; port: number } | null;
}

const api: TerminalAPI = {
  execShell: (command: string) => ipcRenderer.invoke("terminal:exec-shell", command),
  abortShell: (runId: string) => ipcRenderer.invoke("terminal:abort-shell", runId),
  onShellOutput: (callback) => {
    const listener = (_event: unknown, data: unknown) => callback(data as { runId: string; type: string; data: string; exitCode?: number | null });
    ipcRenderer.on("terminal:shell-output", listener);
    return () => {
      ipcRenderer.removeListener("terminal:shell-output", listener);
    };
  },
  getGatewayInfo: () => ipcRenderer.invoke("terminal:get-gateway-info"),
  getGatewayAuthSync: () => {
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
  },
};

contextBridge.exposeInMainWorld("terminalAPI", api);
