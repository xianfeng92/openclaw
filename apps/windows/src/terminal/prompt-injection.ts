/**
 * Prompt injection helper for OpenClaw Terminal.
 * Builds context-aware prompts for agents.
 */

export interface PromptContext {
  description: string;
  customers: Array<{ name: string; score: number }>;
  projects: Array<{ name: string; score: number }>;
  decisions: Array<{ title: string; score: number }>;
}

/**
 * Build a system prompt with context injection.
 * This would be called when spawning an actual AI agent.
 */
export function buildContextualSystemPrompt(context: PromptContext): string {
  const sections: string[] = [];

  // Base system prompt
  sections.push("You are an expert software development assistant working on business-critical tasks.");

  // Add customer context if available
  if (context.customers.length > 0) {
    sections.push("\n## Customer Context");
    for (const customer of context.customers) {
      sections.push(`- Working for: ${customer.name}`);
    }
  }

  // Add project context if available
  if (context.projects.length > 0) {
    sections.push("\n## Project Context");
    for (const project of context.projects) {
      sections.push(`- Project: ${project.name}`);
    }
  }

  // Add decision context if available
  if (context.decisions.length > 0) {
    sections.push("\n## Technical Decisions to Follow");
    for (const decision of context.decisions) {
      sections.push(`- ${decision.title}`);
    }
  }

  sections.push("\n## Task");
  sections.push(context.description);

  return sections.join("\n");
}

/**
 * Build a detailed prompt that includes context notes.
 */
export function buildDetailedPrompt(
  baseDescription: string,
  contextData: {
    customers?: Array<{ name: string; notes?: string; tags?: string[] }>;
    projects?: Array<{ name: string; description?: string; status?: string }>;
    decisions?: Array<{ title: string; decision: string; consequences?: string[] }>;
  },
): string {
  const parts: string[] = [];

  // Add customer context
  if (contextData.customers && contextData.customers.length > 0) {
    parts.push("## Customer Context\n");
    for (const customer of contextData.customers) {
      parts.push(`**${customer.name}**`);
      if (customer.tags && customer.tags.length > 0) {
        parts.push(`Tags: ${customer.tags.join(", ")}`);
      }
      if (customer.notes) {
        parts.push(customer.notes);
      }
      parts.push("");
    }
  }

  // Add project context
  if (contextData.projects && contextData.projects.length > 0) {
    parts.push("## Project Context\n");
    for (const project of contextData.projects) {
      parts.push(`**${project.name}** [${project.status || "active"}]`);
      if (project.description) {
        parts.push(project.description);
      }
      parts.push("");
    }
  }

  // Add decision context
  if (contextData.decisions && contextData.decisions.length > 0) {
    parts.push("## Technical Decisions\n");
    for (const decision of contextData.decisions) {
      parts.push(`**${decision.title}**`);
      parts.push(decision.decision);
      if (decision.consequences && decision.consequences.length > 0) {
        parts.push("Consequences:");
        decision.consequences.forEach((c) => parts.push(`  - ${c}`));
      }
      parts.push("");
    }
  }

  // Add the task description
  parts.push("## Task\n");
  parts.push(baseDescription);

  return parts.join("\n");
}

/**
 * Format context for display in the terminal.
 */
export function formatContextForDisplay(context: PromptContext): string[] {
  const lines: string[] = [];

  if (context.customers.length > 0) {
    lines.push("👤 Customers:");
    for (const customer of context.customers) {
      lines.push(`  • ${customer.name} (relevance: ${customer.score})`);
    }
  }

  if (context.projects.length > 0) {
    lines.push("📁 Projects:");
    for (const project of context.projects) {
      lines.push(`  • ${project.name} (relevance: ${project.score})`);
    }
  }

  if (context.decisions.length > 0) {
    lines.push("🔀 Decisions:");
    for (const decision of context.decisions) {
      lines.push(`  • ${decision.title} (relevance: ${decision.score})`);
    }
  }

  return lines;
}

/**
 * Generate a context summary string.
 */
export function generateContextSummary(context: PromptContext): string {
  const parts: string[] = [];

  if (context.customers.length > 0) {
    parts.push(`${context.customers.length} customer(s)`);
  }

  if (context.projects.length > 0) {
    parts.push(`${context.projects.length} project(s)`);
  }

  if (context.decisions.length > 0) {
    parts.push(`${context.decisions.length} decision(s)`);
  }

  return parts.length > 0 ? parts.join(", ") : "No relevant context";
}
