/**
 * Context manager for business context.
 * Manages storage, retrieval, and search of business context.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getMemorySearchManager } from "../memory/index.js";
import type {
  BusinessContext,
  ContextSearchResult,
  Customer,
  Decision,
  Meeting,
  ObsidianConfig,
  Pattern,
  Project,
} from "./context-schema.js";
import { syncFromObsidian } from "./obsidian-sync.js";
import { resolveStateDir } from "../config/paths.js";
import { categorizeTask, type TaskCategory } from "./agent-selector.js";

const CONTEXT_DB_FILENAME = "business-context.json";
let cachedContext: BusinessContext | null = null;
let contextFilePath: string | null = null;

/**
 * Get the path to the context storage file.
 */
function getContextPath(): string {
  if (contextFilePath) {
    return contextFilePath;
  }
  const stateDir = resolveStateDir();
  contextFilePath = path.join(stateDir, CONTEXT_DB_FILENAME);
  return contextFilePath;
}

/**
 * Get default empty context.
 */
function getDefaultContext(): BusinessContext {
  return {
    customers: [],
    projects: [],
    meetings: [],
    decisions: [],
    patterns: [],
    lastSyncAt: undefined,
  };
}

/**
 * Load business context from storage.
 */
export async function loadContext(): Promise<BusinessContext> {
  if (cachedContext) {
    return cachedContext;
  }

  const filePath = getContextPath();

  if (!fs.existsSync(filePath)) {
    cachedContext = getDefaultContext();
    return cachedContext;
  }

  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content) as BusinessContext;

    // Validate structure
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.customers) ||
      !Array.isArray(parsed.projects)
    ) {
      console.warn("[ContextManager] Invalid context file, using defaults");
      cachedContext = getDefaultContext();
      return cachedContext;
    }

    // Convert date strings back to Date objects
    parsed.meetings = parsed.meetings.map((m) => ({
      ...m,
      date: new Date(m.date),
    }));
    parsed.decisions = parsed.decisions.map((d) => ({
      ...d,
      date: new Date(d.date),
    }));
    parsed.projects = parsed.projects.map((p) => ({
      ...p,
      startDate: p.startDate ? new Date(p.startDate) : undefined,
    }));

    cachedContext = parsed;
    return cachedContext;
  } catch (err) {
    console.error("[ContextManager] Failed to load context:", err);
    cachedContext = getDefaultContext();
    return cachedContext;
  }
}

/**
 * Save business context to storage.
 */
export async function saveContext(context: BusinessContext): Promise<void> {
  const filePath = getContextPath();

  // Ensure directory exists
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });

  const content = JSON.stringify(context, null, 2);
  await fs.promises.writeFile(filePath, content, {
    encoding: "utf-8",
    mode: 0o600,
  });

  cachedContext = context;
}

/**
 * Sync context from Obsidian vault.
 */
export async function syncContext(config: ObsidianConfig): Promise<BusinessContext> {
  const newContext = await syncFromObsidian(config);
  await saveContext(newContext);
  return newContext;
}

/**
 * Get all customers.
 */
export async function getCustomers(): Promise<Customer[]> {
  const context = await loadContext();
  return context.customers;
}

/**
 * Get all projects.
 */
export async function getProjects(): Promise<Project[]> {
  const context = await loadContext();
  return context.projects;
}

/**
 * Get all meetings.
 */
export async function getMeetings(): Promise<Meeting[]> {
  const context = await loadContext();
  return context.meetings;
}

/**
 * Get all decisions.
 */
export async function getDecisions(): Promise<Decision[]> {
  const context = await loadContext();
  return context.decisions;
}

/**
 * Get all patterns.
 */
export async function getPatterns(): Promise<Pattern[]> {
  const context = await loadContext();
  return context.patterns;
}

/**
 * Find customer by ID.
 */
export async function getCustomerById(id: string): Promise<Customer | null> {
  const context = await loadContext();
  return context.customers.find((c) => c.id === id) || null;
}

/**
 * Find project by ID.
 */
export async function getProjectById(id: string): Promise<Project | null> {
  const context = await loadContext();
  return context.projects.find((p) => p.id === id) || null;
}

/**
 * Search customers by name or notes.
 */
