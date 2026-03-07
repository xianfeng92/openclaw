import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { WebSocketServer, type WebSocket } from "ws";
import type { CyDeckRuntimeProviderConfig } from "./cydeck-config.js";
import {
  buildMessagesForProvider,
  clearConnectionSessions,
  getSession,
  maybeRunPreCompactionFlush,
  maybeRunSessionMemoryAutoWrite,
  normalizeAgentHint,
  resolveMemoryRuntimeConfig,
  syncLandingSystemPrompt,
  trimSessionMessages,
  type ChatSession,
  type MemoryRuntimeConfig,
} from "./embedded-gateway.chat.js";
import {
  createConnectOkPayload,
  parseGatewayRequest,
  sendGatewayChatEvent,
  sendGatewayError,
  sendGatewayResponse,
  validateConnectRequest,
  type GatewayRequest,
} from "./embedded-gateway.protocol.js";
import {
  createEmbeddedGatewayProvider,
  formatProviderError,
  type AIProvider,
} from "./embedded-gateway.providers.js";
import {
  buildRealtimeContext,
  injectRealtimeContext,
  resolveRealtimeQuery,
} from "./embedded-gateway.realtime.js";
import {
  handleMemoryGetRequest,
  handleMemorySearchRequest,
  handleSessionRotateRequest,
  type RequestHandlerResult,
} from "./embedded-gateway.request-handlers.js";
import { rotateGatewayAuthToken } from "./gateway-auth.js";
import type { GatewayLike, GatewayState, GatewayStatus } from "./gateway-like.js";

const DEFAULT_PORT = 19001;

type ConnectionContext = {
  connectionId: string;
  clientId: string;
  authenticated: boolean;
  closed: boolean;
  activeRuns: Map<string, AbortController>;
};

export type EmbeddedGatewayOptions = {
  runtimeProvider?: CyDeckRuntimeProviderConfig;
  aiProviderOverride?: AIProvider | null;
  workspacePath?: string;
  memoryRuntime?: Partial<MemoryRuntimeConfig>;
};

function isAbortError(err: unknown): boolean {
  if (!err) {
    return false;
  }
  if (err instanceof DOMException && err.name === "AbortError") {
    return true;
  }
  if (err instanceof Error) {
    return err.name === "AbortError" || /abort/i.test(err.message);
  }
  return false;
}

export class EmbeddedGateway extends EventEmitter implements GatewayLike {
  private wss: WebSocketServer | null = null;
  private readonly sessions = new Map<string, ChatSession>();
  private readonly connections = new Set<ConnectionContext>();
  private aiProvider: AIProvider | null = null;
  private aiUnavailableReason = "";
  private readonly runtimeProviderLocked: boolean;
  private readonly memoryRuntime: MemoryRuntimeConfig;
  private workspacePath: string = process.cwd();

  private status: GatewayStatus = "stopped";
  private lastError: string | undefined;

  private readonly port: number;
  private authToken: string;

  constructor(port: number, authToken: string, options: EmbeddedGatewayOptions = {}) {
    super();

    const normalizedPort = Number.isFinite(port) && port > 0 ? Math.floor(port) : DEFAULT_PORT;
    this.port = normalizedPort;
    this.authToken = authToken;
    this.runtimeProviderLocked = options.aiProviderOverride !== undefined;
    this.memoryRuntime = resolveMemoryRuntimeConfig(options.memoryRuntime);
    this.reloadWorkspacePath(options.workspacePath);

    if (this.runtimeProviderLocked) {
      this.aiProvider = options.aiProviderOverride ?? null;
      this.aiUnavailableReason = options.aiProviderOverride
        ? ""
        : "AI chat is disabled for this Embedded Gateway instance.";
      return;
    }

    this.reloadRuntimeProvider(options.runtimeProvider);
  }

  reloadWorkspacePath(workspacePath?: string): void {
    const raw = typeof workspacePath === "string" ? workspacePath.trim() : "";
    if (!raw) {
      return;
    }
    this.workspacePath = raw;
  }

