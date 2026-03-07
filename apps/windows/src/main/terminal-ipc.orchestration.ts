import { exec } from "child_process";
import * as fs from "fs";
import { ipcMain } from "electron";
import * as path from "path";
import { promisify } from "util";

type ShellResult = {
  stdout: string;
  stderr: string;
};

type GetAgentManager = (projectPath?: string) => any;
type ImportOrchestrationModule = () => Promise<Record<string, (...args: any[]) => any>>;

type RelevantContext = {
  customers: Array<{ name: string; score: number }>;
  projects: Array<{ name: string; score: number }>;
  decisions: Array<{ title: string; score: number }>;
  meetings: Array<{ title: string; score: number }>;
  patterns: Array<{ name: string; score: number }>;
};

type AgentTaskStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "exited"
  | "killed";

type AgentTask = {
  id: string;
  description: string;
  status: AgentTaskStatus;
  agent: string;
  startedAt: number;
  completedAt?: number;
  tmuxSession?: string;
  branch?: string;
  exitCode?: number | null;
  failureReason?: string;
};

type WorkflowStep = {
  id: string;
  type: string;
  command: string;
  description?: string;
  timeout?: number;
};

type WorkflowRecord = {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  runCount: number;
  createdAt: number;
};

type WorkflowRunStepResult = {
  step: { id: string; type: string; command: string; description?: string };
  status: "success" | "failed";
  output?: string;
  error?: string;
  taskId?: string;
  durationMs: number;
};

const execAsync = promisify(exec);

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