export function searchCustomers(
  query: string,
  customers: Customer[],
): ContextSearchResult<Customer>[] {
  const lowerQuery = query.toLowerCase();

  return customers
    .map((customer) => {
      let score = 0;
      const reasons: string[] = [];

      // Name match (high score)
      if (customer.name.toLowerCase().includes(lowerQuery)) {
        score += 10;
        reasons.push("name match");
      }

      // Tag match
      if (customer.tags?.some((t) => t.toLowerCase().includes(lowerQuery))) {
        score += 5;
        reasons.push("tag match");
      }

      // Notes match (lower score)
      if (customer.notes.toLowerCase().includes(lowerQuery)) {
        score += 2;
        reasons.push("notes match");
      }

      // Email/contact match
      if (
        customer.email?.toLowerCase().includes(lowerQuery) ||
        customer.contact?.toLowerCase().includes(lowerQuery)
      ) {
        score += 3;
        reasons.push("contact match");
      }

      return {
        item: customer,
        score,
        matchReason: reasons.join(", ") || "no match",
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Search projects by name or description.
 */
export function searchProjects(
  query: string,
  projects: Project[],
): ContextSearchResult<Project>[] {
  const lowerQuery = query.toLowerCase();

  return projects
    .map((project) => {
      let score = 0;
      const reasons: string[] = [];

      if (project.name.toLowerCase().includes(lowerQuery)) {
        score += 10;
        reasons.push("name match");
      }

      if (project.description.toLowerCase().includes(lowerQuery)) {
        score += 3;
        reasons.push("description match");
      }

      if (project.tags?.some((t) => t.toLowerCase().includes(lowerQuery))) {
        score += 5;
        reasons.push("tag match");
      }

      if (project.customer?.toLowerCase().includes(lowerQuery)) {
        score += 4;
        reasons.push("customer match");
      }

      return {
        item: project,
        score,
        matchReason: reasons.join(", ") || "no match",
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Search meetings by title, notes, or attendees.
 */
export function searchMeetings(
  query: string,
  meetings: Meeting[],
): ContextSearchResult<Meeting>[] {
  const lowerQuery = query.toLowerCase();

  return meetings
    .map((meeting) => {
      let score = 0;
      const reasons: string[] = [];

      if (meeting.title.toLowerCase().includes(lowerQuery)) {
        score += 10;
        reasons.push("title match");
      }

      if (meeting.notes.toLowerCase().includes(lowerQuery)) {
        score += 3;
        reasons.push("notes match");
      }

      if (meeting.attendees.some((a) => a.toLowerCase().includes(lowerQuery))) {
        score += 5;
        reasons.push("attendee match");
      }

      // Recent meetings get a slight boost
      const daysAgo = (Date.now() - meeting.date.getTime()) / (1000 * 60 * 60 * 24);
      if (daysAgo < 7) {
        score += 1;
        reasons.push("recent");
      }

      return {
        item: meeting,
        score,
        matchReason: reasons.join(", ") || "no match",
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Search decisions by title, context, or decision text.
 */
export function searchDecisions(
  query: string,
  decisions: Decision[],
): ContextSearchResult<Decision>[] {
  const lowerQuery = query.toLowerCase();

  return decisions
    .map((decision) => {
      let score = 0;
      const reasons: string[] = [];

      if (decision.title.toLowerCase().includes(lowerQuery)) {
        score += 10;
        reasons.push("title match");
      }

      if (decision.decision.toLowerCase().includes(lowerQuery)) {
        score += 8;
        reasons.push("decision match");
      }

      if (decision.context.toLowerCase().includes(lowerQuery)) {
        score += 3;
        reasons.push("context match");
      }

      // Boost active decisions
      if (decision.status === "accepted") {
        score += 1;
      }

      return {
        item: decision,
        score,
        matchReason: reasons.join(", ") || "no match",
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Search patterns by name or description.
 */
export function searchPatterns(
  query: string,
  patterns: Pattern[],
): ContextSearchResult<Pattern>[] {
  const lowerQuery = query.toLowerCase();

  return patterns
    .map((pattern) => {
      let score = 0;
      const reasons: string[] = [];

      if (pattern.name.toLowerCase().includes(lowerQuery)) {
        score += 10;
        reasons.push("name match");
      }

      if (pattern.description.toLowerCase().includes(lowerQuery)) {
        score += 5;
        reasons.push("description match");
      }

      if (pattern.prompt.toLowerCase().includes(lowerQuery)) {
        score += 3;
        reasons.push("prompt match");
      }

      // Boost effective patterns
      if (pattern.effectiveness && pattern.effectiveness > 0.7) {
        score += 2;
        reasons.push("highly effective");
      }

      return {
        item: pattern,
        score,
        matchReason: reasons.join(", ") || "no match",
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Search all context for a query.
 */
export async function searchContext(query: string): Promise<{
  customers: ContextSearchResult<Customer>[];
  projects: ContextSearchResult<Project>[];
  meetings: ContextSearchResult<Meeting>[];
  decisions: ContextSearchResult<Decision>[];
  patterns: ContextSearchResult<Pattern>[];
}> {
  const context = await loadContext();

  return {
    customers: searchCustomers(query, context.customers),
    projects: searchProjects(query, context.projects),
    meetings: searchMeetings(query, context.meetings),
    decisions: searchDecisions(query, context.decisions),
    patterns: searchPatterns(query, context.patterns),
  };
}

/**
 * Add or update a customer.
 */
export async function upsertCustomer(customer: Customer): Promise<void> {
  const context = await loadContext();
  const index = context.customers.findIndex((c) => c.id === customer.id);

  if (index >= 0) {
    context.customers[index] = customer;
  } else {
    context.customers.push(customer);
  }

  await saveContext(context);
}

/**
 * Add or update a pattern.
 */
export async function upsertPattern(pattern: Pattern): Promise<void> {
  const context = await loadContext();
  const index = context.patterns.findIndex((p) => p.id === pattern.id);

  if (index >= 0) {
    context.patterns[index] = pattern;
  } else {
    context.patterns.push(pattern);
  }

  await saveContext(context);
}

/**
 * Update pattern effectiveness score.
 */
export async function updatePatternEffectiveness(
  patternId: string,
  success: boolean,
): Promise<void> {
  const context = await loadContext();
  const pattern = context.patterns.find((p) => p.id === patternId);

  if (!pattern) {
    return;
  }

  // Initialize effectiveness if not set
  if (pattern.effectiveness === undefined) {
    pattern.effectiveness = 0.5;
  }

  // Initialize usage count
  if (!pattern.usageCount) {
    pattern.usageCount = 0;
  }

  // Update using exponential moving average
  const alpha = 0.2; // Learning rate
  const target = success ? 1 : 0;
  pattern.effectiveness = alpha * target + (1 - alpha) * pattern.effectiveness;
  pattern.usageCount += 1;

  await saveContext(context);
}

/**
 * Pattern category mapping to task categories from agent-selector.
 * Maps pattern categories to the TaskCategory values they best support.
 */
const PATTERN_CATEGORY_MAPPING: Record<string, TaskCategory[]> = {
  "bug-fix": ["bugfix"],
  "feature": ["feature"],
  "refactor": ["refactor"],
  "coding": ["bugfix", "feature", "refactor"],
  "architecture": ["refactor", "feature"],
  "testing": ["test", "bugfix"],
  "documentation": ["docs"],
  "security": ["security"],
  "performance": ["performance", "refactor"],
  "general": ["general"],
};

/**
 * Recommend patterns for a given task description.
 * Returns patterns ranked by relevance, effectiveness, and usage.
 */
export async function recommendPatterns(
  description: string,
  limit: number = 3,
): Promise<ContextSearchResult<Pattern>[]> {
  const context = await loadContext();
  const taskCategory = categorizeTask(description);
  const lowerDesc = description.toLowerCase();

  // Score each pattern
  const scored = context.patterns.map((pattern) => {
    let score = 0;
    const reasons: string[] = [];

    // Category match (high weight)
    const patternTaskTypes = PATTERN_CATEGORY_MAPPING[pattern.category] || [];
    if (patternTaskTypes.includes(taskCategory)) {
      score += 20;
      reasons.push("category match");
    } else if (patternTaskTypes.includes("general")) {
      // Generic patterns get lower base score
      score += 5;
    }

    // Keyword matches in pattern name/description
    if (pattern.name.toLowerCase().includes(lowerDesc)) {
      score += 15;
      reasons.push("name match");
    }
    if (pattern.description.toLowerCase().includes(lowerDesc)) {
      score += 10;
      reasons.push("description match");
    }

    // Effectiveness boost (very important)
    if (pattern.effectiveness) {
      if (pattern.effectiveness >= 0.8) {
        score += 15;
        reasons.push("highly effective");
      } else if (pattern.effectiveness >= 0.6) {
        score += 10;
        reasons.push("effective");
      } else if (pattern.effectiveness >= 0.4) {
        score += 5;
        reasons.push("moderately effective");
      }
    }

    // Usage count boost (patterns proven in practice)
    if (pattern.usageCount && pattern.usageCount >= 5) {
      score += 5;
      reasons.push("proven");
    }

    // Recency boost (recently updated/used patterns)
    const daysSinceUpdate = pattern.updatedAt
      ? (Date.now() - pattern.updatedAt) / (1000 * 60 * 60 * 24)
      : 365;
    if (daysSinceUpdate < 30) {
      score += 2;
      reasons.push("recent");
    }

    return {
      item: pattern,
      score,
      matchReason: reasons.join(", ") || "general suggestion",
    };
  });

  // Filter out patterns with no score and sort
  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Get context summary for display.
 */
export async function getContextSummary(): Promise<{
  customers: number;
  projects: number;
  meetings: number;
  decisions: number;
  patterns: number;
  lastSyncAt?: string;
}> {
  const context = await loadContext();

  return {
    customers: context.customers.length,
    projects: context.projects.length,
    meetings: context.meetings.length,
    decisions: context.decisions.length,
    patterns: context.patterns.length,
    lastSyncAt: context.lastSyncAt
      ? new Date(context.lastSyncAt).toISOString()
      : undefined,
  };
}

/**
 * Clear cached context (useful for testing or forced refresh).
 */
export function clearContextCache(): void {
  cachedContext = null;
}
