/**
 * Retry strategy for failed agents.
 * Analyzes failures and determines the best approach for retry.
 */

import * as fs from "node:fs";
import { runCommandWithTimeout, resolveCommand } from "../process/exec.js";
import type { ActiveTask } from "./types.js";

/**
 * A failure analysis result.
 */
export interface FailureAnalysis {
  reason: string;
  category: FailureCategory;
  canRetry: boolean;
  suggestedAction: RetryAction;
  context?: string;
}

/**
 * Categories of failures.
 */
export type FailureCategory =
  | "timeout"
  | "api_error"
  | "permission"
  | "dependency"
  | "logic"
  | "network"
  | "unknown";

/**
 * Suggested retry actions.
 */
export type RetryAction =
  | "retry_same"
  | "retry_with_context"
  | "retry_different_agent"
  | "manual_intervention"
  | "give_up";

/**
 * Analyze a failed task to determine the failure reason.
 */
export async function analyzeFailure(task: ActiveTask): Promise<FailureAnalysis> {
  // Check tmux session logs if available
  if (task.tmuxSession) {
    const logs = await getTmuxSessionLogs(task.tmuxSession);
    if (logs) {
      return analyzeFromLogs(task, logs);
    }
  }

  // Check error message in task
  if (task.error) {
    return analyzeFromErrorMessage(task.error);
  }

  // Default: unknown failure
  return {
    reason: "Unknown failure - no logs or error message available",
    category: "unknown",
    canRetry: true,
    suggestedAction: "retry_with_context",
  };
}

/**
 * Get logs from a tmux session.
 */
async function getTmuxSessionLogs(sessionName: string): Promise<string | null> {
  try {
    const result = await runCommandWithTimeout(
      [resolveCommand("tmux"), "capture-pane", "-t", sessionName, "-p", "-S", "-1000"],
      10_000,
    );

    if (result.code === 0) {
      return result.stdout;
    }
  } catch (err) {
    console.error("[RetryStrategy] Failed to get tmux logs:", err);
  }

  return null;
}

/**
 * Analyze failure from tmux logs.
 */
function analyzeFromLogs(task: ActiveTask, logs: string): FailureAnalysis {
  const lowerLogs = logs.toLowerCase();

  // Check for API errors
  if (
    lowerLogs.includes("rate limit") ||
    lowerLogs.includes("quota exceeded") ||
    lowerLogs.includes("429")
  ) {
    return {
      reason: "API rate limit exceeded",
      category: "api_error",
      canRetry: true,
      suggestedAction: "retry_same",
      context: "Wait before retry to let rate limit reset",
    };
  }

  if (
    lowerLogs.includes("unauthorized") ||
    lowerLogs.includes("401") ||
    lowerLogs.includes("invalid api key")
  ) {
    return {
      reason: "Authentication failed - invalid API key",
      category: "api_error",
      canRetry: false,
      suggestedAction: "manual_intervention",
      context: "Check API key configuration",
    };
  }

  if (
    lowerLogs.includes("timeout") ||
    lowerLogs.includes("timed out") ||
    lowerLogs.includes("etimedout")
  ) {
    return {
      reason: "Request timeout",
      category: "timeout",
      canRetry: true,
      suggestedAction: "retry_same",
      context: "Network or API timeout, may resolve on retry",
    };
  }

  // Check for permission errors
  if (
    lowerLogs.includes("permission denied") ||
    lowerLogs.includes("eacces") ||
    lowerLogs.includes("403")
  ) {
    return {
      reason: "Permission denied",
      category: "permission",
      canRetry: false,
      suggestedAction: "manual_intervention",
      context: "Check file/directory permissions",
    };
  }

  // Check for dependency issues
  if (
    lowerLogs.includes("cannot find module") ||
    lowerLogs.includes("module not found") ||
    lowerLogs.includes("dependency")
  ) {
    return {
      reason: "Missing dependency",
      category: "dependency",
      canRetry: true,
      suggestedAction: "retry_with_context",
      context: "Install missing dependencies before retry",
    };
  }

  // Check for network errors
  if (
    lowerLogs.includes("network") ||
    lowerLogs.includes("connection") ||
    lowerLogs.includes("enotfound")
  ) {
    return {
      reason: "Network error",
      category: "network",
      canRetry: true,
      suggestedAction: "retry_same",
      context: "Network issue, may resolve on retry",
    };
  }

  // Check for crash/panic
  if (
    lowerLogs.includes("segmentation fault") ||
    lowerLogs.includes("panic") ||
    lowerLogs.includes("fatal error")
  ) {
    return {
      reason: "Process crashed",
      category: "unknown",
      canRetry: true,
      suggestedAction: "retry_different_agent",
      context: "Try a different approach or agent",
    };
  }

  // Check if the agent gave up
  if (
    lowerLogs.includes("i cannot") ||
    lowerLogs.includes("unable to") ||
    lowerLogs.includes("i don't know") ||
    lowerLogs.includes("i'm sorry")
  ) {
    return {
      reason: "Agent gave up - task too complex or unclear",
      category: "logic",
      canRetry: true,
      suggestedAction: "retry_with_context",
      context: "Add more context or break down task further",
    };
  }

  // Default: unknown
  return {
    reason: "Unknown failure pattern in logs",
    category: "unknown",
    canRetry: true,
    suggestedAction: "retry_with_context",
    context: logs.slice(-500), // Last 500 chars
  };
}

