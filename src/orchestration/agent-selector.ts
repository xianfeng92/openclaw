/**
 * Agent selection logic based on task categorization and context.
 */

import type { AgentType } from "./types.js";
import type { BusinessContext, ContextSearchResult } from "./context-schema.js";

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
 * More specific patterns are checked first.
 */
export function categorizeTask(description: string): TaskCategory {
  const lower = description.toLowerCase();

  // Security detection (check before bugfix - more specific)
  // But allow "refactor" to take precedence for refactoring tasks
  if (/security|secure|vulnerability|xss|injection|csrf/.test(lower)) {
    return "security";
  }

  // Performance detection (check before refactor - more specific)
  if (/performance|optimize|slow|cache|efficient|latency/.test(lower)) {
    return "performance";
  }

  // Test detection
  if (/test|spec|coverage|unit|integration|e2e|mock/.test(lower)) {
    return "test";
  }

  // Documentation detection
  if (/doc|readme|comment|document|explain|guide|tutorial/.test(lower)) {
    return "docs";
  }

  // Review detection
  if (/review|audit|check|verify|inspect/.test(lower)) {
    return "review";
  }

  // Refactor detection (check before feature/bugfix - more specific)
  if (/refactor|restructure|reorganize|clean ?up|simplify|rewrite/.test(lower)) {
    return "refactor";
  }

  // Feature detection
  if (/add|implement|create|new|feature|enhance|support|introduce/.test(lower)) {
    return "feature";
  }

  // Bugfix detection (most general, check last)
  if (/fix|bug|issue|error|crash|broken|fail/.test(lower)) {
    return "bugfix";
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
 * Select an agent with context awareness.
 * Uses business context to make better agent selection decisions.
 */
export function resolveAgentWithContext(
  description: string,
  context: BusinessContext | null,
  override?: AgentType,
): AgentType {
  if (override) {
    return override;
  }

  // If no context available, fall back to basic selection
  if (!context) {
    return resolveAgent(description);
  }

  const lower = description.toLowerCase();
  const category = categorizeTask(description);

  // Context-aware overrides

  // If working with specific customer configurations that need care
  if (context.customers.some((c) => lower.includes(c.name.toLowerCase()))) {
    // Use Claude for customer-specific work (better attention to detail)
    return "claude";
  }

  // If the task relates to a recent meeting with action items
  const recentMeetings = context.meetings.filter(
    (m) => Date.now() - m.date.getTime() < 7 * 24 * 60 * 60 * 1000,
  );
  if (
    recentMeetings.some((m) =>
      lower.includes(m.title.toLowerCase()) ||
      m.actionItems.some((item) => lower.includes(item.toLowerCase()))
    )
  ) {
    // Use Claude for action item follow-through
    return "claude";
  }

  // If the task relates to a technical decision
  if (context.decisions.some((d) => lower.includes(d.title.toLowerCase()))) {
    // Use Claude for decision-aware implementation
    return "claude";
  }

  // If there's a relevant pattern with high effectiveness
  const effectivePatterns = context.patterns.filter(
    (p) => p.effectiveness && p.effectiveness > 0.7
  );
  if (effectivePatterns.some((p) => lower.includes(p.name.toLowerCase()))) {
    // Use the agent that worked well with this pattern
    // For now, default to Claude
    return "claude";
  }

  // Default to category-based selection
  return selectAgent(category);
}

/**
 * Get relevant context for a task description.
 */
export function getRelevantContext(
  description: string,
  context: BusinessContext | null,
): {
  customers: Array<{ id: string; name: string; score: number }>;
  projects: Array<{ id: string; name: string; score: number }>;
  decisions: Array<{ id: string; title: string; score: number }>;
  meetings: Array<{ id: string; title: string; score: number }>;
  patterns: Array<{ id: string; name: string; score: number }>;
} {
  if (!context) {
    return {
      customers: [],
      projects: [],
      decisions: [],
      meetings: [],
      patterns: [],
    };
  }

  const lower = description.toLowerCase();

  // Score customers
  const customers = context.customers
    .map((c) => {
      let score = 0;
      if (lower.includes(c.name.toLowerCase())) score += 10;
      if (c.tags?.some((t) => lower.includes(t.toLowerCase()))) score += 5;
      if (c.notes.toLowerCase().includes(lower)) score += 2;
      return { id: c.id, name: c.name, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  // Score projects
  const projects = context.projects
    .map((p) => {
      let score = 0;
      if (lower.includes(p.name.toLowerCase())) score += 10;
      if (p.description.toLowerCase().includes(lower)) score += 3;
      if (p.tags?.some((t) => lower.includes(t.toLowerCase()))) score += 5;
      if (p.customer && lower.includes(p.customer.toLowerCase())) score += 4;
      return { id: p.id, name: p.name, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  // Score decisions
  const decisions = context.decisions
    .map((d) => {
      let score = 0;
      if (lower.includes(d.title.toLowerCase())) score += 10;
      if (d.decision.toLowerCase().includes(lower)) score += 8;
      if (d.context.toLowerCase().includes(lower)) score += 3;
      if (d.status === "accepted") score += 1;
      return { id: d.id, title: d.title, score };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // Score meetings
  const meetings = context.meetings
    .map((m) => {
      let score = 0;
      if (lower.includes(m.title.toLowerCase())) score += 10;
      if (m.notes.toLowerCase().includes(lower)) score += 3;
      if (m.attendees.some((a) => lower.includes(a.toLowerCase()))) score += 5;
      // Recent meetings get a boost
      const daysAgo = (Date.now() - m.date.getTime()) / (1000 * 60 * 60 * 24);
      if (daysAgo < 7) score += 2;
      return { id: m.id, title: m.title, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  // Score patterns
  const patterns = context.patterns
    .map((p) => {
      let score = 0;
      if (lower.includes(p.name.toLowerCase())) score += 10;
      if (p.description.toLowerCase().includes(lower)) score += 5;
      if (p.prompt.toLowerCase().includes(lower)) score += 3;
      // Boost effective patterns
      if (p.effectiveness && p.effectiveness > 0.7) score += 2;
      return { id: p.id, name: p.name, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  return { customers, projects, decisions, meetings, patterns };
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
