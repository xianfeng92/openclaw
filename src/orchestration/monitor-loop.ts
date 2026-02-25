/**
 * Monitoring loop for tracking running agent tasks.
 */

import { checkDoD, isDoDPassed } from "./dod-checker.js";
import {
  createTask,
  getTask,
  listTasks,
  updateTask,
  updateTaskStatus,
} from "./task-registry.js";
import { isSessionAlive, listSessions } from "./tmux-manager.js";
import type { ActiveTask } from "./types.js";

const MONITOR_INTERVAL_MS = 5_000; // Check every 5 seconds

export interface MonitorOptions {
  onTaskCompleted?: (task: ActiveTask) => void;
  onTaskFailed?: (task: ActiveTask) => void;
  onTaskTimeout?: (task: ActiveTask) => void;
  taskTimeoutMs?: number;
}

export class MonitorLoop {
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;
  private options: Required<MonitorOptions>;

  constructor(options: MonitorOptions = {}) {
    this.options = {
      onTaskCompleted: options.onTaskCompleted ?? (() => {}),
      onTaskFailed: options.onTaskFailed ?? (() => {}),
      onTaskTimeout: options.onTaskTimeout ?? (() => {}),
      taskTimeoutMs: options.taskTimeoutMs ?? 3_600_000, // 1 hour default
    };
  }

  /**
   * Start the monitoring loop.
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.intervalId = setInterval(() => {
      void this.checkAllTasks();
    }, MONITOR_INTERVAL_MS);
  }

  /**
   * Stop the monitoring loop.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
  }

  /**
   * Check the status of all running tasks.
   */
  async checkAllTasks(): Promise<void> {
    const tasks = await listTasks();
    const runningTasks = tasks.filter((t) => t.status === "running");

    for (const task of runningTasks) {
      await this.checkTask(task);
    }
  }

  /**
   * Check the status of a single task.
   */
  async checkTask(task: ActiveTask): Promise<void> {
    const now = Date.now();
    const elapsed = now - task.startedAt;

    // Check for timeout
    if (elapsed > this.options.taskTimeoutMs) {
      await this.handleTimeout(task);
      return;
    }

    // Check if tmux session is still alive
    if (task.tmuxSession) {
      const isAlive = await isSessionAlive(task.tmuxSession);

      if (!isAlive) {
        // Session died, mark task as failed
        await this.handleSessionDied(task);
        return;
      }
    }

    // TODO: Check for completion signals from the agent
    // This would involve checking for a completion marker file
    // or receiving an event from the agent process
  }

  /**
   * Handle a task that has timed out.
   */
  private async handleTimeout(task: ActiveTask): Promise<void> {
    await updateTaskStatus(task.id, "failed", "Task timed out");
    this.options.onTaskTimeout(task);
  }

  /**
   * Handle a task whose session has died.
   */
  private async handleSessionDied(task: ActiveTask): Promise<void> {
    await updateTaskStatus(task.id, "failed", "Agent session terminated unexpectedly");
    this.options.onTaskFailed(task);
  }

  /**
   * Handle a task that has completed successfully.
   */
  private async handleTaskCompleted(task: ActiveTask): Promise<void> {
    // Run DoD checks
    const checks = await checkDoD(task);
    const updatedTask = await updateTask(task.id, {
      status: "completed",
      completedAt: Date.now(),
      checks,
    });

    if (updatedTask) {
      this.options.onTaskCompleted(updatedTask);
    }
  }

  /**
   * Handle a task that has failed.
   */
  private async handleTaskFailed(task: ActiveTask, error: string): Promise<void> {
    await updateTaskStatus(task.id, "failed", error);
    this.options.onTaskFailed(task);
  }

  /**
   * Get the list of active tmux sessions managed by the monitor.
   */
  async getActiveSessions(): Promise<string[]> {
    return listSessions();
  }
}

// Global monitor instance
let globalMonitor: MonitorLoop | null = null;

/**
 * Get or create the global monitor instance.
 */
export function getGlobalMonitor(options?: MonitorOptions): MonitorLoop {
  if (!globalMonitor) {
    globalMonitor = new MonitorLoop(options);
  }
  return globalMonitor;
}

/**
 * Start the global monitor.
 */
export function startGlobalMonitor(options?: MonitorOptions): MonitorLoop {
  const monitor = getGlobalMonitor(options);
  monitor.start();
  return monitor;
}

/**
 * Stop the global monitor.
 */
export function stopGlobalMonitor(): void {
  if (globalMonitor) {
    globalMonitor.stop();
  }
}

/**
 * Reset the global monitor (for testing).
 */
export function resetGlobalMonitor(): void {
  stopGlobalMonitor();
  globalMonitor = null;
}
