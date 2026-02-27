/**
 * Gateway Adapter - WebSocket Gateway Mode
 *
 * Wraps GatewayChatClient to implement TerminalAdapter interface.
 * Enables TUI to work with existing Gateway connection.
 */

import type {
  TerminalAdapter,
  ChatSendOptions,
  ChatSendResult,
  AbortOptions,
  HistoryOptions,
  HistoryResult,
  SessionListOptions,
  SessionListResult,
  SessionPatchOptions,
  SessionPatchResult,
  AgentsListResult,
  ModelsListResult,
  AdapterStatus,
  AdapterEvent,
  EventListener,
  AdapterConnection,
} from "./adapter-types.js";
import type {
  GatewaySessionList,
  GatewayAgentsList,
  GatewayModelChoice,
} from "../tui/gateway-chat.js";
import { GatewayChatClient } from "../tui/gateway-chat.js";

/**
 * Gateway Adapter wraps GatewayChatClient
 */
export class GatewayAdapter implements TerminalAdapter {
  readonly mode = "gateway" as const;

  private client: GatewayChatClient;
  private eventListeners: Set<EventListener> = new Set();

  // Expose connection info for TUI compatibility
  readonly connection: AdapterConnection;

  constructor(opts: { url?: string; token?: string; password?: string }) {
    this.client = new GatewayChatClient(opts);
    this.connection = {
      url: opts.url ?? "ws://localhost:18789",
      token: opts.token,
      password: opts.password,
    };

    // Forward gateway events to adapter listeners
    this.client.onEvent((event) => {
      this.emitEvent({
        type: event.event as "chat" | "agent",
        payload: event.payload,
      });
    });

    this.client.onConnected(() => {
      this.emitEvent({ type: "status", payload: { connected: true } });
    });

    this.client.onDisconnected((reason) => {
      this.emitEvent({ type: "status", payload: { connected: false, reason } });
    });
  }

  async start(): Promise<void> {
    await this.client.ready();
  }

  stop(): void {
    this.client.close();
  }

  isReady(): boolean {
    return this.client.isConnected();
  }

  getStatus(): AdapterStatus {
    return {
      connected: this.client.isConnected(),
      mode: "gateway",
      message: this.client.isConnected()
        ? "Connected to Gateway"
        : "Connecting to Gateway...",
    };
  }

  async sendChat(opts: ChatSendOptions): Promise<ChatSendResult> {
    try {
      const result = await this.client.sendChat({
        sessionKey: opts.sessionKey,
        message: opts.message,
        thinking: opts.thinking,
        deliver: opts.deliver,
        timeoutMs: opts.timeoutMs,
        runId: opts.runId,
      });

      return {
        runId: result.runId ?? "",
        status: result.error ? "error" : "started",
        error: result.error,
      };
    } catch (err) {
      return {
        runId: "",
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async abortChat(opts: AbortOptions): Promise<void> {
    await this.client.abortChat({
      sessionKey: opts.sessionKey,
      runId: opts.runId,
    });
  }

  async loadHistory(opts: HistoryOptions): Promise<HistoryResult> {
    const result = await this.client.loadHistory({
      sessionKey: opts.sessionKey,
      limit: opts.limit,
    });

    return {
      entries: (result.messages ?? []).map((msg) => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        runId: msg.runId,
      })),
    };
  }

  async listSessions(opts?: SessionListOptions): Promise<SessionListResult> {
    const result: GatewaySessionList = await this.client.listSessions();

    let sessions = result.sessions.map((s) => ({
      key: s.key,
      updatedAt: s.updatedAt ?? undefined,
      lastMessagePreview: s.lastMessagePreview,
      model: s.model,
      totalTokens: s.totalTokens ?? undefined,
    }));

    if (opts?.limit) {
      sessions = sessions.slice(0, opts.limit);
    }

    return { sessions };
  }

  async patchSession(opts: SessionPatchOptions): Promise<SessionPatchResult> {
    const result = await this.client.patchSession({
      sessionKey: opts.sessionKey,
      updates: opts.updates,
    });

    return { ok: result.ok ?? false };
  }

  async resetSession(sessionKey: string): Promise<void> {
    await this.client.resetSession(sessionKey);
  }

  async listAgents(): Promise<AgentsListResult> {
    const result: GatewayAgentsList = await this.client.listAgents();

    return {
      defaultId: result.defaultId,
      agents: result.agents.map((a) => ({
        id: a.id,
        name: a.name,
      })),
    };
  }

  async listModels(): Promise<ModelsListResult> {
    const result: GatewayModelChoice[] = await this.client.listModels();

    return {
      models: result.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        contextWindow: m.contextWindow,
        reasoning: m.reasoning,
      })),
    };
  }

  onEvent(listener: EventListener): void {
    this.eventListeners.add(listener);
  }

  onConnected(callback: () => void): void {
    this.client.onConnected(callback);
  }

  onDisconnected(callback: (reason: string) => void): void {
    this.client.onDisconnected(callback);
  }

  private emitEvent(event: AdapterEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }
}
