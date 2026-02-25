// Gateway client for terminal - uses proper Gateway protocol

const generateUUID = (): string => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export type GatewayEventHandler = (message: string, state: "delta" | "final" | "aborted") => void;

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
    timeout?: number;
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
    const payload = frame.payload;

    // Extract text from various payload formats
    let text = "";
    let state: "delta" | "final" | "aborted" = "final";

    if (typeof payload === "string") {
      text = payload;
    } else if (payload && typeof payload === "object") {
      // Check for different payload structures
      if (payload.message !== undefined) {
        text = extractMessageText(payload.message);
      } else if (payload.text && typeof payload.text === "string") {
        text = payload.text;
      } else if (payload.delta && typeof payload.delta === "string") {
        text = payload.delta;
        state = "delta";
      } else if (payload.content && typeof payload.content === "string") {
        text = payload.content;
      } else if (payload.parts && Array.isArray(payload.parts)) {
        // Handle parts array
        text = payload.parts.map((p: any) => {
          if (typeof p === "string") return p;
          if (p && p.text) return p.text;
          if (p && p.delta) return p.delta;
          return "";
        }).join("");
      }

      if (payload.state) {
        if (payload.state === "delta" || payload.state === "final" || payload.state === "aborted") {
          state = payload.state;
        } else if (payload.state === "error") {
          // Keep terminal flow simple: render the error text and close this response turn.
          state = "final";
        }
      }

      if (!text && typeof payload.errorMessage === "string") {
        text = payload.errorMessage;
      }
    }

    if (text) {
      console.log("[Gateway] Notifying handlers:", text.substring(0, 50), state);
      for (const handler of this.eventHandlers) {
        try {
          handler(text, state);
        } catch (err) {
          console.error("[Gateway] Event handler error:", err);
        }
      }
    }
  }

  async sendMessage(sessionKey: string, message: string): Promise<string> {
    if (!this.helloReceived) {
      throw new Error("Not connected to Gateway");
    }

    return new Promise((resolve, reject) => {
      const requestId = generateUUID();

      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Request timeout"));
      }, 60000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      // Send the message request
      this.send({
        type: "req",
        id: requestId,
        method: "chat.send",
        params: {
          sessionKey,
          message,
          deliver: true,
          idempotencyKey: requestId,
        },
      });
    });
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
