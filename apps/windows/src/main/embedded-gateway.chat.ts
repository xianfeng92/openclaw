import { buildLandingSystemPrompt, isPrivateLandingSession } from "./landing.js";
import {
  appendSessionMemorySnapshot,
  memorySearch,
  type MemorySearchResult,
  type SessionSnapshotReason,
  type SessionSnapshotResult,
} from "./memory-runtime.js";
import type { ChatMessage } from "./embedded-gateway.providers.js";

const SESSION_MAX_MESSAGES = 40;
const LANDING_PROMPT_MARKER = "[cydeck:landing-system-prompt]";
const MEMORY_TOOLS_PROMPT_MARKER = "[cydeck:memory-tools]";
const AGENT_HINT_PROMPT_MARKER = "[cydeck:agent-hint]";
const DEFAULT_AUTO_MEMORY_WRITE_MESSAGES = 12;
const DEFAULT_PRE_COMPACTION_MESSAGES = SESSION_MAX_MESSAGES;
const DEFAULT_SNAPSHOT_MAX_MESSAGES = 18;
const DEFAULT_MEMORY_SEARCH_RESULTS = 3;

export type ChatSession = {
  sessionKey: string;
  messages: ChatMessage[];
  lastMemoryWriteMessageCount: number;
  lastPreCompactionFlushMessageCount: number;
  agentHint?: string;
};

export type MemoryRuntimeConfig = {
  enabled: boolean;
  autoWriteMessages: number;
  preCompactionMessages: number;
  snapshotMaxMessages: number;
  searchMaxResults: number;
};

export function resolveMemoryRuntimeConfig(
  input?: Partial<MemoryRuntimeConfig>,
): MemoryRuntimeConfig {
  return {
    enabled: input?.enabled !== false,
    autoWriteMessages: Math.max(
      1,
      Math.floor(input?.autoWriteMessages ?? DEFAULT_AUTO_MEMORY_WRITE_MESSAGES),
    ),
    preCompactionMessages: Math.max(
      1,
      Math.floor(input?.preCompactionMessages ?? DEFAULT_PRE_COMPACTION_MESSAGES),
    ),
    snapshotMaxMessages: Math.max(
      1,
      Math.floor(input?.snapshotMaxMessages ?? DEFAULT_SNAPSHOT_MAX_MESSAGES),
    ),
    searchMaxResults: Math.max(
      1,
      Math.floor(input?.searchMaxResults ?? DEFAULT_MEMORY_SEARCH_RESULTS),
    ),
  };
}

export function normalizeAgentHint(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  switch (normalized) {
    case "gpt":
      return "openai";
    case "claude":
    case "openai":
    case "gemini":
    case "codex":
    case "local":
      return normalized;
    case "main":
      return undefined;
    default:
      return normalized;
  }
}

export function buildAgentHintSystemPrompt(agentHint?: string): string {
  if (!agentHint) {
    return "";
  }
  return [
    AGENT_HINT_PROMPT_MARKER,
    `Preferred agent profile: ${agentHint}.`,
    "Use this profile as a style and planning hint while answering the user's request.",
  ].join("\n");
}

function makeSessionMapKey(connectionId: string, sessionKey: string): string {
  return `${connectionId}::${sessionKey}`;
}

export function getSession(
  sessions: Map<string, ChatSession>,
  connectionId: string,
  sessionKey: string,
): ChatSession {
  const namespacedKey = makeSessionMapKey(connectionId, sessionKey);
  let session = sessions.get(namespacedKey);
  if (!session) {
    session = {
      sessionKey,
      messages: [],
      lastMemoryWriteMessageCount: 0,
      lastPreCompactionFlushMessageCount: 0,
    };
    sessions.set(namespacedKey, session);
  }
  return session;
}

export function getExistingSession(
  sessions: Map<string, ChatSession>,
  connectionId: string,
  sessionKey: string,
): ChatSession | undefined {
  return sessions.get(makeSessionMapKey(connectionId, sessionKey));
}

export function clearConnectionSessions(
  sessions: Map<string, ChatSession>,
  connectionId: string,
): void {
  const prefix = `${connectionId}::`;
  for (const key of sessions.keys()) {
    if (key.startsWith(prefix)) {
      sessions.delete(key);
    }
  }
}

export function trimSessionMessages(session: ChatSession): void {
  if (session.messages.length <= SESSION_MAX_MESSAGES) {
    return;
  }
  const overflow = session.messages.length - SESSION_MAX_MESSAGES;
  if (isManagedLandingPrompt(session.messages[0])) {
    // Preserve managed system prompt and trim oldest chat turns.
    session.messages.splice(1, overflow);
    return;
  }
  session.messages.splice(0, overflow);
}

export function isManagedLandingPrompt(message: ChatMessage | undefined): boolean {
  if (!message || message.role !== "system") {
    return false;
  }
  return message.content.startsWith(LANDING_PROMPT_MARKER);
}

export function syncLandingSystemPrompt(
  session: ChatSession,
  workspacePath: string,
): void {
  const prompt = buildLandingSystemPrompt(workspacePath, session.sessionKey);
  if (isManagedLandingPrompt(session.messages[0])) {
    session.messages.shift();
  }
  if (!prompt) {
    return;
  }
  session.messages.unshift({
    role: "system",
    content: `${LANDING_PROMPT_MARKER}\n${prompt}`,
  });
}

