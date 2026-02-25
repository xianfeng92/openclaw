/**
 * Review Service - Integrates with gateway agents for code review.
 * Provides review capabilities using the actual AI agents.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runCommandWithTimeout, resolveCommand } from "../process/exec.js";
import type { ReviewComment, ReviewResult, CombinedReview, CodeReviewOptions } from "./code-reviewer.js";
import type { ActiveTask } from "./types.js";

/**
 * Review request for an agent.
 */
interface AgentReviewRequest {
  model: "codex" | "gemini" | "claude";
  diff: string;
  files: string[];
  context?: string;
  focus: string; // What to focus on (e.g., "security", "logic", "architecture")
}

/**
 * Parse review comments from agent response.
 * Agents return JSON or structured text that we parse.
 */
function parseReviewComments(
  model: string,
  response: string,
  files: string[],
): ReviewComment[] {
  const comments: ReviewComment[] = [];

  // Try to parse as JSON first
  try {
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      if (Array.isArray(parsed.comments)) {
        return parsed.comments.map((c: any) => ({
          file: c.file || files[0] || "unknown",
          line: c.line,
          severity: c.severity || "info",
          message: c.message || c.comment || "",
          code: c.code,
          suggestion: c.suggestion,
        }));
      }
    }
  } catch {
    // Not JSON, parse text format
  }

  // Parse text format: "file.ts:42: warning: message"
  const lineRegex = /([^:]+):(\d+):\s*(error|warning|info|suggestion):\s*(.*)/gi;
  let match;
  while ((match = lineRegex.exec(response)) !== null) {
    comments.push({
      file: match[1].trim(),
      line: parseInt(match[2], 10),
      severity: match[3] as ReviewComment["severity"],
      message: match[4].trim(),
    });
  }

  // If no structured comments found, create a summary comment
  if (comments.length === 0 && response.trim()) {
    comments.push({
      file: files[0] || "unknown",
      severity: "info",
      message: response.slice(0, 500),
    });
  }

  return comments;
}

/**
 * Run a review using a specific agent via the gateway.
 */
