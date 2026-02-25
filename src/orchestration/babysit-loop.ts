/**
 * Babysit loop for monitoring and auto-retry of failed agents.
 * Periodically checks running tasks and respawns failed ones.
 */

import * as crypto from "node:crypto";
import { getTask, updateTask, listTasks } from "./task-registry.js";
import { isSessionAlive, killSession } from "./tmux-manager.js";
import { analyzeFailure, selectRetryStrategy } from "./retry-strategy.js";
import { buildContextualPrompt } from "./prompt-builder.js";
import { loadContext } from "./context-manager.js";
import type { ActiveTask } from "./types.js";

/**
 * Configuration for the babysit loop.
 */
export interface BabysitConfig {
  intervalMs: number; // How often to check (default: 10 minutes)
  maxRetriesPerTask: number; // Maximum retries per task (default: 3)
  retryDelayMs: number; // Delay before retry (default: 30 seconds)
  enabled: boolean; // Whether the loop is enabled
}

const DEFAULT_CONFIG: BabysitConfig = {
  intervalMs: 10 * 60 * 1000, // 10 minutes
  maxRetriesPerTask: 3,
  retryDelayMs: 30 * 1000, // 30 seconds
  enabled: true,
};

let intervalId: ReturnType<typeof setInterval> | null = null;
let currentConfig = DEFAULT_CONFIG;

/**
 * Start the babysit loop.
 */
export function startBabysitLoop(config?: Partial<BabysitConfig>): void {
  if (intervalId) {
    console.log("[BabysitLoop] Already running, restarting with new config");
    stopBabysitLoop();
  }

  currentConfig = { ...DEFAULT_CONFIG, ...config };

  if (!currentConfig.enabled) {
    console.log("[BabysitLoop] Disabled by config");
    return;
  }

  console.log("[BabysitLoop] Starting with config:", currentConfig);

  // Run immediately, then on interval
  void runBabysitCheck();
  intervalId = setInterval(() => {
    void runBabysitCheck();
  }, currentConfig.intervalMs);
}

/**
 * Stop the babysit loop.
 */
export function stopBabysitLoop(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[BabysitLoop] Stopped");
  }
}

/**
 * Get current status of the babysit loop.
 */
export function getBabysitStatus(): {
  running: boolean;
  config: BabysitConfig;
} {
  return {
    running: intervalId !== null,
    config: currentConfig,
  };
}

/**
 * Run a single babysit check.
 */
export async function runBabysitCheck(): Promise<void> {
  try {
    console.log("[BabysitLoop] Running check...");

    const tasks = await listTasks();
    const runningTasks = tasks.filter((t) => t.status === "running");

    console.log(`[BabysitLoop] Found ${runningTasks.length} running tasks`);

    for (const task of runningTasks) {
      await checkAndRecoverTask(task);
    }

    console.log("[BabysitLoop] Check complete");
  } catch (err) {
    console.error("[BabysitLoop] Check failed:", err);
  }
}

/**
 * Check and recover a single task.
 */
async function checkAndRecoverTask(task: ActiveTask): Promise<void> {
  const { id, tmuxSession, retryCount } = task;

  // Skip if max retries reached
  if (retryCount >= currentConfig.maxRetriesPerTask) {
    console.log(`[BabysitLoop] Task ${id} reached max retries, giving up`);
    await updateTask(id, {
      status: "failed",
      error: `Max retries (${currentConfig.maxRetriesPerTask}) exceeded`,
    });
    return;
  }

  // Check if tmux session exists
  if (!tmuxSession) {
    console.log(`[BabysitLoop] Task ${id} has no tmux session, skipping`);
    return;
  }

  const sessionExists = await isSessionAlive(tmuxSession);

  if (sessionExists) {
    // Session is alive, check if it's making progress
    const isStuck = await checkIfTaskStuck(task);
    if (isStuck) {
      console.log(`[BabysitLoop] Task ${id} appears stuck, may need intervention`);
      // For now, just log - could implement forced recovery
    }
    return;
  }

  // Session is dead, attempt recovery
  console.log(`[BabysitLoop] Task ${id} tmux session not found, analyzing failure`);

  await recoverFailedTask(task);
}

/**
 * Check if a task is stuck (session exists but no progress).
 */
