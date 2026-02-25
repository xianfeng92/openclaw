import { ipcMain, WebContents } from "electron";
import { spawn, ChildProcess, exec } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import type { GatewayManager } from "./gateway.js";

const execAsync = promisify(exec);

interface ShellResult {
  stdout: string;
  stderr: string;
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

// Orchestral task storage
interface OrchestralTask {
  id: string;
  agent: string;
  description: string;
  repo: string;
  worktree?: string;
  branch?: string;
  startedAt: number;
  status: "running" | "completed" | "failed" | "killed";
  process?: ChildProcess;
  pid?: number;
}

const orchestralTasks = new Map<string, OrchestralTask>();

// Get the actual project repository path, not the app directory
function getProjectPath(): string {
  // In development, return the actual project root
  // In production, use the app directory
  const devPath = "C:\\Users\\xforg\\Desktop\\openclaw";
  if (fs.existsSync(devPath)) {
    return devPath;
  }
  return process.cwd();
}

const tasksFilePath = path.join(getProjectPath(), ".openclaw", "tasks.json");

let gatewayManagerInstance: GatewayManager | null = null;

function getShellCommand(): string {
  return process.platform === "win32" ? "cmd.exe" : "/bin/sh";
}

// Save tasks to file
function saveTasks(): void {
  try {
    const dir = path.dirname(tasksFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tasks = Array.from(orchestralTasks.values());
    fs.writeFileSync(tasksFilePath, JSON.stringify(tasks, null, 2));
  } catch (err) {
    console.error("[Orchestral] Failed to save tasks:", err);
  }
}

// Load tasks from file
function loadTasks(): void {
  try {
    if (fs.existsSync(tasksFilePath)) {
      const data = fs.readFileSync(tasksFilePath, "utf-8");
      const tasks = JSON.parse(data) as OrchestralTask[];
      for (const task of tasks) {
        // Remove process reference as it can't be serialized
        orchestralTasks.set(task.id, { ...task, process: undefined });
      }
    }
  } catch (err) {
    console.error("[Orchestral] Failed to load tasks:", err);
  }
}

export function setupTerminalIpc(gatewayManager: GatewayManager): void {
  gatewayManagerInstance = gatewayManager;

  // Load existing tasks on startup
  loadTasks();

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

  // ===== Orchestral Commands =====

  // Helper to execute shell command and get output
  async function execShell(command: string): Promise<ShellResult> {
    try {
      return await execAsync(command, {
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
        timeout: 30000,
      }) as ShellResult;
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string };
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? String(err),
      };
    }
  }

  // Check if we're in a git repository
  async function getGitRepo(): Promise<string | null> {
    try {
      const result = await execShell("git rev-parse --show-toplevel");
      if (result.stdout.trim()) {
        return result.stdout.trim();
      }
    } catch {
      // Not in a git repo
    }
    return null;
  }

