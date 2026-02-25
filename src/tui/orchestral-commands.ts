/**
 * Orchestral command handlers for /spawn, /agents, and /tasks.
 */

import type { ChatLog } from "./components/chat-log.js";
import type { TuiStateAccess } from "./tui-types.js";
import { resolveAgent, getAgentIcon, getAgentName } from "../orchestration/agent-selector.js";
import { isTmuxAvailable, createSession, isSessionAlive, killSession, sendKeys, listSessions, captureOutput } from "../orchestration/tmux-manager.js";
import { createWorktree, removeWorktree, detectPackageManager, getWorktreeBranch } from "../orchestration/git-worktree.js";
import { createTask, listTasks, getTask, updateTaskStatus, deleteTask } from "../orchestration/task-registry.js";
import { tmuxSessionName, worktreeDirForTask, parseTaskFilters, formatAge, formatTimestamp } from "../orchestration/utils.js";
import type { ActiveTask, AgentType } from "../orchestration/types.js";
import { runCommandWithTimeout, resolveCommand } from "../process/exec.js";
import * as path from "node:path";

const DEFAULT_TIMEOUT = 10_000;

/**
 * Parse /spawn command arguments.
 */
interface SpawnArgs {
  description: string;
  agent?: AgentType;
  branch?: string;
}

function parseSpawnArgs(args: string): SpawnArgs {
  const parts = args.split(/\s+/);
  const result: SpawnArgs = {
    description: "",
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part === "--agent" && i + 1 < parts.length) {
      const agent = parts[++i] as AgentType;
      if (["claude", "codex", "gemini"].includes(agent)) {
        result.agent = agent;
      }
    } else if (part === "--branch" && i + 1 < parts.length) {
      result.branch = parts[++i];
    } else {
      // Everything else is part of the description
      result.description += (result.description ? " " : "") + part;
    }
  }

  return result;
}

/**
 * Handle /spawn command.
 */
export async function handleSpawnCommand(
  args: string,
  state: TuiStateAccess,
  chatLog: ChatLog,
  setActivityStatus: (text: string) => void,
): Promise<void> {
  const parsed = parseSpawnArgs(args);

  if (!parsed.description) {
    chatLog.addSystem("usage: /spawn <description> [--agent <claude|codex|gemini>] [--branch <name>]");
    return;
  }

  // Check if tmux is available
  if (!(await isTmuxAvailable())) {
    chatLog.addSystem("error: tmux is not available. Please install tmux first.");
    return;
  }

  // Get current git repository
  let repoPath = process.cwd();
  try {
    const gitResult = await runCommandWithTimeout(
      [resolveCommand("git"), "rev-parse", "--show-toplevel"],
      DEFAULT_TIMEOUT,
    );
    if (gitResult.code === 0) {
      repoPath = gitResult.stdout.trim();
    }
  } catch {
    // Not in a git repo, continue with cwd
  }

  // Resolve agent
  const agent = resolveAgent(parsed.description, parsed.agent);

  // Generate task ID and related names
  const taskId = `task-${Date.now()}`;
  const sessionName = tmuxSessionName(taskId);
  const branchName = parsed.branch || `orchestral/${taskId.slice(0, 16)}`;

  chatLog.addSystem(`Spawning task ${taskId}...`);
  chatLog.addSystem(`  Agent: ${getAgentIcon(agent)} ${getAgentName(agent)}`);
  chatLog.addSystem(`  Branch: ${branchName}`);

  // Create worktree
  const worktreePath = worktreeDirForTask(taskId, repoPath);
  const worktreeResult = await createWorktree({
    repoPath,
    branch: branchName,
    worktreeDir: worktreePath,
  });

  if (!worktreeResult.success) {
    chatLog.addSystem(`error: failed to create worktree: ${worktreeResult.error}`);
    return;
  }

  chatLog.addSystem(`  Worktree: ${worktreePath}`);

  // Create tmux session
  const sessionResult = await createSession({
    name: sessionName,
    command: `cd "${worktreePath}" && clear`,
    cwd: worktreePath,
  });

  if (!sessionResult.success) {
    // Clean up worktree
    await removeWorktree(worktreePath, repoPath);
    chatLog.addSystem(`error: failed to create tmux session: ${sessionResult.error}`);
    return;
  }

  chatLog.addSystem(`  Session: ${sessionName}`);
  chatLog.addSystem(`  Attach with: tmux attach -t ${sessionName}`);

  // Create task in registry
  const task = await createTask({
    tmuxSession: sessionName,
    agent,
    description: parsed.description,
    repo: repoPath,
    worktree: worktreePath,
    branch: branchName,
    startedAt: Date.now(),
    status: "running",
    notifyOnComplete: true,
    retryCount: 0,
    maxRetries: 3,
  });

  // Send initial message to the agent in tmux
  const initialPrompt = `Task: ${parsed.description}\n\nPlease implement this task. Start by exploring the codebase to understand the context, then make the necessary changes.`;
  await sendKeys(sessionName, `echo '${initialPrompt}'`);
  await sendKeys(sessionName, `openclaw chat "${initialPrompt}"`);

  chatLog.addSystem(`✓ Task ${task.id} spawned successfully`);
}

