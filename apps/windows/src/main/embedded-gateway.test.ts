import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { EmbeddedGateway, type AIProvider } from "./embedded-gateway.js";

type GatewayFrame = Record<string, unknown>;
type FrameInbox = {
  queue: GatewayFrame[];
  waiters: Array<(frame: GatewayFrame) => void>;
};

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to resolve free port")));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForSocketOpen(ws: WebSocket, timeoutMs = 2000): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket open timeout"));
    }, timeoutMs);

    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ws.off("open", onOpen);
      ws.off("error", onError);
    };

    ws.on("open", onOpen);
    ws.on("error", onError);
  });
}

const inboxes = new WeakMap<WebSocket, FrameInbox>();

function ensureInbox(ws: WebSocket): FrameInbox {
  const existing = inboxes.get(ws);
  if (existing) {
    return existing;
  }

  const inbox: FrameInbox = {
    queue: [],
    waiters: [],
  };

  ws.on("message", (raw) => {
    try {
      const text = typeof raw === "string" ? raw : raw.toString();
      const frame = JSON.parse(text) as GatewayFrame;
      const waiter = inbox.waiters.shift();
      if (waiter) {
        waiter(frame);
        return;
      }
      inbox.queue.push(frame);
    } catch {
      // Ignore malformed test frames.
    }
  });

  inboxes.set(ws, inbox);
  return inbox;
}

async function nextFrame(ws: WebSocket, timeoutMs = 2500): Promise<GatewayFrame> {
  const inbox = ensureInbox(ws);
  if (inbox.queue.length > 0) {
    return inbox.queue.shift() as GatewayFrame;
  }

  return await new Promise<GatewayFrame>((resolve, reject) => {
    const waiter = (frame: GatewayFrame) => {
      clearTimeout(timeout);
      resolve(frame);
    };

    const timeout = setTimeout(() => {
      const idx = inbox.waiters.indexOf(waiter);
      if (idx >= 0) {
        inbox.waiters.splice(idx, 1);
      }
      reject(new Error("Timed out waiting for gateway frame"));
    }, timeoutMs);

    inbox.waiters.push(waiter);
  });
}

function sendRequest(
  ws: WebSocket,
  request: { id: string; method: string; params?: Record<string, unknown> },
): void {
  ws.send(
    JSON.stringify({
      type: "req",
      id: request.id,
      method: request.method,
      params: request.params ?? {},
    }),
  );
}

async function connectClient(ws: WebSocket, token: string, protocol = 3): Promise<GatewayFrame> {
  ensureInbox(ws);
  sendRequest(ws, {
    id: "connect",
    method: "connect",
    params: {
      minProtocol: protocol,
      maxProtocol: protocol,
      client: {
        id: "cli",
        version: "1.0.0",
      },
      auth: { token },
    },
  });
  return await nextFrame(ws);
}

async function waitForChatState(
  ws: WebSocket,
  state: "delta" | "final" | "aborted" | "error",
  timeoutMs = 3000,
): Promise<GatewayFrame> {
  const start = Date.now();
  while (true) {
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) {
      throw new Error(`Timed out waiting for chat event state=${state}`);
    }
    const frame = await nextFrame(ws, remaining);
    if (frame.type !== "event" || frame.event !== "chat") {
      continue;
    }
    const payload =
      frame.payload && typeof frame.payload === "object"
        ? (frame.payload as Record<string, unknown>)
        : {};
    if (payload.state === state) {
      return frame;
    }
  }
}

const activeSockets = new Set<WebSocket>();

afterEach(async () => {
  for (const socket of activeSockets) {
    try {
      socket.terminate();
    } catch {
      // Best effort.
    }
  }
  activeSockets.clear();
});

describe("embedded-gateway protocol", () => {
  it("rejects invalid desktop token during connect", async () => {
    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", { aiProviderOverride: null });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);

      const frame = await connectClient(ws, "wrong-token");
      expect(frame.type).toBe("res");
      expect(frame.ok).toBe(false);
      expect((frame.error as Record<string, unknown>).code).toBe(401);
    } finally {
      await gateway.stop();
    }
  });

  it("rejects incompatible protocol versions during connect", async () => {
    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", { aiProviderOverride: null });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);

      const frame = await connectClient(ws, "test-token", 4);
      expect(frame.type).toBe("res");
      expect(frame.ok).toBe(false);
      expect((frame.error as Record<string, unknown>).code).toBe(426);
    } finally {
      await gateway.stop();
    }
  });

  it("blocks chat.send before connect and serves fallback after authorized connect", async () => {
    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", { aiProviderOverride: null });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);

      sendRequest(ws, {
        id: "chat-before-connect",
        method: "chat.send",
        params: { sessionKey: "default", message: "hello", deliver: true },
      });
      const unauthorized = await nextFrame(ws);
      expect(unauthorized.ok).toBe(false);
      expect((unauthorized.error as Record<string, unknown>).code).toBe(401);

      const connectFrame = await connectClient(ws, "test-token");
      expect(connectFrame.ok).toBe(true);
      expect((connectFrame.payload as Record<string, unknown>).type).toBe("hello-ok");

      sendRequest(ws, {
        id: "chat-after-connect",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "hello from terminal",
          deliver: true,
          idempotencyKey: "run-1",
        },
      });

      const started = await nextFrame(ws);
      expect(started.ok).toBe(true);
      expect((started.payload as Record<string, unknown>).runId).toBe("run-1");

      const finalEvent = await waitForChatState(ws, "final");
      const payload = finalEvent.payload as Record<string, unknown>;
      expect(payload.runId).toBe("run-1");
      expect(typeof payload.text).toBe("string");
      expect((payload.text as string).length).toBeGreaterThan(0);
    } finally {
      await gateway.stop();
    }
  });
});

