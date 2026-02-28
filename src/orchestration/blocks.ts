/**
 * Blocks UI - Command output as interactive blocks
 * Provides data structure and operations for command execution blocks
 */

import { randomUUID } from "node:crypto";

export type BlockStatus = "running" | "success" | "error" | "cancelled";

export type BlockOutputLine = {
  content: string;
  timestamp: number;
  type: "stdout" | "stderr" | "system";
};

export interface CommandBlockMetadata {
  workingDir: string;
  sessionId: string;
  shell?: string;
  userId?: string;
  tags?: string[];
}

export interface CommandBlockStats {
  lineCount: number;
  charCount: number;
  errorCount: number;
  warningCount: number;
}

export interface CommandBlock {
  id: string;
  command: string;
  status: BlockStatus;
  exitCode: number | null;
  output: BlockOutputLine[];
  timestamp: number;
  duration: number; // in milliseconds
  metadata: CommandBlockMetadata;
  stats?: CommandBlockStats;
  collapsed?: boolean;
}

export interface BlockCreateOptions {
  command: string;
  workingDir: string;
  sessionId: string;
  shell?: string;
  userId?: string;
  tags?: string[];
}

export interface BlockSearchOptions {
  query: string;
  caseSensitive?: boolean;
  regex?: boolean;
  outputType?: "stdout" | "stderr" | "all";
}

export interface BlockSearchResult {
  blockId: string;
  matches: Array<{
    lineIndex: number;
    startIndex: number;
    endIndex: number;
    content: string;
  }>;
  totalMatches: number;
}

/**
 * Create a new command block
 */
export function createBlock(options: BlockCreateOptions): CommandBlock {
  return {
    id: randomUUID(),
    command: options.command,
    status: "running",
    exitCode: null,
    output: [],
    timestamp: Date.now(),
    duration: 0,
    metadata: {
      workingDir: options.workingDir,
      sessionId: options.sessionId,
      shell: options.shell,
      userId: options.userId,
      tags: options.tags,
    },
    collapsed: false,
  };
}

/**
 * Add output to a block
 */
export function addBlockOutput(
  block: CommandBlock,
  content: string,
  type: "stdout" | "stderr" | "system" = "stdout",
): CommandBlock {
  const lines = content.split("\n");
  const newOutput: BlockOutputLine[] = [];

  for (const line of lines) {
    newOutput.push({
      content: line,
      timestamp: Date.now(),
      type,
    });
  }

  return {
    ...block,
    output: [...block.output, ...newOutput],
  };
}

/**
 * Finalize a block with exit code
 */
export function finalizeBlock(
  block: CommandBlock,
  exitCode: number,
): CommandBlock {
  const duration = Date.now() - block.timestamp;
  const status: BlockStatus = exitCode === 0 ? "success" : "error";

  return {
    ...block,
    status,
    exitCode,
    duration,
    stats: computeBlockStats(block),
  };
}

/**
 * Cancel a running block
 */
export function cancelBlock(block: CommandBlock): CommandBlock {
  const duration = Date.now() - block.timestamp;

  return {
    ...block,
    status: "cancelled",
    exitCode: null,
    duration,
    stats: computeBlockStats(block),
  };
}

/**
 * Toggle block collapsed state
 */
export function toggleBlockCollapsed(block: CommandBlock): CommandBlock {
  return {
    ...block,
    collapsed: !block.collapsed,
  };
}

/**
 * Compute block statistics
 */
export function computeBlockStats(block: CommandBlock): CommandBlockStats {
  let errorCount = 0;
  let warningCount = 0;

  for (const line of block.output) {
    const lower = line.content.toLowerCase();
    if (lower.includes("error") || lower.includes("err:")) {
      errorCount++;
    }
    if (lower.includes("warning") || lower.includes("warn:")) {
      warningCount++;
    }
  }

  return {
    lineCount: block.output.length,
    charCount: block.output.reduce((sum, line) => sum + line.content.length, 0),
    errorCount,
    warningCount,
  };
}

/**
 * Format block for display
 */
export function formatBlock(block: CommandBlock, compact = false): string {
  const lines: string[] = [];

  // Header
  const statusIcon = getStatusIcon(block.status);
  lines.push(`${statusIcon} ${block.command}`);

  if (!compact || block.collapsed) {
    // Output
    for (const line of block.output) {
      const prefix = line.type === "stderr" ? "!" : line.type === "system" ? ">" : " ";
      lines.push(`${prefix} ${line.content}`);
    }

    // Footer with exit info
    if (block.status !== "running") {
      const exitStr = block.exitCode !== null ? `exit: ${block.exitCode}` : "cancelled";
      const durationStr = formatDuration(block.duration);
      lines.push(`--- ${exitStr} | ${durationStr}`);
    }
  } else if (block.stats) {
    // Compact single line summary
    lines.push(`   ${block.stats.lineCount} lines | ${formatDuration(block.duration)}`);
  }

  return lines.join("\n");
}

/**
 * Get status icon for block
 */