  // Spawn a new orchestral task (Windows-compatible, no tmux required)
  ipcMain.handle(
    "terminal:orchestral-spawn",
    async (
      event,
      opts: { description: string; agent?: string; branch?: string },
    ): Promise<{ success: boolean; task?: any; error?: string }> => {
      try {
        console.log("[Orchestral] spawn called with:", opts);

        // Get current git repository
        const repoPath = await getGitRepo();
        console.log("[Orchestral] repoPath:", repoPath);

        // Generate task ID
        const taskId = `task-${Date.now()}`;
        const agent = opts.agent || "claude";
        const branchName = opts.branch || `orchestral/${taskId.slice(0, 16)}`;

        console.log("[Orchestral] taskId:", taskId, "branch:", branchName);

        let worktreePath: string | undefined;
        let worktreeCreated = false;

        // Create git worktree if in a git repo
        if (repoPath) {
          worktreePath = path.join(repoPath, ".openclaw", "worktrees", taskId);

          // Notify about worktree creation
          event.sender.send("terminal:shell-output", {
            runId: taskId,
            type: "stdout",
            data: `Creating worktree: ${branchName}...\n`,
          });

          // Create worktree
          const worktreeResult = await execShell(
            `git -C "${repoPath}" worktree add -b ${branchName} "${worktreePath}" 2>&1`,
          );

          // Check if worktree was created (git worktree add outputs to stderr on Windows sometimes)
          const worktreeDirExists = fs.existsSync(worktreePath);
          const hasGitDir = fs.existsSync(path.join(worktreePath, ".git"));

          if (hasGitDir || worktreeDirExists) {
            worktreeCreated = true;
            event.sender.send("terminal:shell-output", {
              runId: taskId,
              type: "stdout",
              data: `✓ Worktree created\n`,
            });
          } else {
            event.sender.send("terminal:shell-output", {
              runId: taskId,
              type: "stderr",
              data: `Worktree creation issue: ${worktreeResult.stderr || worktreeResult.stdout}\n`,
            });
          }

          // Install dependencies if package.json exists and worktree was created
          if (worktreeCreated) {
            const pkgJsonPath = path.join(worktreePath, "package.json");
            if (fs.existsSync(pkgJsonPath)) {
              event.sender.send("terminal:shell-output", {
                runId: taskId,
                type: "stdout",
                data: `Installing dependencies...\n`,
              });

              // Try to detect package manager and install
              const lockFiles = [
                { file: "pnpm-lock.yaml", cmd: "pnpm install" },
                { file: "yarn.lock", cmd: "yarn install" },
                { file: "package-lock.json", cmd: "npm install" },
              ];

              for (const { file, cmd } of lockFiles) {
                if (fs.existsSync(path.join(worktreePath, file))) {
                  event.sender.send("terminal:shell-output", {
                    runId: taskId,
                    type: "stdout",
                    data: `Running: ${cmd}...\n`,
                  });
                  const installResult = await execShell(`cd "${worktreePath}" && ${cmd} 2>&1`);
                  if (installResult.stderr && installResult.stderr.includes("ERR")) {
                    event.sender.send("terminal:shell-output", {
                      runId: taskId,
                      type: "stderr",
                      data: `Dependency install warning: ${installResult.stderr.slice(0, 200)}\n`,
                    });
                  } else {
                    event.sender.send("terminal:shell-output", {
                      runId: taskId,
                      type: "stdout",
                      data: `✓ Dependencies installed\n`,
                    });
                  }
                  break;
                }
              }

              // No lock file found, try npm
              if (!lockFiles.some(lf => fs.existsSync(path.join(worktreePath, lf.file)))) {
                event.sender.send("terminal:shell-output", {
                  runId: taskId,
                  type: "stdout",
                  data: `Running: npm install...\n`,
                });
                const npmResult = await execShell(`cd "${worktreePath}" && npm install 2>&1`);
                if (npmResult.stderr && npmResult.stderr.includes("ERR!")) {
                  event.sender.send("terminal:shell-output", {
                    runId: taskId,
                    type: "stderr",
                    data: `npm install warning (may be ok): ${npmResult.stderr.slice(0, 150)}\n`,
                  });
                } else {
                  event.sender.send("terminal:shell-output", {
                    runId: taskId,
                    type: "stdout",
                    data: `✓ Dependencies installed\n`,
                  });
                }
              }
            }
          }
        }

        // Create the task
        const task: OrchestralTask = {
          id: taskId,
          agent,
          description: opts.description,
          repo: repoPath || process.cwd(),
          worktree: worktreePath,
          branch: branchName,
          startedAt: Date.now(),
          status: "running",
        };

        orchestralTasks.set(taskId, task);
        saveTasks();

        console.log("[Orchestral] Task saved:", task);

        // Prepare response
        let message = `✓ Task ${taskId} created`;
        let details: string[] = [];

        if (worktreeCreated && worktreePath) {
          details.push(`Worktree: ${worktreePath}`);
          details.push(`Branch: ${branchName}`);
        } else if (!repoPath) {
          details.push(`Working in: ${process.cwd()}`);
        }

        // Send completion notification
        event.sender.send("terminal:shell-output", {
          runId: taskId,
          type: "exit",
          data: "",
          exitCode: 0,
        });

        return {
          success: true,
          task: {
            ...task,
            message,
            details: details.join("\n"),
            worktreeCreated,
            mode: "lightweight",
          },
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );

  // Agents command (list, kill, attach, redirect, output)
  ipcMain.handle(
    "terminal:orchestral-agents",
    async (_event, action: string, args: string[]): Promise<any> => {
      try {
        switch (action) {
          case "list": {
            // Return all tracked orchestral tasks
            const tasks = Array.from(orchestralTasks.values())
              .filter(t => t.status === "running")
              .map(task => ({
                id: task.id,
                agent: task.agent,
                description: task.description,
                startedAt: task.startedAt,
                status: task.status,
                worktree: task.worktree,
                branch: task.branch,
                hasSession: !!task.process || !!task.pid,
              }));

            return { success: true, tasks };
          }

          case "kill": {
            const taskId = args[0];
            const task = orchestralTasks.get(taskId);

            if (!task) {
              return { success: false, error: "Task not found" };
            }

            // Kill the process if it exists
            if (task.process) {
              task.process.kill("SIGTERM");
            }

            // Clean up worktree if it exists
            if (task.worktree && task.repo) {
              try {
                await execShell(`git -C "${task.repo}" worktree remove --force "${task.worktree}"`);
              } catch {
                // Ignore cleanup errors
              }
            }

            // Update task status
            task.status = "killed";
            orchestralTasks.set(taskId, task);
            saveTasks();

            return { success: true, message: `Task ${taskId} terminated` };
          }

          case "attach": {
            const taskId = args[0];
            const task = orchestralTasks.get(taskId);

            if (!task) {
              return { success: false, error: "Task not found" };
            }

            if (!task.worktree) {
              return {
                success: true,
                message: `Task ${taskId} (no worktree - work in current directory)`,
                taskId,
                description: task.description,
              };
            }

            return {
              success: true,
              message: `Navigate to the worktree directory:`,
              worktree: task.worktree,
              command: `cd "${task.worktree}"`,
              taskId,
            };
          }

          case "redirect": {
            const taskId = args[0];
            const message = args.slice(1).join(" ");
            const task = orchestralTasks.get(taskId);

            if (!task) {
              return { success: false, error: "Task not found" };
            }

            // Store the redirect message in the task description
            task.description = `[REDIRECTED] ${message}\n\nOriginal: ${task.description}`;
            orchestralTasks.set(taskId, task);
            saveTasks();

            return { success: true, message: `Task ${taskId} redirected`, newDescription: task.description };
          }

          case "output": {
            const taskId = args[0];
            const task = orchestralTasks.get(taskId);

            if (!task) {
              return { success: false, error: "Task not found" };
            }

            // For lightweight tasks, we don't have stored output
            return {
              success: true,
              output: `Task ${taskId}: ${task.description}\nWorktree: ${task.worktree || "N/A"}\nBranch: ${task.branch || "N/A"}\n\nNo session output available (lightweight mode)`,
            };
          }

          default:
            return { success: false, error: "Unknown action" };
        }
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );

  // Tasks command
  ipcMain.handle(
    "terminal:orchestral-tasks",
    async (_event, filters: Record<string, string>): Promise<any> => {
      try {
        let tasks = Array.from(orchestralTasks.values());

        // Apply filters
        if (filters.status) {
          tasks = tasks.filter(t => t.status === filters.status);
        }
        if (filters.agent) {
          tasks = tasks.filter(t => t.agent === filters.agent);
        }
        if (filters.limit) {
          tasks = tasks.slice(0, Number.parseInt(filters.limit, 10));
        }

        // Sort by started time (newest first)
        tasks.sort((a, b) => b.startedAt - a.startedAt);

        // Count by status
        const allTasks = Array.from(orchestralTasks.values());
        const summary = `Total: ${allTasks.length} | running: ${allTasks.filter(t => t.status === "running").length} | completed: ${allTasks.filter(t => t.status === "completed").length} | failed: ${allTasks.filter(t => t.status === "failed").length}`;

        return {
          success: true,
          tasks,
          summary,
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );

  // Clean up completed tasks periodically
  setInterval(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    for (const [id, task] of orchestralTasks.entries()) {
      // Remove tasks older than 7 days that are completed/failed/killed
      if (
        (task.status === "completed" || task.status === "failed" || task.status === "killed") &&
        now - task.startedAt > 7 * dayMs
      ) {
        orchestralTasks.delete(id);
      }
    }
    saveTasks();
  }, 60 * 60 * 1000); // Every hour
}

// Keep old signature for backward compatibility, but warn
export function setupTerminalIpcLegacy(): void {
  console.warn("[Terminal] setupTerminalIpc called without gatewayManager parameter");
}