describe("embedded-gateway session and lifecycle", () => {
  it("keeps sessions isolated per websocket connection", async () => {
    const provider: AIProvider = {
      chat: async (messages, onChunk) => {
        const lastUser =
          [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
        const text = `reply:${messages.length}:${lastUser}`;
        if (onChunk) {
          await onChunk(text);
        }
        return text;
      },
    };

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", { aiProviderOverride: provider });

    try {
      await gateway.start();
      const ws1 = new WebSocket(`ws://127.0.0.1:${port}`);
      const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws1);
      activeSockets.add(ws2);
      await waitForSocketOpen(ws1);
      await waitForSocketOpen(ws2);

      expect((await connectClient(ws1, "test-token")).ok).toBe(true);
      expect((await connectClient(ws2, "test-token")).ok).toBe(true);

      sendRequest(ws1, {
        id: "ws1-chat-1",
        method: "chat.send",
        params: {
          sessionKey: "same-session-key",
          message: "first",
          deliver: true,
          idempotencyKey: "ws1-run-1",
        },
      });
      await nextFrame(ws1); // started
      const ws1Delta1 = await waitForChatState(ws1, "delta");
      expect((ws1Delta1.payload as Record<string, unknown>).text).toBe("reply:1:first");
      await waitForChatState(ws1, "final");

      sendRequest(ws1, {
        id: "ws1-chat-2",
        method: "chat.send",
        params: {
          sessionKey: "same-session-key",
          message: "second",
          deliver: true,
          idempotencyKey: "ws1-run-2",
        },
      });
      await nextFrame(ws1); // started
      const ws1Delta2 = await waitForChatState(ws1, "delta");
      expect((ws1Delta2.payload as Record<string, unknown>).text).toBe("reply:3:second");
      await waitForChatState(ws1, "final");

      sendRequest(ws2, {
        id: "ws2-chat-1",
        method: "chat.send",
        params: {
          sessionKey: "same-session-key",
          message: "other",
          deliver: true,
          idempotencyKey: "ws2-run-1",
        },
      });
      await nextFrame(ws2); // started
      const ws2Delta = await waitForChatState(ws2, "delta");
      expect((ws2Delta.payload as Record<string, unknown>).text).toBe("reply:1:other");
      await waitForChatState(ws2, "final");
    } finally {
      await gateway.stop();
    }
  });

  it("aborts in-flight chat when websocket closes unexpectedly", async () => {
    let aborted = false;
    const provider: AIProvider = {
      chat: async (_messages, onChunk, signal) => {
        return await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(async () => {
            if (signal?.aborted) {
              return;
            }
            if (onChunk) {
              await onChunk("late");
            }
            resolve("late");
          }, 1000);

          signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
      },
    };

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", { aiProviderOverride: provider });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);
      expect((await connectClient(ws, "test-token")).ok).toBe(true);

      sendRequest(ws, {
        id: "chat-run",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "long-running",
          deliver: true,
          idempotencyKey: "abort-run",
        },
      });
      await nextFrame(ws); // started
      ws.terminate();

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(aborted).toBe(true);
    } finally {
      await gateway.stop();
    }
  });

  it("emits state-changed lifecycle transitions", async () => {
    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", { aiProviderOverride: null });
    const statuses: string[] = [];
    const listener = (state: { status: string }) => {
      statuses.push(state.status);
    };
    gateway.on("state-changed", listener);

    try {
      await gateway.start();
      await gateway.stop();

      expect(statuses).toContain("starting");
      expect(statuses).toContain("running");
      expect(statuses).toContain("stopping");
      expect(statuses).toContain("stopped");
    } finally {
      gateway.off("state-changed", listener);
      await gateway.stop();
    }
  });
});
