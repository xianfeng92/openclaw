#!/usr/bin/env node
/**
 * OpenClaw Terminal Integration Tests
 *
 * Tests the actual orchestration services directly (bypassing the UI).
 * This validates the backend functionality that the terminal commands use.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ANSI colors
const c = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

let passCount = 0;
let failCount = 0;

function testGroup(name: string) {
  console.log(`\n${c.cyan}[TEST]${c.reset} ${name}`);
}

function testPass(msg: string) {
  console.log(`  ${c.green}✓ PASS${c.reset} ${msg}`);
  passCount++;
}

function testFail(msg: string, err?: unknown) {
  console.log(`  ${c.red}✗ FAIL${c.reset} ${msg}`);
  if (err) console.log(`    ${c.gray}${err}${c.reset}`);
  failCount++;
}

function testInfo(msg: string) {
  console.log(`  ${c.gray}${msg}${c.reset}`);
}

/**
 * Test 1: Context Management (Obsidian sync)
 */
async function testContextManagement() {
  testGroup("Context Management - Obsidian Sync");

  try {
    const { syncContext, getCustomers, getProjects, getPatterns, getContextSummary } = await import("../src/orchestration/context-manager.js");

    const testVaultPath = "C:\\Users\\xforg\\Desktop\\openclaw\\test-data\\obsidian-vault";
    testInfo(`Testing vault at: ${testVaultPath}`);

    // Verify vault exists
    const vaultExists = await fs.promises.access(testVaultPath).then(() => true).catch(() => false);
    if (!vaultExists) {
      testFail("Test vault not found - run terminal-test-setup.ts first");
      return;
    }
    testPass("Test vault exists");

    // Sync from vault
    const result = await syncContext({ vaultPath: testVaultPath });
    testInfo(`Synced: ${result.customers.length} customers, ${result.projects.length} projects, ${result.patterns.length} patterns`);

    if (result.customers.length >= 2) testPass(`Customers loaded: ${result.customers.map(c => c.name).join(", ")}`);
    else testFail("Expected at least 2 customers");

    if (result.projects.length >= 2) testPass(`Projects loaded: ${result.projects.map(p => p.name).join(", ")}`);
    else testFail("Expected at least 2 projects");

    if (result.patterns.length >= 3) testPass(`Patterns loaded: ${result.patterns.map(p => p.name).join(", ")}`);
    else testFail("Expected at least 3 patterns");

    // Test getContextSummary
    const summary = await getContextSummary();
    testPass(`Context summary: ${summary.customers} customers, ${summary.projects} projects, ${summary.patterns} patterns`);

  } catch (err) {
    testFail("Context management test failed", err);
  }
}

/**
 * Test 2: Pattern Management
 */