  reloadRuntimeProvider(runtimeProvider?: CyDeckRuntimeProviderConfig): void {
    if (this.runtimeProviderLocked) {
      return;
    }

    const configured = createEmbeddedGatewayProvider(runtimeProvider);
    this.aiProvider = configured.provider;
    this.aiUnavailableReason = configured.unavailableReason;
  }

  getState(): GatewayState {
    return {
      status: this.status,
      port: this.port,
      error: this.lastError,
    };
  }

  getAuthToken(): string {
    return this.authToken;
  }

  isRunning(): boolean {
    return this.status === "running";
  }

  async start(): Promise<void> {
    if (this.status === "running" || this.status === "starting") {
      return;
    }

    this.setState("starting");

    try {
      const wss = await this.createServer(this.port);
      this.wss = wss;

      this.wss.on("connection", (ws) => this.handleConnection(ws));
      this.wss.on("error", (err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[EmbeddedGateway] WebSocket server error:", message);
        if (this.status === "running") {
          this.setState("error", message);
        }
      });

      this.setState("running");
      console.log(`[EmbeddedGateway] Started on ws://127.0.0.1:${this.port}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState("error", message);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.status === "stopped" || this.status === "stopping") {
      return;
    }

    this.setState("stopping");

    const server = this.wss;
    this.wss = null;

    for (const connection of this.connections) {
      connection.closed = true;
      for (const controller of connection.activeRuns.values()) {
        controller.abort();
      }
      connection.activeRuns.clear();
      clearConnectionSessions(this.sessions, connection.connectionId);
    }
    this.connections.clear();

    if (server) {
      await new Promise<void>((resolve, reject) => {
        for (const client of server.clients) {
          try {
            client.terminate();
          } catch {
            // Best effort.
          }
        }

        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    }

    this.setState("stopped");
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  rotateAuthToken(newToken?: string): { token: string; path: string } {
    if (newToken && newToken.trim()) {
      this.authToken = newToken.trim();
      return { token: this.authToken, path: "" };
    }

    const rotated = rotateGatewayAuthToken();
    this.authToken = rotated.token;
    return rotated;
  }

  private async createServer(port: number): Promise<WebSocketServer> {
    return await new Promise<WebSocketServer>((resolve, reject) => {
      const server = new WebSocketServer({
        host: "127.0.0.1",
        port,
      });

      const onError = (err: Error) => {
        server.off("listening", onListening);
        reject(err);
      };

      const onListening = () => {
        server.off("error", onError);
        resolve(server);
      };

      server.once("error", onError);
      server.once("listening", onListening);
    });
  }

  private handleConnection(ws: WebSocket): void {
    const context: ConnectionContext = {
      connectionId: randomUUID(),
      clientId: "unknown",
      authenticated: false,
      closed: false,
      activeRuns: new Map<string, AbortController>(),
    };
    this.connections.add(context);

    ws.on("close", (code, reason) => {
      this.handleConnectionClosed(context, code, reason.toString());
    });
    ws.on("error", (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[EmbeddedGateway] Connection error (${context.connectionId}): ${message}`);
    });
    ws.on("message", (raw) => {
      const frame = parseGatewayRequest(raw);
      if (!frame) {
        return;
      }

      void this.handleRequest(ws, context, frame).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        sendGatewayError(ws, frame.id, message);
      });
    });
  }

  private handleConnectionClosed(
    context: ConnectionContext,
    code: number,
    reason: string,
  ): void {
    if (context.closed) {
      return;
    }
    context.closed = true;

    for (const controller of context.activeRuns.values()) {
      controller.abort();
    }
    context.activeRuns.clear();

    clearConnectionSessions(this.sessions, context.connectionId);
    this.connections.delete(context);

    if (code !== 1000) {
      console.warn(
        `[EmbeddedGateway] Connection closed unexpectedly (${context.connectionId}) code=${code} reason=${reason || "none"}`,
      );
    }
  }

  private async handleRequest(
    ws: WebSocket,
    context: ConnectionContext,
    request: GatewayRequest,
  ): Promise<void> {
    const id = request.id;
    const method = request.method;
    const params = request.params ?? {};

    if (method === "connect") {
      await this.handleConnect(ws, context, id, params, request.auth);
      return;
    }

    if (!context.authenticated) {
      sendGatewayError(ws, id, "Unauthorized", 401);
      return;
    }

    if (method === "chat.send") {
      await this.handleChatSend(ws, context, id, params);
      return;
    }

    if (method === "tools.memory.search") {
      this.replyWithRequestResult(
        ws,
        id,
        handleMemorySearchRequest({
          workspacePath: this.workspacePath,
          params,
        }),
      );
      return;
    }

    if (method === "tools.memory.get") {
      this.replyWithRequestResult(
        ws,
        id,
        handleMemoryGetRequest({
          workspacePath: this.workspacePath,
          params,
        }),
      );
      return;
    }

    if (method === "session.rotate") {
      this.replyWithRequestResult(
        ws,
        id,
        handleSessionRotateRequest({
          sessions: this.sessions,
          connectionId: context.connectionId,
          workspacePath: this.workspacePath,
          memoryRuntime: this.memoryRuntime,
          params,
        }),
      );
      return;
    }

    sendGatewayError(ws, id, `Unknown method: ${method}`, 404);
  }

  private async handleConnect(
    ws: WebSocket,
    context: ConnectionContext,
    id: string,
    params: Record<string, unknown>,
    auth?: { token?: string },
  ): Promise<void> {
    const validation = validateConnectRequest({
      expectedToken: this.authToken,
      params,
      auth,
    });
    if (!validation.ok) {
      sendGatewayError(ws, id, validation.message, validation.code);
      return;
    }

    if (validation.clientId) {
      context.clientId = validation.clientId;
    }

    context.authenticated = true;
    sendGatewayResponse(ws, id, createConnectOkPayload());
  }

  private async handleChatSend(
    ws: WebSocket,
    context: ConnectionContext,
    requestId: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const message = params.message;
    if (typeof message !== "string" || !message.trim()) {
      sendGatewayError(ws, requestId, "Message is required", 400);
      return;
    }

    const sessionKey =
      typeof params.sessionKey === "string" && params.sessionKey.trim()
        ? params.sessionKey.trim()
        : "default";

    const idempotencyKey =
      typeof params.idempotencyKey === "string" && params.idempotencyKey.trim()
        ? params.idempotencyKey.trim()
        : randomUUID();

    const deliver = params.deliver !== false;
    const session = getSession(this.sessions, context.connectionId, sessionKey);
    syncLandingSystemPrompt(session, this.workspacePath);
    if (Object.prototype.hasOwnProperty.call(params, "agentHint")) {
      session.agentHint = normalizeAgentHint(params.agentHint);
    }

    session.messages.push({ role: "user", content: message.trim() });
    maybeRunPreCompactionFlush({
      session,
      workspacePath: this.workspacePath,
      memoryRuntime: this.memoryRuntime,
    });
    trimSessionMessages(session);

    sendGatewayResponse(ws, requestId, {
      runId: idempotencyKey,
      status: "started",
    });

    if (!deliver) {
      return;
    }

    const controller = new AbortController();
    context.activeRuns.set(idempotencyKey, controller);

    try {
      let seq = 0;
      let fullText = "";
      const realtimeResolution = await resolveRealtimeQuery(
        message.trim(),
        { sessionMessages: session.messages },
        controller.signal,
      );
      if (realtimeResolution?.assistantText) {
        const replyText = realtimeResolution.assistantText;
        session.messages.push({ role: "assistant", content: replyText });
        maybeRunPreCompactionFlush({
          session,
          workspacePath: this.workspacePath,
          memoryRuntime: this.memoryRuntime,
        });
        trimSessionMessages(session);
        maybeRunSessionMemoryAutoWrite({
          session,
          workspacePath: this.workspacePath,
          memoryRuntime: this.memoryRuntime,
        });
        sendGatewayChatEvent(ws, {
          runId: idempotencyKey,
          sessionKey,
          seq,
          state: "final",
          text: replyText,
        });
        return;
      }

      if (!this.aiProvider) {
        const fallbackText = this.aiUnavailableReason;
        session.messages.push({ role: "assistant", content: fallbackText });
        maybeRunPreCompactionFlush({
          session,
          workspacePath: this.workspacePath,
          memoryRuntime: this.memoryRuntime,
        });
        trimSessionMessages(session);
        maybeRunSessionMemoryAutoWrite({
          session,
          workspacePath: this.workspacePath,
          memoryRuntime: this.memoryRuntime,
        });
        sendGatewayChatEvent(ws, {
          runId: idempotencyKey,
          sessionKey,
          seq,
          state: "final",
          text: fallbackText,
        });
        return;
      }

      const providerInput = buildMessagesForProvider({
        session,
        userMessage: message.trim(),
        workspacePath: this.workspacePath,
        memoryRuntime: this.memoryRuntime,
      });
      const realtimeContext =
        realtimeResolution?.context ??
        (await buildRealtimeContext(
          message.trim(),
          { sessionMessages: session.messages },
          controller.signal,
        ));
      const providerMessages = injectRealtimeContext(providerInput.messages, realtimeContext);

      await this.aiProvider.chat(
        providerMessages,
        async (chunk) => {
          if (!chunk || context.closed || controller.signal.aborted) {
            return;
          }
          fullText += chunk;
          const sent = sendGatewayChatEvent(ws, {
            runId: idempotencyKey,
            sessionKey,
            seq,
            state: "delta",
            text: chunk,
          });
          seq += 1;

          if (!sent) {
            controller.abort();
          }
        },
        controller.signal,
      );

      if (controller.signal.aborted || context.closed) {
        sendGatewayChatEvent(ws, {
          runId: idempotencyKey,
          sessionKey,
          state: "aborted",
          text: "Request aborted",
        });
        return;
      }

      session.messages.push({ role: "assistant", content: fullText });
      maybeRunPreCompactionFlush({
        session,
        workspacePath: this.workspacePath,
        memoryRuntime: this.memoryRuntime,
      });
      trimSessionMessages(session);
      maybeRunSessionMemoryAutoWrite({
        session,
        workspacePath: this.workspacePath,
        memoryRuntime: this.memoryRuntime,
      });

      sendGatewayChatEvent(ws, {
        runId: idempotencyKey,
        sessionKey,
        seq,
        state: "final",
        text: "",
      });
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted || context.closed) {
        sendGatewayChatEvent(ws, {
          runId: idempotencyKey,
          sessionKey,
          state: "aborted",
          text: "Request aborted",
        });
        return;
      }

      const messageText = formatProviderError(err);
      sendGatewayChatEvent(ws, {
        runId: idempotencyKey,
        sessionKey,
        state: "error",
        text: messageText,
        errorMessage: messageText,
      });
    } finally {
      context.activeRuns.delete(idempotencyKey);
    }
  }

  private replyWithRequestResult(
    ws: WebSocket,
    requestId: string,
    result: RequestHandlerResult,
  ): void {
    if (result.ok) {
      sendGatewayResponse(ws, requestId, result.payload);
      return;
    }
    sendGatewayError(ws, requestId, result.message, result.code);
  }

  private setState(status: GatewayStatus, error?: string): void {
    const previousStatus = this.status;
    const previousError = this.lastError;

    this.status = status;
    this.lastError = status === "error" ? error ?? "Unknown embedded gateway error" : undefined;

    if (previousStatus === this.status && previousError === this.lastError) {
      return;
    }

    this.emit("state-changed", this.getState());
  }
}

export type { AIProvider } from "./embedded-gateway.providers.js";
