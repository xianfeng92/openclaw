import { randomUUID, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { WebSocketServer, type WebSocket } from "ws";
import { ProxyAgent, type Dispatcher } from "undici";
import type { CyDeckRuntimeProviderConfig } from "./cydeck-config.js";
import { rotateGatewayAuthToken } from "./gateway-auth.js";
import type { GatewayLike, GatewayState, GatewayStatus } from "./gateway-like.js";

const GATEWAY_PROTOCOL_VERSION = 3;
const DEFAULT_PORT = 19001;
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const GOOGLE_DEFAULT_MODEL = "gemini-2.0-flash";
const GOOGLE_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const WS_READY_STATE_OPEN = 1;
const SESSION_MAX_MESSAGES = 40;

type GatewayRequest = {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
  auth?: { token?: string };
};

type GatewayResponse = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message: string; code?: number };
};

type GatewayEventFrame = {
  type: "event";
  event: string;
  payload: Record<string, unknown>;
};

type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatSession = {
  sessionKey: string;
  messages: ChatMessage[];
};

type ConnectionContext = {
  connectionId: string;
  clientId: string;
  authenticated: boolean;
  closed: boolean;
  activeRuns: Map<string, AbortController>;
};

export interface AIProvider {
  chat(
    messages: ChatMessage[],
    onChunk?: (text: string) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<string>;
}

export type EmbeddedGatewayOptions = {
  runtimeProvider?: CyDeckRuntimeProviderConfig;
  aiProviderOverride?: AIProvider | null;
};

type RequestInitWithDispatcher = RequestInit & { dispatcher?: Dispatcher };

function shouldBypassProxy(hostname: string, noProxyRaw?: string): boolean {
  if (!noProxyRaw || !noProxyRaw.trim()) {
    return false;
  }

  const host = hostname.trim().toLowerCase();
  const rules = noProxyRaw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  for (const rule of rules) {
    if (rule === "*") {
      return true;
    }
    const normalizedRule = rule.startsWith(".") ? rule.slice(1) : rule;
    if (host === normalizedRule || host.endsWith(`.${normalizedRule}`)) {
      return true;
    }
  }

  return false;
}

function createProxyDispatcher(baseUrl: string): Dispatcher | undefined {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return undefined;
  }

  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (shouldBypassProxy(parsed.hostname, noProxy)) {
    return undefined;
  }

  const proxyUrl =
    (parsed.protocol === "https:" ? process.env.HTTPS_PROXY || process.env.https_proxy : "") ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  if (!proxyUrl || !proxyUrl.trim()) {
    return undefined;
  }

  try {
    return new ProxyAgent(proxyUrl.trim());
  } catch {
    return undefined;
  }
}

function formatProviderError(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }

  const withCause = err as Error & { cause?: unknown };
  const cause = withCause.cause;

  if (cause instanceof Error && cause.message) {
    return `${err.message} (${cause.message})`;
  }

  if (cause && typeof cause === "object") {
    const causeRecord = cause as Record<string, unknown>;
    if (typeof causeRecord.message === "string" && causeRecord.message.trim()) {
      return `${err.message} (${causeRecord.message})`;
    }
  }

  return err.message;
}

