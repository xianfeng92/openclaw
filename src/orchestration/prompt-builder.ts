/**
 * Prompt builder for context-aware agent prompts.
 * Injects relevant business context into agent system and user prompts.
 */

import type {
  ContextInjectionOptions,
  ContextualPrompt,
  Customer,
  Decision,
  Meeting,
  Pattern,
  Project,
} from "./context-schema.js";
import {
  searchCustomers,
  searchDecisions,
  searchMeetings,
  searchPatterns,
  searchProjects,
} from "./context-manager.js";

const DEFAULT_INJECTION_OPTIONS: ContextInjectionOptions = {
  maxCustomers: 3,
  maxProjects: 3,
  maxMeetings: 5,
  maxDecisions: 5,
  maxPatterns: 2,
  includeInactive: false,
};

/**
 * Build a context-aware prompt for an agent.
 */
export async function buildContextualPrompt(
  taskDescription: string,
  context: {
    customers: Customer[];
    projects: Project[];
    meetings: Meeting[];
    decisions: Decision[];
    patterns: Pattern[];
  },
  options: ContextInjectionOptions = {},
): Promise<ContextualPrompt> {
  const opts = { ...DEFAULT_INJECTION_OPTIONS, ...options };

  // Search for relevant context
  const relevantCustomers = searchCustomers(taskDescription, context.customers)
    .slice(0, opts.maxCustomers)
    .map((r) => r.item);

  const relevantProjects = searchProjects(taskDescription, context.projects)
    .slice(0, opts.maxProjects)
    .map((r) => r.item);

  const relevantMeetings = searchMeetings(taskDescription, context.meetings)
    .slice(0, opts.maxMeetings)
    .map((r) => r.item);

  const relevantDecisions = searchDecisions(taskDescription, context.decisions)
    .slice(0, opts.maxDecisions)
    .map((r) => r.item);

  // Get most effective patterns
  const relevantPatterns = context.patterns
    .filter((p) => p.effectiveness === undefined || p.effectiveness > 0.5)
    .sort((a, b) => (b.effectiveness || 0) - (a.effectiveness || 0))
    .slice(0, opts.maxPatterns);

  // Build system prompt with context
  const systemPrompt = buildSystemPrompt({
    customers: relevantCustomers,
    projects: relevantProjects,
    meetings: relevantMeetings,
    decisions: relevantDecisions,
    patterns: relevantPatterns,
  });

  // Build user prompt (original task description with context hints)
  const userPrompt = buildUserPrompt(taskDescription, {
    customers: relevantCustomers,
    projects: relevantProjects,
    meetings: relevantMeetings,
  });

  return {
    systemPrompt,
    userPrompt,
    injectedContext: {
      customers: relevantCustomers,
      projects: relevantProjects,
      meetings: relevantMeetings,
      decisions: relevantDecisions,
      patterns: relevantPatterns,
    },
  };
}

/**
 * Build the system prompt with context.
 */
function buildSystemPrompt(context: {
  customers: Customer[];
  projects: Project[];
  meetings: Meeting[];
  decisions: Decision[];
  patterns: Pattern[];
}): string {
  const sections: string[] = [];

  // Base system prompt
  sections.push(
    "You are an expert software development assistant working on business-critical tasks.",
    "You have access to business context that should inform your decisions and approach.",
    "",
  );

  // Customers section
  if (context.customers.length > 0) {
    sections.push("## Customer Context");
    for (const customer of context.customers) {
      sections.push(`### ${customer.name}`);
      if (customer.notes) {
        sections.push(customer.notes);
      }
      if (customer.contact || customer.email) {
        sections.push(`Contact: ${customer.contact || customer.email}`);
      }
      if (customer.configuration) {
        sections.push(`Configuration: ${JSON.stringify(customer.configuration)}`);
      }
      sections.push("");
    }
  }

  // Projects section
  if (context.projects.length > 0) {
    sections.push("## Project Context");
    for (const project of context.projects) {
      sections.push(`### ${project.name} (${project.status})`);
      if (project.description) {
        sections.push(project.description);
      }
      if (project.customer) {
        sections.push(`Customer: ${project.customer}`);
      }
      sections.push("");
    }
  }

  // Recent meetings section
  if (context.meetings.length > 0) {
    sections.push("## Relevant Meetings");
    for (const meeting of context.meetings) {
      const dateStr = meeting.date.toISOString().split("T")[0];
      sections.push(`### ${meeting.title} (${dateStr})`);
      if (meeting.attendees.length > 0) {
        sections.push(`Attendees: ${meeting.attendees.join(", ")}`);
      }
      if (meeting.notes) {
        sections.push(meeting.notes);
      }
      if (meeting.actionItems.length > 0) {
        sections.push("Action Items:");
        for (const item of meeting.actionItems) {
          sections.push(`  - ${item}`);
        }
      }
      sections.push("");
    }
  }

  // Technical decisions section
  if (context.decisions.length > 0) {
    sections.push("## Technical Decisions");
    for (const decision of context.decisions) {
      const dateStr = decision.date.toISOString().split("T")[0];
      sections.push(`### ${decision.title} (${dateStr}) [${decision.status}]`);
      if (decision.context) {
        sections.push(`Context: ${decision.context}`);
      }
      sections.push(`Decision: ${decision.decision}`);
      if (decision.consequences.length > 0) {
        sections.push("Consequences:");
        for (const cons of decision.consequences) {
          sections.push(`  - ${cons}`);
        }
      }
      sections.push("");
    }
  }

  // Effective patterns section
  if (context.patterns.length > 0) {
    sections.push("## Effective Patterns");
    for (const pattern of context.patterns) {
      sections.push(`### ${pattern.name}`);
      if (pattern.description) {
        sections.push(pattern.description);
      }
      sections.push("");
    }
  }

  return sections.join("\n");
}

