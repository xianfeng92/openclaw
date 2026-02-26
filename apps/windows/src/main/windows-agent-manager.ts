/**
 * Windows Agent Process Manager
 * Manages AI agent processes using node-pty for real-time output
 */

import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import type { WebContents } from "electron";
import { app } from "electron";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(require("child_process").exec);

type AgentProcessStatus = "starting" | "running" | "exited" | "killed";

export interface WindowsAgentProcess {
  id: string;
  pid: number;
  description: string;
  worktree?: string;
  startedAt: number;
  status: AgentProcessStatus;
  agent?: string;
  branch?: string;
  // Store output lines (circular buffer)
  outputBuffer: string[];
  maxBufferLines: number;
  // For Windows, we track the shell process
  shellProcess?: ReturnType<typeof spawn>;
  // For real-time output via IPC
  webContents?: WebContents;
  exitCode?: number | null;
  completedAt?: number;
  failureReason?: string;
  lastOutput?: string;
}

interface AgentStartOptions {
  taskId: string;
  description: string;
  worktree?: string;
  agent?: string;
  branch?: string;
  webContents: WebContents;
  useContext?: boolean;
  relevantContext?: {
    customers: Array<{ name: string; score: number }>;
    projects: Array<{ name: string; score: number }>;
    decisions: Array<{ title: string; score: number }>;
    meetings: Array<{ title: string; score: number }>;
    patterns: Array<{ name: string; score: number }>;
  };
}

interface AgentStartResult {
  success: boolean;
  pid?: number;
  error?: string;
  command?: string;
  exitCode?: number | null;
  lastOutput?: string;
}

type AgentCliLaunch = {
  command: string;
  args: string[];
  commandForDisplay: string;
  cwd: string;
  usesWorkspaceFlag: boolean;
  note?: string;
};

/**
 * Windows Agent Process Manager
 * Handles spawning, monitoring, and terminating agent processes
 */
