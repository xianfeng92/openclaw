import { describe, expect, it, vi } from "vitest";
import { TerminalGatewayClient } from "./gateway-client.js";

class FakeWebSocket {
  static readonly OPEN = 1;

  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly sentFrames: unknown[] = [];
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    const frame = JSON.parse(data) as Record<string, unknown>;
    this.sentFrames.push(frame);

    if (frame.method === "connect") {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            payload: {
              type: "hello-ok",
              protocol: 3,
            },
          }),
        });
      });
    }
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: "closed" });
  }
}

describe("TerminalGatewayClient.sendMessage", () => {
  it("connects as a CyDeck desktop client", async () => {
    const originalWebSocket = globalThis.WebSocket;
    FakeWebSocket.instances.length = 0;
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    try {
      const client = new TerminalGatewayClient("ws://127.0.0.1:18789", "token");
      const connectPromise = client.connect();
      const socket = FakeWebSocket.instances[0];
      expect(socket?.url).toBe("ws://127.0.0.1:18789");

      socket?.onopen?.();
      await connectPromise;

      const connectFrame = socket?.sentFrames[0] as {
        method?: string;
        params?: {
          client?: Record<string, unknown>;
          caps?: string[];
          scopes?: string[];
        };
      };
      expect(connectFrame.method).toBe("connect");
      expect(connectFrame.params?.client?.mode).toBe("cydeck");
      expect(connectFrame.params?.client?.displayName).toBe("CyDeck Terminal");
      expect(connectFrame.params?.caps).toContain("desktop.cydeck");
      expect(connectFrame.params?.scopes).toEqual(["operator.read", "operator.write"]);
      expect(connectFrame.params?.scopes).not.toContain("operator.admin");
    } finally {
      if (originalWebSocket) {
        globalThis.WebSocket = originalWebSocket;
      } else {
        delete (globalThis as { WebSocket?: unknown }).WebSocket;
      }
    }
  });

  it("forwards agentHint to chat.send when provided", async () => {
    const client = new TerminalGatewayClient("ws://127.0.0.1:18789", "token");
    const sendRequest = vi.fn(
      async (
        _method: string,
        _params: Record<string, unknown>,
        _opts?: { requestId?: string; timeoutMs?: number },
      ) => ({
        runId: "run-1",
        status: "started",
      }),
    );
    (client as unknown as { sendRequest: typeof sendRequest }).sendRequest = sendRequest;

    await client.sendMessage("default", "hello", {
      idempotencyKey: "idem-1",
      agentHint: "claude",
    });

    expect(sendRequest).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        sessionKey: "default",
        message: "hello",
        deliver: true,
        idempotencyKey: "idem-1",
        agentHint: "claude",
      }),
      { requestId: "idem-1", timeoutMs: 60000 },
    );
  });

  it("omits agentHint when blank", async () => {
    const client = new TerminalGatewayClient("ws://127.0.0.1:18789", "token");
    const sendRequest = vi.fn(
      async (
        _method: string,
        _params: Record<string, unknown>,
        _opts?: { requestId?: string; timeoutMs?: number },
      ) => ({
      runId: "run-2",
      status: "started",
      }),
    );
    (client as unknown as { sendRequest: typeof sendRequest }).sendRequest = sendRequest;

    await client.sendMessage("default", "hello", {
      idempotencyKey: "idem-2",
      agentHint: "   ",
    });

    expect(sendRequest).toHaveBeenCalledTimes(1);
    const firstCall = sendRequest.mock.calls[0];
    const sentParams = (firstCall ? firstCall[1] : {}) as Record<string, unknown>;
    expect(sentParams).not.toHaveProperty("agentHint");
  });
});