export function collectConversationMessages(session: ChatSession): Array<{
  role: "user" | "assistant";
  content: string;
}> {
  return session.messages
    .filter(
      (
        message,
      ): message is {
        role: "user" | "assistant";
        content: string;
      } => message.role === "user" || message.role === "assistant",
    )
    .filter((message) => message.content.trim().length > 0);
}

export function shouldPersistMemoryForSession(
  sessionKey: string,
  memoryRuntime: MemoryRuntimeConfig,
): boolean {
  if (!memoryRuntime.enabled) {
    return false;
  }
  return isPrivateLandingSession(sessionKey);
}

export function persistSessionMemorySnapshot(input: {
  session: ChatSession;
  workspacePath: string;
  memoryRuntime: MemoryRuntimeConfig;
  reason: SessionSnapshotReason;
  force?: boolean;
}): SessionSnapshotResult {
  const { session, workspacePath, memoryRuntime, reason, force } = input;
  if (!shouldPersistMemoryForSession(session.sessionKey, memoryRuntime)) {
    return {
      filePath: "",
      relativePath: "",
      saved: false,
      messageCount: 0,
    };
  }

  const conversation = collectConversationMessages(session);
  if (conversation.length === 0) {
    return {
      filePath: "",
      relativePath: "",
      saved: false,
      messageCount: 0,
    };
  }

  const shouldWrite =
    force === true ||
    conversation.length - session.lastMemoryWriteMessageCount >= memoryRuntime.autoWriteMessages;
  if (!shouldWrite) {
    return {
      filePath: "",
      relativePath: "",
      saved: false,
      messageCount: conversation.length,
    };
  }

  const snapshotMessages = conversation.slice(-memoryRuntime.snapshotMaxMessages);
  const result = appendSessionMemorySnapshot({
    workspacePath,
    sessionKey: session.sessionKey,
    reason,
    messages: snapshotMessages,
  });
  if (result.saved) {
    session.lastMemoryWriteMessageCount = conversation.length;
  }
  return result;
}

export function maybeRunPreCompactionFlush(input: {
  session: ChatSession;
  workspacePath: string;
  memoryRuntime: MemoryRuntimeConfig;
}): void {
  const { session, workspacePath, memoryRuntime } = input;
  if (!shouldPersistMemoryForSession(session.sessionKey, memoryRuntime)) {
    return;
  }

  const conversationCount = collectConversationMessages(session).length;
  if (conversationCount < memoryRuntime.preCompactionMessages) {
    return;
  }
  if (session.lastPreCompactionFlushMessageCount === conversationCount) {
    return;
  }

  persistSessionMemorySnapshot({
    session,
    workspacePath,
    memoryRuntime,
    reason: "pre-compaction-flush",
    force: true,
  });
  session.lastPreCompactionFlushMessageCount = conversationCount;
}

export function maybeRunSessionMemoryAutoWrite(input: {
  session: ChatSession;
  workspacePath: string;
  memoryRuntime: MemoryRuntimeConfig;
}): void {
  persistSessionMemorySnapshot({
    ...input,
    reason: "session-memory",
  });
}

export function buildMemoryToolContext(
  results: MemorySearchResult[],
  query: string,
): string {
  const lines: string[] = [
    MEMORY_TOOLS_PROMPT_MARKER,
    "Available local tools: memory_search, memory_get.",
    `memory_search(query="${query.replaceAll('"', '\\"')}") returned ${results.length} snippets.`,
    "",
    "Use memory_get(path, from, lines) when you need exact source lines.",
    "",
  ];
  for (const result of results) {
    lines.push(
      `- ${result.path}#L${result.startLine}-L${result.endLine} (score=${result.score.toFixed(2)})`,
      result.snippet,
      "",
    );
  }
  return lines.join("\n").trim();
}

export function buildMessagesForProvider(input: {
  session: ChatSession;
  userMessage: string;
  workspacePath: string;
  memoryRuntime: MemoryRuntimeConfig;
}): { messages: ChatMessage[]; memoryResults: MemorySearchResult[] } {
  const { session, userMessage, workspacePath, memoryRuntime } = input;
  const baseMessages = session.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  let insertIndex = isManagedLandingPrompt(baseMessages[0]) ? 1 : 0;

  const agentHintPrompt = buildAgentHintSystemPrompt(session.agentHint);
  if (agentHintPrompt) {
    baseMessages.splice(insertIndex, 0, {
      role: "system",
      content: agentHintPrompt,
    });
    insertIndex += 1;
  }

  if (!shouldPersistMemoryForSession(session.sessionKey, memoryRuntime)) {
    return { messages: baseMessages, memoryResults: [] };
  }

  let memoryResults: MemorySearchResult[] = [];
  try {
    memoryResults = memorySearch(workspacePath, userMessage, {
      maxResults: memoryRuntime.searchMaxResults,
    });
  } catch {
    memoryResults = [];
  }

  if (memoryResults.length === 0) {
    return { messages: baseMessages, memoryResults: [] };
  }

  baseMessages.splice(insertIndex, 0, {
    role: "system",
    content: buildMemoryToolContext(memoryResults, userMessage),
  });
  return { messages: baseMessages, memoryResults };
}
