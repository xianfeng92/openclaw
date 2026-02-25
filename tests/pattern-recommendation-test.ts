#!/usr/bin/env node
/**
 * Functional test for Pattern Recommendation System
 *
 * Tests:
 * 1. Task categorization based on description
 * 2. Pattern recommendation with relevance scoring
 * 3. Effectiveness tracking (EMA)
 * 4. Category matching
 */

import { recommendPatterns } from "../src/orchestration/context-manager.js";
import { categorizeTask, type TaskCategory } from "../src/orchestration/agent-selector.js";
import { upsertPattern, loadContext, saveContext } from "../src/orchestration/index.js";
import type { Pattern } from "../src/orchestration/context-schema.js";

// Test patterns
const TEST_PATTERNS: Pattern[] = [
  {
    id: "pattern-1",
    name: "BugFix Template",
    category: "bug-fix",
    description: "Use this template for fixing bugs and errors",
    prompt: "First understand the expected behavior, then find the root cause...",
    effectiveness: 0.9,
    usageCount: 10,
    createdAt: Date.now() - 10 * 24 * 60 * 60 * 1000, // 10 days ago
    updatedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
  },
  {
    id: "pattern-2",
    name: "Feature Implementation",
    category: "feature",
    description: "Use this for implementing new features",
    prompt: "Break down the feature into smaller tasks...",
    effectiveness: 0.7,
    usageCount: 5,
    createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
  },
  {
    id: "pattern-3",
    name: "Code Refactor",
    category: "refactor",
    description: "Use this for code cleanup and refactoring",
    prompt: "Identify code smells and refactor step by step...",
    effectiveness: 0.8,
    usageCount: 7,
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
  },
  {
    id: "pattern-4",
    name: "Test Writing",
    category: "testing",
    description: "Use this for writing unit tests",
    prompt: "Write tests for edge cases and happy paths...",
    effectiveness: 0.6,
    usageCount: 3,
    createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
  },
  {
    id: "pattern-5",
    name: "Security Review",
    category: "security",
    description: "Use this for security-related changes",
    prompt: "Check for authentication, authorization, and input validation...",
    effectiveness: 0.85,
    usageCount: 4,
    createdAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
  },
];

// Test task descriptions
const TEST_TASKS = [
  { desc: "Fix login crash on startup", expected: "bugfix" },
  { desc: "Add user profile page", expected: "feature" },
  { desc: "Refactor authentication module", expected: "refactor" },
  { desc: "Write unit tests for payment", expected: "test" },
  { desc: "Fix XSS vulnerability in comments", expected: "security" },
  { desc: "Optimize slow database queries", expected: "performance" },
  { desc: "Document API endpoints", expected: "docs" },
];

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

async function setupTestPatterns(): Promise<void> {
  console.log(formatTest("Setting up test patterns"));

  for (const pattern of TEST_PATTERNS) {
    await upsertPattern(pattern);
  }

  console.log(formatPass(`Setup ${TEST_PATTERNS.length} test patterns`));
}

async function testTaskCategorization(): Promise<boolean> {
  console.log(formatTest("Task Categorization"));

  let passCount = 0;
  for (const { desc, expected } of TEST_TASKS) {
    const result = categorizeTask(desc);
    const passed = result === expected;
    if (passed) passCount++;

    console.log(
      passed
        ? formatPass(`"${desc}" → ${result}`)
        : formatFail(`"${desc}" → ${result} (expected ${expected})`)
    );
  }

  const allPassed = passCount === TEST_TASKS.length;
  console.log(formatInfo(`Passed ${passCount}/${TEST_TASKS.length} categorization tests`));
  return allPassed;
}

async function testPatternRecommendation(): Promise<boolean> {
  console.log(formatTest("Pattern Recommendation"));

  const tests = [
    { desc: "Fix login crash", expectedPattern: "BugFix Template" },
    { desc: "Add new feature for users", expectedPattern: "Feature Implementation" },
    { desc: "Refactor code structure", expectedPattern: "Code Refactor" },
    { desc: "Write tests for payment module", expectedPattern: "Test Writing" },
    { desc: "Fix security vulnerability", expectedPattern: "Security Review" },
  ];

  let passCount = 0;
  for (const { desc, expectedPattern } of tests) {
    const recommendations = await recommendPatterns(desc, 1);

    if (recommendations.length > 0) {
      const topPattern = recommendations[0].item.name;
      const passed = topPattern === expectedPattern;
      if (passed) passCount++;

      console.log(
        passed
          ? formatPass(`"${desc}" → "${topPattern}" (score: ${recommendations[0].score})`)
          : formatFail(`"${desc}" → "${topPattern}" (expected "${expectedPattern}", score: ${recommendations[0].score})`)
      );
      console.log(formatInfo(`    Reason: ${recommendations[0].matchReason}`));
    } else {
      console.log(formatFail(`"${desc}" → No recommendations`));
    }
  }

  const allPassed = passCount === tests.length;
  console.log(formatInfo(`Passed ${passCount}/${tests.length} recommendation tests`));
  return allPassed;
}

