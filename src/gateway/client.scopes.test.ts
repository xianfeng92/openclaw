import { afterEach, describe, expect, it, vi } from "vitest";

describe("GatewayClient default scopes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not request implicit operator scopes when none are provided", async () => {
    vi.useFakeTimers();
    vi.resetModules();

    class MockWebSocket {
      static last: MockWebSocket | null = null;
      static OPEN = 1;

      readonly handlers = new Map<string, Array<(value?: unknown) => void>>();
      readyState = 1;
      sentFrames: string[] = [];

      constructor(_url: unknown, _opts: unknown) {
        MockWebSocket.last = this;
      }

      on(event: string, handler: (value?: unknown) => void) {
        const list = this.handlers.get(event) ?? [];
        list.push(handler);
        this.handlers.set(event, list);
      }

      send(data: string) {
        this.sentFrames.push(data);
      }

      close() {
        // no-op
      }

      emit(event: string, value?: unknown) {
        for (const handler of this.handlers.get(event) ?? []) {
          handler(value);
        }
      }
    }

    vi.doMock("ws", () => ({
      WebSocket: MockWebSocket,
    }));

    const { GatewayClient } = await import("./client.js");
    const client = new GatewayClient({ url: "ws://127.0.0.1:1" });
    client.start();

    MockWebSocket.last?.emit("open");
    await vi.advanceTimersByTimeAsync(800);

    const frame = JSON.parse(MockWebSocket.last?.sentFrames[0] ?? "{}") as {
      params?: { scopes?: unknown };
    };
    expect(frame.params?.scopes).toEqual([]);
  });
});