/**
 * Handle /agents command.
 */
export async function handleAgentsCommand(
  args: string,
  chatLog: ChatLog,
): Promise<void> {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() || "list";

  switch (subcommand) {
    case "list": {
      await handleAgentsList(chatLog);
      break;
    }
    case "kill": {
      const taskId = parts[1];
      if (!taskId) {
        chatLog.addSystem("usage: /agents kill <task-id>");
        return;
      }
      await handleAgentsKill(taskId, chatLog);
      break;
    }
    case "attach": {
      const taskId = parts[1];
      if (!taskId) {
        chatLog.addSystem("usage: /agents attach <task-id>");
        return;
      }
      await handleAgentsAttach(taskId, chatLog);
      break;
    }
    case "redirect": {
      const taskId = parts[1];
      const message = parts.slice(2).join(" ");
      if (!taskId || !message) {
        chatLog.addSystem("usage: /agents redirect <task-id> <message>");
        return;
      }
      await handleAgentsRedirect(taskId, message, chatLog);
      break;
    }
    case "output": {
      const taskId = parts[1];
      if (!taskId) {
        chatLog.addSystem("usage: /agents output <task-id>");
        return;
      }
      await handleAgentsOutput(taskId, chatLog);
      break;
    }
    default:
      chatLog.addSystem("usage: /agents [list|kill|attach|redirect|output] [args]");
      break;
  }
}

async function handleAgentsList(chatLog: ChatLog): Promise<void> {
  const tasks = await listTasks();
  const runningTasks = tasks.filter((t) => t.status === "running");

  if (runningTasks.length === 0) {
    chatLog.addSystem("No running agents.");
    return;
  }

  chatLog.addSystem(`Running agents (${runningTasks.length}):`);
  chatLog.addSystem("");

  for (const task of runningTasks) {
    const icon = getAgentIcon(task.agent);
    const age = formatAge(task.startedAt);
    const time = formatTimestamp(task.startedAt);

    chatLog.addSystem(`${icon} ${task.id}`);
    chatLog.addSystem(`  Description: ${task.description}`);
    chatLog.addSystem(`  Started: ${time} (${age} ago)`);
    chatLog.addSystem(`  Session: ${task.tmuxSession || "N/A"}`);
    if (task.branch) {
      chatLog.addSystem(`  Branch: ${task.branch}`);
    }
    chatLog.addSystem("");
  }
}

async function handleAgentsKill(taskId: string, chatLog: ChatLog): Promise<void> {
  const task = await getTask(taskId);
  if (!task) {
    chatLog.addSystem(`error: task ${taskId} not found`);
    return;
  }

  if (task.status !== "running") {
    chatLog.addSystem(`Task ${taskId} is not running (status: ${task.status})`);
    return;
  }

  // Kill tmux session
  if (task.tmuxSession) {
    const result = await killSession(task.tmuxSession);
    if (result.success) {
      chatLog.addSystem(`Killed tmux session ${task.tmuxSession}`);
    } else {
      chatLog.addSystem(`Warning: failed to kill tmux session: ${result.error}`);
    }
  }

  // Clean up worktree
  if (task.worktree && task.repo) {
    const result = await removeWorktree(task.worktree, task.repo);
    if (result.success) {
      chatLog.addSystem(`Removed worktree ${task.worktree}`);
    } else {
      chatLog.addSystem(`Warning: failed to remove worktree: ${result.error}`);
    }
  }

  // Update task status
  await updateTaskStatus(taskId, "failed", "Killed by user");
  chatLog.addSystem(`Task ${taskId} killed`);
}

async function handleAgentsAttach(taskId: string, chatLog: ChatLog): Promise<void> {
  const task = await getTask(taskId);
  if (!task) {
    chatLog.addSystem(`error: task ${taskId} not found`);
    return;
  }

  if (!task.tmuxSession) {
    chatLog.addSystem(`Task ${taskId} has no tmux session`);
    return;
  }

  if (!(await isSessionAlive(task.tmuxSession))) {
    chatLog.addSystem(`Session ${task.tmuxSession} is not active`);
    return;
  }

  chatLog.addSystem(`To attach to the session, run in another terminal:`);
  chatLog.addSystem(`  tmux attach -t ${task.tmuxSession}`);
  chatLog.addSystem(`(Press Ctrl+B, then D to detach without killing)`);
}

