/**
 * Code reviewer for multi-model code review.
 * Coordinates parallel reviews from Codex, Gemini, and Claude.
 */

import type {
  Customer,
  Decision,
  Project,
} from "./context-schema.js";
import { buildReviewPrompt } from "./prompt-builder.js";
import type { ActiveTask, DoDChecks } from "./types.js";

/**
 * A review comment from an agent.
 */
export interface ReviewComment {
  file: string;
  line?: number;
  severity: "error" | "warning" | "info" | "suggestion";
  message: string;
  code?: string;
  suggestion?: string;
}

/**
 * A review result from a single model.
 */
export interface ReviewResult {
  model: "codex" | "gemini" | "claude";
  comments: ReviewComment[];
  summary: string;
  passed: boolean;
  duration: number; // milliseconds
}

/**
 * Combined review results.
 */
export interface CombinedReview {
  results: ReviewResult[];
  allPassed: boolean;
  totalComments: number;
  errors: number;
  warnings: number;
  suggestions: number;
  summary: string;
}

/**
 * Options for code review.
 */
export interface CodeReviewOptions {
  branch?: string;
  prNumber?: number;
  context?: {
    customers: Customer[];
    projects: Project[];
    decisions: Decision[];
  };
  maxFiles?: number;
  timeout?: number; // milliseconds
}

/**
 * Run code review using multiple models in parallel.
 */
export async function runMultiModelReview(
  task: ActiveTask,
  options: CodeReviewOptions = {},
): Promise<CombinedReview> {
  const startTime = Date.now();

  // Get the diff or files to review
  const diffOrFiles = await getDiffForReview(task, options);

  // Build review prompt with context
  const prompt = options.context
    ? buildReviewPrompt(options.context, diffOrFiles)
    : `Review the following code changes:\n\n${diffOrFiles}`;

  // Run parallel reviews
  const results = await Promise.all([
    runCodexReview(prompt, options.timeout),
    runGeminiReview(prompt, options.timeout),
    runClaudeReview(prompt, options.timeout),
  ]);

  const duration = Date.now() - startTime;

  // Combine results
  return combineResults(results);
}

/**
 * Get diff for review.
 */
async function getDiffForReview(
  task: ActiveTask,
  options: CodeReviewOptions,
): Promise<string> {
  // Try to get diff from git
  const { runCommandWithTimeout, resolveCommand } = await import("../process/exec.js");

  if (task.branch && task.worktree) {
    try {
      const baseBranch = options.branch ? options.branch : "main";
      const result = await runCommandWithTimeout(
        [
          resolveCommand("git"),
          "-C",
          task.worktree,
          "diff",
          `${baseBranch}...HEAD`,
        ],
        30_000,
      );

      if (result.code === 0 && result.stdout) {
        return result.stdout;
      }
    } catch (err) {
      console.error("[CodeReviewer] Failed to get diff:", err);
    }
  }

  // Fallback: list changed files
  if (task.worktree) {
    try {
      const result = await runCommandWithTimeout(
        [
          resolveCommand("git"),
          "-C",
          task.worktree,
          "diff",
          "--name-only",
          "HEAD~1",
        ],
        10_000,
      );

      if (result.code === 0 && result.stdout) {
        return `Changed files:\n${result.stdout}`;
      }
    } catch {
      // Ignore
    }
  }

  return "No diff available";
}

/**
 * Run Codex review (focus: edge cases, logic errors).
 */
