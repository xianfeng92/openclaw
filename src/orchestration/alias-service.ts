/**
 * Alias and Quick Action Service
 * Allows creating shortcuts for frequently used commands.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveStateDir } from "../config/paths.js";

/**
 * An alias definition.
 */
export interface Alias {
  id: string;
  name: string;
  command: string;
  description?: string;
  createdAt: number;
  usageCount: number;
  tags?: string[];
}

/**
 * Quick action preset.
 */
export interface QuickAction {
  id: string;
  name: string;
  icon: string;
  command: string;
  description?: string;
  category?: string;
  tags?: string[];
}

const ALIASES_FILE = "aliases.json";
let aliasesCache: Alias[] | null = null;

function getAliasesPath(): string {
  const stateDir = resolveStateDir();
  return path.join(stateDir, ALIASES_FILE);
}

/**
 * Built-in quick actions.
 */
export const BUILT_IN_QUICK_ACTIONS: QuickAction[] = [
  {
    id: "quick-fix",
    name: "Quick Fix",
    icon: "🔧",
    command: "/spawn Fix the bug --agent codex --no-context",
    description: "Spawn a quick bug-fix agent",
    category: "debug",
  },
  {
    id: "quick-feature",
    name: "Add Feature",
    icon: "✨",
    command: "/spawn Implement feature --agent claude",
    description: "Spawn a feature implementation agent",
    category: "feature",
  },
  {
    id: "quick-test",
    name: "Run Tests",
    icon: "🧪",
    command: "!npm test",
    description: "Run test suite",
    category: "testing",
  },
  {
    id: "quick-status",
    name: "Status",
    icon: "📊",
    command: "/status",
    description: "Show system status",
    category: "system",
  },
  {
    id: "quick-context",
    name: "Load Context",
    icon: "📚",
    command: "/context load",
    description: "Load Obsidian context",
    category: "context",
  },
];

/**
 * Load all aliases.
 */
export async function loadAliases(): Promise<Alias[]> {
  if (aliasesCache) {
    return aliasesCache;
  }

  const aliasesPath = getAliasesPath();

  if (!fs.existsSync(aliasesPath)) {
    aliasesCache = [];
    return [];
  }

  try {
    const content = fs.readFileSync(aliasesPath, "utf-8");
    aliasesCache = JSON.parse(content) as Alias[];
    return aliasesCache ?? [];
  } catch {
    aliasesCache = [];
    return [];
  }
}

/**
 * Save all aliases.
 */
async function saveAliases(aliases: Alias[]): Promise<void> {
  const aliasesPath = getAliasesPath();

  const dir = path.dirname(aliasesPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(aliasesPath, JSON.stringify(aliases, null, 2));
  aliasesCache = aliases;
}

/**
 * Clear aliases cache.
 */
export function clearAliasesCache(): void {
  aliasesCache = null;
}

/**
 * Get an alias by name.
 */
export async function getAlias(name: string): Promise<Alias | null> {
  const aliases = await loadAliases();
  return aliases.find((a) => a.name.toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Create a new alias.
 */
export async function createAlias(alias: Omit<Alias, "id" | "createdAt" | "usageCount">): Promise<Alias> {
  const aliases = await loadAliases();

  const newAlias: Alias = {
    ...alias,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    usageCount: 0,
  };

  aliases.push(newAlias);
  await saveAliases(aliases);

  return newAlias;
}

/**
 * Delete an alias.
 */
export async function deleteAlias(name: string): Promise<boolean> {
  const aliases = await loadAliases();
  const index = aliases.findIndex((a) => a.name.toLowerCase() === name.toLowerCase());

  if (index === -1) {
    return false;
  }

  aliases.splice(index, 1);
  await saveAliases(aliases);
  return true;
}

/**
 * List all aliases.
 */
export async function listAliases(): Promise<Alias[]> {
  return await loadAliases();
}

/**
 * Increment alias usage count.
 */
export async function incrementAliasUsage(name: string): Promise<void> {
  const aliases = await loadAliases();
  const alias = aliases.find((a) => a.name.toLowerCase() === name.toLowerCase());

  if (alias) {
    alias.usageCount++;
    await saveAliases(aliases);
  }
}

/**
 * Get quick actions (built-in + custom aliases).
 */
export async function getQuickActions(): Promise<QuickAction[]> {
  const aliases = await loadAliases();

  return [
    ...BUILT_IN_QUICK_ACTIONS,
    ...aliases.map((a) => ({
      id: a.id,
      name: a.name,
      icon: "⚡",
      command: a.command,
      description: a.description || `Custom alias for: ${a.command}`,
      category: "custom",
    })),
  ];
}

/**
 * Search aliases by name or command.
 */
export async function searchAliases(query: string): Promise<Alias[]> {
  const aliases = await loadAliases();
  const lowerQuery = query.toLowerCase();

  return aliases.filter((a) =>
    a.name.toLowerCase().includes(lowerQuery) ||
    a.command.toLowerCase().includes(lowerQuery)
  );
}
