import { ipcMain, WebContents } from "electron";
import { spawn, ChildProcess, exec } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import type { GatewayManager } from "./gateway.js";
import { getAgentManager } from "./windows-agent-manager.js";
// Note: Orchestration modules are imported dynamically via IPC or at runtime
// Static imports are removed to avoid build issues

// Helper to parse Obsidian vault (simplified implementation)
async function parseObsidianVault(vaultPath: string): Promise<{
  customers: Array<{ name: string; score: number }>;
  projects: Array<{ name: string; score: number }>;
  meetings: Array<{ title: string; score: number }>;
  decisions: Array<{ title: string; score: number }>;
  patterns: Array<{ name: string; category: string; effectiveness?: number; usageCount?: number }>;
}> {
  const context = {
    customers: [] as Array<{ name: string; score: number }>,
    projects: [] as Array<{ name: string; score: number }>,
    meetings: [] as Array<{ title: string; score: number }>,
    decisions: [] as Array<{ title: string; score: number }>,
    patterns: [] as Array<{ name: string; category: string; effectiveness?: number; usageCount?: number }>,
  };

  try {
    // Check for customer files
    const customersDir = path.join(vaultPath, "Customers");
    if (fs.existsSync(customersDir)) {
      const files = fs.readdirSync(customersDir).filter(f => f.endsWith(".md"));
      for (const file of files) {
        const name = file.replace(".md", "");
        context.customers.push({ name, score: 10 });
      }
    }

    // Check for project files
    const projectsDir = path.join(vaultPath, "Projects");
    if (fs.existsSync(projectsDir)) {
      const files = fs.readdirSync(projectsDir).filter(f => f.endsWith(".md"));
      for (const file of files) {
        const name = file.replace(".md", "");
        context.projects.push({ name, score: 10 });
      }
    }

    // Check for pattern files
    const patternsDir = path.join(vaultPath, "Patterns");
    if (fs.existsSync(patternsDir)) {
      const files = fs.readdirSync(patternsDir).filter(f => f.endsWith(".md"));
      for (const file of files) {
        const name = file.replace(".md", "");
        context.patterns.push({ name, category: "general", effectiveness: 0.5, usageCount: 0 });
      }
    }
  } catch (err) {
    console.error("[Context] Error parsing vault:", err);
  }

  return context;
}

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
  completedAt?: number;
  exitCode?: number | null;
  failureReason?: string;
  lastOutput?: string;
  process?: ChildProcess;
  pid?: number;
  useContext?: boolean;
  contextSummary?: {
    customersCount: number;
    projectsCount: number;
    decisionsCount: number;
  };
  appliedPattern?: {
    id: string;
    name: string;
    appliedAt: number;
  };
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
      const shellCommand = getShellCommand();

      // On Windows, use cmd.exe explicitly with /c flag
      // On Unix, use /bin/sh with -lc flag
      const isWindows = process.platform === "win32";
      const proc = spawn(isWindows ? shellCommand : "/bin/sh", isWindows ? ["/c", command] : ["-lc", command], {
        shell: false, // Don't use shell: true - we're invoking shell explicitly
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

  function trimOutputTail(output: string, maxChars = 4000): string {
    const trimmed = output.trim();
    if (!trimmed) {
      return "";
    }
    if (trimmed.length <= maxChars) {
      return trimmed;
    }
    return trimmed.slice(trimmed.length - maxChars);
  }

  function formatTaskOutput(task: OrchestralTask, lines = 50): string {
    const header = [
      `Task ${task.id}: ${task.description}`,
      `Worktree: ${task.worktree || "N/A"}`,
      `Branch: ${task.branch || "N/A"}`,
      `Status: ${task.status}`,
    ];

    if (task.exitCode !== undefined && task.exitCode !== null) {
      header.push(`Exit code: ${task.exitCode}`);
    }
    if (task.failureReason) {
      header.push(`Failure: ${task.failureReason}`);
    }

    if (!task.lastOutput || !task.lastOutput.trim()) {
      return `${header.join("\n")}\n\nNo session output available`;
    }

    const outputLines = task.lastOutput.split(/\r?\n/u);
    const tail = outputLines.slice(Math.max(0, outputLines.length - Math.max(1, lines))).join("\n").trim();
    return `${header.join("\n")}\n\nLast output:\n${tail}`;
  }

  function syncTaskStatusesFromAgentManager(): void {
    const agentMgr = getAgentManager(getProjectPath());
    let changed = false;

    for (const [taskId, task] of orchestralTasks.entries()) {
      const agentProcess = agentMgr.getAgent(taskId);
      if (!agentProcess) {
        continue;
      }

      let nextStatus: OrchestralTask["status"] = task.status;
      if (agentProcess.status === "running" || agentProcess.status === "starting") {
        nextStatus = "running";
      } else if (agentProcess.status === "killed") {
        nextStatus = "killed";
      } else if (agentProcess.status === "exited") {
        const failed =
          !!agentProcess.failureReason ||
          (agentProcess.exitCode !== undefined &&
            agentProcess.exitCode !== null &&
            agentProcess.exitCode !== 0);
        nextStatus = failed ? "failed" : "completed";
      }

      const nextPid = agentProcess.pid || task.pid;
      const nextCompletedAt =
        nextStatus === "running" ? task.completedAt : task.completedAt ?? agentProcess.completedAt ?? Date.now();
      const nextExitCode = agentProcess.exitCode ?? task.exitCode;
      const nextFailureReason = agentProcess.failureReason ?? task.failureReason;
      const nextLastOutput =
        trimOutputTail(agentProcess.lastOutput ?? "") ||
        (nextStatus === "failed" || nextStatus === "completed"
          ? trimOutputTail(agentMgr.getOutput(taskId, 80))
          : task.lastOutput);

      if (
        task.status !== nextStatus ||
        task.pid !== nextPid ||
        task.completedAt !== nextCompletedAt ||
        task.exitCode !== nextExitCode ||
        task.failureReason !== nextFailureReason ||
        task.lastOutput !== nextLastOutput
      ) {
        orchestralTasks.set(taskId, {
          ...task,
          status: nextStatus,
          pid: nextPid,
          completedAt: nextCompletedAt,
          exitCode: nextExitCode,
          failureReason: nextFailureReason,
          lastOutput: nextLastOutput,
        });
        changed = true;
      }
    }

    if (changed) {
      saveTasks();
    }
  }

  // Helper to execute shell command and get output
  async function execShell(command: string): Promise<ShellResult> {
    try {
      // On Windows, explicitly use cmd.exe to avoid PowerShell compatibility issues
      // On Unix, use the default shell (bash/sh)
      const isWindows = process.platform === "win32";
      const options = {
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
        timeout: 30000,
        // Explicitly set shell on Windows to use cmd.exe
        ...(isWindows ? { shell: "cmd.exe" } : {}),
      };

      return await execAsync(command, options) as ShellResult;
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
      opts: {
        description: string;
        agent?: string;
        branch?: string;
        useContext?: boolean;
        relevantContext?: {
          customers: Array<{ name: string; score: number }>;
          projects: Array<{ name: string; score: number }>;
          decisions: Array<{ title: string; score: number }>;
          meetings: Array<{ title: string; score: number }>;
          patterns: Array<{ name: string; score: number }>;
        };
      },
    ): Promise<{ success: boolean; task?: any; error?: string }> => {
      try {
        console.log("[Orchestral] spawn called with:", opts);

        // Log context if provided
        if (opts.useContext && opts.relevantContext) {
          console.log("[Orchestral] Context injection enabled:", {
            customers: opts.relevantContext.customers?.length || 0,
            projects: opts.relevantContext.projects?.length || 0,
            decisions: opts.relevantContext.decisions?.length || 0,
          });
        }

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
          // Store context with task (as metadata)
          useContext: opts.useContext ?? false,
          contextSummary: opts.relevantContext ? {
            customersCount: opts.relevantContext.customers?.length || 0,
            projectsCount: opts.relevantContext.projects?.length || 0,
            decisionsCount: opts.relevantContext.decisions?.length || 0,
          } : undefined,
        } as any;

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

        // Add context info to response
        if (opts.useContext && opts.relevantContext) {
          const contextItems: string[] = [];
          if (opts.relevantContext.customers?.length) {
            contextItems.push(`${opts.relevantContext.customers.length} customer(s)`);
          }
          if (opts.relevantContext.projects?.length) {
            contextItems.push(`${opts.relevantContext.projects.length} project(s)`);
          }
          if (opts.relevantContext.decisions?.length) {
            contextItems.push(`${opts.relevantContext.decisions.length} decision(s)`);
          }
          if (contextItems.length > 0) {
            details.push(`Context: ${contextItems.join(", ")}`);
          }
        }

        // Start the agent process
        const agentMgr = getAgentManager(getProjectPath());
        const agentResult = await agentMgr.startAgent({
          taskId,
          description: opts.description,
          worktree: worktreePath,
          agent,
          branch: branchName,
          webContents: event.sender,
          useContext: opts.useContext,
          relevantContext: opts.relevantContext,
        });

        if (agentResult.success) {
          task.pid = agentResult.pid;
          orchestralTasks.set(taskId, task);
          details.push(`PID: ${agentResult.pid}`);
        } else {
          // Agent failed to start but worktree was created
          task.status = "failed";
          task.completedAt = Date.now();
          task.exitCode = agentResult.exitCode ?? null;
          task.failureReason = agentResult.error || "Agent failed to start";
          task.lastOutput = trimOutputTail(agentResult.lastOutput ?? "");
          orchestralTasks.set(taskId, task);
          details.push(`Agent start failed: ${task.failureReason}`);
          if (task.exitCode !== null && task.exitCode !== undefined) {
            details.push(`Exit code: ${task.exitCode}`);
          }
          if (task.lastOutput) {
            const preview = task.lastOutput.replace(/\r?\n/gu, " ").slice(0, 240);
            details.push(`Last output: ${preview}`);
          }
        }
        syncTaskStatusesFromAgentManager();
        saveTasks();

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
            mode: "full",
            pid: agentResult.pid,
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
    async (event, action: string, args: string[]): Promise<any> => {
      try {
        const agentMgr = getAgentManager(getProjectPath());

        switch (action) {
          case "list": {
            syncTaskStatusesFromAgentManager();
            // Get agents from both old and new system
            const agentProcesses = agentMgr.listAgents();
            const legacyTasks = Array.from(orchestralTasks.values())
              .filter(t => t.status === "running" && !agentProcesses.some(ap => ap.id === t.id))
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

            return { success: true, tasks: [...agentProcesses, ...legacyTasks] };
          }

          case "kill": {
            const taskId = args[0];

            // Try agent manager first
            const agentKillResult = await agentMgr.killAgent(taskId);
            if (agentKillResult.success) {
              // Update legacy task status
              const task = orchestralTasks.get(taskId);
              if (task) {
                task.status = "killed";
                task.completedAt = Date.now();
                task.failureReason = "Task was terminated by user";
                orchestralTasks.set(taskId, task);
                saveTasks();
              }
              return agentKillResult;
            }

            // Fall back to legacy method
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
            task.completedAt = Date.now();
            task.failureReason = "Task was terminated by user";
            orchestralTasks.set(taskId, task);
            saveTasks();

            return { success: true, message: `Task ${taskId} terminated` };
          }

          case "attach": {
            const taskId = args[0];

            // Try agent manager first
            const agentProcess = agentMgr.getAgent(taskId);
            if (agentProcess) {
              if (!agentProcess.worktree) {
                return {
                  success: true,
                  message: `Task ${taskId} (no worktree - work in current directory)`,
                  taskId,
                  description: agentProcess.description,
                };
              }
              return {
                success: true,
                message: `Navigate to the worktree directory:`,
                worktree: agentProcess.worktree,
                command: `cd "${agentProcess.worktree}"`,
                taskId,
              };
            }

            // Fall back to legacy method
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

            // Try agent manager first
            const agentProcess = agentMgr.getAgent(taskId);
            if (agentProcess) {
              if (agentMgr.sendMessage(taskId, message)) {
                return { success: true, message: `Message sent to ${taskId}` };
              }
              return { success: false, error: "Could not send message (process not running)" };
            }

            // Fall back to legacy method
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
            const linesArg = args[1];
            const lines = linesArg ? parseInt(linesArg, 10) : 50;

            // Try agent manager first
            const agentProcess = agentMgr.getAgent(taskId);
            if (agentProcess) {
              const output = agentMgr.getOutput(taskId, lines);
              const task = orchestralTasks.get(taskId);
              if (!output.trim() && task) {
                return {
                  success: true,
                  output: formatTaskOutput(task, lines),
                  hasOutput: !!task.lastOutput,
                };
              }
              return {
                success: true,
                output,
                hasOutput: output.length > 0,
              };
            }

            // Fall back to legacy method
            const task = orchestralTasks.get(taskId);

            if (!task) {
              return { success: false, error: "Task not found" };
            }

            return {
              success: true,
              output: formatTaskOutput(task, lines),
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

  // Agent output subscription - allow frontend to subscribe to agent output
  ipcMain.on("terminal:subscribe-agent-output", (event, taskId: string) => {
    const agentMgr = getAgentManager(getProjectPath());
    const agentProcess = agentMgr.getAgent(taskId);

    if (agentProcess) {
      // Update the webContents for this agent
      agentProcess.webContents = event.sender;
    }
  });

  // Agent process management IPC handlers
  ipcMain.handle("terminal:agent-start", async (event, opts: {
    taskId: string;
    description: string;
    worktree?: string;
    agent?: string;
    branch?: string;
    useContext?: boolean;
    relevantContext?: {
      customers: Array<{ name: string; score: number }>;
      projects: Array<{ name: string; score: number }>;
      decisions: Array<{ title: string; score: number }>;
      meetings: Array<{ title: string; score: number }>;
      patterns: Array<{ name: string; score: number }>;
    };
  }) => {
    const agentMgr = getAgentManager(getProjectPath());
    return await agentMgr.startAgent({
      ...opts,
      webContents: event.sender,
    });
  });

  ipcMain.handle("terminal:agent-kill", async (_event, taskId: string) => {
    const agentMgr = getAgentManager(getProjectPath());
    return await agentMgr.killAgent(taskId);
  });

  ipcMain.handle("terminal:agent-get-output", async (_event, taskId: string, lines = 50) => {
    const agentMgr = getAgentManager(getProjectPath());
    const agentProcess = agentMgr.getAgent(taskId);

    if (agentProcess) {
      const output = agentMgr.getOutput(taskId, lines);
      return {
        success: true,
        output,
      };
    }

    const task = orchestralTasks.get(taskId);
    if (!task) {
      return { success: false, error: "Task not found" };
    }

    return {
      success: true,
      output: formatTaskOutput(task, lines),
    };
  });

  // Tasks command
  ipcMain.handle(
    "terminal:orchestral-tasks",
    async (_event, filters: Record<string, string>, action?: string): Promise<any> => {
      try {
        // Handle purge/clear action to actually delete tasks from storage
        if (action === "purge" || action === "clear") {
          let deletedCount = 0;
          for (const [taskId, task] of orchestralTasks.entries()) {
            // Only delete completed or failed tasks, keep running ones
            if (task.status === "completed" || task.status === "failed") {
              orchestralTasks.delete(taskId);
              deletedCount++;
            }
          }
          saveTasks();
          return {
            success: true,
            message: `Deleted ${deletedCount} completed/failed tasks from storage`,
          };
        }

        syncTaskStatusesFromAgentManager();
        let tasks = Array.from(orchestralTasks.values())
          .filter(t => t.status !== "killed");

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

  // ===== Context Commands =====

  // Context list - return all loaded context items
  ipcMain.handle("terminal:context-list", async (): Promise<any> => {
    try {
      const contextPath = path.join(getProjectPath(), ".openclaw", "business-context.json");

      if (!fs.existsSync(contextPath)) {
        return {
          customers: [],
          projects: [],
          meetings: [],
          decisions: [],
          patterns: [],
        };
      }

      const data = JSON.parse(fs.readFileSync(contextPath, "utf-8"));

      // Return simplified versions for UI display
      return {
        customers: (data.customers || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          tags: c.tags,
        })),
        projects: (data.projects || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          status: p.status,
        })),
        meetings: (data.meetings || []).map((m: any) => ({
          id: m.id,
          title: m.title,
          date: m.date,
        })),
        decisions: (data.decisions || []).map((d: any) => ({
          id: d.id,
          title: d.title,
          status: d.status,
        })),
        patterns: (data.patterns || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          category: p.category,
        })),
      };
    } catch (err) {
      console.error("[Context] Failed to load context:", err);
      return {
        customers: [],
        projects: [],
        meetings: [],
        decisions: [],
        patterns: [],
      };
    }
  });

  // Context search - search for matching items
  ipcMain.handle("terminal:context-search", async (_event, query: string): Promise<any> => {
    try {
      const contextPath = path.join(getProjectPath(), ".openclaw", "business-context.json");

      if (!fs.existsSync(contextPath)) {
        return {
          customers: [],
          projects: [],
          meetings: [],
          decisions: [],
          patterns: [],
        };
      }

      const data = JSON.parse(fs.readFileSync(contextPath, "utf-8"));
      const lowerQuery = query.toLowerCase();

      // Simple search function
      const searchItems = (items: any[], fields: string[]) => {
        return items
          .map((item: any) => {
            let score = 0;
            for (const field of fields) {
              const value = item[field];
              if (value && String(value).toLowerCase().includes(lowerQuery)) {
                score += 1;
              }
            }
            return { item, score };
          })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((r) => ({
            name: r.item.name || r.item.title || "Unknown",
            score: r.score,
          }));
      };

      return {
        customers: searchItems(data.customers || [], ["name", "notes", "tags"]),
        projects: searchItems(data.projects || [], ["name", "description", "tags"]),
        meetings: searchItems(data.meetings || [], ["title", "notes", "attendees"]),
        decisions: searchItems(data.decisions || [], ["title", "decision", "context"]),
        patterns: searchItems(data.patterns || [], ["name", "description", "prompt"]),
      };
    } catch (err) {
      console.error("[Context] Search failed:", err);
      return {
        customers: [],
        projects: [],
        meetings: [],
        decisions: [],
        patterns: [],
      };
    }
  });

  // Context load - sync from Obsidian vault
  ipcMain.handle("terminal:context-load", async (_event, vaultPath?: string): Promise<any> => {
    try {
      // Determine vault path
      let actualVaultPath = vaultPath || "";

      if (!actualVaultPath) {
        // Try to find Obsidian vault automatically
        actualVaultPath = findObsidianVault() || "";
      }

      if (!actualVaultPath) {
        // Try common Obsidian vault locations as fallback
        const homeDir = process.env.HOME || process.env.USERPROFILE || "";
        const commonPaths = [
          path.join(homeDir, "Obsidian", "Vault"),
          path.join(homeDir, "Documents", "Obsidian", "Vault"),
          path.join(homeDir, "OneDrive", "Documents", "Obsidian", "Vault"),
        ];

        for (const p of commonPaths) {
          if (fs.existsSync(p)) {
            actualVaultPath = p;
            break;
          }
        }
      }

      if (!actualVaultPath || !fs.existsSync(actualVaultPath)) {
        return {
          success: false,
          error: "Vault path not found. Use /context load <vault-path> to specify.",
        };
      }

      console.log(`[Context] Loading from Obsidian vault: ${actualVaultPath}`);

      // Parse Obsidian markdown files
      const context = await parseObsidianVault(actualVaultPath);

      // Save the context
      const contextPath = path.join(getProjectPath(), ".openclaw", "business-context.json");
      const contextDir = path.dirname(contextPath);
      if (!fs.existsSync(contextDir)) {
        fs.mkdirSync(contextDir, { recursive: true });
      }
      fs.writeFileSync(contextPath, JSON.stringify(context, null, 2));

      const summary = `Customers: ${context.customers.length}, Projects: ${context.projects.length}, Meetings: ${context.meetings.length}, Decisions: ${context.decisions.length}, Patterns: ${context.patterns.length}`;

      return {
        success: true,
        summary,
        context: {
          customers: context.customers.length,
          projects: context.projects.length,
          meetings: context.meetings.length,
          decisions: context.decisions.length,
          patterns: context.patterns.length,
        },
      };
    } catch (err) {
      console.error("[Context] Failed to load from Obsidian:", err);
      return {
        success: false,
        error: String(err),
      };
    }
  });

  // Context clear - clear cached context
  ipcMain.handle("terminal:context-clear", async (): Promise<void> => {
    try {
      const contextPath = path.join(getProjectPath(), ".openclaw", "business-context.json");
      if (fs.existsSync(contextPath)) {
        fs.unlinkSync(contextPath);
      }
    } catch (err) {
      console.error("[Context] Failed to clear context:", err);
    }
  });

  // Context summary - get summary statistics
  ipcMain.handle("terminal:context-summary", async (): Promise<any> => {
    try {
      const contextPath = path.join(getProjectPath(), ".openclaw", "business-context.json");

      if (!fs.existsSync(contextPath)) {
        return {
          customers: 0,
          projects: 0,
          meetings: 0,
          decisions: 0,
          patterns: 0,
        };
      }

      const data = JSON.parse(fs.readFileSync(contextPath, "utf-8"));

      return {
        customers: (data.customers || []).length,
        projects: (data.projects || []).length,
        meetings: (data.meetings || []).length,
        decisions: (data.decisions || []).length,
        patterns: (data.patterns || []).length,
        lastSyncAt: data.lastSyncAt ? new Date(data.lastSyncAt).toISOString() : undefined,
      };
    } catch (err) {
      console.error("[Context] Failed to get summary:", err);
      return {
        customers: 0,
        projects: 0,
        meetings: 0,
        decisions: 0,
        patterns: 0,
      };
    }
  });

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

// ===== Pattern Commands =====

// Generate a simple ID for patterns
function generatePatternId(): string {
  return `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// List all patterns
ipcMain.handle("terminal:pattern-list", async (): Promise<any> => {
  try {
    const contextPath = path.join(getProjectPath(), ".openclaw", "business-context.json");

    if (!fs.existsSync(contextPath)) {
      return { success: true, patterns: [] };
    }

    const data = JSON.parse(fs.readFileSync(contextPath, "utf-8"));
    const patterns = data.patterns || [];

    return {
      success: true,
      patterns: patterns.map((p: any) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description,
        effectiveness: p.effectiveness,
        usageCount: p.usageCount || 0,
      })),
    };
  } catch (err) {
    console.error("[Pattern] Failed to list patterns:", err);
    return { success: false, error: String(err), patterns: [] };
  }
});

// Save a new pattern
ipcMain.handle("terminal:pattern-save", async (_event, pattern: {
  name,
  category,
  description,
  prompt,
}): Promise<any> => {
  try {
    const contextPath = path.join(getProjectPath(), ".openclaw", "business-context.json");

    // Load existing context or create new
    let context = { customers: [], projects: [], meetings: [], decisions: [], patterns: [] };
    if (fs.existsSync(contextPath)) {
      context = JSON.parse(fs.readFileSync(contextPath, "utf-8"));
    }

    // Create new pattern
    const newPattern = {
      id: generatePatternId(),
      name,
      category,
      description,
      prompt,
      effectiveness: 0.5, // Start with neutral effectiveness
      usageCount: 0,
      sourceFile: "terminal",
    };

    context.patterns.push(newPattern);

    // Save
    const dir = path.dirname(contextPath);
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(contextPath, JSON.stringify(context, null, 2));

    return {
      success: true,
      id: newPattern.id,
    };
  } catch (err) {
    console.error("[Pattern] Failed to save pattern:", err);
    return { success: false, error: String(err) };
  }
});

// Apply a pattern to a task description
ipcMain.handle("terminal:pattern-apply", async (_event, patternId: string, taskDescription: string): Promise<any> => {
  try {
    const contextPath = path.join(getProjectPath(), ".openclaw", "business-context.json");

    if (!fs.existsSync(contextPath)) {
      return { success: false, error: "No patterns found" };
    }

    const context = JSON.parse(fs.readFileSync(contextPath, "utf-8"));
    const patterns = context.patterns || [];

    // Find pattern by ID or name
    const pattern = patterns.find((p: any) =>
      p.id === patternId || p.name.toLowerCase() === patternId.toLowerCase()
    );

    if (!pattern) {
      return { success: false, error: `Pattern "${patternId}" not found` };
    }

    // Build enhanced prompt
    const enhancedPrompt = `Apply the following pattern to your task:

## Pattern: ${pattern.name}

${pattern.description}

${pattern.prompt}

---

Task: ${taskDescription}`;

    // Increment usage count
    pattern.usageCount = (pattern.usageCount || 0) + 1;
    fs.writeFileSync(contextPath, JSON.stringify(context, null, 2));

    return {
      success: true,
      enhancedPrompt,
      patternId: pattern.id,
    };
  } catch (err) {
    console.error("[Pattern] Failed to apply pattern:", err);
    return { success: false, error: String(err) };
  }
});

// Rate a pattern's effectiveness
ipcMain.handle("terminal:pattern-rate", async (_event, patternId: string, success: boolean): Promise<any> => {
  try {
    const contextPath = path.join(getProjectPath(), ".openclaw", "business-context.json");

    if (!fs.existsSync(contextPath)) {
      return { success: false, error: "No patterns found" };
    }

    const context = JSON.parse(fs.readFileSync(contextPath, utf-8));
    const patterns = context.patterns || [];

    // Find pattern
    const pattern = patterns.find((p: any) => p.id === patternId);

    if (!pattern) {
      return { success: false, error: `Pattern "${patternId}" not found` };
    }

    // Update effectiveness using exponential moving average
    const alpha = 0.2;
    const target = success ? 1 : 0;
    const current = pattern.effectiveness || 0.5;
    pattern.effectiveness = alpha * target + (1 - alpha) * current;

    // Save
    fs.writeFileSync(contextPath, JSON.stringify(context, null, 2));

    console.log(`[Pattern] Rated ${patternId} as ${success ? "success" : "failure"}: ${pattern.effectiveness.toFixed(2)}`);

    return { success: true };
  } catch (err) {
    console.error("[Pattern] Failed to rate pattern:", err);
    return { success: false, error: String(err) };
  }
});

// Recommend patterns for a task description
ipcMain.handle("terminal:pattern-recommend", async (_event, description: string, limit = 3): Promise<any> => {
  try {
    // Import at runtime to avoid circular dependency
    const { recommendPatterns } = await import("../../../src/orchestration/index.js");

    const recommendations = await recommendPatterns(description, limit);

    return {
      success: true,
      patterns: recommendations.map((r) => ({
        id: r.item.id,
        name: r.item.name,
        category: r.item.category,
        description: r.item.description,
        effectiveness: r.item.effectiveness,
        usageCount: r.item.usageCount,
        score: r.score,
        reason: r.matchReason,
      })),
    };
  } catch (err) {
    console.error("[Pattern] Failed to recommend patterns:", err);
    return { success: false, error: String(err) };
  }
});

// Run code review on current git changes
ipcMain.handle("terminal:review-diff", async (_event, options: { branch?: string; maxFiles?: number } = {}): Promise<any> => {
  try {
    const { runCodeReview, formatReviewTerminal } = await import("../../../src/orchestration/index.js");
    const projectPath = getProjectPath();

    console.log("[Review] Starting code review for", projectPath);

    const review = await runCodeReview(projectPath, {
      branch: options.branch,
      maxFiles: options.maxFiles,
    });

    const formatted = formatReviewTerminal(review);

    return {
      success: true,
      review: {
        ...review,
        formatted,
      },
    };
  } catch (err) {
    console.error("[Review] Failed:", err);
    return { success: false, error: String(err) };
  }
});

// PR Commands
ipcMain.handle("terminal:pr-create", async (_event, options: {
  title: string;
  description?: string;
  baseBranch?: string;
  draft?: boolean;
}): Promise<any> => {
  try {
    const { getGitStatus, commitChanges, getCurrentBranch, createPR } = await import("../../../src/orchestration/index.js");
    const projectPath = getProjectPath();

    // Check status
    const status = await getGitStatus(projectPath);
    if (!status.hasChanges) {
      return { success: false, error: "No changes to commit. Make some changes first." };
    }

    // Commit changes
    const commitMsg = options.description || options.title;
    const commitResult = await commitChanges(projectPath, commitMsg);
    if (!commitResult.success) {
      return { success: false, error: `Commit failed: ${commitResult.error}` };
    }

    // Push to remote
    const currentBranch = await getCurrentBranch(projectPath);
    if (!currentBranch) {
      return { success: false, error: "Could not determine current branch" };
    }

    const { runCommandWithTimeout, resolveCommand } = await import("../../process/exec.js");
    const pushResult = await runCommandWithTimeout(
      [resolveCommand("git"), "-C", projectPath, "push", "-u", "origin", currentBranch],
      60_000,
    );

    if (pushResult.code !== 0) {
      return { success: false, error: `Push failed: ${pushResult.stderr}` };
    }

    // Create PR
    const prResult = await createPR(projectPath, {
      title: options.title,
      description: options.description || `## Summary\n\n${options.title}\n\n---\n\n*Created via OpenClaw*`,
      baseBranch: options.baseBranch,
      draft: options.draft,
    });

    return prResult;
  } catch (err) {
    console.error("[PR] Failed:", err);
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("terminal:pr-list", async (): Promise<any> => {
  try {
    const { listOpenPRs } = await import("../../../src/orchestration/index.js");
    const projectPath = getProjectPath();

    const prs = await listOpenPRs(projectPath);
    return { success: true, prs };
  } catch (err) {
    console.error("[PR] Failed:", err);
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("terminal:pr-view", async (_event, prNumber: number): Promise<any> => {
  try {
    const { getPRDetails } = await import("../../../src/orchestration/index.js");
    const projectPath = getProjectPath();

    const pr = await getPRDetails(projectPath, prNumber);
    return { success: true, pr };
  } catch (err) {
    console.error("[PR] Failed:", err);
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("terminal:git-status", async (): Promise<any> => {
  try {
    const { getGitStatus, getCurrentBranch } = await import("../../../src/orchestration/index.js");
    const projectPath = getProjectPath();

    const status = await getGitStatus(projectPath);
    const branch = await getCurrentBranch(projectPath);

    return { success: true, ...status, branch };
  } catch (err) {
    console.error("[Git] Failed:", err);
    return { success: false, error: String(err) };
  }
});

// Workflow Commands
ipcMain.handle("terminal:workflow-list", async (): Promise<any> => {
  try {
    const { listWorkflows } = await import("../../../src/orchestration/index.js");
    const workflows = await listWorkflows();
    return { success: true, workflows };
  } catch (err) {
    console.error("[Workflow] Failed:", err);
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("terminal:workflow-create", async (_event, workflow: {
  name: string;
  description?: string;
  steps: Array<{ id: string; type: string; command: string; description?: string }>;
  tags?: string[];
}): Promise<any> => {
  try {
    const { createWorkflow } = await import("../../../src/orchestration/index.js");
    const result = await createWorkflow(workflow);
    return { success: true, id: result.id };
  } catch (err) {
    console.error("[Workflow] Failed:", err);
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("terminal:workflow-run", async (_event, name: string): Promise<any> => {
  try {
    const { dryRunWorkflow, getWorkflowByName } = await import("../../../src/orchestration/index.js");
    const workflow = await getWorkflowByName(name);

    if (!workflow) {
      return { success: false, error: "Workflow not found" };
    }

    const result = await dryRunWorkflow(workflow.id);
    await import("../../../src/orchestration/index.js").then((m) => m.incrementWorkflowRunCount(workflow.id));

    return { success: true, steps: result.steps };
  } catch (err) {
    console.error("[Workflow] Failed:", err);
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("terminal:workflow-show", async (_event, name: string): Promise<any> => {
  try {
    const { getWorkflowByName } = await import("../../../src/orchestration/index.js");
    const workflow = await getWorkflowByName(name);

    if (workflow) {
      return { success: true, workflow };
    } else {
      return { success: false, error: "Workflow not found" };
    }
  } catch (err) {
    console.error("[Workflow] Failed:", err);
    return { success: false, error: String(err) };
  }
});

ipcMain.handle("terminal:workflow-delete", async (_event, name: string): Promise<any> => {
  try {
    const { getWorkflowByName, deleteWorkflow } = await import("../../../src/orchestration/index.js");
    const workflow = await getWorkflowByName(name);

    if (!workflow) {
      return { success: false, error: "Workflow not found" };
    }

    await deleteWorkflow(workflow.id);
    return { success: true };
  } catch (err) {
    console.error("[Workflow] Failed:", err);
    return { success: false, error: String(err) };
  }
});

// Keep old signature for backward compatibility, but warn
export function setupTerminalIpcLegacy(): void {
  console.warn("[Terminal] setupTerminalIpc called without gatewayManager parameter");
}
