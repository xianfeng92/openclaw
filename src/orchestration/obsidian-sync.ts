/**
 * Obsidian sync module for reading business context from Obsidian vault.
 * Parses Markdown files from Customers/, Meetings/, Decisions/, Patterns/ folders.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatterBlock } from "../markdown/frontmatter.js";
import type {
  BusinessContext,
  Customer,
  Decision,
  Meeting,
  ObsidianConfig,
  Pattern,
  Project,
} from "./context-schema.js";

const DEFAULT_FOLDERS = ["Customers", "Meetings", "Decisions", "Patterns"];

/**
 * Extract body content after frontmatter.
 */
function extractBody(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) {
    return content;
  }
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return content;
  }
  return normalized.slice(endIndex + 5).trim();
}

/**
 * Parse a customer note from Markdown.
 */
function parseCustomerNote(filePath: string, content: string): Customer | null {
  const frontmatter = parseFrontmatterBlock(content);
  const body = extractBody(content);

  const name = frontmatter?.title || frontmatter?.name || path.basename(filePath, ".md");
  const notes = body || frontmatter?.notes || "";
  const contact = frontmatter?.contact || frontmatter?.email || undefined;
  const email = frontmatter?.email || undefined;
  const config = frontmatter?.config || frontmatter?.configuration;
  const tags = frontmatter?.tags || [];

  // Extract ID from filename or use slugified name
  const id = frontmatter?.id || toSlug(name);

  return {
    id,
    name,
    notes,
    contact,
    email,
    configuration: config,
    tags,
    sourceFile: filePath,
  };
}

/**
 * Parse a meeting note from Markdown.
 */
function parseMeetingNote(filePath: string, content: string): Meeting | null {
  const frontmatter = parseFrontmatterBlock(content);
  const body = extractBody(content);

  const title = frontmatter?.title || path.basename(filePath, ".md");
  const dateStr = frontmatter?.date || frontmatter?.Date;
  const date = dateStr ? new Date(dateStr) : new Date();

  const attendees = frontmatter?.attendees || frontmatter?.attendee || [];
  const attendeesArray = Array.isArray(attendees) ? attendees : [attendees];

  const notes = body || frontmatter?.notes || "";

  // Extract action items from frontmatter or body
  const actionItems = frontmatter?.actionItems || frontmatter?.["action-items"] || [];
  const actionItemsArray = Array.isArray(actionItems) ? actionItems : [actionItems];

  // Extract decision references
  const decisions = frontmatter?.decisions || [];
  const decisionsArray = Array.isArray(decisions) ? decisions : [decisions].filter(Boolean);

  // Extract project references
  const projects = frontmatter?.projects || [];
  const projectsArray = Array.isArray(projects) ? projects : [projects].filter(Boolean);

  const id = frontmatter?.id || toSlug(`${dateStr}-${title}`);

  return {
    id,
    date,
    title,
    attendees: attendeesArray,
    notes,
    actionItems: actionItemsArray,
    decisions: decisionsArray,
    projects: projectsArray,
    sourceFile: filePath,
  };
}

/**
 * Parse a decision note from Markdown.
 */
function parseDecisionNote(filePath: string, content: string): Decision | null {
  const frontmatter = parseFrontmatterBlock(content);
  const body = extractBody(content);

  const title = frontmatter?.title || path.basename(filePath, ".md");
  const dateStr = frontmatter?.date || frontmatter?.Date;
  const date = dateStr ? new Date(dateStr) : new Date();

  const context = frontmatter?.context || body?.split(/##? Decision/i)[0] || "";
  const decisionText = frontmatter?.decision || "";
  const consequences = frontmatter?.consequences || frontmatter?.cons || [];
  const consequencesArray = Array.isArray(consequences) ? consequences : [consequences];

  const alternatives = frontmatter?.alternatives || frontmatter?.alt || [];
  const alternativesArray = Array.isArray(alternatives) ? alternatives : [alternatives].filter(Boolean);

  const status = frontmatter?.status || "accepted";
  const validStatuses = ["proposed", "accepted", "deprecated", "superseded"];
  const finalStatus = validStatuses.includes(status) ? status : "accepted";

  const id = frontmatter?.id || toSlug(`${dateStr}-${title}`);

  return {
    id,
    date,
    title,
    context,
    decision: decisionText,
    consequences: consequencesArray,
    alternatives: alternativesArray,
    status: finalStatus,
    sourceFile: filePath,
  };
}

/**
 * Parse a pattern note from Markdown.
 */
function parsePatternNote(filePath: string, content: string): Pattern | null {
  const frontmatter = parseFrontmatterBlock(content);
  const body = extractBody(content);

  const name = frontmatter?.title || frontmatter?.name || path.basename(filePath, ".md");
  const description = frontmatter?.description || frontmatter?.desc || "";
  const prompt = frontmatter?.prompt || body || "";
  const category = frontmatter?.category || "other";

  const validCategories = ["coding", "debugging", "architecture", "communication", "other"];
  const finalCategory = validCategories.includes(category) ? category : "other";

  const effectiveness = typeof frontmatter?.effectiveness === "number" ? frontmatter.effectiveness : undefined;
  const usageCount = typeof frontmatter?.usageCount === "number" ? frontmatter.usageCount : 0;

  const id = frontmatter?.id || toSlug(name);

  return {
    id,
    name,
    description,
    prompt,
    category: finalCategory,
    effectiveness,
    usageCount,
    sourceFile: filePath,
  };
}

/**
 * Read all markdown files from a directory.
 */
async function readMarkdownFiles(dir: string): Promise<Array<{ path: string; content: string }>> {
  const results: Array<{ path: string; content: string }> = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  async function traverse(currentPath: string) {
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await traverse(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        try {
          const content = await fs.promises.readFile(fullPath, "utf-8");
          results.push({ path: fullPath, content });
        } catch (err) {
          console.error(`Failed to read ${fullPath}:`, err);
        }
      }
    }
  }

  await traverse(dir);
  return results;
}

