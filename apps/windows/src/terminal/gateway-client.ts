// Gateway client for terminal - uses proper Gateway protocol

const generateUUID = (): string => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export type GatewayChatState = "delta" | "final" | "aborted" | "error";

export type GatewayChatEvent = {
  event: "chat";
  runId: string;
  sessionKey?: string;
  seq?: number;
  state: GatewayChatState;
  text: string;
};

export type GatewayEventHandler = (event: GatewayChatEvent) => void;

function extractTextPart(part: unknown): string {
  if (typeof part === "string") {
    return part;
  }
  if (!part || typeof part !== "object") {
    return "";
  }
  const record = part as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.delta === "string") {
    return record.delta;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if (Array.isArray(record.content)) {
    return record.content.map((item) => extractTextPart(item)).join("");
  }
  return "";
}

function extractMessageText(message: unknown): string {
  return extractTextPart(message);
}

export class TerminalGatewayClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private helloReceived = false;
  private url: string;
  private token: string;
  private clientId: string;
  private eventHandlers: Set<GatewayEventHandler> = new Set();
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (err: Error) => void;
    timeout?: ReturnType<typeof setTimeout>;
  }>();

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
    this.clientId = `terminal-${Date.now()}-${generateUUID()}`;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        const connectTimeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, 10000);

        this.ws.onopen = () => {
          clearTimeout(connectTimeout);

          // Send connect REQUEST (not a direct connect frame)
          // The Gateway protocol requires the first message to be a "req" type
          const connectId = generateUUID();
          this.send({
            type: "req",
            id: connectId,
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                // Terminal window runs from file:// in Electron, so it should identify as CLI
                // instead of Control UI (which enforces browser-origin checks).
                id: "cli",
                version: "1.0.0",
                platform: navigator.platform,
                mode: "cli",
              },
              caps: [],
              commands: [],
              role: "operator",
              scopes: ["operator.admin"],
              auth: {
                token: this.token,
              },
            },
          });

          // Set up a one-time handler for the connect response
          this.pendingRequests.set(connectId, {
            resolve: (value) => {
              if (value && value.type === "hello-ok") {
                console.log("[Gateway] Connected successfully, protocol:", value.protocol);
                this.connected = true;
                this.helloReceived = true;
                resolve();
              } else {
                reject(new Error("Unexpected response to connect"));
              }
            },
            reject,
            timeout: setTimeout(() => {
              this.pendingRequests.delete(connectId);
              reject(new Error("Connect response timeout"));
            }, 10000),
          });
        };

        this.ws.onclose = (event) => {
          console.log("[Gateway] Connection closed:", event.code, event.reason);
          this.connected = false;
          this.helloReceived = false;
        };

        this.ws.onerror = (err) => {
          console.error("[Gateway] WebSocket error:", err);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleMessage(data: string): void {
    try {
      const frame = JSON.parse(data);
      console.log("[Gateway] Received frame:", frame.type);

      // Handle response frames
      if (frame.type === "res") {
        const pending = this.pendingRequests.get(frame.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(frame.id);

          if (frame.ok) {
            pending.resolve(frame.payload);
          } else {
            pending.reject(new Error(frame.error?.message || "Request failed"));
          }
        }
        return;
      }

      // Handle event frames (streaming responses, etc.)
      if (frame.type === "event") {
        console.log("[Gateway] Event:", frame.event, frame.payload);
        this.notifyEventHandlers(frame);
        return;
      }
    } catch (err) {
      console.error("[Gateway] Failed to parse message:", err, data);
    }
  }

  private notifyEventHandlers(frame: any): void {
    if (frame?.event !== "chat") {
      return;
    }
    const payload = frame?.payload;
    if (!payload || typeof payload !== "object") {
      return;
    }

    const runId = typeof payload.runId === "string" ? payload.runId : "";
    if (!runId) {
      return;
    }

    let state: GatewayChatState = "final";
    if (
      payload.state === "delta" ||
      payload.state === "final" ||
      payload.state === "aborted" ||
      payload.state === "error"
    ) {
      state = payload.state;
    }

    let text = "";
    if (payload.message !== undefined) {
      text = extractMessageText(payload.message);
    } else if (typeof payload.text === "string") {
      text = payload.text;
    } else if (typeof payload.delta === "string") {
      text = payload.delta;
    } else if (typeof payload.content === "string") {
      text = payload.content;
    } else if (Array.isArray(payload.parts)) {
      text = payload.parts.map((p: any) => extractTextPart(p)).join("");
    }
    if (!text && typeof payload.errorMessage === "string") {
      text = payload.errorMessage;
    }

    const event: GatewayChatEvent = {
      event: "chat",
      runId,
      sessionKey: typeof payload.sessionKey === "string" ? payload.sessionKey : undefined,
      seq: typeof payload.seq === "number" ? payload.seq : undefined,
      state,
      text,
    };

    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error("[Gateway] Event handler error:", err);
      }
    }
  }

  private async sendRequest<TResponse>(
    method: string,
    params: Record<string, unknown>,
    opts?: { requestId?: string; timeoutMs?: number },
  ): Promise<TResponse> {
    if (!this.helloReceived) {
      throw new Error("Not connected to Gateway");
    }

    return await new Promise<TResponse>((resolve, reject) => {
      const requestId = opts?.requestId ?? generateUUID();
      const timeoutMs = Math.max(1, Math.floor(opts?.timeoutMs ?? 60000));
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Request timeout"));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: (value: unknown) => {
          resolve(value as TResponse);
        },
        reject,
        timeout,
      });

      this.send({
        type: "req",
        id: requestId,
        method,
        params,
      });
    });
  }

  async sendMessage(
    sessionKey: string,
    message: string,
    opts?: { idempotencyKey?: string; agentHint?: string },
  ): Promise<{ runId: string; status: string }> {
    const requestId = opts?.idempotencyKey ?? generateUUID();
    const normalizedAgentHint =
      typeof opts?.agentHint === "string" ? opts.agentHint.trim() : "";
    const params: Record<string, unknown> = {
      sessionKey,
      message,
      deliver: true,
      idempotencyKey: requestId,
    };
    if (normalizedAgentHint) {
      params.agentHint = normalizedAgentHint;
    }
    const payload = await this.sendRequest<Record<string, unknown>>(
      "chat.send",
      params,
      { requestId, timeoutMs: 60000 },
    );
    const runId = typeof payload.runId === "string" ? payload.runId : requestId;
    const status = typeof payload.status === "string" ? payload.status : "started";
    return { runId, status };
  }

  async rotateSession(fromSessionKey: string): Promise<{
    saved: boolean;
    relativePath?: string;
    messageCount?: number;
  }> {
    const payload = await this.sendRequest<Record<string, unknown>>(
      "session.rotate",
      { fromSessionKey },
      { timeoutMs: 10000 },
    );
    return {
      saved: payload.saved === true,
      relativePath: typeof payload.relativePath === "string" ? payload.relativePath : undefined,
      messageCount: typeof payload.messageCount === "number" ? payload.messageCount : undefined,
    };
  }

  onEvent(handler: GatewayEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  disconnect(): void {
    this.connected = false;
    this.helloReceived = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Clear all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Disconnected"));
    }
    this.pendingRequests.clear();
  }

  isConnected(): boolean {
    return this.connected && this.helloReceived && this.ws?.readyState === WebSocket.OPEN;
  }
}