/**
 * Build the user prompt with context hints.
 */
function buildUserPrompt(
  taskDescription: string,
  context: {
    customers: Customer[];
    projects: Project[];
    meetings: Meeting[];
  },
): string {
  const hints: string[] = [];

  if (context.customers.length > 0) {
    hints.push(
      `This task is for: ${context.customers.map((c) => c.name).join(", ")}`,
    );
  }

  if (context.projects.length > 0) {
    hints.push(
      `Related projects: ${context.projects.map((p) => p.name).join(", ")}`,
    );
  }

  if (context.meetings.length > 0) {
    const recent = context.meetings
      .filter((m) => {
        const daysAgo = (Date.now() - m.date.getTime()) / (1000 * 60 * 60 * 24);
        return daysAgo < 30;
      })
      .slice(0, 2);

    if (recent.length > 0) {
      hints.push(
        `Recent meetings: ${recent.map((m) => m.title).join(", ")}`,
      );
    }
  }

  if (hints.length === 0) {
    return taskDescription;
  }

  return `${hints.join("\n")}\n\nTask: ${taskDescription}`;
}

/**
 * Build a prompt with pattern injection.
 * Useful when a specific pattern should be applied.
 */
export function buildPromptWithPattern(
  taskDescription: string,
  pattern: Pattern,
): string {
  return `Apply the following pattern to your task:

## Pattern: ${pattern.name}

${pattern.description}

${pattern.prompt}

---

Task: ${taskDescription}`;
}

/**
 * Build a prompt for code review with context.
 */
export function buildReviewPrompt(
  context: {
    customers: Customer[];
    projects: Project[];
    decisions: Decision[];
  },
  diffOrFiles: string,
): string {
  const sections: string[] = [];

  sections.push(
    "Review the following code changes for:",
    "1. Correctness and potential bugs",
    "2. Security vulnerabilities",
    "3. Performance issues",
    "4. Architectural consistency",
    "5. Adherence to technical decisions",
    "",
  );

  if (context.decisions.length > 0) {
    sections.push("## Relevant Technical Decisions");
    for (const decision of context.decisions) {
      sections.push(`- ${decision.title}: ${decision.decision}`);
    }
    sections.push("");
  }

  if (context.customers.length > 0) {
    sections.push(`## Customer Context`);
    for (const customer of context.customers) {
      sections.push(`- Working for ${customer.name}`);
      if (customer.configuration) {
        sections.push(`  - Config: ${JSON.stringify(customer.configuration)}`);
      }
    }
    sections.push("");
  }

  sections.push("## Code to Review");
  sections.push(diffOrFiles);

  return sections.join("\n");
}

/**
 * Build a minimal context hint for quick reference.
 */
export function buildContextHint(context: {
  customers: Customer[];
  projects: Project[];
  meetings: Meeting[];
}): string {
  const hints: string[] = [];

  if (context.customers.length > 0) {
    hints.push(`Customers: ${context.customers.map((c) => c.name).join(", ")}`);
  }

  if (context.projects.length > 0) {
    const activeProjects = context.projects.filter((p) => p.status === "active");
    if (activeProjects.length > 0) {
      hints.push(
        `Active Projects: ${activeProjects.map((p) => p.name).join(", ")}`,
      );
    }
  }

  if (hints.length === 0) {
    return "No active context";
  }

  return hints.join(" | ");
}

/**
 * Format a customer for prompt injection.
 */
export function formatCustomerForPrompt(customer: Customer): string {
  const parts: string[] = [`**Customer: ${customer.name}**`];

  if (customer.notes) {
    parts.push(customer.notes);
  }

  if (customer.contact || customer.email) {
    parts.push(`Contact: ${customer.contact || customer.email}`);
  }

  if (customer.tags && customer.tags.length > 0) {
    parts.push(`Tags: ${customer.tags.join(", ")}`);
  }

  return parts.join("\n");
}

/**
 * Format a project for prompt injection.
 */
export function formatProjectForPrompt(project: Project): string {
  const parts: string[] = [`**Project: ${project.name}** [${project.status}]`];

  if (project.description) {
    parts.push(project.description);
  }

  if (project.customer) {
    parts.push(`Customer: ${project.customer}`);
  }

  if (project.tags && project.tags.length > 0) {
    parts.push(`Tags: ${project.tags.join(", ")}`);
  }

  return parts.join("\n");
}

/**
 * Format a decision for prompt injection.
 */
export function formatDecisionForPrompt(decision: Decision): string {
  const dateStr = decision.date.toISOString().split("T")[0];
  const parts: string[] = [
    `**Decision: ${decision.title}** (${dateStr}) [${decision.status}]`,
  ];

  if (decision.context) {
    parts.push(`Context: ${decision.context}`);
  }

  parts.push(`Decision: ${decision.decision}`);

  if (decision.consequences.length > 0) {
    parts.push("Consequences:");
    decision.consequences.forEach((c) => parts.push(`  - ${c}`));
  }

  return parts.join("\n");
}
