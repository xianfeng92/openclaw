#!/usr/bin/env node
/**
 * Babysit Loop Agent Respawn Test
 *
 * Tests the agent respawn functionality when tasks fail.
 */

import {
  startBabysitLoop,
  stopBabysitLoop,
  getBabysitStatus,
  runBabysitCheck,
  retryTask,
} from "../src/orchestration/babysit-loop.js";
import { createTask, getTask, listTasks } from "../src/orchestration/task-registry.js";

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

async function testStartBabysitLoop(): Promise<boolean> {
  console.log(formatTest("Start Babysit Loop"));

  try {
    startBabysitLoop({
      intervalMs: 1000, // 1 second for testing (normally 10 minutes)
      maxRetriesPerTask: 3,
      retryDelayMs: 500, // Short delay for testing
      enabled: true,
    });

    const status = getBabysitStatus();
    if (status.running) {
      console.log(formatPass("Babysit loop started"));
      console.log(formatInfo(`Config: interval=${status.config.intervalMs}ms, maxRetries=${status.config.maxRetriesPerTask}`));
      return true;
    } else {
      console.log(formatFail("Babysit loop not running"));
      return false;
    }
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testStopBabysitLoop(): Promise<boolean> {
  console.log(formatTest("Stop Babysit Loop"));

  try {
    stopBabysitLoop();

    const status = getBabysitStatus();
    if (!status.running) {
      console.log(formatPass("Babysit loop stopped"));
      return true;
    } else {
      console.log(formatFail("Babysit loop still running"));
      return false;
    }
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testGetBabysitStatus(): Promise<boolean> {
  console.log(formatTest("Get Babysit Status"));

  try {
    const status = getBabysitStatus();

    console.log(formatInfo(`Running: ${status.running}`));
    console.log(formatInfo(`Interval: ${status.config.intervalMs}ms`));
    console.log(formatInfo(`Max retries: ${status.config.maxRetriesPerTask}`));

    console.log(formatPass("Babysit status retrieved"));
    return true;
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testCreateTask(): Promise<boolean> {
  console.log(formatTest("Create Test Task"));

  try {
    const task = await createTask({
      agent: "claude",
      description: `Test task for respawn ${Date.now()}`,
      repo: "/tmp/test-repo",
      status: "pending",
      spawnedBy: "babysit-test",
      retryCount: 0,
      maxRetries: 3,
    });

    console.log(formatInfo(`Created task: ${task.id}`));
    console.log(formatInfo(`Status: ${task.status}`));

    console.log(formatPass("Task created successfully"));
    return true;
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testRunBabysitCheck(): Promise<boolean> {
  console.log(formatTest("Run Babysit Check"));

  try {
    // Create a mock task
    const task = await createTask({
      agent: "claude",
      description: `Babysit check test ${Date.now()}`,
      repo: "/tmp/test-repo",
      status: "pending",
      spawnedBy: "test",
    });

    // Run the check (it should find the pending task)
    await runBabysitCheck();

    // Verify task still exists
    const retrieved = await getTask(task.id);
    if (retrieved) {
      console.log(formatInfo(`Task still exists: ${retrieved.id}`));
      console.log(formatPass("Babysit check completed"));
      return true;
    } else {
      console.log(formatFail("Task disappeared after check"));
      return false;
    }
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testRetryTask(): Promise<boolean> {
  console.log(formatTest("Retry Task"));

  try {
    // Create a failed task
    const task = await createTask({
      agent: "codex",
      description: `Failed task for retry ${Date.now()}`,
      repo: "/tmp/test-repo",
      status: "failed",
      spawnedBy: "test",
      retryCount: 0,
      maxRetries: 3,
      error: "Test failure",
    });

    console.log(formatInfo(`Created failed task: ${task.id}`));

    // Retry the task
    const result = await retryTask(task.id);

    if (result) {
      console.log(formatInfo(`Retry initiated`));
      console.log(formatPass("Task retry initiated"));
      return true;
    } else {
      console.log(formatFail("Task retry failed"));
      return false;
    }
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function runBabysitTests(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("  Babysit Loop - Functional Tests");
  console.log("=".repeat(60));

  // Test status and config
  const results = await Promise.all([
    testGetBabysitStatus(),
    testCreateTask(),
  ]);

  // Test starting/stopping
  const startResult = await testStartBabysitLoop();
  results.push(startResult);

  if (startResult) {
    results.push(await testStopBabysitLoop());
  }

  // Test check
  results.push(await testRunBabysitCheck());

  // Test retry
  results.push(await testRetryTask());

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

// Run tests
runBabysitTests();
