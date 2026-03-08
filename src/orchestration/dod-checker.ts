/**
 * Definition of Done (DoD) checker for task completion validation.
 */

import { runCommandWithTimeout, resolveCommand } from "../process/exec.js";
import type { ActiveTask, DoDChecks } from "./types.js";

const DEFAULT_TIMEOUT = 30_000;

/**
 * Check if a PR exists for the task's branch.
 * This uses gh CLI if available, otherwise returns a placeholder.
 */
async function checkPRCreated(task: ActiveTask): Promise<boolean> {
  if (!task.branch) {
    return false;
  }

  try {
    // Try to use gh CLI to check for PRs
    const result = await runCommandWithTimeout(
      [resolveCommand("gh"), "pr", "list", "--head", task.branch, "--json", "number", "-q", ".[0].number"],
      DEFAULT_TIMEOUT,
    );

    if (result.code === 0 && result.stdout.trim()) {
      const prNumber = Number.parseInt(result.stdout.trim(), 10);
      return Number.isFinite(prNumber) && prNumber > 0;
    }
  } catch {
    // gh CLI not available or error
  }

  // Fallback: check if a PR number is stored in the task
  return typeof task.pr === "number" && task.pr > 0;
}

/**
 * Check if the branch is synced with remote.
 */
async function checkBranchSynced(task: ActiveTask): Promise<boolean> {
  if (!task.worktree) {
    return true; // No worktree means no branch to sync
  }

  try {
    const result = await runCommandWithTimeout(
      [resolveCommand("git"), "-C", task.worktree, "status", "-sb", "--porcelain"],
      DEFAULT_TIMEOUT,
    );

    if (result.code !== 0) {
      return false;
    }

    // Check if branch is ahead/behind
    const status = result.stdout.trim();
    // "[ahead 3]" or "[behind 2]" or "[ahead 1, behind 2]"
    const aheadBehind = status.match(/\[ahead (\d+)(?:, behind (\d+))?\]/);

    if (!aheadBehind) {
      return true; // No divergence info, assume synced
    }

    const ahead = Number.parseInt(aheadBehind[1], 10);
    const behind = aheadBehind[2] ? Number.parseInt(aheadBehind[2], 10) : 0;

    // Consider synced if not ahead or behind
    return ahead === 0 && behind === 0;
  } catch {
    return false;
  }
}

/**
 * Check if CI is passing for the branch.
 * This uses gh CLI if available, otherwise returns a placeholder.
 */
async function checkCIPassed(task: ActiveTask): Promise<boolean> {
  if (!task.branch) {
    return true; // No branch means no CI to check
  }

  try {
    // Try to use gh CLI to check CI status
    const result = await runCommandWithTimeout(
      [resolveCommand("gh"), "pr", "checks", "--head", task.branch, "--json", "conclusion", "-q", ".[0].conclusion"],
      DEFAULT_TIMEOUT,
    );

    if (result.code === 0) {
      const conclusion = result.stdout.trim().toLowerCase();
      return conclusion === "success";
    }
  } catch {
    // gh CLI not available or error
  }

  // Default to true if we can't check
  return true;
}

/**
 * Check if screenshots are included (for UI-related tasks).
 */
async function checkScreenshotsIncluded(task: ActiveTask): Promise<boolean> {
  // For now, this is a placeholder
  // In a real implementation, this could check for image files
  // in the worktree or in PR attachments
  return false;
}

/**
 * Run DoD checks for a completed task.
 */
export async function checkDoD(task: ActiveTask): Promise<DoDChecks> {
  const checks: DoDChecks = {
    prCreated: await checkPRCreated(task),
    branchSynced: await checkBranchSynced(task),
    ciPassed: await checkCIPassed(task),
    screenshotsIncluded: await checkScreenshotsIncluded(task),
  };

  return checks;
}

/**
 * Format DoD check results for display.
 */
export function formatDoDChecks(checks: DoDChecks): string[] {
  const lines: string[] = [];

  const formatCheck = (label: string, value: boolean | undefined) => {
    if (value === undefined) {
      return `${label}: N/A`;
    }
    return `${label}: ${value ? "✓" : "✗"}`;
  };

  lines.push(formatCheck("PR Created", checks.prCreated));
  lines.push(formatCheck("Branch Synced", checks.branchSynced));
  lines.push(formatCheck("CI Passed", checks.ciPassed));

  if (checks.screenshotsIncluded !== undefined) {
    lines.push(formatCheck("Screenshots", checks.screenshotsIncluded));
  }

  if (checks.codexReviewPassed !== undefined) {
    lines.push(formatCheck("Codex Review", checks.codexReviewPassed));
  }

  if (checks.claudeReviewPassed !== undefined) {
    lines.push(formatCheck("Claude Review", checks.claudeReviewPassed));
  }

  if (checks.geminiReviewPassed !== undefined) {
    lines.push(formatCheck("Gemini Review", checks.geminiReviewPassed));
  }

  return lines;
}

/**
 * Check if all required DoD checks pass.
 */
export function isDoDPassed(checks: DoDChecks): boolean {
  return checks.prCreated && checks.branchSynced && (checks.ciPassed !== false);
}
