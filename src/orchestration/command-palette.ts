/**
 * Command Palette - Unified command entry point
 * Integrates Workflows, Aliases, and Quick Actions for fuzzy search and execution
 */

import { loadWorkflows, executeWorkflow, type Workflow } from "./workflows.js";
import { searchAliases, getQuickActions, type Alias, type QuickAction } from "./alias-service.js";

export type PaletteItemType = "workflow" | "alias" | "quick-action";

export interface PaletteItem {
  id: string;
  type: PaletteItemType;
  name: string;
  description: string;
  icon?: string;
  execute: (params?: Record<string, string>) => Promise<PaletteExecuteResult>;
  metadata?: {
    category?: string;
    tags?: string[];
    usageCount?: number;
  };
}

export interface PaletteExecuteResult {
  success: boolean;
  command?: string;
  output?: string;
  error?: string;
}

export interface PaletteSearchOptions {
  limit?: number;
  includeTypes?: PaletteItemType[];
  category?: string;
}

export interface PaletteSearchResult {
  items: PaletteItem[];
  query: string;
  total: number;
}

// Icons for different item types
const TYPE_ICONS: Record<PaletteItemType, string> = {
  workflow: "📦",
  alias: "🔧",
  "quick-action": "⚡",
};

/**
 * Simple fuzzy match implementation
 * Returns true if the query matches the target string
 */
export function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  // Exact match
  if (targetLower.includes(queryLower)) {
    return true;
  }

  // Fuzzy match - check if all query chars appear in order
  let queryIndex = 0;
  for (const char of targetLower) {
    if (char === queryLower[queryIndex]) {
      queryIndex++;
      if (queryIndex === queryLower.length) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Score a match for sorting results
 * Higher score = better match
 */
export function scoreMatch(query: string, target: string): number {
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  // Exact match gets highest score
  if (targetLower === queryLower) {
    return 100;
  }

  // Starts with query
  if (targetLower.startsWith(queryLower)) {
    return 80;
  }

  // Contains query
  if (targetLower.includes(queryLower)) {
    return 60;
  }

  // Fuzzy match - score based on how compact the match is
  let queryIndex = 0;
  let lastMatchIndex = 0;
  let totalDistance = 0;

  for (let i = 0; i < targetLower.length && queryIndex < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIndex]) {
      if (queryIndex > 0) {
        totalDistance += i - lastMatchIndex;
      }
      lastMatchIndex = i;
      queryIndex++;
    }
  }

  if (queryIndex === queryLower.length) {
    // Lower distance = better match
    return Math.max(0, 50 - totalDistance);
  }

  return 0;
}

/**
 * Convert a Workflow to a PaletteItem
 */
function workflowToPaletteItem(workflow: Workflow, workspaceDir?: string): PaletteItem {
  return {
    id: `workflow:${workflow.name}`,
    type: "workflow",
    name: workflow.name,
    description: workflow.description,
    icon: TYPE_ICONS.workflow,
    execute: async (params) => {
      const result = await executeWorkflow(workflow.name, params, workspaceDir);
      return {
        success: result.success,
        command: result.command,
        error: result.error,
      };
    },
    metadata: {
      category: "workflow",
      tags: workflow.shortcuts,
    },
  };
}

/**
 * Convert an Alias to a PaletteItem
 */
function aliasToPaletteItem(alias: Alias): PaletteItem {
  return {
    id: `alias:${alias.name}`,
    type: "alias",
    name: alias.name,
    description: alias.description || `Alias for: ${alias.command}`,
    icon: TYPE_ICONS.alias,
    execute: async () => {
      // For aliases, we return the command that should be executed
      // The actual execution happens in the terminal
      return {
        success: true,
        command: alias.command,
      };
    },
    metadata: {
      category: "alias",
      tags: alias.tags,
      usageCount: alias.usageCount ?? 0,
    },
  };
}

/**
 * Convert a QuickAction to a PaletteItem
 */
