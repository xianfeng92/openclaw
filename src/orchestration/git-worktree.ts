/**
 * Git worktree management for isolated task environments.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runCommandWithTimeout, resolveCommand } from "../process/exec.js";
import type { WorktreeOptions } from "./types.js";

const DEFAULT_TIMEOUT = 60_000;

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "unknown";

/**
 * Detect the package manager used in a directory.
 */
export async function detectPackageManager(dir: string): Promise<PackageManager> {
  const checkFiles = [
    { file: "package-lock.json", manager: "npm" as const },
    { file: "pnpm-lock.yaml", manager: "pnpm" as const },
    { file: "yarn.lock", manager: "yarn" as const },
    { file: "bun.lockb", manager: "bun" as const },
  ];

  for (const { file, manager } of checkFiles) {
    const filePath = path.join(dir, file);
    try {
      await fs.promises.access(filePath);
      return manager;
    } catch {
      // File doesn't exist, continue
    }
  }

  // Fallback: check for package.json and default to npm
  try {
    await fs.promises.access(path.join(dir, "package.json"));
    return "npm";
  } catch {
    return "unknown";
  }
}

/**
 * Get the install command for a package manager.
 */
function managerInstallArgs(manager: PackageManager): string[] {
  switch (manager) {
    case "npm":
      return ["npm", "install"];
    case "pnpm":
      return ["pnpm", "install"];
    case "yarn":
      return ["yarn", "install"];
    case "bun":
      return ["bun", "install"];
    default:
      return ["npm", "install"];
  }
}

/**
 * Create a git worktree for a task.
 */
export async function createWorktree(opts: WorktreeOptions): Promise<{
  success: boolean;
  path?: string;
  error?: string;
}> {
  const { repoPath, branch, worktreeDir } = opts;

  try {
    // Verify repo is a git repository
    const gitResult = await runCommandWithTimeout(
      [resolveCommand("git"), "-C", repoPath, "rev-parse", "--git-dir"],
      DEFAULT_TIMEOUT,
    );
    if (gitResult.code !== 0) {
      return { success: false, error: "Not a git repository" };
    }

    // Create parent directory for worktree
    await fs.promises.mkdir(path.dirname(worktreeDir), { recursive: true });

    // Create the worktree
    const worktreeResult = await runCommandWithTimeout(
      [resolveCommand("git"), "-C", repoPath, "worktree", "add", "-b", branch, worktreeDir],
      { timeoutMs: DEFAULT_TIMEOUT, cwd: repoPath },
    );

    if (worktreeResult.code !== 0) {
      return {
        success: false,
        error: `Failed to create worktree: ${worktreeResult.stderr}`,
      };
    }

    // Install dependencies if package.json exists
    const packageJsonPath = path.join(worktreeDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const manager = await detectPackageManager(worktreeDir);
      const installArgs = managerInstallArgs(manager);

      const installResult = await runCommandWithTimeout(
        installArgs,
        { timeoutMs: 300_000, cwd: worktreeDir },
      );

      if (installResult.code !== 0) {
        // Clean up worktree on install failure
        await removeWorktree(worktreeDir, repoPath);
        return {
          success: false,
          error: `Failed to install dependencies: ${installResult.stderr}`,
        };
      }
    }

    return { success: true, path: worktreeDir };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Remove a git worktree.
 */
export async function removeWorktree(
  worktreeDir: string,
  repoPath?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // First, remove the worktree from git's registry
    if (repoPath) {
      await runCommandWithTimeout(
        [resolveCommand("git"), "-C", repoPath, "worktree", "remove", "--force", worktreeDir],
        DEFAULT_TIMEOUT,
      ).catch(() => {
        // Ignore errors, continue with directory removal
      });

      // Prune worktree list
      await runCommandWithTimeout(
        [resolveCommand("git"), "-C", repoPath, "worktree", "prune"],
        DEFAULT_TIMEOUT,
      ).catch(() => {
        // Ignore errors
      });
    }

    // Remove the directory
    if (fs.existsSync(worktreeDir)) {
      await fs.promises.rm(worktreeDir, { recursive: true, force: true });
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * List all git worktrees for a repository.
 */
export async function listWorktrees(repoPath: string): Promise<string[]> {
  try {
    const result = await runCommandWithTimeout(
      [resolveCommand("git"), "-C", repoPath, "worktree", "list", "--porcelain"],
      DEFAULT_TIMEOUT,
    );

    if (result.code !== 0) {
      return [];
    }

    // Parse output: each worktree starts with "worktree <path>"
    return result.stdout
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice(9)); // Remove "worktree " prefix
  } catch {
    return [];
  }
}

/**
 * Get the current branch name of a worktree.
 */
export async function getWorktreeBranch(worktreeDir: string): Promise<string | null> {
  try {
    const result = await runCommandWithTimeout(
      [resolveCommand("git"), "-C", worktreeDir, "branch", "--show-current"],
      DEFAULT_TIMEOUT,
    );

    if (result.code === 0) {
      return result.stdout.trim();
    }
    return null;
  } catch {
    return null;
  }
}