export function getStatusIcon(status: BlockStatus): string {
  switch (status) {
    case "running":
      return "▶";
    case "success":
      return "✓";
    case "error":
      return "✗";
    case "cancelled":
      return "○";
  }
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Search within a block
 */
export function searchInBlock(
  block: CommandBlock,
  options: BlockSearchOptions,
): BlockSearchResult {
  const matches: BlockSearchResult["matches"] = [];
  const { query, caseSensitive = false, outputType = "all" } = options;

  // Short-circuit empty query to avoid infinite loop
  if (!query) {
    return {
      blockId: block.id,
      matches: [],
      totalMatches: 0,
    };
  }

  let searchQuery = query;
  if (!caseSensitive) {
    searchQuery = query.toLowerCase();
  }

  for (let i = 0; i < block.output.length; i++) {
    const line = block.output[i];

    // Skip if output type doesn't match
    if (outputType !== "all" && line.type !== outputType) {
      continue;
    }

    let lineContent = line.content;
    if (!caseSensitive) {
      lineContent = line.content.toLowerCase();
    }

    let startIndex = 0;
    let index;
    while ((index = lineContent.indexOf(searchQuery, startIndex)) !== -1) {
      matches.push({
        lineIndex: i,
        startIndex: index,
        endIndex: index + query.length,
        content: line.content,
      });
      startIndex = index + 1;
    }
  }

  return {
    blockId: block.id,
    matches,
    totalMatches: matches.length,
  };
}

/**
 * Get block output as plain text
 */
export function getBlockOutputAsText(block: CommandBlock, includeSystem = false): string {
  return block.output
    .filter((line) => includeSystem || line.type !== "system")
    .map((line) => line.content)
    .join("\n");
}

/**
 * Get block output as JSON
 */
export function getBlockOutputAsJSON(block: CommandBlock): string {
  return JSON.stringify(block.output, null, 2);
}

/**
 * Create a shareable link for a block
 */
export function createBlockShareLink(block: CommandBlock, baseUrl = ""): string {
  // In a real implementation, this would create a URL that encodes the block data
  // For now, we use btoa with proper UTF-8 encoding
  const encoded = btoa(unescape(encodeURIComponent(block.command)));
  return `${baseUrl}/block/${block.id}/${encoded}`;
}

/**
 * Parse a shareable link to get block data
 */
export function parseBlockShareLink(link: string): { id: string; command: string } | null {
  try {
    // Handle relative paths by prepending a dummy base URL
    let url: URL;
    if (link.startsWith("/")) {
      url = new URL(link, "http://localhost");
    } else if (link.startsWith("http://") || link.startsWith("https://")) {
      url = new URL(link);
    } else {
      // Assume it's a relative path without leading slash
      url = new URL(`/${link}`, "http://localhost");
    }

    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] === "block" && parts[1] && parts[2]) {
      return {
        id: parts[1],
        command: decodeURIComponent(escape(atob(parts[2]))),
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Filter blocks by criteria
 */
export function filterBlocks(
  blocks: CommandBlock[],
  criteria: {
    status?: BlockStatus;
    sessionId?: string;
    userId?: string;
    minDuration?: number;
    maxDuration?: number;
    tags?: string[];
    commandPattern?: RegExp;
  },
): CommandBlock[] {
  return blocks.filter((block) => {
    if (criteria.status && block.status !== criteria.status) {
      return false;
    }
    if (criteria.sessionId && block.metadata.sessionId !== criteria.sessionId) {
      return false;
    }
    if (criteria.userId && block.metadata.userId !== criteria.userId) {
      return false;
    }
    if (criteria.minDuration && block.duration < criteria.minDuration) {
      return false;
    }
    if (criteria.maxDuration && block.duration > criteria.maxDuration) {
      return false;
    }
    if (criteria.tags && criteria.tags.length > 0) {
      const blockTags = block.metadata.tags ?? [];
      if (!criteria.tags.every((tag) => blockTags.includes(tag))) {
        return false;
      }
    }
    if (criteria.commandPattern && !criteria.commandPattern.test(block.command)) {
      return false;
    }
    return true;
  });
}

/**
 * Sort blocks by criteria
 */
export function sortBlocks(
  blocks: CommandBlock[],
  sortBy: "timestamp" | "duration" | "command" | "status",
  order: "asc" | "desc" = "desc",
): CommandBlock[] {
  return [...blocks].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "timestamp":
        comparison = a.timestamp - b.timestamp;
        break;
      case "duration":
        comparison = a.duration - b.duration;
        break;
      case "command":
        comparison = a.command.localeCompare(b.command);
        break;
      case "status":
        const statusOrder = ["running", "success", "error", "cancelled"];
        comparison =
          statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
        break;
    }

    return order === "asc" ? comparison : -comparison;
  });
}

/**
 * Get block summary for list view
 */
export function getBlockSummary(block: CommandBlock): {
  id: string;
  command: string;
  status: BlockStatus;
  exitCode: number | null;
  duration: number;
  timestamp: number;
  outputLineCount: number;
  hasErrors: boolean;
  hasWarnings: boolean;
} {
  return {
    id: block.id,
    command: block.command,
    status: block.status,
    exitCode: block.exitCode,
    duration: block.duration,
    timestamp: block.timestamp,
    outputLineCount: block.output.length,
    hasErrors: (block.stats?.errorCount ?? 0) > 0,
    hasWarnings: (block.stats?.warningCount ?? 0) > 0,
  };
}