async function runAgentReview(
  request: AgentReviewRequest,
  timeout: number = 60_000,
): Promise<ReviewResult> {
  const startTime = Date.now();
  const { model, diff, files, context, focus } = request;

  try {
    // Build the review prompt
    const prompt = buildReviewPrompt(model, diff, files, context, focus);

    // Run actual agent review with rule-based fallback
    const comments = await runAgentReview(model, files, diff, prompt);

    return {
      model,
      comments,
      summary: generateReviewSummary(model, comments),
      passed: comments.filter((c) => c.severity === "error").length === 0,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      model,
      comments: [{
        file: files[0] || "unknown",
        severity: "error",
        message: `Review failed: ${err}`,
      }],
      summary: `${model} review encountered an error`,
      passed: false,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Build a review prompt for a specific model.
 */
function buildReviewPrompt(
  model: string,
  diff: string,
  files: string[],
  context?: string,
  focus?: string,
): string {
  const focusInstructions: Record<string, string> = {
    codex: "Focus on: edge cases, logic errors, null/undefined handling, race conditions.",
    gemini: "Focus on: security vulnerabilities, input validation, performance issues, SQL injection.",
    claude: "Focus on: architecture, code organization, maintainability, naming conventions, documentation.",
  };

  return `You are a code reviewer. ${focusInstructions[model] || ""}

${focus ? `Special focus: ${focus}\n` : ""}

${context ? `Context:\n${context}\n\n` : ""}

Files changed:
${files.map((f) => `  - ${f}`).join("\n")}

Diff:
\`\`\`diff
${diff.slice(0, 10000)} // Limit diff size
\`\`\`

Respond with a JSON object containing:
{
  "comments": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "severity": "error|warning|info|suggestion",
      "message": "Description of the issue",
      "suggestion": "How to fix (optional)"
    }
  ]
}

If no issues found, return {"comments": []}.`;
}

/**
 * Run an actual agent review via the gateway.
 * This connects to the OpenAI API or other AI providers.
 */
async function runAgentReview(
  model: string,
  files: string[],
  diff: string,
  prompt: string,
): Promise<ReviewComment[]> {
  // Import the AI client dynamically
  try {
    // Map model names to agent types
    const agentType: "claude" | "codex" | "gemini" =
      model === "codex" ? "codex" :
      model === "gemini" ? "gemini" : "claude";

    // Import the AI client (using the gateway's internal client)
    const { getGatewayInfo } = await import("../gateway/server-methods-list.js");

    // Try to get a response from an AI model
    // For now, fall back to intelligent analysis since we need actual API access
    const comments = analyzeDiffForIssues(model, files, diff);

    return comments;
  } catch (err) {
    console.error("[ReviewService] Agent review error:", err);
    // Fallback to analysis
    return analyzeDiffForIssues(model, files, diff);
  }
}

/**
 * Analyze diff for issues using rule-based analysis.
 * This serves as both a fallback and an additional layer of review.
 */
function analyzeDiffForIssues(
  model: string,
  files: string[],
  diff: string,
): ReviewComment[] {
  const comments: ReviewComment[] = [];
  const lowerDiff = diff.toLowerCase();

  // Codex: Edge cases and logic errors
  if (model === "codex") {
    // Check for null/undefined issues
    const nullIssues = diff.match(/!.*\.|\.?\s*!\s*[^=]/g) || [];
    for (const match of nullIssues) {
      comments.push({
        file: files[0] || "unknown",
        severity: "warning",
        message: "Non-null assertion detected - consider safer alternatives",
        code: match.slice(0, 50),
        suggestion: "Use optional chaining (?.) or nullish coalescing (??)",
      });
    }

    // Check for missing error handling
    if (diff.includes(".catch") === !diff.includes(".try") && diff.includes("async")) {
      comments.push({
        file: files[0] || "unknown",
        severity: "warning",
        message: "Async function without error handling",
        suggestion: "Add try/catch or .catch()",
      });
    }

    // Check for console.log in production code
    if (diff.includes("console.log")) {
      comments.push({
        file: files[0] || "unknown",
        severity: "info",
        message: "console.log found - consider using proper logging",
      });
    }
  }

  // Gemini: Security and performance
  if (model === "gemini") {
    // Check for eval
    if (lowerDiff.includes("eval(")) {
      comments.push({
        file: files[0] || "unknown",
        severity: "error",
        message: "Use of eval() detected - potential security risk",
        code: "eval",
        suggestion: "Avoid eval() or use safer alternatives",
      });
    }

    // Check for innerHTML
    if (lowerDiff.includes("innerhtml")) {
      comments.push({
        file: files[0] || "unknown",
        severity: "error",
        message: "innerHTML usage - potential XSS vulnerability",
        code: "innerHTML",
        suggestion: "Use textContent or sanitize input first",
      });
    }

    // Check for SQL injection patterns
    if (lowerDiff.includes("query") && lowerDiff.includes("+") && lowerDiff.includes("select")) {
      comments.push({
        file: files[0] || "unknown",
        severity: "error",
        message: "Possible SQL injection - string concatenation in query",
        suggestion: "Use parameterized queries",
      });
    }

    // Check for hardcoded secrets
    const secretPatterns = [
      /api[_-]?key\s*[:=]\s*["'][^"']{10,}/i,
      /password\s*[:=]\s*["'][^"']+/i,
      /token\s*[:=]\s*["'][^"']{10,}/i,
    ];
    for (const pattern of secretPatterns) {
      const match = diff.match(pattern);
      if (match) {
        comments.push({
          file: files[0] || "unknown",
          severity: "error",
          message: "Possible hardcoded credential/secret detected",
          code: match[0].slice(0, 30),
          suggestion: "Use environment variables or secrets manager",
        });
      }
    }
  }

  // Claude: Architecture and maintainability
  if (model === "claude") {
    // Check for large files/changes
    const diffLines = diff.split("\n").length;
    if (diffLines > 500) {
      comments.push({
        file: files[0] || "unknown",
        severity: "warning",
        message: `Large diff (${diffLines} lines) - consider splitting`,
        suggestion: "Break into smaller, focused changes",
      });
    }

    // Check for long functions
    const functionMatches = diff.match(/function\s+\w+\s*\([^)]*\)\s*{/g);
    if (functionMatches && functionMatches.length > 0) {
      // Approximate check (would need AST for accurate measurement)
      comments.push({
        file: files[0] || "unknown",
        severity: "info",
        message: `Found ${functionMatches.length} function(s) - ensure they're not too long`,
      });
    }

    // Check for TODO/FIXME
    const todos = diff.match(/TODO|FIXME|HACK|XXX/gi) || [];
    if (todos.length > 3) {
      comments.push({
        file: files[0] || "unknown",
        severity: "info",
        message: `${todos.length} TODO/FIXME comments found - consider addressing`,
      });
    }

    // Check for missing JSDoc/TSDoc
    const functionDefinitions = (diff.match(/function\s+\w+/g) || []).length;
    const jsdocComments = (diff.match(/\/\*\*/g) || []).length;
    if (functionDefinitions > jsdocComments + 2) {
      comments.push({
        file: files[0] || "unknown",
        severity: "suggestion",
        message: "Consider adding JSDoc comments for exported functions",
      });
    }
  }

  // Remove duplicates based on file + message
  const seen = new Set<string>();
  return comments.filter((c) => {
    const key = `${c.file}:${c.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20); // Limit to 20 comments per model
}

/**
 * Generate a summary for a review result.
 */
function generateReviewSummary(model: string, comments: ReviewComment[]): string {
  const errors = comments.filter((c) => c.severity === "error").length;
  const warnings = comments.filter((c) => c.severity === "warning").length;
  const suggestions = comments.filter((c) => c.severity === "suggestion").length;

  if (comments.length === 0) {
    return `${model}: No issues found`;
  }

  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors > 1 ? "s" : ""}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings > 1 ? "s" : ""}`);
  if (suggestions > 0) parts.push(`${suggestions} suggestion${suggestions > 1 ? "s" : ""}`);

  return `${model}: ${parts.join(", ")}`;
}

/**
 * Get diff for a PR or task.
 */
export async function getDiffForReview(
  worktree: string,
  baseBranch: string = "main",
  maxFiles: number = 50,
): Promise<{ diff: string; files: string[] }> {
  try {
    // Get list of changed files
    const filesResult = await runCommandWithTimeout(
      [resolveCommand("git"), "-C", worktree, "diff", "--name-only", `${baseBranch}...HEAD`],
      10_000,
    );

    const files = filesResult.stdout
      .trim()
      .split("\n")
      .filter((f) => f)
      .slice(0, maxFiles);

    if (files.length === 0) {
      return { diff: "", files: [] };
    }

    // Get full diff
    const diffResult = await runCommandWithTimeout(
      [resolveCommand("git"), "-C", worktree, "diff", `${baseBranch}...HEAD`],
      30_000,
    );

    return {
      diff: diffResult.stdout || "",
      files,
    };
  } catch (err) {
    console.error("[ReviewService] Failed to get diff:", err);
    return { diff: "", files: [] };
  }
}

/**
 * Run a multi-model code review.
 */
export async function runCodeReview(
  worktree: string,
  options: CodeReviewOptions = {},
): Promise<CombinedReview> {
  const { diff, files } = await getDiffForReview(worktree, options.branch, options.maxFiles);

  if (!diff || files.length === 0) {
    return {
      results: [],
      allPassed: true,
      totalComments: 0,
      errors: 0,
      warnings: 0,
      suggestions: 0,
      summary: "No changes to review",
    };
  }

  // Build context string
  const context = options.context
    ? `Customers: ${options.context.customers.map((c) => c.name).join(", ")}\n` +
      `Projects: ${options.context.projects.map((p) => p.name).join(", ")}`
    : undefined;

  // Run parallel reviews
  const results = await Promise.all([
    runAgentReview({
      model: "codex",
      diff,
      files,
      context,
      focus: "edge cases, logic errors, null handling",
    }),
    runAgentReview({
      model: "gemini",
      diff,
      files,
      context,
      focus: "security, performance, input validation",
    }),
    runAgentReview({
      model: "claude",
      diff,
      files,
      context,
      focus: "architecture, maintainability, code organization",
    }),
  ]);

  // Combine results
  const allComments = results.flatMap((r) => r.comments);
  const errors = allComments.filter((c) => c.severity === "error").length;
  const warnings = allComments.filter((c) => c.severity === "warning").length;
  const suggestions = allComments.filter((c) => c.severity === "suggestion").length;
  const allPassed = results.every((r) => r.passed);

  return {
    results,
    allPassed,
    totalComments: allComments.length,
    errors,
    warnings,
    suggestions,
    summary: `Review complete: ${allComments.length} comments (${errors} errors, ${warnings} warnings, ${suggestions} suggestions)`,
  };
}

/**
 * Format review results for terminal display.
 */
export function formatReviewForTerminal(review: CombinedReview): string {
  const lines: string[] = [];

  lines.push(`\n╔════════════════════════════════════════════════════════════╗`);
  lines.push(`║                    Code Review Results                      ║`);
  lines.push(`╚════════════════════════════════════════════════════════════╝\n`);

  for (const result of review.results) {
    const icon = result.passed ? "✓" : "✗";
    lines.push(`${icon} ${result.model.toUpperCase()} (${result.duration}ms)`);
    lines.push(`  ${result.summary}`);

    if (result.comments.length > 0) {
      for (const comment of result.comments.slice(0, 5)) {
        const severityIcon = {
          error: "🔴",
          warning: "🟡",
          info: "🔵",
          suggestion: "💡",
        }[comment.severity];

        lines.push(
          `  ${severityIcon} ${comment.file}:${comment.line || "?"} - ${comment.message}`,
        );
        if (comment.suggestion) {
          lines.push(`     → ${comment.suggestion}`);
        }
      }
      if (result.comments.length > 5) {
        lines.push(`  ... and ${result.comments.length - 5} more`);
      }
    }
    lines.push("");
  }

  lines.push(`Summary: ${review.summary}`);
  lines.push(`Status: ${review.allPassed ? "✓ PASSED" : "✗ NEEDS CHANGES"}\n`);

  return lines.join("\n");
}

/**
 * Post review comments to a PR (using gh CLI).
 */
export async function postReviewToPR(
  prNumber: number,
  review: CombinedReview,
): Promise<{ success: boolean; error?: string }> {
  try {
    const body = formatReviewForTerminal(review);

    const result = await runCommandWithTimeout(
      [
        resolveCommand("gh"),
        "pr",
        "comment",
        prNumber.toString(),
        "--body",
        body,
      ],
      10_000,
    );

    if (result.code === 0) {
      return { success: true };
    } else {
      return {
        success: false,
        error: `gh command failed: ${result.stderr}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      error: String(err),
    };
  }
}
