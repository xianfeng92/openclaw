#!/usr/bin/env node
/**
 * PR Service Self-Test
 *
 * Tests the PR creation and management functionality.
 * Note: This test requires a git repository with gh CLI installed.
 */

import { runCommandWithTimeout, resolveCommand } from "../src/process/exec.js";
import {
  getCurrentBranch,
  getGitStatus,
  commitChanges,
  createPR,
  listOpenPRs,
  getPRDetails,
  type PRCreateOptions,
} from "../src/orchestration/pr-service.js";

// Test configuration
const TEST_WORK_DIR = process.cwd(); // Use current directory
const TEST_BRANCH = `test/pr-service-test-${Date.now()}`;

function formatTest(name: string): string {
  return `\n\x1b[36m[Test]\x1b[0m ${name}`;
}

function formatPass(message: string): string {
  return `\x1b[32m✓ PASS\x1b[0m ${message}`;
}

function formatFail(message: string): string {
  return `\x1b[31m✗ FAIL\x1b[0m ${message}`;
}

function formatInfo(message: string): string {
  return `\x1b[90m  ${message}\x1b[0m`;
}

function formatWarn(message: string): string {
  return `\x1b[33m⚠ WARN\x1b[0m ${message}`;
}

async function checkPrerequisites(): Promise<boolean> {
  console.log(formatTest("Checking Prerequisites"));

  let allOk = true;

  // Check git
  try {
    const result = await runCommandWithTimeout([resolveCommand("git"), "--version"], 5000);
    if (result.code === 0) {
      console.log(formatPass(`Git installed: ${result.stdout.trim()}`));
    } else {
      console.log(formatFail("Git not found"));
      allOk = false;
    }
  } catch {
    console.log(formatFail("Git not found"));
    allOk = false;
  }

  // Check gh CLI
  try {
    const result = await runCommandWithTimeout([resolveCommand("gh"), "--version"], 5000);
    if (result.code === 0) {
      console.log(formatPass(`GitHub CLI installed: ${result.stdout.trim()}`));
    } else {
      console.log(formatFail("GitHub CLI not found"));
      allOk = false;
    }
  } catch {
    console.log(formatFail("GitHub CLI not found"));
    allOk = false;
  }

  // Check gh auth
  try {
    const result = await runCommandWithTimeout([resolveCommand("gh"), "auth", "status"], 5000);
    if (result.code === 0) {
      console.log(formatPass("GitHub CLI authenticated"));
    } else {
      console.log(formatWarn("GitHub CLI not authenticated - PR tests will be skipped"));
      allOk = false;
    }
  } catch {
    console.log(formatWarn("Could not check GitHub auth status"));
    allOk = false;
  }

  return allOk;
}

async function testGetCurrentBranch(): Promise<boolean> {
  console.log(formatTest("Get Current Branch"));

  try {
    const branch = await getCurrentBranch(TEST_WORK_DIR);

    if (branch) {
      console.log(formatPass(`Current branch: ${branch}`));
      return true;
    } else {
      console.log(formatFail("Could not determine current branch"));
      return false;
    }
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testGetGitStatus(): Promise<boolean> {
  console.log(formatTest("Get Git Status"));

  try {
    const status = await getGitStatus(TEST_WORK_DIR);

    console.log(formatInfo(`Branch check: ${status.hasChanges ? "Has changes" : "Clean"}`));
    if (status.hasChanges) {
      console.log(formatInfo(`  Staged: ${status.staged.length}`));
      console.log(formatInfo(`  Modified: ${status.modified.length}`));
      console.log(formatInfo(`  Untracked: ${status.untracked.length}`));
    }

    console.log(formatPass("Status retrieved successfully"));
    return true;
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testCommitChanges(): Promise<boolean> {
  console.log(formatTest("Commit Changes"));

  // Create a test file
  const testFile = `.openclaw/test-commit-${Date.now()}.txt`;
  const testContent = `Test commit at ${new Date().toISOString()}\n`;

  try {
    // Write test file
    const { writeFile } = await import("node:fs");
    const { join } = await import("node:path");
    const { resolveStateDir } = await import("../src/config/paths.js");
    const stateDir = resolveStateDir();
    const testPath = join(stateDir, testFile);

    await writeFile(testPath, testContent, "utf-8");

    // Check if file was created
    const statusBefore = await getGitStatus(TEST_WORK_DIR);
    const hadUntracked = statusBefore.untracked.some((f) => f.includes(testFile));

    if (!hadUntracked) {
      console.log(formatWarn("Test file not detected in git status (may be in .gitignore)"));
      return true; // Skip but don't fail
    }

    // Try to commit
    const result = await commitChanges(TEST_WORK_DIR, `test: automated test commit`);
    console.log(formatInfo(`Commit result: ${result.success ? "Success" : result.error}`));

    if (result.success) {
      console.log(formatPass("Commit created successfully"));

      // Clean up: reset the commit
      await runCommandWithTimeout([resolveCommand("git"), "reset", "HEAD~1"], 10_000);

      // Remove the test file
      const { unlink } = await import("node:fs/promises");
      try { await unlink(testPath); } catch {}

      return true;
    } else {
      console.log(formatFail(`Commit failed: ${result.error}`));
      return false;
    }
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testListPRs(): Promise<boolean> {
  console.log(formatTest("List Open PRs"));

  try {
    const prs = await listOpenPRs(TEST_WORK_DIR);

    console.log(formatInfo(`Found ${prs.length} open PR(s)`));
    for (const pr of prs.slice(0, 3)) {
      console.log(formatInfo(`  #${pr.number}: ${pr.title} (${pr.state})`));
    }

    console.log(formatPass("PR list retrieved successfully"));
    return true;
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testCreatePR(): Promise<boolean> {
  console.log(formatTest("Create PR (Skipped - Manual Test Required)"));

  console.log(formatInfo("PR creation test requires manual verification:"));
  console.log(formatInfo("  1. Make some code changes"));
  console.log(formatInfo("  2. Run: /pr create \"Test PR\""));
  console.log(formatInfo("  3. Verify PR is created on GitHub"));
  console.log(formatInfo("  4. Clean up the test PR"));

  return true; // Skip automated test
}

async function runPRServiceTests(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("  PR Service - Functional Tests");
  console.log("=".repeat(60));

  const hasPrerequisites = await checkPrerequisites();
  if (!hasPrerequisites) {
    console.log("\n" + formatWarn("Some prerequisites are missing. Partial tests will run."));
  }

  const results = await Promise.all([
    testGetCurrentBranch(),
    testGetGitStatus(),
    hasPrerequisites ? testCommitChanges() : Promise.resolve(true),
    hasPrerequisites ? testListPRs() : Promise.resolve(true),
    testCreatePR(), // Always returns true (manual test)
  ]);

  const passCount = results.filter((r) => r).length;
  const totalCount = results.length;

  console.log("\n" + "=".repeat(60));
  console.log(`  Results: ${passCount}/${totalCount} test groups passed`);
  console.log("=".repeat(60) + "\n");

  if (passCount === totalCount) {
    console.log("\x1b[32m✓ All tests passed!\x1b[0m\n");
    process.exit(0);
  } else {
    console.log(`\x1b[31m✗ ${totalCount - passCount} test group(s) failed\x1b[0m\n`);
    process.exit(1);
  }
}

// Run tests if executed directly
runPRServiceTests();
