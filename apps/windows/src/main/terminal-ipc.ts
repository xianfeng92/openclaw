import { ipcMain, WebContents } from "electron";
import { spawn, ChildProcess, exec } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_CYDECK_CONFIG,
  getEffectiveConfig,
  resolveCyDeckConfigPath,
  resolveCyDeckStateDir,
} from "./cydeck-config.js";
import type { CyDeckConfigIssue, CyDeckConfigValidation, CyDeckRuntimeProviderConfig } from "./cydeck-config.js";
import {
  assignConfigPathValue,
  coerceCyDeckConfigValue,
  formatMutableConfigKeysForHelp,
  isCyDeckMutableConfigKey,
} from "./cydeck-config-ipc.js";
import type { GatewayLike } from "./gateway-like.js";
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

let gatewayManagerInstance: GatewayLike | undefined;

// NOTE: Task storage is unified in WindowsAgentProcessManager (agent-tasks.json)

// Cached project path with CWD tracking for auto-invalidation
let cachedProjectPath: string | undefined;
let cachedProjectPathCwd: string | undefined;

// Get the current project path (git repo root or current working directory)
async function resolveProjectPath(): Promise<string> {
  const currentCwd = process.cwd();

  // Return cached value if still valid (CWD hasn't changed)
  if (cachedProjectPath && cachedProjectPathCwd === currentCwd) {
    return cachedProjectPath;
  }

  // CWD changed or cache miss - recompute
  try {
    const result = await execAsync("git rev-parse --show-toplevel", {
      windowsHide: true,
    });
    if (result.stdout && result.stdout.trim()) {
      cachedProjectPath = result.stdout.trim();
      cachedProjectPathCwd = currentCwd;
      return cachedProjectPath;
    }
  } catch {
    // Not in a git repo, use current working directory
  }
  cachedProjectPath = currentCwd;
  cachedProjectPathCwd = currentCwd;
  return cachedProjectPath;
}

// Synchronous version for use in handlers (uses cached value or current directory)
function getProjectPath(): string {
  const currentCwd = process.cwd();
  // Invalidate cache if CWD changed
  if (cachedProjectPathCwd !== currentCwd) {
    cachedProjectPath = undefined;
    cachedProjectPathCwd = undefined;
  }
  return cachedProjectPath ?? currentCwd;
}

function getShellCommand(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec || "cmd.exe";
  }
  return process.env.SHELL || "/bin/sh";
}

