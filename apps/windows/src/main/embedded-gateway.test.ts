import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { EmbeddedGateway, type AIProvider } from "./embedded-gateway.js";
import { appendLandingNote, ensureLandingWorkspaceFiles } from "./landing.js";

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
const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cydeck-gateway-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const socket of activeSockets) {
    try {
      socket.terminate();
    } catch {
      // Best effort.
    }
  }
  activeSockets.clear();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

  it("supports google runtime provider without OpenAI compatibility mode", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        expect(url).toContain("/models/gemini-2.0-flash:generateContent");
        expect(url).toContain("key=gemini-test-key");

        const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        const contents = requestBody.contents as Array<Record<string, unknown>>;
        expect(Array.isArray(contents)).toBe(true);
        expect(String(contents[0]?.role)).toBe("user");

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "hello from gemini-native" }],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    );

    Object.assign(globalThis, { fetch: fetchMock });

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", {
      runtimeProvider: {
        provider: "google",
        apiKey: "gemini-test-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.0-flash",
        maxTokens: 2048,
      },
    });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);
      expect((await connectClient(ws, "test-token")).ok).toBe(true);

      sendRequest(ws, {
        id: "google-chat",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "hello from user",
          deliver: true,
          idempotencyKey: "google-run-1",
        },
      });

      const started = await nextFrame(ws);
      expect(started.ok).toBe(true);
      expect((started.payload as Record<string, unknown>).runId).toBe("google-run-1");

      const delta = await waitForChatState(ws, "delta");
      expect((delta.payload as Record<string, unknown>).text).toBe("hello from gemini-native");
      await waitForChatState(ws, "final");

      expect(fetchMock).toHaveBeenCalled();
    } finally {
      await gateway.stop();
      Object.assign(globalThis, { fetch: originalFetch });
    }
  });

  it("supports anthropic runtime provider", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        expect(url).toContain("/messages");
        expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("anthropic-test-key");

        const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        expect(requestBody.model).toBe("claude-3-5-haiku-latest");
        expect(Array.isArray(requestBody.messages)).toBe(true);

        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "hello from anthropic" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    );

    Object.assign(globalThis, { fetch: fetchMock });

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", {
      runtimeProvider: {
        provider: "anthropic",
        apiKey: "anthropic-test-key",
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-3-5-haiku-latest",
        maxTokens: 2048,
      },
    });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);
      expect((await connectClient(ws, "test-token")).ok).toBe(true);

      sendRequest(ws, {
        id: "anthropic-chat",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "hello from user",
          deliver: true,
          idempotencyKey: "anthropic-run-1",
        },
      });

      await nextFrame(ws); // started
      const delta = await waitForChatState(ws, "delta");
      expect((delta.payload as Record<string, unknown>).text).toBe("hello from anthropic");
      await waitForChatState(ws, "final");
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      await gateway.stop();
      Object.assign(globalThis, { fetch: originalFetch });
    }
  });

  it("uses HTTPS_PROXY dispatcher for google runtime provider when proxy is configured", async () => {
    const originalFetch = globalThis.fetch;
    const originalHttpsProxy = process.env.HTTPS_PROXY;
    const originalNoProxy = process.env.NO_PROXY;

    process.env.HTTPS_PROXY = "http://127.0.0.1:7890";
    delete process.env.NO_PROXY;

    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const requestInit = init as RequestInit & { dispatcher?: unknown };
        expect(requestInit.dispatcher).toBeDefined();
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "proxy-ok" }],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    );

    Object.assign(globalThis, { fetch: fetchMock });

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", {
      runtimeProvider: {
        provider: "google",
        apiKey: "gemini-test-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.0-flash",
        maxTokens: 2048,
      },
    });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);
      expect((await connectClient(ws, "test-token")).ok).toBe(true);

      sendRequest(ws, {
        id: "proxy-google-chat",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "hello via proxy",
          deliver: true,
          idempotencyKey: "proxy-run-1",
        },
      });

      await nextFrame(ws); // started
      const delta = await waitForChatState(ws, "delta");
      expect((delta.payload as Record<string, unknown>).text).toBe("proxy-ok");
      await waitForChatState(ws, "final");
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      await gateway.stop();
      Object.assign(globalThis, { fetch: originalFetch });
      if (originalHttpsProxy === undefined) {
        delete process.env.HTTPS_PROXY;
      } else {
        process.env.HTTPS_PROXY = originalHttpsProxy;
      }
      if (originalNoProxy === undefined) {
        delete process.env.NO_PROXY;
      } else {
        process.env.NO_PROXY = originalNoProxy;
      }
    }
  });

  it("bypasses proxy dispatcher when NO_PROXY matches google host", async () => {
    const originalFetch = globalThis.fetch;
    const originalHttpsProxy = process.env.HTTPS_PROXY;
    const originalNoProxy = process.env.NO_PROXY;

    process.env.HTTPS_PROXY = "http://127.0.0.1:7890";
    process.env.NO_PROXY = "generativelanguage.googleapis.com";

    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const requestInit = init as RequestInit & { dispatcher?: unknown };
        expect(requestInit.dispatcher).toBeUndefined();
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "no-proxy-ok" }],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    );

    Object.assign(globalThis, { fetch: fetchMock });

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", {
      runtimeProvider: {
        provider: "google",
        apiKey: "gemini-test-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.0-flash",
        maxTokens: 2048,
      },
    });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);
      expect((await connectClient(ws, "test-token")).ok).toBe(true);

      sendRequest(ws, {
        id: "no-proxy-google-chat",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "hello no proxy",
          deliver: true,
          idempotencyKey: "no-proxy-run-1",
        },
      });

      await nextFrame(ws); // started
      const delta = await waitForChatState(ws, "delta");
      expect((delta.payload as Record<string, unknown>).text).toBe("no-proxy-ok");
      await waitForChatState(ws, "final");
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      await gateway.stop();
      Object.assign(globalThis, { fetch: originalFetch });
      if (originalHttpsProxy === undefined) {
        delete process.env.HTTPS_PROXY;
      } else {
        process.env.HTTPS_PROXY = originalHttpsProxy;
      }
      if (originalNoProxy === undefined) {
        delete process.env.NO_PROXY;
      } else {
        process.env.NO_PROXY = originalNoProxy;
      }
    }
  });

  it("reloads runtime provider without restarting gateway", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "reloaded-provider-ok" }],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    Object.assign(globalThis, { fetch: fetchMock });

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", {
      runtimeProvider: {
        provider: "google",
        apiKey: "",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.0-flash",
        maxTokens: 2048,
      },
    });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);
      expect((await connectClient(ws, "test-token")).ok).toBe(true);

      sendRequest(ws, {
        id: "chat-before-reload",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "first",
          deliver: true,
          idempotencyKey: "reload-run-1",
        },
      });
      await nextFrame(ws); // started
      const beforeReload = await waitForChatState(ws, "final");
      expect(String((beforeReload.payload as Record<string, unknown>).text)).toContain("apiKey is empty");

      gateway.reloadRuntimeProvider({
        provider: "google",
        apiKey: "gemini-test-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.0-flash",
        maxTokens: 2048,
      });

      sendRequest(ws, {
        id: "chat-after-reload",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "second",
          deliver: true,
          idempotencyKey: "reload-run-2",
        },
      });
      await nextFrame(ws); // started
      const delta = await waitForChatState(ws, "delta");
      expect((delta.payload as Record<string, unknown>).text).toBe("reloaded-provider-ok");
      await waitForChatState(ws, "final");
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      await gateway.stop();
      Object.assign(globalThis, { fetch: originalFetch });
    }
  });
});

