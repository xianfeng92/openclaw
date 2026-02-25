import { ipcMain, WebContents } from "electron";
import { spawn, ChildProcess } from "child_process";
import { v4 as uuidv4 } from "uuid";
import type { GatewayManager } from "./gateway.js";

interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

interface ShellOutputEvent {
  runId: string;
  type: "stdout" | "stderr" | "exit";
  data: string;
  exitCode?: number | null;
}

type PendingShell = {
  proc: ChildProcess;
  stdout: string;
  stderr: string;
  webContents: WebContents;
};

const activeShells = new Map<string, PendingShell>();

let gatewayManagerInstance: GatewayManager | null = null;

function getShellCommand(): string {
  return process.platform === "win32" ? "cmd.exe" : "/bin/sh";
}

export function setupTerminalIpc(gatewayManager: GatewayManager): void {
  gatewayManagerInstance = gatewayManager;

  // Execute shell command
  ipcMain.handle(
    "terminal:exec-shell",
    async (event, command: string): Promise<{ runId: string }> => {
      const runId = uuidv4();
      const shell = getShellCommand();

      const proc = spawn(shell, [], {
        shell: true,
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
      });

      const pending: PendingShell = {
        proc,
        stdout: "",
        stderr: "",
        webContents: event.sender,
      };
      activeShells.set(runId, pending);

      // Write the command to stdin
      proc.stdin?.write(`${command}\n`);
      proc.stdin?.end();

      // Stream stdout
      proc.stdout?.on("data", (data) => {
        const chunk = data.toString();
        pending.stdout += chunk;
        event.sender.send("terminal:shell-output", {
          runId,
          type: "stdout",
          data: chunk,
        } as ShellOutputEvent);
      });

      // Stream stderr
      proc.stderr?.on("data", (data) => {
        const chunk = data.toString();
        pending.stderr += chunk;
        event.sender.send("terminal:shell-output", {
          runId,
          type: "stderr",
          data: chunk,
        } as ShellOutputEvent);
      });

      // Handle exit
      proc.on("close", (code) => {
        event.sender.send("terminal:shell-output", {
          runId,
          type: "exit",
          data: "",
          exitCode: code,
        } as ShellOutputEvent);
        activeShells.delete(runId);
      });

      // Handle errors
      proc.on("error", (err) => {
        event.sender.send("terminal:shell-output", {
          runId,
          type: "stderr",
          data: err.message,
        } as ShellOutputEvent);
        activeShells.delete(runId);
      });

      return { runId };
    },
  );

  // Abort shell command
  ipcMain.handle("terminal:abort-shell", async (_event, runId: string): Promise<{ success: boolean }> => {
    const pending = activeShells.get(runId);
    if (pending && pending.proc) {
      pending.proc.kill("SIGTERM");
      activeShells.delete(runId);
      return { success: true };
    }
    return { success: false };
  });

  // Get gateway info (port and token)
  ipcMain.handle("terminal:get-gateway-info", async (): Promise<{ port?: number; token?: string }> => {
    if (!gatewayManagerInstance) {
      return {};
    }

    const state = gatewayManagerInstance.getState();
    const token = gatewayManagerInstance.getAuthToken();

    return {
      port: state.port,
      token,
    };
  });
}

// Keep old signature for backward compatibility, but warn
export function setupTerminalIpcLegacy(): void {
  console.warn("[Terminal] setupTerminalIpc called without gatewayManager parameter");
}