function findObsidianVault(): string | undefined {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const candidates = [
    process.env.CYDECK_OBSIDIAN_VAULT,
    path.join(homeDir, "Obsidian", "Vault"),
    path.join(homeDir, "Documents", "Obsidian", "Vault"),
    path.join(homeDir, "OneDrive", "Documents", "Obsidian", "Vault"),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

const getAgentManager = (projectPath?: string) =>
  require("./windows-agent-manager.js").getAgentManager(projectPath ?? getProjectPath());

const ORCHESTRATION_MODULE_PATH: string = "../../../src/orchestration/index.js";
const PROCESS_EXEC_MODULE_PATH: string = "../../process/exec.js";

type OrchestrationModule = Record<string, (...args: any[]) => any>;
type ProcessExecModule = {
  runCommandWithTimeout: (
    argv: string[],
    optionsOrTimeout: number | { timeoutMs: number; cwd?: string; input?: string; env?: NodeJS.ProcessEnv },
  ) => Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null; killed: boolean }>;
  resolveCommand: (command: string) => string;
};

type AgentTaskStatus = "starting" | "running" | "exited" | "killed";

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

type PatternRecommendation = {
  item: {
    id: string;
    name: string;
    category: string;
    description: string;
    effectiveness?: number;
    usageCount?: number;
  };
  score: number;
  matchReason: string;
};

async function importOrchestrationModule(): Promise<OrchestrationModule> {
  return (await import(ORCHESTRATION_MODULE_PATH)) as OrchestrationModule;
}

async function importProcessExecModule(): Promise<ProcessExecModule> {
  return (await import(PROCESS_EXEC_MODULE_PATH)) as ProcessExecModule;
}

type TerminalConfigBaseResult = {
  success: boolean;
  configPath: string;
  stateDir: string;
  error?: string;
};

type TerminalConfigGetResult = TerminalConfigBaseResult & {
  config?: unknown;
  runtimeProvider?: unknown;
  workspacePath?: string;
  validation?: CyDeckConfigValidation;
  warnings?: string[];
  issues?: CyDeckConfigIssue[];
};

type TerminalConfigSetResult = TerminalConfigBaseResult & {
  key?: string;
  value?: string | number | boolean;
  validation?: CyDeckConfigValidation;
  warnings?: string[];
  issues?: CyDeckConfigIssue[];
};

type TerminalConfigValidateResult = TerminalConfigBaseResult & {
  validation?: CyDeckConfigValidation;
  warnings?: string[];
  issues?: CyDeckConfigIssue[];
};

type TerminalConfigResetResult = TerminalConfigBaseResult & {
  validation?: CyDeckConfigValidation;
  warnings?: string[];
  issues?: CyDeckConfigIssue[];
};

type TerminalConfigApplyResult = TerminalConfigBaseResult & {
  runtimeProvider?: unknown;
  validation?: CyDeckConfigValidation;
  warnings?: string[];
  issues?: CyDeckConfigIssue[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneDefaultConfigRecord(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(DEFAULT_CYDECK_CONFIG)) as Record<string, unknown>;
}

function loadEditableConfigDocument(): {
  success: boolean;
  configPath: string;
  stateDir: string;
  document?: Record<string, unknown>;
  error?: string;
} {
  const configPath = resolveCyDeckConfigPath();
  const stateDir = resolveCyDeckStateDir();

  if (!fs.existsSync(configPath)) {
    return {
      success: true,
      configPath,
      stateDir,
      document: cloneDefaultConfigRecord(),
    };
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    if (!raw.trim()) {
      return {
        success: true,
        configPath,
        stateDir,
        document: {},
      };
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
      return {
        success: false,
        configPath,
        stateDir,
        error: `Config file must contain a JSON object: ${configPath}`,
      };
    }

    return {
      success: true,
      configPath,
      stateDir,
      document: parsed,
    };
  } catch (err) {
    return {
      success: false,
      configPath,
      stateDir,
      error: `Failed to read config file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function writeConfigDocument(
  configPath: string,
  stateDir: string,
  document: Record<string, unknown>,
): { success: boolean; error?: string } {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Failed to write config file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function applyRuntimeProviderToGateway(
  runtimeProvider: CyDeckRuntimeProviderConfig,
): { success: boolean; error?: string } {
  if (!gatewayManagerInstance) {
    return { success: false, error: "Gateway is not initialized" };
  }

  if (typeof gatewayManagerInstance.reloadRuntimeProvider !== "function") {
    return { success: false, error: "Current gateway does not support runtime provider reload" };
  }

  try {
    gatewayManagerInstance.reloadRuntimeProvider(runtimeProvider);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function setupTerminalIpc(gatewayManager: GatewayLike): void {
  gatewayManagerInstance = gatewayManager;

  // Note: Agent manager loads existing tasks on startup via its constructor

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

  // Get effective config (resolved + validated)
  ipcMain.handle("terminal:config-get", async (): Promise<TerminalConfigGetResult> => {
    try {
      const effective = getEffectiveConfig();
      return {
        success: true,
        configPath: effective.configPath,
        stateDir: effective.stateDir,
        config: effective.config,
        runtimeProvider: effective.runtimeProvider,
        workspacePath: effective.workspacePath,
        validation: effective.validation,
        warnings: effective.warnings,
        issues: effective.issues,
      };
    } catch (err) {
      return {
        success: false,
        configPath: resolveCyDeckConfigPath(),
        stateDir: resolveCyDeckStateDir(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Return config filesystem paths.
  ipcMain.handle("terminal:config-path", async (): Promise<TerminalConfigBaseResult> => {
    return {
      success: true,
      configPath: resolveCyDeckConfigPath(),
      stateDir: resolveCyDeckStateDir(),
    };
  });

  // Re-run validation against current effective config.
  ipcMain.handle("terminal:config-validate", async (): Promise<TerminalConfigValidateResult> => {
    try {
      const effective = getEffectiveConfig();
      return {
        success: true,
        configPath: effective.configPath,
        stateDir: effective.stateDir,
        validation: effective.validation,
        warnings: effective.warnings,
        issues: effective.issues,
      };
    } catch (err) {
      return {
        success: false,
        configPath: resolveCyDeckConfigPath(),
        stateDir: resolveCyDeckStateDir(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Apply effective runtime provider to the live gateway without restarting the app.
  ipcMain.handle("terminal:config-apply", async (): Promise<TerminalConfigApplyResult> => {
    try {
      const effective = getEffectiveConfig();
      const applyResult = applyRuntimeProviderToGateway(effective.runtimeProvider);
      if (!applyResult.success) {
        return {
          success: false,
          configPath: effective.configPath,
          stateDir: effective.stateDir,
          runtimeProvider: effective.runtimeProvider,
          validation: effective.validation,
          warnings: effective.warnings,
          issues: effective.issues,
          error: applyResult.error,
        };
      }

      return {
        success: true,
        configPath: effective.configPath,
        stateDir: effective.stateDir,
        runtimeProvider: effective.runtimeProvider,
        validation: effective.validation,
        warnings: effective.warnings,
        issues: effective.issues,
      };
    } catch (err) {
      return {
        success: false,
        configPath: resolveCyDeckConfigPath(),
        stateDir: resolveCyDeckStateDir(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Reset config back to the default CyDeck shape.
  ipcMain.handle("terminal:config-reset", async (): Promise<TerminalConfigResetResult> => {
    const configPath = resolveCyDeckConfigPath();
    const stateDir = resolveCyDeckStateDir();
    const writeResult = writeConfigDocument(configPath, stateDir, cloneDefaultConfigRecord());
    if (!writeResult.success) {
      return {
        success: false,
        configPath,
        stateDir,
        error: writeResult.error,
      };
    }

    try {
      const effective = getEffectiveConfig();
      return {
        success: true,
        configPath: effective.configPath,
        stateDir: effective.stateDir,
        validation: effective.validation,
        warnings: effective.warnings,
        issues: effective.issues,
      };
    } catch (err) {
      return {
        success: false,
        configPath,
        stateDir,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Set a single config key in the JSON document.
  ipcMain.handle(
    "terminal:config-set",
    async (_event, key: string, rawValue: string): Promise<TerminalConfigSetResult> => {
      const normalizedKey = typeof key === "string" ? key.trim() : "";
      const normalizedRawValue = typeof rawValue === "string" ? rawValue : "";
      const configPath = resolveCyDeckConfigPath();
      const stateDir = resolveCyDeckStateDir();

      if (!normalizedKey) {
        return {
          success: false,
          configPath,
          stateDir,
          error: "Missing config key. Usage: /config set <key> <value>",
        };
      }

      if (!isCyDeckMutableConfigKey(normalizedKey)) {
        return {
          success: false,
          configPath,
          stateDir,
          error: `Unsupported config key "${normalizedKey}". Mutable keys: ${formatMutableConfigKeysForHelp()}`,
        };
      }

      const coerced = coerceCyDeckConfigValue(normalizedKey, normalizedRawValue);
      if (!coerced.ok) {
        return {
          success: false,
          configPath,
          stateDir,
          error: coerced.error,
        };
      }

      const editable = loadEditableConfigDocument();
      if (!editable.success || !editable.document) {
        return {
          success: false,
          configPath: editable.configPath,
          stateDir: editable.stateDir,
          error: editable.error ?? "Failed to load editable config document",
        };
      }

      assignConfigPathValue(editable.document, normalizedKey, coerced.value);
      const writeResult = writeConfigDocument(editable.configPath, editable.stateDir, editable.document);
      if (!writeResult.success) {
        return {
          success: false,
          configPath: editable.configPath,
          stateDir: editable.stateDir,
          error: writeResult.error,
        };
      }

      try {
        const effective = getEffectiveConfig();
        const shouldApplyRuntimeProvider = normalizedKey === "ai.defaultProvider" || normalizedKey.startsWith("ai.providers.");
        if (shouldApplyRuntimeProvider) {
          const applyResult = applyRuntimeProviderToGateway(effective.runtimeProvider);
          if (!applyResult.success) {
            return {
              success: false,
              configPath: effective.configPath,
              stateDir: effective.stateDir,
              key: normalizedKey,
              value: coerced.value,
              validation: effective.validation,
              warnings: effective.warnings,
              issues: effective.issues,
              error: applyResult.error,
            };
          }
        }

        return {
          success: true,
          configPath: effective.configPath,
          stateDir: effective.stateDir,
          key: normalizedKey,
          value: coerced.value,
          validation: effective.validation,
          warnings: effective.warnings,
          issues: effective.issues,
        };
      } catch (err) {
        return {
          success: false,
          configPath: editable.configPath,
          stateDir: editable.stateDir,
          error: err instanceof Error ? err.message : String(err),
          key: normalizedKey,
          value: coerced.value,
        };
      }
    },
  );

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
        }

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
          details.push(`PID: ${agentResult.pid}`);
        } else {
          // Agent failed to start but worktree was created
          details.push(`Agent start failed: ${agentResult.error}`);
          if (agentResult.exitCode !== null && agentResult.exitCode !== undefined) {
            details.push(`Exit code: ${agentResult.exitCode}`);
          }
          if (agentResult.lastOutput) {
            const preview = agentResult.lastOutput.replace(/\r?\n/gu, " ").slice(0, 240);
            details.push(`Last output: ${preview}`);
          }
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
            id: taskId,
            agent,
            description: opts.description,
            repo: repoPath || process.cwd(),
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

  // Agents command (list, kill, attach, redirect, output)
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
            const taskId = args[0];
            return await agentMgr.killAgent(taskId);
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

    return { success: false, error: "Task not found" };
  });

  // Tasks command
  ipcMain.handle(
    "terminal:orchestral-tasks",
    async (_event, filters: Record<string, string>, action?: string): Promise<any> => {
      try {
        const agentMgr = getAgentManager(getProjectPath());

        // Handle purge/clear action - delete completed/failed tasks
        if (action === "purge" || action === "clear") {
          const deletedCount = agentMgr.clearCompletedTasks();
          return {
            success: true,
            message: `Deleted ${deletedCount} completed/failed task(s)`,
          };
        }

        // Handle purge-all action - forcefully clear ALL tasks including stale "running" ones
        if (action === "purge-all" || action === "clear-all") {
          const result = agentMgr.clearAllTasks();
          return {
            success: true,
            message: `Cleared ALL tasks (${result.count} total)${result.worktreesCleaned > 0 ? ` and cleaned ${result.worktreesCleaned} worktree(s)` : ""}`,
          };
        }

        // Get all tasks from agent manager
        const allTasks = agentMgr.listAgents() as AgentTask[];
        let tasks = allTasks.filter((t: AgentTask) => t.status !== "killed");

        // Apply filters
        if (filters.status) {
          tasks = tasks.filter((t: AgentTask) => t.status === filters.status);
        }
        if (filters.agent) {
          tasks = tasks.filter((t: AgentTask) => t.agent === filters.agent);
        }
        if (filters.limit) {
          tasks = tasks.slice(0, Number.parseInt(filters.limit, 10));
        }

        // Sort by started time (newest first)
        tasks.sort((a: AgentTask, b: AgentTask) => b.startedAt - a.startedAt);

        // Count by status
        const summary = `Total: ${allTasks.length} | running: ${allTasks.filter((t: AgentTask) => t.status === "running").length} | starting: ${allTasks.filter((t: AgentTask) => t.status === "starting").length} | exited: ${allTasks.filter((t: AgentTask) => t.status === "exited").length} | killed: ${allTasks.filter((t: AgentTask) => t.status === "killed").length}`;

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

  // Note: Task cleanup is handled internally by WindowsAgentProcessManager
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
  name: string;
  category: string;
  description: string;
  prompt: string;
}): Promise<any> => {
  try {
    const { name, category, description, prompt } = pattern;
    const contextPath = path.join(getProjectPath(), ".openclaw", "business-context.json");

    // Load existing context or create new
    let context: {
      customers: unknown[];
      projects: unknown[];
      meetings: unknown[];
      decisions: unknown[];
      patterns: Array<Record<string, unknown>>;
    } = { customers: [], projects: [], meetings: [], decisions: [], patterns: [] };
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

    const context = JSON.parse(fs.readFileSync(contextPath, "utf-8"));
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
    const { recommendPatterns } = await importOrchestrationModule();

    const recommendations = (await recommendPatterns(description, limit)) as PatternRecommendation[];

    return {
      success: true,
      patterns: recommendations.map((r: PatternRecommendation) => ({
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
    const { runCodeReview, formatReviewTerminal } = await importOrchestrationModule();
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
    const { getGitStatus, commitChanges, getCurrentBranch, createPR } = await importOrchestrationModule();
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

    const { runCommandWithTimeout, resolveCommand } = await importProcessExecModule();
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
    const { listOpenPRs } = await importOrchestrationModule();
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
    const { getPRDetails } = await importOrchestrationModule();
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
    const { getGitStatus, getCurrentBranch } = await importOrchestrationModule();
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

ipcMain.handle("terminal:workflow-run", async (_event, name: string): Promise<any> => {
  try {
    const { dryRunWorkflow, getWorkflowByName } = await importOrchestrationModule();
    const workflow = await getWorkflowByName(name);

    if (!workflow) {
      return { success: false, error: "Workflow not found" };
    }

    const result = await dryRunWorkflow(workflow.id);
    const { incrementWorkflowRunCount } = await importOrchestrationModule();
    await incrementWorkflowRunCount(workflow.id);

    return { success: true, steps: result.steps };
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

// Keep old signature for backward compatibility, but warn
export function setupTerminalIpcLegacy(): void {
  console.warn("[Terminal] setupTerminalIpc called without gatewayManager parameter");
}
