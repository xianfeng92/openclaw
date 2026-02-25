/**
 * Utility functions for the OpenClaw Agent Orchestration System.
 */

import type { TaskFilterOptions, TaskStatus } from "./types.js";

let taskCounter = 0;

export function generateTaskId(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  taskCounter = (taskCounter + 1) % 1000;
  const nnn = String(taskCounter).padStart(3, "0");
  return `task-${yyyy}${mm}${dd}-${nnn}`;
}

export function deriveBranchName(description: string): string {
  // Clean and normalize the description to create a branch name
  const cleaned = description
    .toLowerCase()
    // Replace non-alphanumeric with hyphens
    .replace(/[^a-z0-9]+/g, "-")
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, "")
    // Limit length
    .slice(0, 50);

  // Add a short random suffix for uniqueness
  const suffix = Math.random().toString(36).slice(2, 6);
  return cleaned ? `${cleaned}-${suffix}` : `branch-${suffix}`;
}

export function formatAge(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function parseTaskFilters(args: string): TaskFilterOptions {
  const filters: TaskFilterOptions = {};
  const parts = args.split(/\s+/);

  for (const part of parts) {
    if (part.startsWith("--status=")) {
      const status = part.slice(9) as TaskStatus;
      if (["pending", "running", "completed", "failed", "blocked"].includes(status)) {
        filters.status = status;
      }
    } else if (part.startsWith("--agent=")) {
      const agent = part.slice(8);
      if (["claude", "codex", "gemini"].includes(agent)) {
        filters.agent = agent as "claude" | "codex" | "gemini";
      }
    } else if (part.startsWith("--limit=")) {
      const limit = Number.parseInt(part.slice(8), 10);
      if (Number.isFinite(limit) && limit > 0) {
        filters.limit = limit;
      }
    }
  }

  return filters;
}

export function tmuxSessionName(taskId: string): string {
  return `claw-${taskId}`;
}

export function worktreeDirForTask(taskId: string, repoPath: string): string {
  // Create worktree in .openclaw/worktrees/{taskId} under the repo
  return `${repoPath}/.openclaw/worktrees/${taskId}`;
}
