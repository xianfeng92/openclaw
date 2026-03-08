import { ipcMain } from "electron";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import type { GatewayLike } from "./gateway-like.js";
import { registerTerminalConfigIpcHandlers } from "./terminal-ipc.config.js";
import { registerTerminalOrchestrationIpcHandlers } from "./terminal-ipc.orchestration.js";
import { registerTerminalAuditIpcHandlers } from "./terminal-ipc.audit.js";
import { registerTerminalShellIpcHandlers } from "./terminal-ipc.shell.js";
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

type GetAgentManager = (projectPath?: string) => any;
type ImportOrchestrationModule = () => Promise<OrchestrationModule>;

const defaultGetAgentManager: GetAgentManager = (projectPath?: string) =>
  require("./windows-agent-manager.js").getAgentManager(projectPath ?? getProjectPath());

let getAgentManager: GetAgentManager = defaultGetAgentManager;
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

const defaultImportOrchestrationModule: ImportOrchestrationModule = async (): Promise<OrchestrationModule> => {
  return (await import(ORCHESTRATION_MODULE_PATH)) as OrchestrationModule;
};
let importOrchestrationModule: ImportOrchestrationModule = defaultImportOrchestrationModule;

export function registerTerminalIpcRuntimeDeps(deps: {
  getAgentManager?: GetAgentManager;
  importOrchestrationModule?: ImportOrchestrationModule;
}): void {
  getAgentManager = deps.getAgentManager ?? defaultGetAgentManager;
  importOrchestrationModule = deps.importOrchestrationModule ?? defaultImportOrchestrationModule;
}

async function importProcessExecModule(): Promise<ProcessExecModule> {
  return (await import(PROCESS_EXEC_MODULE_PATH)) as ProcessExecModule;
}

export function setupTerminalIpc(gatewayManager: GatewayLike): void {

  // Note: Agent manager loads existing tasks on startup via its constructor

  registerTerminalShellIpcHandlers();
  registerTerminalAuditIpcHandlers();
  registerTerminalConfigIpcHandlers({
    getGatewayManager: () => gatewayManager,
  });

  registerTerminalOrchestrationIpcHandlers({
    getAgentManager,
    getProjectPath,
    importOrchestrationModule,
  });

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

// Keep old signature for backward compatibility, but warn
export function setupTerminalIpcLegacy(): void {
  console.warn("[Terminal] setupTerminalIpc called without gatewayManager parameter");
}

