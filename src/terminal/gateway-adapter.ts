/**
 * Gateway Adapter - WebSocket Gateway Mode
 *
 * Wraps GatewayChatClient to implement TerminalAdapter.
 */

import type {
  AbortOptions,
  AdapterConnection,
  AdapterEvent,
  AdapterStatus,
  AgentsListResult,
  ChatSendOptions,
  ChatSendResult,
  EventListener,
  HistoryOptions,
  HistoryResult,
  ModelsListResult,
  SessionListOptions,
  SessionListResult,
  SessionPatchOptions,
  SessionPatchResult,
  TerminalAdapter,
} from "./adapter-types.js";
import {
  GatewayChatClient,
  type GatewayEvent,
  type GatewayAgentsList,
  type GatewayModelChoice,
  type GatewaySessionList,
} from "../tui/gateway-chat.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
const MAX_MISSED_HEARTBEATS = 2;

function extractText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if (Array.isArray(record.content)) {
    return record.content.map((entry) => extractText(entry)).join("");
  }
  return "";
}

export class GatewayAdapter implements TerminalAdapter {
  readonly mode = "gateway" as const;

  private readonly client: GatewayChatClient;
  private readonly eventListeners = new Set<EventListener>();
  private readonly connectedListeners = new Set<() => void>();
  private readonly disconnectedListeners = new Set<(reason: string) => void>();
  private heartbeatTimer?: NodeJS.Timeout;
  private missedHeartbeats = 0;
  private isStarted = false;
  private degraded = false;

  readonly connection: AdapterConnection;

  constructor(opts: { url?: string; token?: string; password?: string }) {
    this.client = new GatewayChatClient(opts);
    this.connection = this.client.connection;

    this.client.onEvent = (event: GatewayEvent) => {
      const type = event.event === "agent" ? "agent" : event.event === "chat" ? "chat" : "status";
      this.emitEvent({
        type,
        payload: event.payload,
      });
    };

    this.client.onConnected = () => {
      this.missedHeartbeats = 0;
      this.degraded = false;
      this.emitEvent({ type: "status", payload: { connected: true } });
      for (const listener of this.connectedListeners) {
        listener();
      }
    };

    this.client.onDisconnected = (reason) => {
      const message = reason?.trim() || "closed";
      this.emitEvent({ type: "status", payload: { connected: false, reason: message } });
      for (const listener of this.disconnectedListeners) {
        listener(message);
      }
    };
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }
    this.client.start();
    await this.client.waitForReady();
    this.startHeartbeat();
    this.isStarted = true;
  }

  stop(): void {
    this.stopHeartbeat();
    this.isStarted = false;
    this.client.stop();
  }

  isReady(): boolean {
    return this.isStarted && Boolean(this.client.hello) && !this.degraded;
  }

  getStatus(): AdapterStatus {
    if (this.degraded) {
      return {
        connected: false,
        mode: "gateway",
        message: "Gateway degraded (connection issues)",
      };
    }
    const connected = Boolean(this.client.hello);
    return {
      connected,
      mode: "gateway",
      message: connected ? "Connected to Gateway" : "Connecting to Gateway...",
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.performHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private async performHeartbeat(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      await Promise.race([
        this.client.listSessions(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Heartbeat timeout")), HEARTBEAT_TIMEOUT_MS),
        ),
      ]);

      if (this.missedHeartbeats > 0) {
        this.missedHeartbeats = 0;
        if (this.degraded) {
          this.degraded = false;
          this.emitEvent({ type: "status", payload: { connected: true, recovered: true } });
        }
      }
    } catch (err) {
      this.missedHeartbeats += 1;
      if (this.missedHeartbeats >= MAX_MISSED_HEARTBEATS && !this.degraded) {
        this.degraded = true;
        this.emitEvent({
          type: "degraded",
          payload: {
            reason: err instanceof Error ? err.message : "Connection lost",
            missedHeartbeats: this.missedHeartbeats,
          },
        });
      }
    }
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  resetDegraded(): void {
    this.degraded = false;
    this.missedHeartbeats = 0;
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
        runId: result.runId,
        status: "started",
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
    const result = (await this.client.loadHistory({
      sessionKey: opts.sessionKey,
      limit: opts.limit,
    })) as {
      messages?: Array<{
        role: "user" | "assistant" | "system";
        content: unknown;
        timestamp?: number;
        runId?: string;
      }>;
    };

    return {
      entries: (result.messages ?? []).map((msg) => ({
        role: msg.role,
        content: extractText(msg.content),
        timestamp: msg.timestamp,
        runId: msg.runId,
      })),
    };
  }

  async listSessions(opts?: SessionListOptions): Promise<SessionListResult> {
    const result = (await this.client.listSessions({
      limit: opts?.limit,
    })) as GatewaySessionList;

    return {
      sessions: result.sessions.map((session) => ({
        key: session.key,
        updatedAt: session.updatedAt ?? undefined,
        lastMessagePreview: session.lastMessagePreview,
        model: session.model,
        totalTokens: session.totalTokens ?? undefined,
      })),
    };
  }

  async patchSession(opts: SessionPatchOptions): Promise<SessionPatchResult> {
    const result = await this.client.patchSession({
      key: opts.sessionKey,
      ...opts.updates,
    });
    return { ok: Boolean(result?.ok) };
  }

  async resetSession(sessionKey: string): Promise<void> {
    await this.client.resetSession(sessionKey);
  }

  async listAgents(): Promise<AgentsListResult> {
    const result = (await this.client.listAgents()) as GatewayAgentsList;
    return {
      defaultId: result.defaultId,
      agents: result.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
      })),
    };
  }

  async listModels(): Promise<ModelsListResult> {
    const result = (await this.client.listModels()) as GatewayModelChoice[];
    return {
      models: result.map((model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        contextWindow: model.contextWindow,
        reasoning: model.reasoning,
      })),
    };
  }

  onEvent(listener: EventListener): void {
    this.eventListeners.add(listener);
  }

  onConnected(callback: () => void): void {
    this.connectedListeners.add(callback);
  }

  onDisconnected(callback: (reason: string) => void): void {
    this.disconnectedListeners.add(callback);
  }

  private emitEvent(event: AdapterEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors.
      }
    }
  }
}
