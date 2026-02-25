/**
 * Agent selection logic based on task categorization.
 */

import type { AgentType } from "./types.js";

export type TaskCategory =
  | "feature"
  | "bugfix"
  | "refactor"
  | "docs"
  | "test"
  | "review"
  | "performance"
  | "security"
  | "general";

/**
 * Categorize a task based on its description.
 */
export function categorizeTask(description: string): TaskCategory {
  const lower = description.toLowerCase();

  // Feature detection
  if (/add|implement|create|new|feature|enhance|support/.test(lower)) {
    return "feature";
  }

  // Bugfix detection
  if (/fix|bug|issue|error|crash|broken|fail/.test(lower)) {
    return "bugfix";
  }

  // Refactor detection
  if (/refactor|restructure|reorganize|clean|simplify/.test(lower)) {
    return "refactor";
  }

  // Documentation detection
  if (/doc|readme|comment|document|explain/.test(lower)) {
    return "docs";
  }

  // Test detection
  if (/test|spec|coverage|unit|integration|e2e/.test(lower)) {
    return "test";
  }

  // Review detection
  if (/review|audit|check|verify|inspect/.test(lower)) {
    return "review";
  }

  // Performance detection
  if (/performance|optimize|speed|slow|fast|cache|efficient/.test(lower)) {
    return "performance";
  }

  // Security detection
  if (/security|secure|vulnerability|auth|permission/.test(lower)) {
    return "security";
  }

  return "general";
}

/**
 * Select an agent based on task category.
 * Default selection strategy:
 * - Claude: Most tasks, especially reasoning-heavy
 * - Codex: Quick fixes, simple implementations
 * - Gemini: Research, documentation, multi-step
 */
export function selectAgent(category: TaskCategory): AgentType {
  switch (category) {
    case "feature":
      return "claude"; // Best for complex feature implementation

    case "bugfix":
      return "codex"; // Quick for bug fixes

    case "refactor":
      return "claude"; // Good at understanding context

    case "docs":
      return "gemini"; // Good at documentation

    case "test":
      return "codex"; // Quick for generating tests

    case "review":
      return "claude"; // Thorough reviewer

    case "performance":
      return "claude"; // Good at optimization reasoning

    case "security":
      return "claude"; // Security-focused reasoning

    case "general":
    default:
      return "claude"; // Default to Claude
  }
}

/**
 * Select an agent based on explicit override or category.
 */
export function resolveAgent(
  description: string,
  override?: AgentType,
): AgentType {
  if (override) {
    return override;
  }
  const category = categorizeTask(description);
  return selectAgent(category);
}

/**
 * Get agent display name.
 */
export function getAgentName(agent: AgentType): string {
  switch (agent) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "gemini":
      return "Gemini";
  }
}

/**
 * Get agent emoji/icon.
 */
export function getAgentIcon(agent: AgentType): string {
  switch (agent) {
    case "claude":
      return "🤖";
    case "codex":
      return "⚡";
    case "gemini":
      return "✨";
  }
}