class OpenAIProvider implements AIProvider {
  private readonly dispatcher: Dispatcher | undefined;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
  ) {
    this.dispatcher = createProxyDispatcher(baseUrl);
  }

  async chat(
    messages: ChatMessage[],
    onChunk?: (text: string) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<string> {
    const requestInit: RequestInitWithDispatcher = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: Boolean(onChunk),
      }),
      signal,
    };
    if (this.dispatcher) {
      requestInit.dispatcher = this.dispatcher;
    }

    const response = await fetch(`${normalizeBaseUrl(this.baseUrl)}/chat/completions`, requestInit);

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status} ${response.statusText}`);
    }

    if (!onChunk) {
      const data = (await response.json()) as Record<string, unknown>;
      return this.extractFullText(data);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("AI API returned an empty response body");
    }

    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const lineBreakIndex = buffer.indexOf("\n");
        if (lineBreakIndex === -1) {
          break;
        }

        const line = buffer.slice(0, lineBreakIndex).trim();
        buffer = buffer.slice(lineBreakIndex + 1);

        if (!line.startsWith("data:")) {
          continue;
        }

        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") {
          continue;
        }

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const delta = this.extractDeltaText(parsed);
          if (delta) {
            fullText += delta;
            await onChunk(delta);
          }
        } catch {
          // Ignore malformed chunks from upstream provider.
        }
      }
    }

    return fullText;
  }

  private extractFullText(data: Record<string, unknown>): string {
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    if (!first || typeof first !== "object") {
      return "";
    }

    const message = first.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") {
      return "";
    }

    const content = message.content;
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }
          const text = (part as Record<string, unknown>).text;
          return typeof text === "string" ? text : "";
        })
        .join("");
    }

    return "";
  }

  private extractDeltaText(data: Record<string, unknown>): string {
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    if (!first || typeof first !== "object") {
      return "";
    }

    const delta = first.delta as Record<string, unknown> | undefined;
    if (!delta || typeof delta !== "object") {
      return "";
    }

    const content = delta.content;
    return typeof content === "string" ? content : "";
  }
}

class GoogleProvider implements AIProvider {
  private readonly dispatcher: Dispatcher | undefined;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly maxTokens: number,
  ) {
    this.dispatcher = createProxyDispatcher(baseUrl);
  }

  async chat(
    messages: ChatMessage[],
    onChunk?: (text: string) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<string> {
    const systemMessages = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content.trim())
      .filter(Boolean);

    const contents = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));

    const endpoint = this.buildEndpoint();
    const payload: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: Math.max(1, Math.floor(this.maxTokens)),
      },
    };
    if (systemMessages.length > 0) {
      payload.systemInstruction = {
        parts: [{ text: systemMessages.join("\n\n") }],
      };
    }

    const requestInit: RequestInitWithDispatcher = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    };
    if (this.dispatcher) {
      requestInit.dispatcher = this.dispatcher;
    }

    const response = await fetch(endpoint, requestInit);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const detail = errorText ? ` - ${errorText}` : "";
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}${detail}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const text = this.extractText(data);
    if (onChunk && text) {
      await onChunk(text);
    }
    return text;
  }

  private buildEndpoint(): string {
    const normalizedBase = normalizeBaseUrl(this.baseUrl);
    const encodedModel = encodeURIComponent(this.model);
    const encodedKey = encodeURIComponent(this.apiKey);
    return `${normalizedBase}/models/${encodedModel}:generateContent?key=${encodedKey}`;
  }

  private extractText(data: Record<string, unknown>): string {
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const first = candidates[0] as Record<string, unknown> | undefined;
    if (!first || typeof first !== "object") {
      return "";
    }

    const content = first.content as Record<string, unknown> | undefined;
    if (!content || typeof content !== "object") {
      return "";
    }

    const parts = Array.isArray(content.parts) ? content.parts : [];
    return parts
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const text = (part as Record<string, unknown>).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

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

    if (this.runtimeProviderLocked) {
      this.aiProvider = options.aiProviderOverride ?? null;
      this.aiUnavailableReason = options.aiProviderOverride
        ? ""
        : "AI chat is disabled for this Embedded Gateway instance.";
      return;
    }

    this.reloadRuntimeProvider(options.runtimeProvider);
  }

  reloadRuntimeProvider(runtimeProvider?: CyDeckRuntimeProviderConfig): void {
    if (this.runtimeProviderLocked) {
      return;
    }

    if (runtimeProvider) {
      const apiKey = runtimeProvider.apiKey.trim();
      if (!apiKey) {
        this.aiProvider = null;
        this.aiUnavailableReason =
          `Provider "${runtimeProvider.provider}" is selected but apiKey is empty.`;
        return;
      }

      if (runtimeProvider.provider === "openai") {
        const baseUrl = runtimeProvider.baseUrl.trim() || OPENAI_DEFAULT_BASE_URL;
        const model = runtimeProvider.model.trim() || OPENAI_DEFAULT_MODEL;
        this.aiProvider = new OpenAIProvider(apiKey, baseUrl, model);
        this.aiUnavailableReason = "";
        return;
      }

      if (runtimeProvider.provider === "google") {
        const baseUrl = runtimeProvider.baseUrl.trim() || GOOGLE_DEFAULT_BASE_URL;
        const model = runtimeProvider.model.trim() || GOOGLE_DEFAULT_MODEL;
        this.aiProvider = new GoogleProvider(apiKey, baseUrl, model, runtimeProvider.maxTokens);
        this.aiUnavailableReason = "";
        return;
      }

      this.aiProvider = null;
      this.aiUnavailableReason =
        `Provider "${runtimeProvider.provider}" is not supported by Embedded Gateway yet.`;
      return;
    }

    const envOpenAiApiKey = (process.env.OPENAI_API_KEY || "").trim();
    const envOpenAiBaseUrl =
      (process.env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE_URL).trim() || OPENAI_DEFAULT_BASE_URL;
    const envOpenAiModel = (process.env.OPENAI_MODEL || OPENAI_DEFAULT_MODEL).trim() || OPENAI_DEFAULT_MODEL;
    if (envOpenAiApiKey) {
      this.aiProvider = new OpenAIProvider(envOpenAiApiKey, envOpenAiBaseUrl, envOpenAiModel);
      this.aiUnavailableReason = "";
      return;
    }

    const envGeminiApiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
    const envGeminiBaseUrl =
      (process.env.GEMINI_BASE_URL || GOOGLE_DEFAULT_BASE_URL).trim() || GOOGLE_DEFAULT_BASE_URL;
    const envGeminiModel = (process.env.GEMINI_MODEL || GOOGLE_DEFAULT_MODEL).trim() || GOOGLE_DEFAULT_MODEL;
    if (envGeminiApiKey) {
      this.aiProvider = new GoogleProvider(envGeminiApiKey, envGeminiBaseUrl, envGeminiModel, 8192);
      this.aiUnavailableReason = "";
      return;
    }

    this.aiProvider = null;
    this.aiUnavailableReason =
      "AI chat is not configured. Set CyDeck config ai provider apiKey or OPENAI_API_KEY/GEMINI_API_KEY.";
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
      this.clearConnectionSessions(connection);
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
      const text = typeof raw === "string" ? raw : raw.toString();

      let frame: GatewayRequest;
      try {
        frame = JSON.parse(text) as GatewayRequest;
      } catch {
        return;
      }

      if (!frame || frame.type !== "req" || typeof frame.id !== "string") {
        return;
      }

      if (typeof frame.method !== "string" || !frame.method.trim()) {
        this.sendError(ws, frame.id, "Invalid method", 400);
        return;
      }

      void this.handleRequest(ws, context, frame).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.sendError(ws, frame.id, message);
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

    this.clearConnectionSessions(context);
    this.connections.delete(context);

    if (code !== 1000) {
      console.warn(
        `[EmbeddedGateway] Connection closed unexpectedly (${context.connectionId}) code=${code} reason=${reason || "none"}`,
      );
    }
  }

  private clearConnectionSessions(context: ConnectionContext): void {
    const prefix = `${context.connectionId}::`;
    for (const key of this.sessions.keys()) {
      if (key.startsWith(prefix)) {
        this.sessions.delete(key);
      }
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
      this.sendError(ws, id, "Unauthorized", 401);
      return;
    }

    if (method === "chat.send") {
      await this.handleChatSend(ws, context, id, params);
      return;
    }

    this.sendError(ws, id, `Unknown method: ${method}`, 404);
  }

  private isTokenValid(candidate: string): boolean {
    const expected = Buffer.from(this.authToken);
    const provided = Buffer.from(candidate);
    if (expected.length !== provided.length) {
      return false;
    }
    return timingSafeEqual(expected, provided);
  }

  private isProtocolCompatible(params: Record<string, unknown>): boolean {
    const minProtocol =
      typeof params.minProtocol === "number" && Number.isFinite(params.minProtocol)
        ? Math.floor(params.minProtocol)
        : undefined;
    const maxProtocol =
      typeof params.maxProtocol === "number" && Number.isFinite(params.maxProtocol)
        ? Math.floor(params.maxProtocol)
        : undefined;

    if (minProtocol !== undefined && minProtocol > GATEWAY_PROTOCOL_VERSION) {
      return false;
    }
    if (maxProtocol !== undefined && maxProtocol < GATEWAY_PROTOCOL_VERSION) {
      return false;
    }
    return true;
  }

  private async handleConnect(
    ws: WebSocket,
    context: ConnectionContext,
    id: string,
    params: Record<string, unknown>,
    auth?: { token?: string },
  ): Promise<void> {
    if (!this.isProtocolCompatible(params)) {
      this.sendError(
        ws,
        id,
        `Protocol mismatch. Embedded Gateway supports protocol ${GATEWAY_PROTOCOL_VERSION}.`,
        426,
      );
      return;
    }

    const paramsAuth = params.auth;
    const paramsToken =
      paramsAuth && typeof paramsAuth === "object"
        ? (paramsAuth as Record<string, unknown>).token
        : undefined;

    const tokenFromRequest =
      typeof auth?.token === "string"
        ? auth.token
        : typeof paramsToken === "string"
          ? paramsToken
          : undefined;

    if (!tokenFromRequest || !this.isTokenValid(tokenFromRequest)) {
      this.sendError(ws, id, "Unauthorized", 401);
      return;
    }

    const client = params.client;
    if (client && typeof client === "object") {
      const clientId = (client as Record<string, unknown>).id;
      if (typeof clientId === "string" && clientId.trim()) {
        context.clientId = clientId.trim();
      }
    }

    context.authenticated = true;

    this.sendResponse(ws, id, {
      type: "hello-ok",
      protocol: GATEWAY_PROTOCOL_VERSION,
      server: {
        name: "CyDeck Embedded Gateway",
        version: "1.0.0",
        mode: "embedded",
      },
    });
  }

  private getSession(context: ConnectionContext, sessionKey: string): ChatSession {
    const namespacedKey = `${context.connectionId}::${sessionKey}`;
    let session = this.sessions.get(namespacedKey);
    if (!session) {
      session = { sessionKey, messages: [] };
      this.sessions.set(namespacedKey, session);
    }
    return session;
  }

  private trimSessionMessages(session: ChatSession): void {
    if (session.messages.length <= SESSION_MAX_MESSAGES) {
      return;
    }
    const overflow = session.messages.length - SESSION_MAX_MESSAGES;
    session.messages.splice(0, overflow);
  }

  private async handleChatSend(
    ws: WebSocket,
    context: ConnectionContext,
    requestId: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const message = params.message;
    if (typeof message !== "string" || !message.trim()) {
      this.sendError(ws, requestId, "Message is required", 400);
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
    const session = this.getSession(context, sessionKey);

    session.messages.push({ role: "user", content: message.trim() });
    this.trimSessionMessages(session);

    this.sendResponse(ws, requestId, {
      runId: idempotencyKey,
      status: "started",
    });

    if (!deliver) {
      return;
    }

    if (!this.aiProvider) {
      const fallbackText = this.aiUnavailableReason;
      session.messages.push({ role: "assistant", content: fallbackText });
      this.trimSessionMessages(session);
      this.sendChatEvent(ws, {
        runId: idempotencyKey,
        sessionKey,
        seq: 0,
        state: "final",
        text: fallbackText,
      });
      return;
    }

    const controller = new AbortController();
    context.activeRuns.set(idempotencyKey, controller);

    try {
      let seq = 0;
      let fullText = "";

      await this.aiProvider.chat(
        session.messages,
        async (chunk) => {
          if (!chunk || context.closed || controller.signal.aborted) {
            return;
          }
          fullText += chunk;
          const sent = this.sendChatEvent(ws, {
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
        this.sendChatEvent(ws, {
          runId: idempotencyKey,
          sessionKey,
          state: "aborted",
          text: "Request aborted",
        });
        return;
      }

      session.messages.push({ role: "assistant", content: fullText });
      this.trimSessionMessages(session);

      this.sendChatEvent(ws, {
        runId: idempotencyKey,
        sessionKey,
        seq,
        state: "final",
        text: "",
      });
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted || context.closed) {
        this.sendChatEvent(ws, {
          runId: idempotencyKey,
          sessionKey,
          state: "aborted",
          text: "Request aborted",
        });
        return;
      }

      const messageText = formatProviderError(err);
      this.sendChatEvent(ws, {
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

  private sendChatEvent(
    ws: WebSocket,
    payload: {
      runId: string;
      sessionKey: string;
      seq?: number;
      state: "delta" | "final" | "aborted" | "error";
      text: string;
      errorMessage?: string;
    },
  ): boolean {
    return this.sendEvent(ws, {
      event: "chat",
      payload,
    });
  }

  private sendResponse(ws: WebSocket, id: string, payload: unknown): boolean {
    const frame: GatewayResponse = {
      type: "res",
      id,
      ok: true,
      payload,
    };
    return this.sendFrame(ws, frame);
  }

  private sendError(ws: WebSocket, id: string, message: string, code = 500): boolean {
    const frame: GatewayResponse = {
      type: "res",
      id,
      ok: false,
      error: {
        message,
        code,
      },
    };
    return this.sendFrame(ws, frame);
  }

  private sendEvent(
    ws: WebSocket,
    event: { event: string; payload: Record<string, unknown> },
  ): boolean {
    const frame: GatewayEventFrame = {
      type: "event",
      event: event.event,
      payload: event.payload,
    };
    return this.sendFrame(ws, frame);
  }

  private sendFrame(ws: WebSocket, frame: GatewayResponse | GatewayEventFrame): boolean {
    if (ws.readyState !== WS_READY_STATE_OPEN) {
      return false;
    }

    try {
      ws.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
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