export class WindowsAgentProcessManager {
  private processes = new Map<string, WindowsAgentProcess>();
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    // Clean up zombie processes on startup
    this.cleanupZombies();
  }

  /**
   * Start an agent process
   */
  async startAgent(opts: AgentStartOptions): Promise<AgentStartResult> {
    const { taskId, description, worktree, agent, branch, webContents, useContext, relevantContext } = opts;

    // Check if process already exists
    if (this.processes.has(taskId)) {
      return { success: false, error: "Task already exists" };
    }

    // Determine working directory
    const workingDir = worktree || this.projectPath;

    // Verify working directory exists
    if (!fs.existsSync(workingDir)) {
      return { success: false, error: `Working directory does not exist: ${workingDir}` };
    }

    // Create process entry
    const agentProcess: WindowsAgentProcess = {
      id: taskId,
      pid: 0,
      description,
      worktree,
      startedAt: Date.now(),
      status: "starting",
      agent,
      branch,
      outputBuffer: [],
      maxBufferLines: 1000,
      webContents,
    };

    this.processes.set(taskId, agentProcess);

    try {
      const launchContext = this.resolveLaunchContext(workingDir);
      const launch = this.buildAgentLaunch({
        taskId,
        description,
        workingDir,
        runnerCwd: launchContext.runnerCwd,
        includeWorkspaceFlag: launchContext.includeWorkspaceFlag,
        note: launchContext.note,
        agent,
        useContext,
        relevantContext,
      });

      // Send initial output
      this.sendOutput(taskId, `[agent] Starting agent process...\n`);
      this.sendOutput(taskId, `[agent] Working directory: ${workingDir}\n`);
      if (launch.cwd !== workingDir) {
        this.sendOutput(taskId, `[agent] Runner cwd: ${launch.cwd}\n`);
      }
      if (launch.note) {
        this.sendOutput(taskId, `[agent] ${launch.note}\n`);
      }
      this.sendOutput(taskId, `[agent] Command: ${launch.commandForDisplay}\n`);
      this.sendOutput(taskId, "\n");

      const proc = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: {
          ...process.env,
          // Ensure openclaw can find its config
          OPENCLAW_PROFILE: "desktop",
        },
        shell: false,
        windowsHide: true, // Hide the console window on Windows
        stdio: ["ignore", "pipe", "pipe"], // Pipe stdout and stderr
      });

      agentProcess.shellProcess = proc;
      agentProcess.pid = proc.pid ?? 0;
      agentProcess.status = "running";

      // Set up output handlers
      proc.stdout?.on("data", (data: Buffer) => {
        const output = data.toString();
        this.addToBuffer(taskId, output);
        this.sendOutput(taskId, output);
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const output = data.toString();
        this.addToBuffer(taskId, output);
        this.sendOutput(taskId, `[stderr] ${output}`);
      });

      // Handle exit
      proc.on("close", (code: number | null) => {
        agentProcess.status = "exited";
        agentProcess.exitCode = code;
        agentProcess.completedAt = Date.now();
        agentProcess.lastOutput = this.getOutputTail(agentProcess.outputBuffer, 80);
        const parsedFailure = this.extractFailureReason(agentProcess.lastOutput);
        if (parsedFailure) {
          agentProcess.failureReason = parsedFailure;
        } else if (code !== null && code !== 0) {
          agentProcess.failureReason = `Agent exited with code ${code}`;
        } else {
          agentProcess.failureReason = undefined;
        }
        this.sendOutput(taskId, `\n[agent] Process exited with code ${code}\n`);
        this.saveTasks();
      });

      // Handle errors
      proc.on("error", (err: Error) => {
        agentProcess.status = "exited";
        agentProcess.completedAt = Date.now();
        agentProcess.failureReason = err.message;
        this.sendOutput(taskId, `[agent] Error: ${err.message}\n`);
        this.saveTasks();
      });

      // Save tasks
      this.saveTasks();

      // Detect immediate launch failures so callers don't report a false "running" state.
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (proc.exitCode !== null && proc.exitCode !== undefined) {
        const lastOutput = this.getOutputTail(agentProcess.outputBuffer, 80);
        const parsedFailure = this.extractFailureReason(lastOutput);
        const hasFailure = proc.exitCode !== 0 || !!parsedFailure;
        if (!hasFailure) {
          return {
            success: true,
            pid: proc.pid ?? 0,
            command: launch.commandForDisplay,
          };
        }

        agentProcess.status = "exited";
        agentProcess.exitCode = proc.exitCode;
        agentProcess.completedAt = Date.now();
        agentProcess.lastOutput = lastOutput;
        agentProcess.failureReason =
          parsedFailure ?? `Agent exited immediately (code ${proc.exitCode})`;
        this.saveTasks();
        return {
          success: false,
          error: agentProcess.failureReason,
          command: launch.commandForDisplay,
          exitCode: proc.exitCode,
          lastOutput,
        };
      }

      return {
        success: true,
        pid: proc.pid ?? 0,
        command: launch.commandForDisplay,
      };
    } catch (err) {
      agentProcess.status = "exited";
      this.processes.delete(taskId);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Kill an agent process
   */
  async killAgent(taskId: string): Promise<{ success: boolean; error?: string }> {
    const process = this.processes.get(taskId);

    if (!process) {
      return { success: false, error: "Task not found" };
    }

    try {
      if (process.shellProcess) {
        if (os.platform() === "win32") {
          // On Windows, use taskkill to force kill the process tree
          await execAsync(`taskkill /F /T /PID ${process.pid}`);
        } else {
          process.shellProcess.kill("SIGTERM");
        }
      }

      process.status = "killed";
      process.completedAt = Date.now();
      process.failureReason = "Task was terminated by user";
      this.sendOutput(taskId, `[agent] Process terminated\n`);

      // Clean up worktree if it exists
      if (process.worktree && fs.existsSync(process.worktree)) {
        try {
          // Remove worktree using git
          await execAsync(`git -C "${this.projectPath}" worktree remove --force "${process.worktree}"`, {
            timeout: 5000,
          });
        } catch {
          // Ignore worktree cleanup errors
        }
      }

      // Remove from active processes (keep in saved tasks for history)
      this.saveTasks();

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Get output from an agent process
   */
  getOutput(taskId: string, lines = 50): string {
    const process = this.processes.get(taskId);

    if (!process) {
      return "Task not found";
    }

    const buffer = process.outputBuffer;
    const start = Math.max(0, buffer.length - lines);
    return buffer.slice(start).join("");
  }

  /**
   * List all agent processes
   */
  listAgents(): Array<{
    id: string;
    pid: number;
    description: string;
    status: AgentProcessStatus;
    startedAt: number;
    worktree?: string;
    agent?: string;
    branch?: string;
  }> {
    return Array.from(this.processes.values()).map((p) => ({
      id: p.id,
      pid: p.pid,
      description: p.description,
      status: p.status,
      startedAt: p.startedAt,
      worktree: p.worktree,
      agent: p.agent,
      branch: p.branch,
    }));
  }

  /**
   * Get a specific agent process
   */
  getAgent(taskId: string): WindowsAgentProcess | undefined {
    return this.processes.get(taskId);
  }

  /**
   * Send a message to an agent process
   */
  sendMessage(taskId: string, message: string): boolean {
    const process = this.processes.get(taskId);

    if (!process || !process.shellProcess || process.status !== "running") {
      return false;
    }

    try {
      process.shellProcess.stdin?.write(`${message}\n`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Add output to the circular buffer
   */
  private addToBuffer(taskId: string, data: string): void {
    const process = this.processes.get(taskId);
    if (!process) return;

    // Split by lines and add to buffer
    const lines = data.split("\n");
    for (const line of lines) {
      process.outputBuffer.push(line + "\n");
      // Trim buffer if it exceeds max size
      if (process.outputBuffer.length > process.maxBufferLines) {
        process.outputBuffer.shift();
      }
    }
  }

  /**
   * Send output to the frontend via IPC
   */
  private sendOutput(taskId: string, data: string): void {
    const process = this.processes.get(taskId);
    if (!process?.webContents || process.webContents.isDestroyed()) {
      return;
    }

    try {
      process.webContents.send("terminal:agent-output", {
        taskId,
        type: "stdout",
        data,
      });
    } catch (err) {
      console.error("[AgentManager] Failed to send output:", err);
    }
  }

  /**
   * Build the agent command based on configuration
   */
  private buildAgentLaunch(
    options: {
      taskId: string;
      description: string;
      workingDir: string;
      runnerCwd: string;
      includeWorkspaceFlag: boolean;
      note?: string;
      agent?: string;
      useContext?: boolean;
      relevantContext?: {
        customers: Array<{ name: string; score: number }>;
        projects: Array<{ name: string; score: number }>;
        decisions: Array<{ title: string; score: number }>;
        meetings: Array<{ title: string; score: number }>;
        patterns: Array<{ name: string; score: number }>;
      };
    },
  ): AgentCliLaunch {
    // NOTE: `openclaw agent` requires both a target selector and `--message`.
    // We force local mode and pin workspace to the spawned worktree so execution
    // happens immediately in the isolated task environment.
    // taskId is used as session-id so each spawn gets an isolated session.
    const agentArgs = ["agent", "--local"];
    if (options.includeWorkspaceFlag) {
      agentArgs.push("--workspace", options.workingDir);
    }
    agentArgs.push("--session-id", options.taskId, "--message", options.description);

    // Keep the orchestral agent label as metadata only. The CLI `--agent` flag expects
    // a configured agent id, while orchestral labels are provider hints (claude/codex/gemini).
    void options.agent;
    void options.useContext;
    void options.relevantContext;

    if (app.isPackaged) {
      const args = ["-y", "openclaw", "--profile", "desktop", ...agentArgs];
      return {
        command: "npx",
        args,
        commandForDisplay: this.formatCommandForDisplay("npx", args),
        cwd: options.runnerCwd,
        usesWorkspaceFlag: options.includeWorkspaceFlag,
        note: options.note,
      };
    }

    const repoRoot = path.resolve(__dirname, "../../../..");
    const scriptPath = path.join(repoRoot, "scripts", "run-node.mjs");
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`OpenClaw runner not found at: ${scriptPath}`);
    }

    const args = [scriptPath, "--profile", "desktop", ...agentArgs];
    return {
      command: "node",
      args,
      commandForDisplay: this.formatCommandForDisplay("node", args),
      cwd: options.runnerCwd,
      usesWorkspaceFlag: options.includeWorkspaceFlag,
      note: options.note,
    };
  }

  private resolveLaunchContext(workingDir: string): {
    runnerCwd: string;
    includeWorkspaceFlag: boolean;
    note?: string;
  } {
    const taskSupportsWorkspace = this.supportsAgentWorkspaceFlag(workingDir);
    if (taskSupportsWorkspace) {
      return { runnerCwd: workingDir, includeWorkspaceFlag: true };
    }

    const projectSupportsWorkspace = this.supportsAgentWorkspaceFlag(this.projectPath);
    if (projectSupportsWorkspace) {
      return {
        runnerCwd: this.projectPath,
        includeWorkspaceFlag: true,
        note:
          "Task worktree CLI does not support --workspace; using project checkout CLI with workspace override.",
      };
    }

    return {
      runnerCwd: workingDir,
      includeWorkspaceFlag: false,
      note:
        "Current CLI does not support --workspace; falling back to default workspace resolution.",
    };
  }

  private supportsAgentWorkspaceFlag(repoRoot: string): boolean {
    const registerPath = path.join(repoRoot, "src", "cli", "program", "register.agent.ts");
    try {
      const source = fs.readFileSync(registerPath, "utf-8");
      const agentCommandBlock = source.match(/\.command\("agent"\)([\s\S]*?)\.action\(/u)?.[1] ?? "";
      return /--workspace <dir>/u.test(agentCommandBlock);
    } catch {
      return false;
    }
  }

  private formatCommandForDisplay(command: string, args: string[]): string {
    const quoted = args.map((arg) => {
      if (!/[\s"]/u.test(arg)) {
        return arg;
      }
      return `"${arg.replace(/"/g, '\\"')}"`;
    });
    return [command, ...quoted].join(" ");
  }

  private getOutputTail(buffer: string[], lines: number): string {
    const tailStart = Math.max(0, buffer.length - lines);
    const tail = buffer.slice(tailStart).join("").trim();
    if (!tail) {
      return "";
    }
    const maxChars = 4000;
    return tail.length > maxChars ? tail.slice(tail.length - maxChars) : tail;
  }

  private extractFailureReason(output: string): string | undefined {
    if (!output) {
      return undefined;
    }

    const lines = output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .reverse();

    for (const line of lines) {
      const jsonCandidate = line.startsWith("[stderr] ") ? line.slice(9).trim() : line;
      if (!jsonCandidate.startsWith("{") || !jsonCandidate.includes("\"error\"")) {
        continue;
      }

      try {
        const parsed = JSON.parse(jsonCandidate) as {
          error?: { code?: number | string; status?: string; message?: string };
        };
        if (!parsed?.error || typeof parsed.error !== "object") {
          continue;
        }

        const error = parsed.error;
        const parts: string[] = [];
        if (typeof error.status === "string" && error.status.trim()) {
          parts.push(error.status.trim());
        }
        if (typeof error.code === "number" || typeof error.code === "string") {
          parts.push(`code ${String(error.code)}`);
        }
        if (typeof error.message === "string" && error.message.trim()) {
          parts.push(error.message.trim());
        }

        return parts.length > 0 ? parts.join(" | ") : "Provider returned an error payload";
      } catch {
        // Ignore malformed JSON lines
      }
    }

    const lastStderr = lines.find((line) => line.startsWith("[stderr] "));
    if (lastStderr) {
      return lastStderr.slice(9).trim();
    }

    return undefined;
  }

  /**
   * Save tasks to file for persistence
   */
  private saveTasks(): void {
    try {
      const tasksPath = path.join(this.projectPath, ".openclaw", "agent-tasks.json");
      const dir = path.dirname(tasksPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tasks = Array.from(this.processes.values()).map((p) => ({
        id: p.id,
        pid: p.pid,
        description: p.description,
        worktree: p.worktree,
        startedAt: p.startedAt,
        status: p.status,
        agent: p.agent,
        branch: p.branch,
        completedAt: p.completedAt,
        exitCode: p.exitCode,
        failureReason: p.failureReason,
        lastOutput: p.lastOutput,
        // Don't include webContents or shellProcess in serialization
      }));

      fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
    } catch (err) {
      console.error("[AgentManager] Failed to save tasks:", err);
    }
  }

  /**
   * Clean up zombie processes on startup
   */
  private cleanupZombies(): void {
    try {
      const tasksPath = path.join(this.projectPath, ".openclaw", "agent-tasks.json");

      if (!fs.existsSync(tasksPath)) {
        return;
      }

      const tasks = JSON.parse(fs.readFileSync(tasksPath, "utf-8")) as WindowsAgentProcess[];

      for (const task of tasks) {
        // Check if process is still running
        if (task.status === "running" && task.pid) {
          try {
            // Try to signal the process (zero signal doesn't actually send a signal)
            process.kill(task.pid, 0);

            // Process is still running, check if it's actually an agent
            // For now, we'll just mark it as exited since we can't verify
            task.status = "exited";
          } catch {
            // Process doesn't exist, mark as exited
            task.status = "exited";
          }
        }
      }

      // Save the updated state
      fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
    } catch (err) {
      console.error("[AgentManager] Failed to cleanup zombies:", err);
    }
  }

  /**
   * Get statistics about running agents
   */
  getStats(): {
    total: number;
    running: number;
    starting: number;
    exited: number;
    killed: number;
  } {
    const processes = Array.from(this.processes.values());

    return {
      total: processes.length,
      running: processes.filter((p) => p.status === "running").length,
      starting: processes.filter((p) => p.status === "starting").length,
      exited: processes.filter((p) => p.status === "exited").length,
      killed: processes.filter((p) => p.status === "killed").length,
    };
  }
}

// Export a singleton instance manager
let agentManagerInstance: WindowsAgentProcessManager | null = null;

export function getAgentManager(projectPath: string): WindowsAgentProcessManager {
  if (!agentManagerInstance) {
    agentManagerInstance = new WindowsAgentProcessManager(projectPath);
  }
  return agentManagerInstance;
}

export function resetAgentManager(): void {
  agentManagerInstance = null;
}