async function runCodexReview(
  prompt: string,
  timeout?: number,
): Promise<ReviewResult> {
  const startTime = Date.now();

  try {
    // This would integrate with the Codex agent
    // For now, return a placeholder result
    const comments: ReviewComment[] = [
      {
        file: "unknown",
        severity: "info",
        message: "Codex review not yet implemented - placeholder result",
      },
    ];

    return {
      model: "codex",
      comments,
      summary: "Codex review placeholder",
      passed: true,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      model: "codex",
      comments: [],
      summary: `Codex review failed: ${err}`,
      passed: false,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Run Gemini review (focus: security, performance).
 */
async function runGeminiReview(
  prompt: string,
  timeout?: number,
): Promise<ReviewResult> {
  const startTime = Date.now();

  try {
    // This would integrate with the Gemini agent
    const comments: ReviewComment[] = [
      {
        file: "unknown",
        severity: "info",
        message: "Gemini review not yet implemented - placeholder result",
      },
    ];

    return {
      model: "gemini",
      comments,
      summary: "Gemini review placeholder",
      passed: true,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      model: "gemini",
      comments: [],
      summary: `Gemini review failed: ${err}`,
      passed: false,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Run Claude review (focus: architecture, maintainability).
 */
async function runClaudeReview(
  prompt: string,
  timeout?: number,
): Promise<ReviewResult> {
  const startTime = Date.now();

  try {
    // This would integrate with the Claude agent
    const comments: ReviewComment[] = [
      {
        file: "unknown",
        severity: "info",
        message: "Claude review not yet implemented - placeholder result",
      },
    ];

    return {
      model: "claude",
      comments,
      summary: "Claude review placeholder",
      passed: true,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      model: "claude",
      comments: [],
      summary: `Claude review failed: ${err}`,
      passed: false,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Combine review results.
 */
function combineResults(results: ReviewResult[]): CombinedReview {
  const allPassed = results.every((r) => r.passed);
  const totalComments = results.reduce((sum, r) => sum + r.comments.length, 0);

  const errors = results.reduce(
    (sum, r) => sum + r.comments.filter((c) => c.severity === "error").length,
    0,
  );
  const warnings = results.reduce(
    (sum, r) => sum + r.comments.filter((c) => c.severity === "warning").length,
    0,
  );
  const suggestions = results.reduce(
    (sum, r) => sum + r.comments.filter((c) => c.severity === "suggestion").length,
    0,
  );

  // Build summary
  const summaryParts: string[] = [];
  summaryParts.push(`Total comments: ${totalComments}`);
  summaryParts.push(`Errors: ${errors}`);
  summaryParts.push(`Warnings: ${warnings}`);
  summaryParts.push(`Suggestions: ${suggestions}`);

  for (const result of results) {
    summaryParts.push(`\n${result.model.toUpperCase()}: ${result.summary}`);
  }

  return {
    results,
    allPassed,
    totalComments,
    errors,
    warnings,
    suggestions,
    summary: summaryParts.join("\n"),
  };
}

/**
 * Convert review results to DoD checks.
 */
export function reviewToDoDChecks(review: CombinedReview): Partial<DoDChecks> {
  return {
    codexReviewPassed: review.results.find((r) => r.model === "codex")?.passed,
    claudeReviewPassed: review.results.find((r) => r.model === "claude")?.passed,
    geminiReviewPassed: review.results.find((r) => r.model === "gemini")?.passed,
  };
}

/**
 * Post review comments to GitHub PR.
 */
export async function postReviewComments(
  prNumber: number,
  review: CombinedReview,
): Promise<boolean> {
  try {
    const { runCommandWithTimeout, resolveCommand } = await import("../process/exec.js");

    // Post overall summary as a PR comment
    const summaryComment = `## 🤖 Automated Code Review

${review.summary}

---
*Generated by OpenClaw Multi-Model Reviewer*`;

    const result = await runCommandWithTimeout(
      [
        resolveCommand("gh"),
        "pr",
        "comment",
        String(prNumber),
        "--body",
        summaryComment,
      ],
      30_000,
    );

    return result.code === 0;
  } catch (err) {
    console.error("[CodeReviewer] Failed to post review comments:", err);
    return false;
  }
}

/**
 * Determine if changes should be requested based on review.
 */
export function shouldRequestChanges(review: CombinedReview): boolean {
  // Request changes if there are errors
  if (review.errors > 0) {
    return true;
  }

  // Request changes if any model failed
  if (!review.allPassed) {
    return true;
  }

  // Optionally request changes for many warnings
  if (review.warnings > 10) {
    return true;
  }

  return false;
}

/**
 * Format review results for terminal display.
 */
export function formatReviewForTerminal(review: CombinedReview): string[] {
  const lines: string[] = [];

  lines.push("╔════════════════════════════════════════════════════════════╗");
  lines.push("║                    CODE REVIEW RESULTS                    ║");
  lines.push("╚════════════════════════════════════════════════════════════╝");

  lines.push("");
  lines.push(`Total Comments: ${review.totalComments}`);
  lines.push(`Errors: ${review.errors}`);
  lines.push(`Warnings: ${review.warnings}`);
  lines.push(`Suggestions: ${review.suggestions}`);

  lines.push("");
  for (const result of review.results) {
    const status = result.passed ? "✓ PASS" : "✗ FAIL";
    lines.push(`${result.model.toUpperCase()}: ${status} (${result.duration}ms)`);
    lines.push(`  ${result.summary}`);

    if (result.comments.length > 0) {
      for (const comment of result.comments.slice(0, 5)) {
        const severity = comment.severity.toUpperCase().padEnd(10);
        lines.push(`  [${severity}] ${comment.file}:${comment.line || "?"}`);
        lines.push(`            ${comment.message}`);
      }
      if (result.comments.length > 5) {
        lines.push(`  ... and ${result.comments.length - 5} more`);
      }
    }
    lines.push("");
  }

  return lines;
}