async function execShell(command: string, cwd: string): Promise<ShellResult> {
  try {
    const isWindows = process.platform === "win32";
    const options = {
      cwd,
      env: process.env,
      windowsHide: true,
      timeout: 30000,
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

async function getGitRepo(cwd: string): Promise<string | null> {
  try {
    const result = await execShell("git rev-parse --show-toplevel", cwd);
    if (result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch {
    // Not in a git repo.
  }
  return null;
}

async function executeWorkflowCommandStep(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}> {
  const isWindows = process.platform === "win32";
  return await new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        env: process.env,
        windowsHide: true,
        timeout: timeoutMs,
        ...(isWindows ? { shell: "cmd.exe" } : {}),
      },
      (error, stdout, stderr) => {
        if (error) {
          const maybeCode = (error as { code?: unknown }).code;
          resolve({
            ok: false,
            code: typeof maybeCode === "number" ? maybeCode : null,
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            error: error.message,
          });
          return;
        }

        resolve({
          ok: true,
          code: 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      },
    );
  });
}

export function registerTerminalOrchestrationIpcHandlers(options: {
  getAgentManager: GetAgentManager;
  getProjectPath: () => string;
  importOrchestrationModule: ImportOrchestrationModule;
}): void {
  const { getAgentManager, getProjectPath, importOrchestrationModule } = options;

  ipcMain.handle(
    "terminal:orchestral-spawn",
    async (
      event,
      opts: {
        description: string;
        agent?: string;
        branch?: string;
        useContext?: boolean;
        relevantContext?: RelevantContext;
      },
    ): Promise<{ success: boolean; task?: any; error?: string }> => {
      try {
        console.log("[Orchestral] spawn called with:", opts);

        if (opts.useContext && opts.relevantContext) {
          console.log("[Orchestral] Context injection enabled:", {
            customers: opts.relevantContext.customers?.length || 0,
            projects: opts.relevantContext.projects?.length || 0,
            decisions: opts.relevantContext.decisions?.length || 0,
          });
        }

        const projectPath = getProjectPath();
        const repoPath = await getGitRepo(projectPath);
        console.log("[Orchestral] repoPath:", repoPath);

        const taskId = `task-${Date.now()}`;
        const agent = opts.agent || "claude";
        const branchName = opts.branch || `orchestral/${taskId.slice(0, 16)}`;

        console.log("[Orchestral] taskId:", taskId, "branch:", branchName);

        let worktreePath: string | undefined;
        let worktreeCreated = false;

        if (repoPath) {
          worktreePath = path.join(repoPath, ".openclaw", "worktrees", taskId);

          event.sender.send("terminal:shell-output", {
            runId: taskId,
            type: "stdout",
            data: `Creating worktree: ${branchName}...\n`,
          });

          const worktreeResult = await execShell(
            `git -C "${repoPath}" worktree add -b ${branchName} "${worktreePath}" 2>&1`,
            projectPath,
          );

          const worktreeDirExists = fs.existsSync(worktreePath);
          const hasGitDir = fs.existsSync(path.join(worktreePath, ".git"));

          if (hasGitDir || worktreeDirExists) {
            worktreeCreated = true;
            event.sender.send("terminal:shell-output", {
              runId: taskId,
              type: "stdout",
              data: "✓ Worktree created\n",
            });
          } else {
            event.sender.send("terminal:shell-output", {
              runId: taskId,
              type: "stderr",
              data: `Worktree creation issue: ${worktreeResult.stderr || worktreeResult.stdout}\n`,
            });
          }
        }

        const message = `✓ Task ${taskId} created`;
        const details: string[] = [];

        if (worktreeCreated && worktreePath) {
          details.push(`Worktree: ${worktreePath}`);
          details.push(`Branch: ${branchName}`);
        } else if (!repoPath) {
          details.push(`Working in: ${projectPath}`);
        }

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

        const agentMgr = getAgentManager(projectPath);
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
          details.push(`PID: ${agentResult.pid}`);
        } else {
          details.push(`Agent start failed: ${agentResult.error}`);
          if (agentResult.exitCode !== null && agentResult.exitCode !== undefined) {
            details.push(`Exit code: ${agentResult.exitCode}`);
          }
          if (agentResult.lastOutput) {
            const preview = agentResult.lastOutput.replace(/\r?\n/gu, " ").slice(0, 240);
            details.push(`Last output: ${preview}`);
          }
        }

        event.sender.send("terminal:shell-output", {
          runId: taskId,
          type: "exit",
          data: "",
          exitCode: 0,
        });

        return {
          success: true,
          task: {
            id: taskId,
            agent,
            description: opts.description,
            repo: repoPath || projectPath,
            worktree: worktreePath,
            branch: branchName,
            startedAt: Date.now(),
            status: agentResult.success ? "running" : "failed",
            pid: agentResult.pid,
            exitCode: agentResult.exitCode,
            failureReason: agentResult.error,
            message,
            details: details.join("\n"),
            worktreeCreated,
            mode: "full",
          },
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    "terminal:orchestral-agents",
    async (event, action: string, args: string[]): Promise<any> => {
      try {
        const agentMgr = getAgentManager(getProjectPath());

        switch (action) {
          case "list": {
            const agentProcesses = agentMgr.listAgents();
            return { success: true, tasks: agentProcesses };
          }

          case "kill": {
            return await agentMgr.killAgent(args[0]);
          }

          case "attach": {
            const taskId = args[0];
            const agentProcess = agentMgr.getAgent(taskId);
            if (!agentProcess) {
              return { success: false, error: "Task not found" };
            }

            if (!agentProcess.worktree) {
              return {
                success: true,
                message: `Task ${taskId} (no worktree - work in current directory)`,
                taskId,
                description: agentProcess.description,
                attachCommand: "",
              };
            }
            const attachCommand = `cd "${agentProcess.worktree}"`;
            return {
              success: true,
              message: "Navigate to the worktree directory:",
              worktree: agentProcess.worktree,
              command: attachCommand,
              attachCommand,
              taskId,
            };
          }

          case "redirect": {
            const taskId = args[0];
            const message = args.slice(1).join(" ");
            const agentProcess = agentMgr.getAgent(taskId);
            if (!agentProcess) {
              return { success: false, error: "Task not found" };
            }

            if (agentMgr.sendMessage(taskId, message)) {
              return { success: true, message: `Message sent to ${taskId}` };
            }
            return { success: false, error: "Could not send message (process not running)" };
          }

          case "output": {
            const taskId = args[0];
            const linesArg = args[1];
            const lines = linesArg ? parseInt(linesArg, 10) : 50;
            const agentProcess = agentMgr.getAgent(taskId);
            if (!agentProcess) {
              return { success: false, error: "Task not found" };
            }

            const output = agentMgr.getOutput(taskId, lines);
            return {
              success: true,
              output,
              hasOutput: output.length > 0,
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

  ipcMain.on("terminal:subscribe-agent-output", (event, taskId: string) => {
    const agentMgr = getAgentManager(getProjectPath());
    const agentProcess = agentMgr.getAgent(taskId);

    if (agentProcess) {
      agentProcess.webContents = event.sender;
    }
  });

  ipcMain.handle("terminal:agent-start", async (event, opts: {
    taskId: string;
    description: string;
    worktree?: string;
    agent?: string;
    branch?: string;
    useContext?: boolean;
    relevantContext?: RelevantContext;
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

    return { success: false, error: "Task not found" };
  });

  ipcMain.handle(
    "terminal:orchestral-tasks",
    async (_event, filters: Record<string, string>, action?: string): Promise<any> => {
      try {
        const agentMgr = getAgentManager(getProjectPath());

        if (action === "complete") {
          const taskId = typeof filters.taskId === "string" ? filters.taskId.trim() : "";
          if (!taskId) {
            return { success: false, error: "taskId is required" };
          }

          const success = String(filters.success || "").toLowerCase() === "true";
          const reason = typeof filters.reason === "string" ? filters.reason : undefined;
          const updateResult = agentMgr.completeTask(taskId, success, reason);
          if (!updateResult.success) {
            return { success: false, error: updateResult.error || "Failed to update task" };
          }
          return {
            success: true,
            task: updateResult.task,
            message: `Task ${taskId} marked as ${success ? "completed" : "failed"}`,
          };
        }

        if (action === "purge" || action === "clear") {
          const deletedCount = agentMgr.clearCompletedTasks();
          return {
            success: true,
            message: `Deleted ${deletedCount} completed/failed task(s)`,
          };
        }

        if (action === "purge-all" || action === "clear-all") {
          const result = agentMgr.clearAllTasks();
          return {
            success: true,
            message: `Cleared ALL tasks (${result.count} total)${result.worktreesCleaned > 0 ? ` and cleaned ${result.worktreesCleaned} worktree(s)` : ""}`,
          };
        }

        const allTasks = agentMgr.listAgents() as AgentTask[];
        let tasks = allTasks.filter((task) => task.status !== "killed");

        if (filters.status) {
          tasks = tasks.filter((task) => task.status === filters.status);
        }
        if (filters.agent) {
          tasks = tasks.filter((task) => task.agent === filters.agent);
        }
        if (filters.limit) {
          tasks = tasks.slice(0, Number.parseInt(filters.limit, 10));
        }

        tasks.sort((a, b) => b.startedAt - a.startedAt);

        const summary =
          `Total: ${allTasks.length} | running: ${allTasks.filter((task) => task.status === "running").length}` +
          ` | starting: ${allTasks.filter((task) => task.status === "starting").length}` +
          ` | completed: ${allTasks.filter((task) => task.status === "completed").length}` +
          ` | failed: ${allTasks.filter((task) => task.status === "failed").length}` +
          ` | exited: ${allTasks.filter((task) => task.status === "exited").length}` +
          ` | killed: ${allTasks.filter((task) => task.status === "killed").length}`;

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

  ipcMain.handle("terminal:workflow-list", async (): Promise<any> => {
    try {
      const { listWorkflows } = await importOrchestrationModule();
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
      const { createWorkflow } = await importOrchestrationModule();
      const result = await createWorkflow(workflow);
      return { success: true, id: result.id };
    } catch (err) {
      console.error("[Workflow] Failed:", err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("terminal:workflow-run", async (event, name: string): Promise<any> => {
    try {
      const { getWorkflowByName, incrementWorkflowRunCount } = await importOrchestrationModule();
      const workflow = (await getWorkflowByName(name)) as WorkflowRecord | null;

      if (!workflow) {
        return { success: false, error: "Workflow not found" };
      }

      const projectPath = getProjectPath();
      const stepResults: WorkflowRunStepResult[] = [];
      let workflowSucceeded = true;

      for (const step of workflow.steps) {
        const startedAt = Date.now();
        const baseResult: WorkflowRunStepResult = {
          step: {
            id: step.id,
            type: step.type,
            command: step.command,
            description: step.description,
          },
          status: "success",
          durationMs: 0,
        };

        try {
          if (step.type === "command") {
            const commandResult = await executeWorkflowCommandStep(
              step.command,
              projectPath,
              Math.max(1, Math.floor(step.timeout ?? 30_000)),
            );
            if (!commandResult.ok) {
              baseResult.status = "failed";
              baseResult.error =
                commandResult.error ||
                commandResult.stderr.trim() ||
                `Command failed with code ${String(commandResult.code)}`;
            } else if (commandResult.stderr.trim()) {
              baseResult.output = trimOutputTail(commandResult.stderr);
            } else {
              baseResult.output = trimOutputTail(commandResult.stdout);
            }
          } else if (step.type === "spawn") {
            const taskId = `wf-${Date.now()}-${step.id}`;
            const agentMgr = getAgentManager(projectPath);
            const spawnResult = await agentMgr.startAgent({
              taskId,
              description: step.command,
              webContents: event.sender,
            });
            if (!spawnResult?.success) {
              baseResult.status = "failed";
              baseResult.error = spawnResult?.error || "Failed to spawn agent task";
            } else {
              baseResult.taskId = taskId;
              baseResult.output = `Spawned task ${taskId}`;
            }
          } else if (step.type === "delay") {
            const parsedDelay = Number.parseInt(step.command, 10);
            const delayMs =
              Number.isFinite(parsedDelay) && parsedDelay > 0
                ? parsedDelay
                : Math.max(1, Math.floor(step.timeout ?? 1000));
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            baseResult.output = `Delayed ${delayMs}ms`;
          } else if (step.type === "confirm") {
            baseResult.status = "failed";
            baseResult.error = "confirm step is not yet supported in terminal workflow-run";
          } else {
            baseResult.status = "failed";
            baseResult.error = `Unsupported workflow step type: ${step.type}`;
          }
        } catch (err) {
          baseResult.status = "failed";
          baseResult.error = err instanceof Error ? err.message : String(err);
        }

        baseResult.durationMs = Date.now() - startedAt;
        stepResults.push(baseResult);

        if (baseResult.status === "failed") {
          workflowSucceeded = false;
          break;
        }
      }

      await incrementWorkflowRunCount(workflow.id);

      const completedSteps = stepResults.filter((step) => step.status === "success").length;
      return {
        success: workflowSucceeded,
        result: stepResults,
        steps: stepResults,
        completedSteps,
        totalSteps: workflow.steps.length,
        error:
          workflowSucceeded || stepResults.length === 0
            ? undefined
            : `Workflow stopped at ${stepResults[stepResults.length - 1]?.step.id}`,
      };
    } catch (err) {
      console.error("[Workflow] Failed:", err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("terminal:workflow-show", async (_event, name: string): Promise<any> => {
    try {
      const { getWorkflowByName } = await importOrchestrationModule();
      const workflow = await getWorkflowByName(name);

      if (workflow) {
        return { success: true, workflow };
      }
      return { success: false, error: "Workflow not found" };
    } catch (err) {
      console.error("[Workflow] Failed:", err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("terminal:workflow-delete", async (_event, name: string): Promise<any> => {
    try {
      const { getWorkflowByName, deleteWorkflow } = await importOrchestrationModule();
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
}
