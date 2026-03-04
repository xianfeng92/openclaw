import fs from "node:fs";
import path from "node:path";

export type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
};

export type MemorySearchOptions = {
  maxResults?: number;
  minScore?: number;
};

export type MemoryGetParams = {
  path: string;
  from?: number;
  lines?: number;
};

export type SessionSnapshotMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SessionSnapshotReason = "session-memory" | "session-rotate" | "pre-compaction-flush";

export type SessionSnapshotResult = {
  filePath: string;
  relativePath: string;
  saved: boolean;
  messageCount: number;
};

const MEMORY_MAX_RESULTS_DEFAULT = 4;
const MEMORY_MIN_SCORE_DEFAULT = 0.2;
const MEMORY_SNIPPET_MAX_CHARS = 900;
const MEMORY_CHUNK_LINES = 10;
const MEMORY_CHUNK_STEP = 6;
const MEMORY_LINE_WINDOW = 30;
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "was",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function tokenize(value: string): string[] {
  const tokens = value
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
  return Array.from(new Set(tokens));
}

function safeRelPath(workspacePath: string, absPath: string): string {
  const rel = path.relative(workspacePath, absPath);
  return normalizePath(rel || path.basename(absPath));
}

function isAllowedMemoryRelPath(relPath: string): boolean {
  const normalized = normalizePath(relPath).trim();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("/")) {
    return false;
  }
  if (normalized.includes("..")) {
    return false;
  }
  if (normalized === "MEMORY.md" || normalized === "memory.md") {
    return true;
  }
  return normalized.startsWith("memory/");
}

function walkMemoryDir(memoryDir: string, output: string[]): void {
  if (!fs.existsSync(memoryDir)) {
    return;
  }
  const entries = fs.readdirSync(memoryDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(memoryDir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      walkMemoryDir(fullPath, output);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }
    output.push(fullPath);
  }
}

export function listMemoryFiles(workspacePath: string): string[] {
  const files: string[] = [];
  const rootCandidates = ["MEMORY.md", "memory.md"].map((name) => path.join(workspacePath, name));
  for (const candidate of rootCandidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isFile() && !stat.isSymbolicLink()) {
        files.push(candidate);
      }
    } catch {
      // Ignore unreadable files.
    }
  }

  const memoryDir = path.join(workspacePath, "memory");
  walkMemoryDir(memoryDir, files);
  return Array.from(new Set(files));
}

function scoreChunk(query: string, queryTokens: string[], chunkText: string): number {
  if (!chunkText.trim()) {
    return 0;
  }
  const normalizedChunk = chunkText.toLowerCase();
  const chunkTokens = new Set(tokenize(normalizedChunk));
  let overlap = 0;
  for (const token of queryTokens) {
    if (chunkTokens.has(token)) {
      overlap += 1;
    }
  }
  const tokenScore = queryTokens.length > 0 ? overlap / queryTokens.length : 0;
  const phraseScore = normalizedChunk.includes(query) ? 1 : 0;
  return tokenScore * 0.7 + phraseScore * 0.3;
}

