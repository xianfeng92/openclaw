/**
 * Terminal Adapter Types
 *
 * Defines the abstraction layer for Super AI Terminal to run in either:
 * - Gateway mode: Connects to Gateway via WebSocket
 * - Local mode: Runs embedded agent locally
 */

/**
 * Connection info for TUI compatibility
 */
export type AdapterConnection = {
  url: string;
  token?: string;
  password?: string;
};

/**
 * Chat send options - shared between adapters
 */
export type ChatSendOptions = {
  sessionKey: string;
  message: string;
  thinking?: string;
  deliver?: boolean;
  timeoutMs?: number;
  runId?: string;
};

/**
 * Chat send result
 */
export type ChatSendResult = {
  runId: string;
  status: "started" | "complete" | "error";
  error?: string;
};

/**
 * Abort options
 */
export type AbortOptions = {
  sessionKey: string;
  runId: string;
};

/**
 * History load options
 */
export type HistoryOptions = {
  sessionKey: string;
  limit?: number;
};

/**
 * History entry
 */
export type HistoryEntry = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  runId?: string;
};

/**
 * History result
 */
export type HistoryResult = {
  entries: HistoryEntry[];
};

/**
 * Session list options
 */
export type SessionListOptions = {
  limit?: number;
};

/**
 * Session info (minimal subset for MVP)
 */
export type SessionInfo = {
  key: string;
  updatedAt?: number;
  lastMessagePreview?: string;
  model?: string;
  totalTokens?: number;
};

/**
 * Session list result
 */
export type SessionListResult = {
  sessions: SessionInfo[];
};

/**
 * Session patch options
 */
export type SessionPatchOptions = {
  sessionKey: string;
  updates: Partial<{
    thinkingLevel: string;
    verboseLevel: string;
    model: string;
  }>;
};

/**
 * Session patch result
 */
export type SessionPatchResult = {
  ok: boolean;
};

/**
 * Agent info
 */
export type AgentInfo = {
  id: string;
  name?: string;
};

/**
 * Agents list result
 */
export type AgentsListResult = {
  defaultId: string;
  agents: AgentInfo[];
};

/**
 * Model choice
 */
export type ModelChoice = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
};

/**
 * Models list result
 */
export type ModelsListResult = {
  models: ModelChoice[];
};

/**
 * Adapter status
 */
export type AdapterStatus = {
  connected: boolean;
  mode: "gateway" | "local";
  message?: string;
};

/**
 * Adapter event
 */
export type AdapterEvent = {
  type: "chat" | "agent" | "status" | "error";
  payload: unknown;
};

/**
 * Event listener type
 */
export type EventListener = (event: AdapterEvent) => void;

/**
 * Terminal Adapter Interface
 *
 * This abstraction allows Super AI Terminal to run in either Gateway or Local mode.
 * Implementations:
 * - GatewayAdapter: Wraps GatewayChatClient (WebSocket to Gateway)
 * - LocalAdapter: Uses embedded Pi agent (local execution)
 */
export interface TerminalAdapter {
  /**
   * Adapter mode identifier
   */
  readonly mode: "gateway" | "local";

  /**
   * Start the adapter and establish connection
   */
  start(): Promise<void>;

  /**
   * Stop the adapter and cleanup resources
   */
  stop(): void;

  /**
   * Check if adapter is ready/connected
   */
  isReady(): boolean;

  /**
   * Get current status
   */
  getStatus(): AdapterStatus;

  /**
   * Send a chat message
   */
  sendChat(opts: ChatSendOptions): Promise<ChatSendResult>;

  /**
   * Abort a running chat
   */
  abortChat(opts: AbortOptions): Promise<void>;

  /**
   * Load chat history
   */
  loadHistory(opts: HistoryOptions): Promise<HistoryResult>;

  /**
   * List sessions
   */
  listSessions(opts?: SessionListOptions): Promise<SessionListResult>;

  /**
   * Update session settings
   */
  patchSession(opts: SessionPatchOptions): Promise<SessionPatchResult>;

  /**
   * Reset a session
   */
  resetSession(sessionKey: string): Promise<void>;

  /**
   * List available agents
   */
  listAgents(): Promise<AgentsListResult>;

  /**
   * List available models
   */
  listModels(): Promise<ModelsListResult>;

  /**
   * Register event listener
   */
  onEvent(listener: EventListener): void;

  /**
   * Register connection state callback
   */
  onConnected?(callback: () => void): void;

  /**
   * Register disconnection callback
   */
  onDisconnected?(callback: (reason: string) => void): void;
}