/**
 * Sync context from Obsidian vault.
 */
export async function syncFromObsidian(config: ObsidianConfig): Promise<BusinessContext> {
  const { vaultPath, contextFolders = DEFAULT_FOLDERS, ignorePatterns = [] } = config;

  const context: BusinessContext = {
    customers: [],
    projects: [],
    meetings: [],
    decisions: [],
    patterns: [],
    lastSyncAt: Date.now(),
  };

  for (const folder of contextFolders) {
    const folderPath = path.join(vaultPath, folder);

    if (!fs.existsSync(folderPath)) {
      console.log(`[ObsidianSync] Folder not found: ${folderPath}`);
      continue;
    }

    const files = await readMarkdownFiles(folderPath);

    for (const { path: filePath, content } of files) {
      // Check ignore patterns
      const relativePath = path.relative(vaultPath, filePath);
      if (ignorePatterns.some((pattern) => relativePath.includes(pattern))) {
        continue;
      }

      try {
        switch (folder.toLowerCase()) {
          case "customers": {
            const customer = parseCustomerNote(filePath, content);
            if (customer) context.customers.push(customer);
            break;
          }
          case "projects": {
            const project = parseProjectNote(filePath, content);
            if (project) context.projects.push(project);
            break;
          }
          case "meetings": {
            const meeting = parseMeetingNote(filePath, content);
            if (meeting) context.meetings.push(meeting);
            break;
          }
          case "decisions": {
            const decision = parseDecisionNote(filePath, content);
            if (decision) context.decisions.push(decision);
            break;
          }
          case "patterns": {
            const pattern = parsePatternNote(filePath, content);
            if (pattern) context.patterns.push(pattern);
            break;
          }
        }
      } catch (err) {
        console.error(`[ObsidianSync] Failed to parse ${filePath}:`, err);
      }
    }
  }

  console.log(`[ObsidianSync] Synced:`, {
    customers: context.customers.length,
    projects: context.projects.length,
    meetings: context.meetings.length,
    decisions: context.decisions.length,
    patterns: context.patterns.length,
  });

  return context;
}

/**
 * Parse a project note (optional, not in main plan but useful).
 */
function parseProjectNote(filePath: string, content: string): Project | null {
  const frontmatter = parseFrontmatterBlock(content);
  const body = extractBody(content);

  const name = frontmatter?.title || frontmatter?.name || path.basename(filePath, ".md");
  const description = frontmatter?.description || frontmatter?.desc || body || "";
  const customer = frontmatter?.customer || undefined;
  const status = frontmatter?.status || "active";
  const validStatuses = ["active", "paused", "completed", "cancelled"];
  const finalStatus = validStatuses.includes(status) ? status : "active";

  const startDateStr = frontmatter?.startDate || frontmatter?.["start-date"];
  const startDate = startDateStr ? new Date(startDateStr) : undefined;

  const tags = frontmatter?.tags || [];

  const id = frontmatter?.id || toSlug(name);

  return {
    id,
    name,
    description,
    customer,
    status: finalStatus,
    startDate,
    tags,
    sourceFile: filePath,
  };
}

/**
 * Convert string to URL-safe slug.
 */
function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/**
 * Find Obsidian vault path.
 * Checks common locations.
 */
export function findObsidianVault(): string | null {
  const commonPaths = [
    path.join(process.env.HOME || process.env.USERPROFILE || "", "Obsidian", "Vault"),
    path.join(process.env.HOME || process.env.USERPROFILE || "", "Documents", "Obsidian", "Vault"),
    path.join(process.env.HOME || process.env.USERPROFILE || "", "OneDrive", "Documents", "Obsidian", "Vault"),
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}