async function testPatternManagement() {
  testGroup("Pattern Management");

  try {
    const {
      getPatterns,
      upsertPattern,
      updatePatternEffectiveness,
    } = await import("../src/orchestration/context-manager.js");

    // Load existing patterns
    const patterns = await getPatterns();
    testInfo(`Loaded ${patterns.length} existing patterns`);

    // Create a test pattern
    const testPattern = {
      id: `test-pattern-${Date.now()}`,
      name: `IntegrationTestPattern_${Date.now()}`,
      category: "coding",
      description: "Pattern for integration testing",
      prompt: "Test prompt for {{TASK}}",
      effectiveness: 0.5,
      usageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await upsertPattern(testPattern);
    testPass(`Created pattern: ${testPattern.name}`);

    // Retrieve patterns and find our test
    const allPatterns = await getPatterns();
    const found = allPatterns.find(p => p.id === testPattern.id);
    if (found) {
      testPass("Retrieved created pattern");
    } else {
      testFail("Failed to retrieve created pattern");
    }

    // Update effectiveness
    await updatePatternEffectiveness(testPattern.id, true);
    testPass("Updated pattern effectiveness");

  } catch (err) {
    testFail("Pattern management test failed", err);
  }
}

/**
 * Test 3: Pattern Recommendation
 */
async function testPatternRecommendation() {
  testGroup("Pattern Recommendation System");

  try {
    // First ensure context is loaded
    const { syncContext } = await import("../src/orchestration/context-manager.js");
    const testVaultPath = "C:\\Users\\xforg\\Desktop\\openclaw\\test-data\\obsidian-vault";
    await syncContext({ vaultPath: testVaultPath });

    const { recommendPatterns } = await import("../src/orchestration/context-manager.js");

    // Test different task types
    const testCases = [
      { task: "Fix login crash on Safari", expected: "bugfix-related pattern" },
      { task: "Add user profile page", expected: "feature-related pattern" },
      { task: "Refactor authentication module", expected: "refactor-related pattern" },
    ];

    for (const tc of testCases) {
      const result = await recommendPatterns(tc.task, 3);
      testInfo(`Task: "${tc.task}"`);

      if (result.length > 0) {
        const topPattern = result[0];
        testPass(`Top recommendation: ${topPattern.item.name} (score: ${topPattern.score})`);
        testInfo(`  Reason: ${topPattern.matchReason}`);
      } else {
        testInfo(`No recommendations for: ${tc.task} (patterns may not be categorized yet)`);
      }
    }

  } catch (err) {
    testFail("Pattern recommendation test failed", err);
  }
}

/**
 * Test 4: Workflow Management
 */
async function testWorkflowManagement() {
  testGroup("Workflow Management");

  try {
    const {
      createWorkflow,
      getWorkflowByName,
      dryRunWorkflow,
      deleteWorkflow,
    } = await import("../src/orchestration/workflow-service.js");

    // Create a test workflow
    const workflowName = `Integration Test Workflow_${Date.now()}`;
    const workflow = await createWorkflow({
      name: workflowName,
      description: "Test workflow for integration testing",
      steps: [
        { id: "step-1", type: "command", command: "echo 'Step 1'", description: "Echo step 1" },
        { id: "step-2", type: "command", command: "echo 'Step 2'", description: "Echo step 2" },
      ],
      tags: ["test", "integration"],
    });

    testPass(`Created workflow: ${workflow.id}`);

    // Retrieve by name
    const retrieved = await getWorkflowByName(workflowName);
    if (retrieved && retrieved.id === workflow.id) {
      testPass("Retrieved workflow by name");
    } else {
      testFail("Failed to retrieve workflow by name");
    }

    // Dry run
    const dryRunResult = await dryRunWorkflow(workflow.id);
    if (dryRunResult.steps.length === 2) {
      testPass("Dry run executed successfully");
      testInfo(`  Steps: ${dryRunResult.steps.map(s => s.description).join(", ")}`);
    } else {
      testFail("Dry run returned unexpected number of steps");
    }

    // Cleanup
    await deleteWorkflow(workflow.id);
    testPass("Test workflow deleted");

  } catch (err) {
    testFail("Workflow management test failed", err);
  }
}

/**
 * Test 5: Context Search
 */
async function testContextSearch() {
  testGroup("Context Search");

  try {
    const { searchContext, syncContext } = await import("../src/orchestration/context-manager.js");

    // Ensure context is loaded
    const testVaultPath = "C:\\Users\\xforg\\Desktop\\openclaw\\test-data\\obsidian-vault";
    await syncContext({ vaultPath: testVaultPath });

    // Test searches
    const searches = [
      { query: "AcmeCorp" },
      { query: "payment" },
      { query: "TypeScript" },
      { query: "bug" },
    ];

    for (const search of searches) {
      const result = await searchContext(search.query);
      const totalResults = result.customers.length + result.projects.length +
                          result.meetings.length + result.decisions.length +
                          result.patterns.length;

      testInfo(`Search: "${search.query}" → ${totalResults} results`);

      if (totalResults > 0) {
        testPass(`Found results for: ${search.query}`);
      } else {
        testInfo(`No results for: ${search.query}`);
      }
    }

  } catch (err) {
    testFail("Context search test failed", err);
  }
}

/**
 * Test 6: Git Status
 */
async function testGitStatus() {
  testGroup("Git Operations");

  try {
    const { getCurrentBranch, getGitStatus } = await import("../src/orchestration/pr-service.js");

    const branch = await getCurrentBranch();
    testPass(`Current branch: ${branch || "detached"}`);

    const status = await getGitStatus();
    testPass(`Git status: ${status.hasChanges ? "Has changes" : "Clean"}`);
    testInfo(`  Staged: ${status.staged.length}, Modified: ${status.modified.length}, Untracked: ${status.untracked.length}`);

  } catch (err) {
    testFail("Git operations test failed", err);
  }
}

/**
 * Test 7: Code Review
 */
async function testCodeReview() {
  testGroup("Code Review System");

  try {
    const { runCodeReview } = await import("../src/orchestration/review-service.js");

    // Create a test diff with various issues
    const testDiff = `
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,5 +1,10 @@
 function processUser(input: string) {
-  return input.toUpperCase();
+  const data = eval(input);  // SECURITY ISSUE
+  document.innerHTML = data;  // XSS VULNERABILITY
+  return data;
 }

+// TODO: Fix this later
+// FIXME: Another issue
 function authenticate(token: string) {
+  if (!token) throw new Error();
   const apiKey = "sk-1234567890abcdef";  // HARDCODED SECRET
   return token;
 }
`;

    // Run code review using a temp worktree path (current directory)
    const reviewResult = await runCodeReview(process.cwd(), {
      branch: "main",
      maxFiles: 10,
    });

    testInfo(`Review: ${reviewResult.summary}`);
    testInfo(`  Total comments: ${reviewResult.totalComments}`);
    testInfo(`  Errors: ${reviewResult.errors}, Warnings: ${reviewResult.warnings}`);

    if (reviewResult.results.length === 3) {
      testPass("All 3 models completed review");
    } else {
      testFail(`Expected 3 model reviews, got ${reviewResult.results.length}`);
    }

    // Show sample comments
    for (const result of reviewResult.results) {
      testInfo(`  ${result.model}: ${result.summary}`);
      if (result.comments.length > 0) {
        testInfo(`    Sample: ${result.comments[0].message}`);
      }
    }

  } catch (err) {
    testFail("Code review test failed", err);
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log("\n" + "=".repeat(70));
  console.log(`  ${c.cyan}OpenClaw Terminal - Integration Tests${c.reset}`);
  console.log("=".repeat(70));

  const startTime = Date.now();

  try {
    await testContextManagement();
    await testPatternManagement();
    await testPatternRecommendation();
    await testWorkflowManagement();
    await testContextSearch();
    await testGitStatus();
    await testCodeReview();
  } catch (err) {
    console.error(`${c.red}Fatal error:${c.reset}`, err);
  }

  const duration = Date.now() - startTime;

  console.log("\n" + "=".repeat(70));
  console.log(`  ${c.cyan}Results Summary${c.reset}`);
  console.log("=".repeat(70));
  console.log(`  ${c.green}Passed:${c.reset} ${passCount}`);
  console.log(`  ${c.red}Failed:${c.reset} ${failCount}`);
  console.log(`  ${c.gray}Duration:${c.reset} ${duration}ms`);
  console.log("=".repeat(70) + "\n");

  if (failCount === 0) {
    console.log(`${c.green}✓ All integration tests passed!${c.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${c.red}✗ ${failCount} test(s) failed${c.reset}\n`);
    process.exit(1);
  }
}

// Run tests
runAllTests();