function quickActionToPaletteItem(action: QuickAction): PaletteItem {
  return {
    id: `quick-action:${action.name}`,
    type: "quick-action",
    name: action.name,
    description: action.description ?? action.command,
    icon: TYPE_ICONS["quick-action"],
    execute: async () => {
      // For quick actions, we return the command that should be executed
      return {
        success: true,
        command: action.command,
      };
    },
    metadata: {
      category: "quick-action",
      tags: action.tags,
    },
  };
}

/**
 * Load all palette items from various sources
 */
export async function loadPaletteItems(workspaceDir?: string): Promise<PaletteItem[]> {
  const items: PaletteItem[] = [];

  // Load workflows
  const workflows = await loadWorkflows(workspaceDir);
  for (const workflow of workflows.values()) {
    items.push(workflowToPaletteItem(workflow, workspaceDir));
  }

  // Load aliases
  const aliases = await searchAliases("");
  for (const alias of aliases) {
    items.push(aliasToPaletteItem(alias));
  }

  // Load quick actions
  const quickActions = await getQuickActions();
  for (const action of quickActions) {
    items.push(quickActionToPaletteItem(action));
  }

  return items;
}

/**
 * Search palette items by query
 */
export async function searchPalette(
  query: string,
  options?: PaletteSearchOptions,
  workspaceDir?: string,
): Promise<PaletteSearchResult> {
  const items = await loadPaletteItems(workspaceDir);

  // Filter by type if specified
  let filteredItems = items;
  if (options?.includeTypes && options.includeTypes.length > 0) {
    filteredItems = items.filter((item) => options.includeTypes!.includes(item.type));
  }

  // Filter by category if specified
  if (options?.category) {
    filteredItems = filteredItems.filter(
      (item) => item.metadata?.category === options.category,
    );
  }

  // Score and filter by fuzzy match
  const scoredItems = filteredItems
    .map((item) => {
      const nameScore = scoreMatch(query, item.name);
      const descScore = scoreMatch(query, item.description);
      const maxScore = Math.max(nameScore, descScore);
      return { item, score: maxScore };
    })
    .filter(({ score }) => score > 0);

  // Sort by score (descending) and usage count (descending)
  scoredItems.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    const aUsage = a.item.metadata?.usageCount ?? 0;
    const bUsage = b.item.metadata?.usageCount ?? 0;
    return bUsage - aUsage;
  });

  // Apply limit
  const limitedItems = scoredItems
    .slice(0, options?.limit ?? 20)
    .map(({ item }) => item);

  return {
    items: limitedItems,
    query,
    total: scoredItems.length,
  };
}

/**
 * Execute a palette item by ID
 */
export async function executePaletteItem(
  itemId: string,
  params?: Record<string, string>,
  workspaceDir?: string,
): Promise<PaletteExecuteResult> {
  const items = await loadPaletteItems(workspaceDir);
  const item = items.find((i) => i.id === itemId);

  if (!item) {
    return {
      success: false,
      error: `Item "${itemId}" not found`,
    };
  }

  return item.execute(params);
}

/**
 * Get all unique categories
 */
export async function getPaletteCategories(workspaceDir?: string): Promise<string[]> {
  const items = await loadPaletteItems(workspaceDir);
  const categories = new Set<string>();
  for (const item of items) {
    if (item.metadata?.category) {
      categories.add(item.metadata.category);
    }
  }
  return Array.from(categories).sort();
}

/**
 * Get palette items by category
 */
export async function getItemsByCategory(
  category: string,
  workspaceDir?: string,
): Promise<PaletteItem[]> {
  const items = await loadPaletteItems(workspaceDir);
  return items.filter((item) => item.metadata?.category === category);
}

/**
 * Get popular items (by usage count)
 */
export async function getPopularItems(
  limit = 10,
  workspaceDir?: string,
): Promise<PaletteItem[]> {
  const items = await loadPaletteItems(workspaceDir);
  return items
    .sort((a, b) => (b.metadata?.usageCount ?? 0) - (a.metadata?.usageCount ?? 0))
    .slice(0, limit);
}
