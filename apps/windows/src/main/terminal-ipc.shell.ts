import { spawn } from "child_process";
import { ipcMain } from "electron";
import { v4 as uuidv4 } from "uuid";

type ShellOutputEvent = {
  runId: string;
  type: "stdout" | "stderr" | "exit";
  data: string;
  exitCode?: number | null;
};

type PendingShell = {
  proc: ReturnType<typeof spawn>;
  stdout: string;
  stderr: string;
};

const activeShells = new Map<string, PendingShell>();

function getShellCommand(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec || "cmd.exe";
  }
  return process.env.SHELL || "/bin/sh";
}

export function registerTerminalShellIpcHandlers(): void {
  ipcMain.handle(
    "terminal:exec-shell",
    async (event, command: string): Promise<{ runId: string }> => {
      const runId = uuidv4();
      const shellCommand = getShellCommand();
      const isWindows = process.platform === "win32";
      const proc = spawn(isWindows ? shellCommand : "/bin/sh", isWindows ? ["/c", command] : ["-lc", command], {
        shell: false,
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
      });

      const pending: PendingShell = {
        proc,
        stdout: "",
        stderr: "",
      };
      activeShells.set(runId, pending);

      proc.stdin?.write(`${command}\n`);
      proc.stdin?.end();

      proc.stdout?.on("data", (data) => {
        const chunk = data.toString();
        pending.stdout += chunk;
        event.sender.send("terminal:shell-output", {
          runId,
          type: "stdout",
          data: chunk,
        } satisfies ShellOutputEvent);
      });

      proc.stderr?.on("data", (data) => {
        const chunk = data.toString();
        pending.stderr += chunk;
        event.sender.send("terminal:shell-output", {
          runId,
          type: "stderr",
          data: chunk,
        } satisfies ShellOutputEvent);
      });

      proc.on("close", (code) => {
        event.sender.send("terminal:shell-output", {
          runId,
          type: "exit",
          data: "",
          exitCode: code,
        } satisfies ShellOutputEvent);
        activeShells.delete(runId);
      });

      proc.on("error", (err) => {
        event.sender.send("terminal:shell-output", {
          runId,
          type: "stderr",
          data: err.message,
        } satisfies ShellOutputEvent);
        activeShells.delete(runId);
      });

      return { runId };
    },
  );

  ipcMain.handle("terminal:abort-shell", async (_event, runId: string): Promise<{ success: boolean }> => {
    const pending = activeShells.get(runId);
    if (!pending?.proc) {
      return { success: false };
    }

    pending.proc.kill("SIGTERM");
    activeShells.delete(runId);
    return { success: true };
  });
}