/**
 * Analyze failure from error message.
 */
function analyzeFromErrorMessage(error: string): FailureAnalysis {
  const lowerError = error.toLowerCase();

  if (lowerError.includes("rate limit") || lowerError.includes("quota")) {
    return {
      reason: "API rate limit exceeded",
      category: "api_error",
      canRetry: true,
      suggestedAction: "retry_same",
    };
  }

  if (lowerError.includes("timeout")) {
    return {
      reason: "Request timeout",
      category: "timeout",
      canRetry: true,
      suggestedAction: "retry_same",
    };
  }

  if (lowerError.includes("permission") || lowerError.includes("unauthorized")) {
    return {
      reason: "Permission/authentication error",
      category: "permission",
      canRetry: false,
      suggestedAction: "manual_intervention",
    };
  }

  return {
    reason: error.slice(0, 200),
    category: "unknown",
    canRetry: true,
    suggestedAction: "retry_with_context",
  };
}

/**
 * Select retry strategy based on failure analysis.
 */
export function selectRetryStrategy(
  analysis: FailureAnalysis,
): RetryAction {
  return analysis.suggestedAction;
}

/**
 * Determine if a different agent should be used for retry.
 */
export function selectAlternativeAgent(
  currentAgent: ActiveTask["agent"],
  analysis: FailureAnalysis,
): ActiveTask["agent"] | null {
  // If the issue is agent-specific (e.g., Claude-specific API issues)
  if (analysis.category === "api_error") {
    switch (currentAgent) {
      case "claude":
        return "codex";
      case "codex":
        return "gemini";
      case "gemini":
        return "claude";
    }
  }

  return null;
}

/**
 * Build an improved prompt for retry based on failure.
 */
export function buildRetryPrompt(
  originalDescription: string,
  analysis: FailureAnalysis,
  retryCount: number,
): string {
  const parts: string[] = [];

  parts.push(`This is retry attempt #${retryCount + 1}.`);

  parts.push(`Previous attempt failed: ${analysis.reason}`);

  if (analysis.context) {
    parts.push(`Additional context: ${analysis.context}`);
  }

  // Add specific guidance based on failure category
  switch (analysis.category) {
    case "logic":
      parts.push("The task was unclear or too complex. Please break it down into smaller steps.");
      break;
    case "timeout":
      parts.push("Consider breaking the task into smaller parts to avoid timeouts.");
      break;
    case "dependency":
      parts.push("Make sure to check for and install any required dependencies.");
      break;
  }

  parts.push("");
  parts.push("Original task:");
  parts.push(originalDescription);

  return parts.join("\n");
}

/**
 * Estimate delay before retry based on failure type.
 */
export function getRetryDelay(analysis: FailureAnalysis, retryCount: number): number {
  const baseDelay = 30_000; // 30 seconds

  // Exponential backoff
  const exponentialDelay = baseDelay * Math.pow(2, retryCount);

  // Cap at 5 minutes
  const maxDelay = 5 * 60 * 1000;

  switch (analysis.category) {
    case "api_error":
      if (analysis.reason.includes("rate limit")) {
        // Longer delay for rate limits
        return Math.min(exponentialDelay * 3, maxDelay);
      }
      return exponentialDelay;
    case "timeout":
      return Math.min(exponentialDelay, maxDelay);
    case "network":
      return exponentialDelay;
    default:
      return baseDelay;
  }
}

/**
 * Format failure analysis for display.
 */
export function formatFailureAnalysis(analysis: FailureAnalysis): string[] {
  const lines: string[] = [];

  lines.push(`Reason: ${analysis.reason}`);
  lines.push(`Category: ${analysis.category}`);
  lines.push(`Can Retry: ${analysis.canRetry ? "Yes" : "No"}`);
  lines.push(`Suggested Action: ${analysis.suggestedAction}`);

  if (analysis.context) {
    lines.push(`Context: ${analysis.context.slice(0, 200)}`);
  }

  return lines;
}