describe("embedded-gateway session and lifecycle", () => {
  it("injects landing system prompt into provider messages", async () => {
    const workspace = createTempWorkspace();
    ensureLandingWorkspaceFiles(workspace);
    appendLandingNote(workspace, "soul", "System soul token");

    let capturedMessages: Array<{ role: string; content: string }> = [];
    const provider: AIProvider = {
      chat: async (messages, onChunk) => {
        capturedMessages = messages.map((message) => ({
          role: message.role,
          content: message.content,
        }));
        const text = "ok";
        if (onChunk) {
          await onChunk(text);
        }
        return text;
      },
    };

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", {
      aiProviderOverride: provider,
      workspacePath: workspace,
    });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);
      expect((await connectClient(ws, "test-token")).ok).toBe(true);

      sendRequest(ws, {
        id: "inject-chat",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "hello",
          deliver: true,
          idempotencyKey: "inject-run-1",
        },
      });
      await nextFrame(ws); // started
      await waitForChatState(ws, "final");

      const systemPrompt = capturedMessages.find((message) => message.role === "system")?.content ?? "";
      expect(systemPrompt).toContain("[cydeck:landing-system-prompt]");
      expect(systemPrompt).toContain("### SOUL.md");
      expect(systemPrompt).toContain("System soul token");
    } finally {
      await gateway.stop();
    }
  });

  it("injects agent-hint prompt into provider messages", async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const provider: AIProvider = {
      chat: async (messages, onChunk) => {
        capturedMessages = messages.map((message) => ({
          role: message.role,
          content: message.content,
        }));
        const text = "ok";
        if (onChunk) {
          await onChunk(text);
        }
        return text;
      },
    };

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", {
      aiProviderOverride: provider,
    });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);
      expect((await connectClient(ws, "test-token")).ok).toBe(true);

      sendRequest(ws, {
        id: "hint-chat",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "hello",
          deliver: true,
          idempotencyKey: "hint-run-1",
          agentHint: "claude",
        },
      });
      await nextFrame(ws); // started
      await waitForChatState(ws, "final");

      const hintPrompt =
        capturedMessages.find(
          (message) =>
            message.role === "system" && message.content.includes("[cydeck:agent-hint]"),
        )?.content ?? "";
      expect(hintPrompt).toContain("Preferred agent profile: claude");
    } finally {
      await gateway.stop();
    }
  });

  it("loads MEMORY.md only for private sessions", async () => {
    const workspace = createTempWorkspace();
    ensureLandingWorkspaceFiles(workspace);
    appendLandingNote(workspace, "memory", "Private memory token");

    const capturedRuns: Array<Array<{ role: string; content: string }>> = [];
    const provider: AIProvider = {
      chat: async (messages, onChunk) => {
        capturedRuns.push(
          messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        );
        const text = "ok";
        if (onChunk) {
          await onChunk(text);
        }
        return text;
      },
    };

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", {
      aiProviderOverride: provider,
      workspacePath: workspace,
    });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);
      expect((await connectClient(ws, "test-token")).ok).toBe(true);

      sendRequest(ws, {
        id: "shared-chat",
        method: "chat.send",
        params: {
          sessionKey: "group:team-a",
          message: "hello shared",
          deliver: true,
          idempotencyKey: "shared-run-1",
        },
      });
      await nextFrame(ws); // started
      await waitForChatState(ws, "final");

      sendRequest(ws, {
        id: "private-chat",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "hello private",
          deliver: true,
          idempotencyKey: "private-run-1",
        },
      });
      await nextFrame(ws); // started
      await waitForChatState(ws, "final");

      const sharedSystemPrompt =
        capturedRuns[0]?.find((message) => message.role === "system")?.content ?? "";
      const privateSystemPrompt =
        capturedRuns[1]?.find((message) => message.role === "system")?.content ?? "";

      expect(sharedSystemPrompt).not.toContain("### MEMORY.md");
      expect(sharedSystemPrompt).not.toContain("Private memory token");
      expect(privateSystemPrompt).toContain("### MEMORY.md");
      expect(privateSystemPrompt).toContain("Private memory token");
    } finally {
      await gateway.stop();
    }
  });

  it("injects memory tool context when memory_search finds matches", async () => {
    const workspace = createTempWorkspace();
    ensureLandingWorkspaceFiles(workspace);
    appendLandingNote(workspace, "memory", "Project codename is Atlas");

    let capturedMessages: Array<{ role: string; content: string }> = [];
    const provider: AIProvider = {
      chat: async (messages, onChunk) => {
        capturedMessages = messages.map((message) => ({
          role: message.role,
          content: message.content,
        }));
        const text = "ok";
        if (onChunk) {
          await onChunk(text);
        }
        return text;
      },
    };

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", {
      aiProviderOverride: provider,
      workspacePath: workspace,
    });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);
      expect((await connectClient(ws, "test-token")).ok).toBe(true);

      sendRequest(ws, {
        id: "memory-context-chat",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "What is the Atlas codename?",
          deliver: true,
          idempotencyKey: "memory-context-run",
        },
      });
      await nextFrame(ws); // started
      await waitForChatState(ws, "final");

      const memoryContext = capturedMessages.find(
        (message) => message.role === "system" && message.content.includes("[cydeck:memory-tools]"),
      )?.content;
      expect(memoryContext).toBeDefined();
      expect(memoryContext).toContain("memory_search");
      expect(memoryContext).toContain("Atlas");
    } finally {
      await gateway.stop();
    }
  });

  it("injects realtime context before provider chat for weather prompts", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      expect(url).toContain("wttr.in");
      expect(url).toContain(encodeURIComponent("上海"));
      return new Response(
        JSON.stringify({
          nearest_area: [
            {
              areaName: [{ value: "Shanghai" }],
              country: [{ value: "China" }],
            },
          ],
          current_condition: [
            {
              temp_C: "18",
              FeelsLikeC: "16",
              humidity: "72",
              lang_zh: [{ value: "晴" }],
            },
          ],
          weather: [{ date: "2026-03-07", maxtempC: "20", mintempC: "12" }],
        }),
      );
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    let capturedMessages: Array<{ role: string; content: string }> = [];
    const provider: AIProvider = {
      chat: async (messages, onChunk) => {
        capturedMessages = messages.map((chatMessage) => ({
          role: chatMessage.role,
          content: chatMessage.content,
        }));
        const text = "weather-ok";
        if (onChunk) {
          await onChunk(text);
        }
        return text;
      },
    };

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", {
      aiProviderOverride: provider,
    });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);
      expect((await connectClient(ws, "test-token")).ok).toBe(true);

      sendRequest(ws, {
        id: "realtime-weather-chat",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "上海天气",
          deliver: true,
          idempotencyKey: "realtime-weather-run",
        },
      });
      await nextFrame(ws); // started
      await waitForChatState(ws, "final");

      expect(fetchMock).toHaveBeenCalledOnce();
      const realtimeContext = capturedMessages.find(
        (chatMessage) =>
          chatMessage.role === "system" &&
          chatMessage.content.includes("[cydeck:realtime-context]"),
      )?.content;
      expect(realtimeContext).toContain("Realtime weather context for query: 上海天气");
      expect(realtimeContext).toContain("Location: Shanghai, China");
      expect(realtimeContext).toContain("Condition: 晴");
    } finally {
      globalThis.fetch = originalFetch;
      await gateway.stop();
    }
  });

  it("supports tools.memory.search and tools.memory.get request handlers", async () => {
    const workspace = createTempWorkspace();
    ensureLandingWorkspaceFiles(workspace);
    appendLandingNote(workspace, "memory", "Atlas release requires phased rollout.");

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", {
      aiProviderOverride: null,
      workspacePath: workspace,
    });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);
      expect((await connectClient(ws, "test-token")).ok).toBe(true);

      sendRequest(ws, {
        id: "memory-search-tool",
        method: "tools.memory.search",
        params: {
          sessionKey: "default",
          query: "atlas rollout",
        },
      });
      const searchResponse = await nextFrame(ws);
      expect(searchResponse.ok).toBe(true);
      const searchPayload = searchResponse.payload as { results?: Array<{ path: string }> };
      expect(searchPayload.results?.length ?? 0).toBeGreaterThan(0);

      sendRequest(ws, {
        id: "memory-get-tool",
        method: "tools.memory.get",
        params: {
          path: "MEMORY.md",
          from: 1,
          lines: 20,
        },
      });
      const getResponse = await nextFrame(ws);
      expect(getResponse.ok).toBe(true);
      const getPayload = getResponse.payload as { text?: string };
      expect(getPayload.text).toContain("Atlas");
    } finally {
      await gateway.stop();
    }
  });

  it("writes session-memory snapshot on session.rotate", async () => {
    const workspace = createTempWorkspace();
    ensureLandingWorkspaceFiles(workspace);

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", {
      aiProviderOverride: null,
      workspacePath: workspace,
    });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);
      expect((await connectClient(ws, "test-token")).ok).toBe(true);

      sendRequest(ws, {
        id: "chat-before-rotate",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "Remember Atlas rollout checklist.",
          deliver: false,
          idempotencyKey: "rotate-run",
        },
      });
      await nextFrame(ws); // started

      sendRequest(ws, {
        id: "rotate-request",
        method: "session.rotate",
        params: {
          fromSessionKey: "default",
        },
      });
      const rotateResponse = await nextFrame(ws);
      expect(rotateResponse.ok).toBe(true);
      const payload = rotateResponse.payload as {
        saved?: boolean;
        relativePath?: string;
      };
      expect(payload.saved).toBe(true);
      expect(payload.relativePath).toBeTypeOf("string");
      const savedPath = payload.relativePath ?? "";
      const diskPath = path.join(workspace, savedPath);
      expect(fs.existsSync(diskPath)).toBe(true);
      const content = fs.readFileSync(diskPath, "utf-8");
      expect(content).toContain("session-rotate");
      expect(content).toContain("Atlas rollout checklist");
    } finally {
      await gateway.stop();
    }
  });

  it("runs pre-compaction flush snapshots when threshold is reached", async () => {
    const workspace = createTempWorkspace();
    ensureLandingWorkspaceFiles(workspace);
    appendLandingNote(workspace, "memory", "Compaction flush test token");

    const provider: AIProvider = {
      chat: async (_messages, onChunk) => {
        const text = "ok";
        if (onChunk) {
          await onChunk(text);
        }
        return text;
      },
    };

    const port = await getFreePort();
    const gateway = new EmbeddedGateway(port, "test-token", {
      aiProviderOverride: provider,
      workspacePath: workspace,
      memoryRuntime: {
        preCompactionMessages: 2,
        autoWriteMessages: 999,
      },
    });

    try {
      await gateway.start();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      activeSockets.add(ws);
      await waitForSocketOpen(ws);
      expect((await connectClient(ws, "test-token")).ok).toBe(true);

      sendRequest(ws, {
        id: "preflush-chat",
        method: "chat.send",
        params: {
          sessionKey: "default",
          message: "Trigger pre compaction flush.",
          deliver: true,
          idempotencyKey: "preflush-run",
        },
      });
      await nextFrame(ws); // started
      await waitForChatState(ws, "final");

      const memoryDir = path.join(workspace, "memory");
      const files = fs.readdirSync(memoryDir).filter((entry) => entry.endsWith(".md"));
      expect(files.length).toBeGreaterThan(0);
      const firstSnapshot = files[0];
      if (!firstSnapshot) {
        throw new Error("Expected snapshot file");
      }
      const snapshot = fs.readFileSync(path.join(memoryDir, firstSnapshot), "utf-8");
      expect(snapshot).toContain("pre-compaction-flush");
    } finally {
      await gateway.stop();
    }
  });

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
      expect((ws1Delta1.payload as Record<string, unknown>).text).toBe("reply:2:first");
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
      expect((ws1Delta2.payload as Record<string, unknown>).text).toBe("reply:4:second");
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
      expect((ws2Delta.payload as Record<string, unknown>).text).toBe("reply:2:other");
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