async function testEffectivenessTracking(): Promise<boolean> {
  console.log(formatTest("Effectiveness Tracking (EMA)"));

  // Load a pattern and update its effectiveness
  const context = await loadContext();
  const testPattern = context.patterns.find((p) => p.id === "pattern-1");

  if (!testPattern) {
    console.log(formatFail("Test pattern not found"));
    return false;
  }

  const initialEffectiveness = testPattern.effectiveness || 0.5;
  console.log(formatInfo(`Initial effectiveness: ${initialEffectiveness.toFixed(2)}`));

  // Simulate a success rating
  const { updatePatternEffectiveness } = await import("../src/orchestration/context-manager.js");
  await updatePatternEffectiveness("pattern-1", true);

  // Reload and check
  const updatedContext = await loadContext();
  const updatedPattern = updatedContext.patterns.find((p) => p.id === "pattern-1");
  const newEffectiveness = updatedPattern?.effectiveness || 0;

  // EMA formula: new = α * target + (1 - α) * old
  // For success (target=1) with α=0.2: new = 0.2 * 1 + 0.8 * old
  const expected = 0.2 * 1 + 0.8 * initialEffectiveness;
  const isClose = Math.abs(newEffectiveness - expected) < 0.01;

  if (isClose) {
    console.log(formatPass(`Effectiveness updated: ${initialEffectiveness.toFixed(2)} → ${newEffectiveness.toFixed(2)}`));
    console.log(formatInfo(`    Usage count: ${updatedPattern?.usageCount}`));
    return true;
  } else {
    console.log(formatFail(`Effectiveness mismatch: ${newEffectiveness.toFixed(2)} (expected ${expected.toFixed(2)})`));
    return false;
  }
}

async function testMultipleRecommendations(): Promise<boolean> {
  console.log(formatTest("Multiple Pattern Recommendations"));

  const desc = "Fix bug in user authentication";
  const recommendations = await recommendPatterns(desc, 3);

  console.log(formatInfo(`Task: "${desc}"`));
  console.log(formatInfo(`Category: ${categorizeTask(desc)}`));

  if (recommendations.length === 0) {
    console.log(formatFail("No recommendations returned"));
    return false;
  }

  let passCount = 0;
  let lastScore = Infinity;

  for (const rec of recommendations) {
    const scoreDecreasing = rec.score <= lastScore;
    if (scoreDecreasing) {
      passCount++;
      lastScore = rec.score;
    }

    console.log(
      scoreDecreasing
        ? formatPass(`  ${rec.item.name} (score: ${rec.score}, eff: ${rec.item.effectiveness?.toFixed(2) || "N/A"})`)
        : formatFail(`  ${rec.item.name} (score: ${rec.score} - not sorted!)`)
    );
    console.log(formatInfo(`    Reason: ${rec.matchReason}`));
  }

  return passCount === recommendations.length;
}

async function cleanupTestPatterns(): Promise<void> {
  console.log(formatTest("Cleanup"));

  const context = await loadContext();
  context.patterns = context.patterns.filter((p) => !p.id.startsWith("pattern-"));
  await saveContext(context);

  console.log(formatPass("Removed test patterns"));
}

export async function runPatternRecommendationTests(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("  Pattern Recommendation System - Functional Tests");
  console.log("=".repeat(60));

  try {
    await setupTestPatterns();

    const results = await Promise.all([
      testTaskCategorization(),
      testPatternRecommendation(),
      testEffectivenessTracking(),
      testMultipleRecommendations(),
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
  } catch (error) {
    console.error(formatFail(`Test error: ${error}`));
    process.exit(1);
  } finally {
    await cleanupTestPatterns();
  }
}

// Always run tests
runPatternRecommendationTests();
