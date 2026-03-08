import type {
  AdapterConnection,
  ChatSendOptions,
  EventListener,
  ModelChoice,
  TerminalAdapter,
} from "./adapter-types.js";
import type {
  GatewayAgentsList,
  GatewayEvent,
  GatewayModelChoice,
  GatewaySessionList,
} from "../tui/gateway-chat.js";
import type {
  SessionsListParams,
  SessionsPatchParams,
  SessionsPatchResult,
} from "../gateway/protocol/index.js";

export type GatewayGapInfo = {
  expected: number;
  received: number;
};

export type DegradedEventPayload = {
  reason: string;
  missedHeartbeats: number;
};

function splitModelSelection(model: string | null | undefined): {
  model?: string;
  modelProvider?: string;
} {
  const raw = model?.trim();
  if (!raw) {
    return {};
  }
  const slashIndex = raw.indexOf("/");
  if (slashIndex <= 0 || slashIndex === raw.length - 1) {
    return { model: raw };
  }
  return {
    modelProvider: raw.slice(0, slashIndex),
    model: raw.slice(slashIndex + 1),
  };
}

function toGatewayModelChoice(model: ModelChoice): GatewayModelChoice {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
  };
}

export class TuiAdapterClient {
  private readonly adapter: TerminalAdapter;
  private eventHandler?: (evt: GatewayEvent) => void;
  private connectedHandler?: () => void;
  private disconnectedHandler?: (reason: string) => void;
  private gapHandler?: (info: GatewayGapInfo) => void;
  private degradedHandler?: (payload: DegradedEventPayload) => void;

  readonly mode: "gateway" | "local";
  readonly connection: AdapterConnection;

  constructor(adapter: TerminalAdapter) {
    this.adapter = adapter;
    this.mode = adapter.mode;
    this.connection =
      "connection" in adapter
        ? (adapter as TerminalAdapter & { connection: AdapterConnection }).connection
        : { url: adapter.mode === "local" ? "local://embedded" : "ws://127.0.0.1:18789" };

    const forwardEvent: EventListener = (event) => {
      if (event.type === "degraded") {
        const payload = event.payload as DegradedEventPayload;
        this.degradedHandler?.(payload);
      }
      if (!this.eventHandler) {
        return;
      }
      this.eventHandler({
        event: event.type,
        payload: event.payload,
        seq: undefined,
      });
    };

    adapter.onEvent(forwardEvent);
    adapter.onConnected?.(() => {
      this.connectedHandler?.();
    });
    adapter.onDisconnected?.((reason) => {
      this.disconnectedHandler?.(reason);
    });
  }

  set onEvent(handler: (evt: GatewayEvent) => void) {
    this.eventHandler = handler;
  }

  set onConnected(handler: () => void) {
    this.connectedHandler = handler;
  }

  set onDisconnected(handler: (reason: string) => void) {
    this.disconnectedHandler = handler;
  }

  set onGap(handler: (info: GatewayGapInfo) => void) {
    this.gapHandler = handler;
  }

  set onDegraded(handler: (payload: DegradedEventPayload) => void) {
    this.degradedHandler = handler;
  }

  async start(): Promise<void> {
    await this.adapter.start();
  }

  stop(): void {
    this.adapter.stop();
  }

  close(): void {
    this.stop();
  }

  isConnected(): boolean {
    return this.adapter.isReady();
  }

  async waitForReady(): Promise<void> {
    if (!this.adapter.isReady()) {
      await this.adapter.start();
    }
  }

  async ready(): Promise<void> {
    await this.waitForReady();
  }

  getAdapter(): TerminalAdapter {
    return this.adapter;
  }

  isDegraded(): boolean {
    if (this.mode === "local") {
      return false;
    }
    const gatewayAdapter = this.adapter as TerminalAdapter & { isDegraded?: () => boolean };
    return gatewayAdapter.isDegraded?.() ?? false;
  }

  resetDegraded(): void {
    if (this.mode === "local") {
      return;
    }
    const gatewayAdapter = this.adapter as TerminalAdapter & { resetDegraded?: () => void };
    gatewayAdapter.resetDegraded?.();
  }

  async sendChat(opts: ChatSendOptions): Promise<{ runId: string }> {
    const result = await this.adapter.sendChat(opts);
    if (result.status === "error") {
      throw new Error(result.error ?? "chat send failed");
    }
    return { runId: result.runId };
  }

  async abortChat(opts: { sessionKey: string; runId: string }) {
    await this.adapter.abortChat(opts);
    return { ok: true, aborted: true };
  }

  async loadHistory(opts: { sessionKey: string; limit?: number }) {
    const result = await this.adapter.loadHistory(opts);
    return {
      sessionId: opts.sessionKey,
      messages: result.entries.map((entry) => ({
        role: entry.role,
        content: entry.content,
        timestamp: entry.timestamp,
        runId: entry.runId,
      })),
    };
  }

  async listSessions(opts?: SessionsListParams): Promise<GatewaySessionList> {
    const result = await this.adapter.listSessions({ limit: opts?.limit });
    return {
      ts: Date.now(),
      path: "local://sessions",
      count: result.sessions.length,
      defaults: {
        model: null,
        modelProvider: null,
        contextTokens: null,
      },
      sessions: result.sessions.map((session) => ({
        key: session.key,
        updatedAt: session.updatedAt ?? null,
        lastMessagePreview: session.lastMessagePreview,
        model: session.model,
        totalTokens: session.totalTokens,
      })),
    };
  }

  async listAgents(): Promise<GatewayAgentsList> {
    const result = await this.adapter.listAgents();
    return {
      defaultId: result.defaultId,
      mainKey: "main",
      scope: "per-sender",
      agents: result.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
      })),
    };
  }

  async patchSession(opts: SessionsPatchParams): Promise<SessionsPatchResult> {
    const {
      key,
      label,
      thinkingLevel,
      verboseLevel,
      reasoningLevel,
      responseUsage,
      model,
      elevatedLevel,
      sendPolicy,
      groupActivation,
    } = opts;
    const selection = splitModelSelection(model ?? undefined);
    await this.adapter.patchSession({
      sessionKey: key,
      updates: {
        thinkingLevel: thinkingLevel ?? undefined,
        verboseLevel: verboseLevel ?? undefined,
        model: model ?? undefined,
      },
    });
    return {
      ok: true,
      path: "local://sessions",
      key,
      entry: {
        sessionKey: key,
        sessionId: key,
        label: label ?? undefined,
        thinkingLevel: thinkingLevel ?? undefined,
        verboseLevel: verboseLevel ?? undefined,
        reasoningLevel: reasoningLevel ?? undefined,
        responseUsage: responseUsage ?? undefined,
        model: selection.model ?? model ?? undefined,
        modelProvider: selection.modelProvider,
        elevatedLevel: elevatedLevel ?? undefined,
        sendPolicy: sendPolicy ?? undefined,
        groupActivation: groupActivation ?? undefined,
        updatedAt: Date.now(),
      },
      resolved:
        selection.model || selection.modelProvider
          ? {
              model: selection.model,
              modelProvider: selection.modelProvider,
            }
          : undefined,
    };
  }

  async resetSession(key: string) {
    await this.adapter.resetSession(key);
    return { ok: true };
  }

  getStatus() {
    return this.adapter.getStatus();
  }

  async listModels(): Promise<GatewayModelChoice[]> {
    const result = await this.adapter.listModels();
    return result.models.map(toGatewayModelChoice);
  }
}
