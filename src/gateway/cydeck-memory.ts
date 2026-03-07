import fs from "node:fs";
import path from "node:path";
import { buildBootstrapContextFiles } from "../agents/pi-embedded-helpers.js";
import { buildProjectContextSection } from "../agents/system-prompt.js";
import {
  filterBootstrapFilesForSession,
  loadWorkspaceBootstrapFiles,
} from "../agents/workspace.js";

export type CyDeckMemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
};

export type CyDeckMemoryGetParams = {
  path: string;
  from?: number;
  lines?: number;
};

export type CyDeckSessionSnapshotReason =
  | "session-memory"
  | "session-rotate"
  | "pre-compaction-flush";

export type CyDeckSessionSnapshotResult = {
  filePath: string;
  relativePath: string;
  saved: boolean;
  messageCount: number;
};

export type CyDeckTranscriptMessage = {
  role: "user" | "assistant";
  content: string;
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
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !STOPWORDS.has(token)),
    ),
  );
}

function safeRelPath(workspacePath: string, absPath: string): string {
  const rel = path.relative(workspacePath, absPath);
  return normalizePath(rel || path.basename(absPath));
}

function isAllowedMemoryRelPath(relPath: string): boolean {
  const normalized = normalizePath(relPath).trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    return false;
  }
  return normalized === "MEMORY.md" || normalized === "memory.md" || normalized.startsWith("memory/");
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
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      output.push(fullPath);
    }
  }
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
  return singleLine.length <= 600 ? singleLine : `${singleLine.slice(0, 600)}...`;
}

export function isPrivateLandingSession(sessionKey?: string): boolean {
  const key = (sessionKey ?? "").trim().toLowerCase();
  if (!key || key === "default" || key === "main" || key === "direct") {
    return true;
  }
  for (const marker of ["group", "channel", "subagent", "cron"]) {
    const pattern = new RegExp(`(^|:)${marker}(:|$)`, "i");
    if (pattern.test(key)) {
      return false;
    }
  }
  return true;
}

function isMemoryBootstrapFile(fileName: string): boolean {
  return fileName.trim().toLowerCase() === "memory.md";
}

async function loadCyDeckBootstrapContextFiles(
  workspacePath: string,
  sessionKey?: string,
): Promise<ReturnType<typeof buildBootstrapContextFiles>> {
  let files = await loadWorkspaceBootstrapFiles(workspacePath);
  files = filterBootstrapFilesForSession(files, sessionKey);

  if (!isPrivateLandingSession(sessionKey)) {
    files = files.filter((file) => !isMemoryBootstrapFile(file.name));
  }

  return buildBootstrapContextFiles(files);
}

export async function buildCyDeckLandingSystemPrompt(
  workspacePath: string,
  sessionKey?: string,
): Promise<string | null> {
  const contextFiles = await loadCyDeckBootstrapContextFiles(workspacePath, sessionKey);
  return buildProjectContextSection(contextFiles);
}

export function listCyDeckMemoryFiles(workspacePath: string): string[] {
  const files: string[] = [];
  for (const name of ["MEMORY.md", "memory.md"]) {
    const candidate = path.join(workspacePath, name);
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
  walkMemoryDir(path.join(workspacePath, "memory"), files);
  return Array.from(new Set(files));
}

export function cydeckMemorySearch(
  workspacePath: string,
  query: string,
  options: { maxResults?: number; minScore?: number } = {},
): CyDeckMemorySearchResult[] {
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
  const hits: CyDeckMemorySearchResult[] = [];

  for (const absPath of listCyDeckMemoryFiles(workspacePath)) {
    let raw = "";
    try {
      raw = fs.readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }

    const lines = normalizeNewlines(raw).split("\n");
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

  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

export function cydeckMemoryGet(
  workspacePath: string,
  params: CyDeckMemoryGetParams,
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
  return {
    path: requested,
    text: allLines.slice(start - 1, start - 1 + lineCount).join("\n"),
  };
}

export function appendCyDeckSessionMemorySnapshot(params: {
  workspacePath: string;
  sessionKey: string;
  reason: CyDeckSessionSnapshotReason;
  messages: CyDeckTranscriptMessage[];
  now?: Date;
}): CyDeckSessionSnapshotResult {
  const now = params.now ?? new Date();
  const dateToken = now.toISOString().slice(0, 10);
  const timeToken = now.toISOString().slice(11, 19);
  const memoryDir = path.join(params.workspacePath, "memory");
  fs.mkdirSync(memoryDir, { recursive: true });

  const fileName = `${dateToken}-${sanitizeSessionSlug(params.sessionKey)}.md`;
  const filePath = path.join(memoryDir, fileName);
  const relativePath = normalizePath(path.join("memory", fileName));

  const cleanMessages = params.messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: formatSnapshotMessage(message.content),
    }));

  if (cleanMessages.length === 0) {
    return {
      filePath,
      relativePath,
      saved: false,
      messageCount: 0,
    };
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      ["# Session Memory: " + params.sessionKey, "", "Auto-generated snapshots from CyDeck sessions.", ""].join("\n"),
      "utf-8",
    );
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
    relativePath,
    saved: true,
    messageCount: cleanMessages.length,
  };
}

export function extractCyDeckTranscriptMessages(messages: unknown[]): CyDeckTranscriptMessage[] {
  const results: CyDeckTranscriptMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message as {
      role?: unknown;
      content?: unknown;
    };
    const role = record.role;
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    const text = extractTranscriptText(record.content);
    if (!text) {
      continue;
    }
    results.push({
      role,
      content: text,
    });
  }
  return results;
}

function extractTranscriptText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const record = part as { text?: unknown; type?: unknown };
    if (
      typeof record.text === "string" &&
      (record.type === "text" || record.type === "output_text" || record.type === "input_text")
    ) {
      const trimmed = record.text.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
    }
  }
  return parts.join("\n").trim();
}