function trimSnippet(content: string): string {
  const normalized = normalizeNewlines(content).trim();
  if (normalized.length <= MEMORY_SNIPPET_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MEMORY_SNIPPET_MAX_CHARS)}...`;
}

export function memorySearch(
  workspacePath: string,
  query: string,
  options: MemorySearchOptions = {},
): MemorySearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }
  const queryTokens = tokenize(normalizedQuery);
  if (queryTokens.length === 0 && normalizedQuery.length < 3) {
    return [];
  }

  const maxResults = Math.max(1, Math.floor(options.maxResults ?? MEMORY_MAX_RESULTS_DEFAULT));
  const minScore = Math.max(0, options.minScore ?? MEMORY_MIN_SCORE_DEFAULT);

  const files = listMemoryFiles(workspacePath);
  const hits: MemorySearchResult[] = [];

  for (const absPath of files) {
    let raw = "";
    try {
      raw = fs.readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }

    const lines = normalizeNewlines(raw).split("\n");
    if (lines.length === 0) {
      continue;
    }

    for (let start = 0; start < lines.length; start += MEMORY_CHUNK_STEP) {
      const end = Math.min(lines.length, start + MEMORY_CHUNK_LINES);
      const chunk = lines.slice(start, end).join("\n");
      const score = scoreChunk(normalizedQuery, queryTokens, chunk);
      if (score < minScore) {
        continue;
      }
      hits.push({
        path: safeRelPath(workspacePath, absPath),
        startLine: start + 1,
        endLine: end,
        score: Number(score.toFixed(4)),
        snippet: trimSnippet(chunk),
      });
    }
  }

  const ordered: MemorySearchResult[] = [];
  for (const hit of hits) {
    const insertAt = ordered.findIndex((entry) => hit.score > entry.score);
    if (insertAt === -1) {
      ordered.push(hit);
    } else {
      ordered.splice(insertAt, 0, hit);
    }
  }
  return ordered.slice(0, maxResults);
}

export function memoryGet(
  workspacePath: string,
  params: MemoryGetParams,
): { path: string; text: string } {
  const requested = normalizePath(params.path ?? "").trim();
  if (!isAllowedMemoryRelPath(requested)) {
    throw new Error("path must be MEMORY.md or memory/*.md");
  }

  const absPath = path.resolve(workspacePath, requested);
  const relative = path.relative(workspacePath, absPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("path must stay inside workspace");
  }

  const raw = fs.readFileSync(absPath, "utf-8");
  if (!params.from && !params.lines) {
    return { path: requested, text: raw };
  }

  const allLines = normalizeNewlines(raw).split("\n");
  const start = Math.max(1, Math.floor(params.from ?? 1));
  const lineCount = Math.max(1, Math.floor(params.lines ?? MEMORY_LINE_WINDOW));
  const text = allLines.slice(start - 1, start - 1 + lineCount).join("\n");
  return { path: requested, text };
}

function sanitizeSessionSlug(sessionKey: string): string {
  const cleaned = sessionKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "session";
}

function formatSnapshotMessage(content: string): string {
  const singleLine = normalizeNewlines(content).replace(/\s+/g, " ").trim();
  if (singleLine.length <= 600) {
    return singleLine;
  }
  return `${singleLine.slice(0, 600)}...`;
}

export function appendSessionMemorySnapshot(params: {
  workspacePath: string;
  sessionKey: string;
  reason: SessionSnapshotReason;
  messages: SessionSnapshotMessage[];
  now?: Date;
}): SessionSnapshotResult {
  const now = params.now ?? new Date();
  const dateToken = now.toISOString().slice(0, 10);
  const timeToken = now.toISOString().slice(11, 19);
  const memoryDir = path.join(params.workspacePath, "memory");
  fs.mkdirSync(memoryDir, { recursive: true });

  const fileName = `${dateToken}-${sanitizeSessionSlug(params.sessionKey)}.md`;
  const filePath = path.join(memoryDir, fileName);
  const relPath = normalizePath(path.join("memory", fileName));

  const cleanMessages = params.messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: formatSnapshotMessage(message.content),
    }));

  if (cleanMessages.length === 0) {
    return {
      filePath,
      relativePath: relPath,
      saved: false,
      messageCount: 0,
    };
  }

  if (!fs.existsSync(filePath)) {
    const header = [
      `# Session Memory: ${params.sessionKey}`,
      "",
      "Auto-generated snapshots from CyDeck sessions.",
      "",
    ].join("\n");
    fs.writeFileSync(filePath, header, "utf-8");
  }

  const entryLines = [
    `## Snapshot ${dateToken} ${timeToken} UTC`,
    `- Reason: ${params.reason}`,
    `- Messages: ${cleanMessages.length}`,
    "",
    "### Transcript",
    ...cleanMessages.map((message) => `- ${message.role}: ${message.content}`),
    "",
  ];

  fs.appendFileSync(filePath, `${entryLines.join("\n")}\n`, "utf-8");
  return {
    filePath,
    relativePath: relPath,
    saved: true,
    messageCount: cleanMessages.length,
  };
}
