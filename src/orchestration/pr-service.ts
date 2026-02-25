/**
 * PR Service - Automates PR creation after agent work completion.
 * Integrates with git and GitHub CLI (gh) for PR management.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runCommandWithTimeout, resolveCommand } from "../process/exec.js";
import type { ActiveTask } from "./types.js";

/**
 * PR creation options.
 */
export interface PRCreateOptions {
  title: string;
  description: string;
  branch: string;
  baseBranch?: string; // default: main
  draft?: boolean;
  reviewers?: string[];
  labels?: string[];
  assignees?: string[];
}

/**
 * PR creation result.
 */
export interface PRCreateResult {
  success: boolean;
  prNumber?: number;
  prUrl?: string;
  error?: string;
}

/**
 * Get the current git branch.
 */
export async function getCurrentBranch(worktree: string): Promise<string | null> {
  try {
    const result = await runCommandWithTimeout(
      [resolveCommand("git"), "-C", worktree, "rev-parse", "--abbrev-ref", "HEAD"],
      10_000,
    );
    return result.code === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Get git status summary.
 */
export async function getGitStatus(worktree: string): Promise<{
  hasChanges: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
}> {
  try {
    const result = await runCommandWithTimeout(
      [resolveCommand("git"), "-C", worktree, "status", "--porcelain"],
      10_000,
    );

    if (result.code !== 0) {
      return { hasChanges: false, staged: [], modified: [], untracked: [] };
    }

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const line of result.stdout.trim().split("\n")) {
      if (!line) continue;
      const status = line.slice(0, 2);
      const filePath = line.slice(3);

      if (status.includes("M")) modified.push(filePath);
      if (status.includes("A")) staged.push(filePath);
      if (status === "??") untracked.push(filePath);
    }

    return {
      hasChanges: staged.length > 0 || modified.length > 0 || untracked.length > 0,
      staged,
      modified,
      untracked,
    };
  } catch {
    return { hasChanges: false, staged: [], modified: [], untracked: [] };
  }
}

/**
 * Stage all changes and commit.
 */
export async function commitChanges(
  worktree: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Stage all changes
    const addResult = await runCommandWithTimeout(
      [resolveCommand("git"), "-C", worktree, "add", "-A"],
      30_000,
    );

    if (addResult.code !== 0) {
      return { success: false, error: `git add failed: ${addResult.stderr}` };
    }

    // Commit
    const commitResult = await runCommandWithTimeout(
      [resolveCommand("git"), "-C", worktree, "commit", "-m", message],
      30_000,
    );

    if (commitResult.code !== 0) {
      return { success: false, error: `git commit failed: ${commitResult.stderr}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Create a GitHub PR using gh CLI.
 */
export async function createPR(
  worktree: string,
  options: PRCreateOptions,
): Promise<PRCreateResult> {
  try {
    const args = [
      "pr",
      "create",
      "--title",
      options.title,
      "--body",
      options.description,
      "--base",
      options.baseBranch || "main",
    ];

    if (options.draft) {
      args.push("--draft");
    }

    if (options.reviewers && options.reviewers.length > 0) {
      args.push("--reviewer", options.reviewers.join(","));
    }

    if (options.labels && options.labels.length > 0) {
      args.push("--label", options.labels.join(","));
    }

    if (options.assignees && options.assignees.length > 0) {
      args.push("--assignee", options.assignees.join(","));
    }

    const result = await runCommandWithTimeout(
      [resolveCommand("gh"), ...args],
      60_000,
      { cwd: worktree },
    );

    if (result.code !== 0) {
      return { success: false, error: `gh pr create failed: ${result.stderr}` };
    }

    // Parse PR URL from output
    const urlMatch = result.stdout.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/);
    const prUrl = urlMatch ? urlMatch[0] : undefined;
    const prNumber = prUrl ? parseInt(prUrl.split("/").pop() || "0", 10) : undefined;

    return { success: true, prNumber, prUrl };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Complete agent work and create PR.
 * This is the main workflow function.
 */
export async function completeAgentWorkAndCreatePR(
  task: ActiveTask,
  options: {
    prTitle?: string;
    prDescription?: string;
    baseBranch?: string;
    draft?: boolean;
    labels?: string[];
  } = {},
): Promise<PRCreateResult> {
  const { worktree, description, id } = task;

  if (!worktree) {
    return { success: false, error: "Task has no worktree" };
  }

  // Check if there are changes
  const status = await getGitStatus(worktree);
  if (!status.hasChanges) {
    return { success: false, error: "No changes to commit" };
  }

  // Commit changes
  const commitMessage = options.prTitle
    ? `${options.prTitle}\n\nTask: ${id}\n\n${description}`
    : `feat: ${description}\n\nTask: ${id}`;

  const commitResult = await commitChanges(worktree, commitMessage);
  if (!commitResult.success) {
    return { success: false, error: `Commit failed: ${commitResult.error}` };
  }

  // Push to remote
  try {
    const currentBranch = await getCurrentBranch(worktree);
    if (!currentBranch) {
      return { success: false, error: "Could not determine current branch" };
    }

    const pushResult = await runCommandWithTimeout(
      [resolveCommand("git"), "-C", worktree, "push", "-u", "origin", currentBranch],
      60_000,
    );

    if (pushResult.code !== 0) {
      return { success: false, error: `git push failed: ${pushResult.stderr}` };
    }
  } catch (err) {
    return { success: false, error: `Push failed: ${err}` };
  }

  // Create PR
  const prDescription = options.prDescription || buildPRDescription(task, status);
  const prResult = await createPR(worktree, {
    title: options.prTitle || description,
    description: prDescription,
    baseBranch: options.baseBranch,
    draft: options.draft,
    labels: options.labels,
  });

  return prResult;
}

/**
 * Build PR description from task and status.
 */
function buildPRDescription(task: ActiveTask, status: Awaited<ReturnType<typeof getGitStatus>>): string {
  const lines: string[] = [];

  lines.push(`## Summary`);
  lines.push(task.description);
  lines.push("");

  if (task.branch) {
    lines.push(`**Branch:** \`${task.branch}\``);
    lines.push("");
  }

  lines.push(`## Changes`);
  if (status.staged.length > 0) {
    lines.push(`### Added (${status.staged.length})`);
    for (const file of status.staged.slice(0, 10)) {
      lines.push(`  - \`${file}\``);
    }
    if (status.staged.length > 10) {
      lines.push(`  - ... and ${status.staged.length - 10} more`);
    }
    lines.push("");
  }

  if (status.modified.length > 0) {
    lines.push(`### Modified (${status.modified.length})`);
    for (const file of status.modified.slice(0, 10)) {
      lines.push(`  - \`${file}\``);
    }
    if (status.modified.length > 10) {
      lines.push(`  - ... and ${status.modified.length - 10} more`);
    }
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`*Automatically created by OpenClaw Task #${task.id}*`);

  return lines.join("\n");
}

/**
 * List open PRs for the current repository.
 */
export async function listOpenPRs(worktree: string): Promise<Array<{
  number: number;
  title: string;
  url: string;
  state: string;
  author: string;
}>> {
  try {
    const result = await runCommandWithTimeout(
      [resolveCommand("gh"), "pr", "list", "--json", "number,title,url,state,author", "--limit", "20"],
      30_000,
      { cwd: worktree },
    );

    if (result.code !== 0) {
      return [];
    }

    const prs = JSON.parse(result.stdout);
    return prs.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      author: pr.author?.login || "unknown",
    }));
  } catch {
    return [];
  }
}

/**
 * Get PR details.
 */
export async function getPRDetails(worktree: string, prNumber: number): Promise<{
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  mergeable?: boolean;
} | null> {
  try {
    const result = await runCommandWithTimeout(
      [resolveCommand("gh"), "pr", "view", prNumber.toString(), "--json", "number,title,body,state,url,mergeable"],
      30_000,
      { cwd: worktree },
    );

    if (result.code !== 0) {
      return null;
    }

    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}