async function handleAgentsRedirect(taskId: string, message: string, chatLog: ChatLog): Promise<void> {
  const task = await getTask(taskId);
  if (!task) {
    chatLog.addSystem(`error: task ${taskId} not found`);
    return;
  }

  if (!task.tmuxSession) {
    chatLog.addSystem(`Task ${taskId} has no tmux session`);
    return;
  }

  if (!(await isSessionAlive(task.tmuxSession))) {
    chatLog.addSystem(`Session ${task.tmuxSession} is not active`);
    return;
  }

  const result = await sendKeys(task.tmuxSession, message);
  if (result.success) {
    chatLog.addSystem(`Message sent to ${taskId}`);
  } else {
    chatLog.addSystem(`error: failed to send message: ${result.error}`);
  }
}

async function handleAgentsOutput(taskId: string, chatLog: ChatLog): Promise<void> {
  const task = await getTask(taskId);
  if (!task) {
    chatLog.addSystem(`error: task ${taskId} not found`);
    return;
  }

  if (!task.tmuxSession) {
    chatLog.addSystem(`Task ${taskId} has no tmux session`);
    return;
  }

  const output = await captureOutput(task.tmuxSession, 50);
  if (output) {
    const lines = output.split("\n");
    // Show last 20 lines
    const preview = lines.slice(-20).join("\n");
    chatLog.addSystem(`Session output (${task.tmuxSession}):`);
    chatLog.addSystem("─".repeat(60));
    chatLog.addSystem(preview);
    chatLog.addSystem("─".repeat(60));
  } else {
    chatLog.addSystem("No output available or session is not active");
  }
}

/**
 * Handle /tasks command.
 */
export async function handleTasksCommand(
  args: string,
  chatLog: ChatLog,
): Promise<void> {
  const filters = parseTaskFilters(args);
  const tasks = await listTasks();

  // Apply filters
  let filtered = tasks;
  if (filters.status) {
    filtered = filtered.filter((t) => t.status === filters.status);
  }
  if (filters.agent) {
    filtered = filtered.filter((t) => t.agent === filters.agent);
  }
  if (filters.limit) {
    filtered = filtered.slice(0, filters.limit);
  }

  // Sort by started time (newest first)
  filtered.sort((a, b) => b.startedAt - a.startedAt);

  if (filtered.length === 0) {
    chatLog.addSystem("No tasks found.");
    return;
  }

  // Count by status
  const counts = {
    pending: tasks.filter((t) => t.status === "pending").length,
    running: tasks.filter((t) => t.status === "running").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    blocked: tasks.filter((t) => t.status === "blocked").length,
  };

  chatLog.addSystem(`Tasks (${filtered.length} shown, ${tasks.length} total):`);
  chatLog.addSystem(`  pending: ${counts.pending} | running: ${counts.running} | completed: ${counts.completed} | failed: ${counts.failed} | blocked: ${counts.blocked}`);
  chatLog.addSystem("");

  for (const task of filtered) {
    const icon = getAgentIcon(task.agent);
    const age = formatAge(task.startedAt);
    const time = formatTimestamp(task.startedAt);
    const statusIcon = getStatusIcon(task.status);

    chatLog.addSystem(`${statusIcon} ${icon} ${task.id} [${task.status}]`);
    chatLog.addSystem(`  ${task.description}`);
    chatLog.addSystem(`  Started: ${time} (${age} ago)`);
    if (task.completedAt) {
      const duration = formatAge(task.completedAt - task.startedAt);
      chatLog.addSystem(`  Duration: ${duration}`);
    }
    chatLog.addSystem("");
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case "pending":
      return "⏳";
    case "running":
      return "🔄";
    case "completed":
      return "✅";
    case "failed":
      return "❌";
    case "blocked":
      return "🚫";
    default:
      return "❓";
  }
}

/**
 * Generate help text for orchestral commands.
 */
export function orchestralHelpText(): string {
  return [
    "",
    "Orchestral Commands:",
    "  /spawn <description> [--agent <type>] [--branch <name>]",
    "    Spawn a new agent task in an isolated tmux session",
    "",
    "  /agents list",
    "    List all running agents",
    "",
    "  /agents kill <task-id>",
    "    Kill a running agent task",
    "",
    "  /agents attach <task-id>",
    "    Show command to attach to an agent's tmux session",
    "",
    "  /agents redirect <task-id> <message>",
    "    Send a message to redirect an agent",
    "",
    "  /agents output <task-id>",
    "    Show recent output from an agent's session",
    "",
    "  /tasks [--status <running|completed|failed>] [--agent <type>] [--limit <n>]",
    "    List tasks with optional filters",
    "",
  ].join("\n");
}