async function checkIfTaskStuck(task: ActiveTask): Promise<boolean> {
  // This is a placeholder - a real implementation would:
  // 1. Check last activity timestamp in the tmux session
  // 2. Check if the agent process is still running
  // 3. Check for error patterns in the session output

  // For now, return false (assume not stuck)
  return false;
}

/**
 * Recover a failed task.
 */
async function recoverFailedTask(task: ActiveTask): Promise<void> {
  const { id, description, retryCount } = task;

  // Analyze the failure
  const failure = await analyzeFailure(task);
  console.log(`[BabysitLoop] Failure analysis:`, failure);

  // Select retry strategy
  const strategy = selectRetryStrategy(failure);
  console.log(`[BabysitLoop] Retry strategy:`, strategy);

  // Update task with retry count
  await updateTask(id, {
    retryCount: retryCount + 1,
  });

  // Wait before retry
  await sleep(currentConfig.retryDelayMs);

  // Build new prompt with context and failure info
  const context = await loadContext();
  const contextualPrompt = await buildContextualPrompt(
    `${description}\n\nPrevious attempt failed. Reason: ${failure.reason}`,
    context,
  );

  // Respawn the agent
  await respawnAgent(task, contextualPrompt);
}

/**
 * Respawn an agent with a new prompt.
 */
async function respawnAgent(
  task: ActiveTask,
  prompt: { systemPrompt: string; userPrompt: string },
): Promise<void> {
  // This would integrate with the agent spawning system
  // For now, we'll create a new task that references the old one

  const { createTask } = await import("./task-registry.js");
  const { spawnAgentInWorktree } = await import("./git-worktree.js");

  const newTask = await createTask({
    agent: task.agent,
    description: `Retry of ${task.id}: ${task.description}`,
    repo: task.repo,
    spawnedBy: task.id,
    notifyOnComplete: task.notifyOnComplete,
    retryCount: task.retryCount + 1,
    maxRetries: task.maxRetries,
    status: "pending",
  });

  console.log(`[BabysitLoop] Created retry task ${newTask.id}`);

  // Actually spawn the agent
  try {
    await spawnAgentInWorktree(
      newTask,
      task.repo,
      {
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
      },
    );

    console.log(`[BabysitLoop] Successfully respawned agent for task ${newTask.id}`);
  } catch (err) {
    console.error(`[BabysitLoop] Failed to respawn agent:`, err);
    await updateTask(newTask.id, {
      status: "failed",
      error: `Failed to respawn: ${err}`,
    });
  }
}

/**
 * Manually trigger a retry for a specific task.
 */
export async function retryTask(taskId: string): Promise<boolean> {
  const task = await getTask(taskId);

  if (!task) {
    console.error(`[BabysitLoop] Task ${taskId} not found`);
    return false;
  }

  if (task.status === "running") {
    console.error(`[BabysitLoop] Task ${taskId} is still running`);
    return false;
  }

  if (task.retryCount >= currentConfig.maxRetriesPerTask) {
    console.error(`[BabysitLoop] Task ${taskId} reached max retries`);
    return false;
  }

  console.log(`[BabysitLoop] Manual retry for task ${taskId}`);

  await updateTask(taskId, {
    status: "pending",
    retryCount: task.retryCount + 1,
  });

  await recoverFailedTask(task);

  return true;
}

/**
 * Get list of tasks that might need attention.
 */
export async function getTasksNeedingAttention(): Promise<
  Array<{
    task: ActiveTask;
    reason: string;
    suggestion: string;
  }>
> {
  const tasks = await listTasks();
  const attentionNeeded: Array<{
    task: ActiveTask;
    reason: string;
    suggestion: string;
  }> = [];

  for (const task of tasks) {
    // Tasks that failed
    if (task.status === "failed") {
      if (task.retryCount < currentConfig.maxRetriesPerTask) {
        attentionNeeded.push({
          task,
          reason: "Task failed",
          suggestion: "Can be auto-retried with /retry",
        });
      } else {
        attentionNeeded.push({
          task,
          reason: "Task failed (max retries)",
          suggestion: "Manual intervention needed",
        });
      }
    }

    // Tasks that have been running too long
    if (task.status === "running") {
      const runningTime = Date.now() - task.startedAt;
      const hours = runningTime / (1000 * 60 * 60);

      if (hours > 4) {
        attentionNeeded.push({
          task,
          reason: `Running for ${hours.toFixed(1)} hours`,
          suggestion: "Check if stuck",
        });
      }
    }
  }

  return attentionNeeded;
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
