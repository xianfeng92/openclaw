/**
 * Type definitions for the OpenClaw Agent Orchestration System.
 */

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "blocked";

export type AgentType = "claude" | "codex" | "gemini";

// Re-export context types for convenience
export type {
  BusinessContext,
  Customer,
  Decision,
  Meeting,
  ObsidianConfig,
  Pattern,
  Project,
} from "./context-schema.js";
export type {
  ContextInjectionOptions,
  ContextualPrompt,
  ContextSearchResult,
} from "./context-schema.js";

export interface DoDChecks {
  prCreated: boolean;
  branchSynced: boolean;
  ciPassed: boolean;
  screenshotsIncluded?: boolean;
  codexReviewPassed?: boolean;
  claudeReviewPassed?: boolean;
  geminiReviewPassed?: boolean;
}

export interface ActiveTask {
  id: string; // Unique task ID (format: task-YYYYMMDD-NNN)
  tmuxSession?: string; // tmux session name (claw-{id})
  agent: AgentType;
  description: string;
  repo: string;
  worktree?: string; // git worktree path
  branch?: string; // git branch name
  startedAt: number; // Start timestamp
  status: TaskStatus;
  spawnedBy?: string; // Parent task/session key
  notifyOnComplete: boolean;
  retryCount: number;
  maxRetries: number;

  // Completion fields
  pr?: number;
  completedAt?: number;
  checks?: DoDChecks;
  error?: string;
}

export interface TaskRegistryData {
  version: number;
  lastUpdated: number;
  tasks: ActiveTask[];
}

export interface TmuxSessionOptions {
  name: string;
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface WorktreeOptions {
  repoPath: string;
  branch: string;
  worktreeDir: string;
}

export interface TaskFilterOptions {
  status?: TaskStatus;
  agent?: AgentType;
  limit?: number;
}
