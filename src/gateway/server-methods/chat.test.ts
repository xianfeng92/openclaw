import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext, GatewayRequestHandlerOptions, RespondFn } from "./types.js";

const mocks = vi.hoisted(() => ({
  createReplyPrefixOptions: vi.fn(),
  dispatchInboundMessage: vi.fn(),
  getFollowupQueueDepth: vi.fn(),
  getFollowupQueueStatus: vi.fn(),
  isEmbeddedPiRunActive: vi.fn(),
  loadSessionEntry: vi.fn(),
  resolveAgentTimeoutMs: vi.fn(),
  resolveSendPolicy: vi.fn(),
  resolveSessionAgentId: vi.fn(),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveSessionAgentId: mocks.resolveSessionAgentId,
}));

vi.mock("../../agents/timeout.js", () => ({
  resolveAgentTimeoutMs: mocks.resolveAgentTimeoutMs,
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  isEmbeddedPiRunActive: mocks.isEmbeddedPiRunActive,
}));

vi.mock("../../auto-reply/dispatch.js", () => ({
  dispatchInboundMessage: mocks.dispatchInboundMessage,
}));

vi.mock("../../auto-reply/reply/queue.js", () => ({
  getFollowupQueueDepth: mocks.getFollowupQueueDepth,
  getFollowupQueueStatus: mocks.getFollowupQueueStatus,
}));

vi.mock("../../channels/reply-prefix.js", () => ({
  createReplyPrefixOptions: mocks.createReplyPrefixOptions,
}));

vi.mock("../../sessions/send-policy.js", () => ({
  resolveSendPolicy: mocks.resolveSendPolicy,
}));

vi.mock("../session-utils.js", () => ({
  capArrayByJsonBytes: (items: unknown[]) => ({ items }),
  loadSessionEntry: mocks.loadSessionEntry,
  readSessionMessages: () => [],
  resolveSessionModelRef: () => ({ provider: "anthropic", model: "claude-opus-4-1" }),
}));

import { chatHandlers } from "./chat.js";

function waitFor(predicate: () => boolean, timeoutMs = 2500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("timeout waiting for condition"));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

function makeContext(): {
  context: GatewayRequestContext;
  broadcast: ReturnType<typeof vi.fn>;
  nodeSendToSession: ReturnType<typeof vi.fn>;
} {
  const broadcast = vi.fn();
  const nodeSendToSession = vi.fn();
  const context = {
    addChatRun: vi.fn(),
    agentRunSeq: new Map<string, number>(),
    chatAbortControllers: new Map(),
    chatAbortedRuns: new Map(),
    chatDeltaSentAt: new Map<string, number>(),
    chatRunBuffers: new Map<string, string>(),
    dedupe: new Map(),
    logGateway: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
    neuroMetrics: {
      clearRun: vi.fn(),
      markRunStarted: vi.fn(),
    },
    broadcast,
    nodeSendToSession,
    registerToolEventRecipient: vi.fn(),
    removeChatRun: vi.fn(),
  } as unknown as GatewayRequestContext;
  return { context, broadcast, nodeSendToSession };
}

async function callChatSend(params: {
  context: GatewayRequestContext;
  respond: RespondFn;
  sessionKey: string;
  message: string;
  runId: string;
}) {
  const request = {
    req: { type: "req", id: "req-chat-send", method: "chat.send" },
    params: {
      idempotencyKey: params.runId,
      message: params.message,
      sessionKey: params.sessionKey,
    },
    client: null,
    context: params.context,
    respond: params.respond,
    isWebchatConnect: () => false,
  } as unknown as GatewayRequestHandlerOptions;
  await chatHandlers["chat.send"](request);
}

describe("chat.send dispatcher fallback", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.createReplyPrefixOptions.mockReset();
    mocks.dispatchInboundMessage.mockReset();
    mocks.getFollowupQueueDepth.mockReset();
    mocks.getFollowupQueueStatus.mockReset();
    mocks.isEmbeddedPiRunActive.mockReset();
    mocks.loadSessionEntry.mockReset();
    mocks.resolveAgentTimeoutMs.mockReset();
    mocks.resolveSendPolicy.mockReset();
    mocks.resolveSessionAgentId.mockReset();

    mocks.createReplyPrefixOptions.mockReturnValue({ onModelSelected: undefined });
    mocks.loadSessionEntry.mockReturnValue({
      cfg: {},
      entry: { sessionId: "sess-main" },
      storePath: undefined,
    });
    mocks.getFollowupQueueDepth.mockReturnValue(0);
    mocks.getFollowupQueueStatus.mockReturnValue({
      depth: 0,
      draining: false,
      droppedCount: 0,
    });
    mocks.isEmbeddedPiRunActive.mockReturnValue(false);
    mocks.resolveAgentTimeoutMs.mockReturnValue(60_000);
    mocks.resolveSendPolicy.mockReturnValue("allow");
    mocks.resolveSessionAgentId.mockReturnValue("main");
  });

  it("broadcasts one final chat event for delayed block-only dispatcher replies", async () => {
    const runId = "run-late-block-1";
    const delayedText = "delayed block reply";
    const { context, broadcast, nodeSendToSession } = makeContext();

    mocks.dispatchInboundMessage.mockImplementationOnce(async (opts: unknown) => {
      const dispatchOpts = opts as {
        dispatcher: { sendBlockReply: (payload: { text?: string }) => boolean };
      };
      setTimeout(() => {
        dispatchOpts.dispatcher.sendBlockReply({ text: delayedText });
      }, 15);
      return { queuedFinal: false, counts: { tool: 0, block: 1, final: 0 } };
    });

    const respond = vi.fn<RespondFn>();
    await callChatSend({
      context,
      respond,
      sessionKey: "main",
      message: "hello",
      runId,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      { runId, status: "started" },
      undefined,
      { runId },
    );

    await waitFor(
      () =>
        broadcast.mock.calls.some(([event, payload]) => {
          const chatPayload = payload as { runId?: string; state?: string };
          return event === "chat" && chatPayload.runId === runId && chatPayload.state === "final";
        }),
      3000,
    );

    const finalCalls = broadcast.mock.calls.filter(([event, payload]) => {
      const chatPayload = payload as { runId?: string; state?: string };
      return event === "chat" && chatPayload.runId === runId && chatPayload.state === "final";
    });
    expect(finalCalls).toHaveLength(1);

    const finalPayload = finalCalls[0][1] as {
      message?: {
        content?: Array<{ text?: string }>;
      };
    };
    expect(finalPayload.message?.content?.[0]?.text ?? "").toContain(delayedText);
    expect(nodeSendToSession).toHaveBeenCalledTimes(1);
  });

  it("waits for queued followup replies before emitting fallback error", async () => {
    const runId = "run-queued-followup-1";
    const delayedText = "queued followup reply";
    const { context, broadcast, nodeSendToSession } = makeContext();
    const startedAt = Date.now();

    mocks.isEmbeddedPiRunActive.mockImplementation(
      () => Date.now() - startedAt < 3300,
    );
    mocks.getFollowupQueueStatus.mockImplementation(() => ({
      depth: Date.now() - startedAt < 3300 ? 1 : 0,
      draining: false,
      droppedCount: 0,
    }));
    mocks.dispatchInboundMessage.mockImplementationOnce(async (opts: unknown) => {
      const dispatchOpts = opts as {
        dispatcher: { sendBlockReply: (payload: { text?: string }) => boolean };
      };
      setTimeout(() => {
        dispatchOpts.dispatcher.sendBlockReply({ text: delayedText });
      }, 3300);
      return { queuedFinal: false, counts: { tool: 0, block: 1, final: 0 } };
    });

    const respond = vi.fn<RespondFn>();
    await callChatSend({
      context,
      respond,
      sessionKey: "main",
      message: "hello",
      runId,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      { runId, status: "started" },
      undefined,
      { runId },
    );

    await waitFor(
      () =>
        broadcast.mock.calls.some(([event, payload]) => {
          const chatPayload = payload as { runId?: string; state?: string };
          return event === "chat" && chatPayload.runId === runId && chatPayload.state === "final";
        }),
      7500,
    );

    const errorCalls = broadcast.mock.calls.filter(([event, payload]) => {
      const chatPayload = payload as { runId?: string; state?: string };
      return event === "chat" && chatPayload.runId === runId && chatPayload.state === "error";
    });
    expect(errorCalls).toHaveLength(0);

    const finalCalls = broadcast.mock.calls.filter(([event, payload]) => {
      const chatPayload = payload as { runId?: string; state?: string };
      return event === "chat" && chatPayload.runId === runId && chatPayload.state === "final";
    });
    expect(finalCalls).toHaveLength(1);

    const finalPayload = finalCalls[0][1] as {
      message?: {
        content?: Array<{ text?: string }>;
      };
    };
    expect(finalPayload.message?.content?.[0]?.text ?? "").toContain(delayedText);
    expect(nodeSendToSession).toHaveBeenCalledTimes(1);
  });

  it("waits while followup queue is draining even if queue depth is zero", async () => {
    const runId = "run-queued-draining-1";
    const delayedText = "queued draining reply";
    const { context, broadcast, nodeSendToSession } = makeContext();
    const startedAt = Date.now();

    mocks.isEmbeddedPiRunActive.mockReturnValue(false);
    mocks.getFollowupQueueStatus.mockImplementation(() => ({
      depth: 0,
      draining: Date.now() - startedAt < 3300,
      droppedCount: 0,
    }));
    mocks.dispatchInboundMessage.mockImplementationOnce(async (opts: unknown) => {
      const dispatchOpts = opts as {
        dispatcher: { sendBlockReply: (payload: { text?: string }) => boolean };
      };
      setTimeout(() => {
        dispatchOpts.dispatcher.sendBlockReply({ text: delayedText });
      }, 3300);
      return { queuedFinal: false, counts: { tool: 0, block: 1, final: 0 } };
    });

    const respond = vi.fn<RespondFn>();
    await callChatSend({
      context,
      respond,
      sessionKey: "main",
      message: "hello",
      runId,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      { runId, status: "started" },
      undefined,
      { runId },
    );

    await waitFor(
      () =>
        broadcast.mock.calls.some(([event, payload]) => {
          const chatPayload = payload as { runId?: string; state?: string };
          return event === "chat" && chatPayload.runId === runId && chatPayload.state === "final";
        }),
      7500,
    );

    const errorCalls = broadcast.mock.calls.filter(([event, payload]) => {
      const chatPayload = payload as { runId?: string; state?: string };
      return event === "chat" && chatPayload.runId === runId && chatPayload.state === "error";
    });
    expect(errorCalls).toHaveLength(0);
    expect(nodeSendToSession).toHaveBeenCalledTimes(1);
  });

  it("does not emit fallback error when chat delta arrives after dispatch settle", async () => {
    const runId = "run-late-delta-1";
    const { context, broadcast } = makeContext();

    mocks.dispatchInboundMessage.mockImplementationOnce(async () => {
      setTimeout(() => {
        context.chatDeltaSentAt.set(runId, Date.now());
      }, 2000);
      return { queuedFinal: false, counts: { tool: 0, block: 0, final: 0 } };
    });

    const respond = vi.fn<RespondFn>();
    await callChatSend({
      context,
      respond,
      sessionKey: "main",
      message: "hello",
      runId,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      { runId, status: "started" },
      undefined,
      { runId },
    );

    await new Promise((resolve) => setTimeout(resolve, 3600));

    const errorCalls = broadcast.mock.calls.filter(([event, payload]) => {
      const chatPayload = payload as { runId?: string; state?: string };
      return event === "chat" && chatPayload.runId === runId && chatPayload.state === "error";
    });
    expect(errorCalls).toHaveLength(0);
  });

  it("does not broadcast fallback reply when agent delta already exists", async () => {
    const runId = "run-with-delta-1";
    const { context, broadcast, nodeSendToSession } = makeContext();

    mocks.dispatchInboundMessage.mockImplementationOnce(async (opts: unknown) => {
      const dispatchOpts = opts as {
        dispatcher: { sendBlockReply: (payload: { text?: string }) => boolean };
        replyOptions?: { onAgentRunStart?: (sessionId: string) => void };
      };
      dispatchOpts.replyOptions?.onAgentRunStart?.("agent-run-1");
      context.chatDeltaSentAt.set(runId, Date.now());
      setTimeout(() => {
        dispatchOpts.dispatcher.sendBlockReply({ text: "late block should not broadcast" });
      }, 15);
      return { queuedFinal: false, counts: { tool: 0, block: 1, final: 0 } };
    });

    const respond = vi.fn<RespondFn>();
    await callChatSend({
      context,
      respond,
      sessionKey: "main",
      message: "hello",
      runId,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      { runId, status: "started" },
      undefined,
      { runId },
    );

    await new Promise((resolve) => setTimeout(resolve, 350));

    const finalCalls = broadcast.mock.calls.filter(([event, payload]) => {
      const chatPayload = payload as { runId?: string; state?: string };
      return event === "chat" && chatPayload.runId === runId && chatPayload.state === "final";
    });
    expect(finalCalls).toHaveLength(0);
    expect(nodeSendToSession).toHaveBeenCalledTimes(0);
  });

  it("emits fallback chat error when dispatcher produces no visible reply", async () => {
    const runId = "run-no-reply-1";
    const { context, broadcast, nodeSendToSession } = makeContext();

    mocks.dispatchInboundMessage.mockImplementationOnce(async () => {
      return { queuedFinal: false, counts: { tool: 0, block: 0, final: 0 } };
    });

    const respond = vi.fn<RespondFn>();
    await callChatSend({
      context,
      respond,
      sessionKey: "main",
      message: "hello",
      runId,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      { runId, status: "started" },
      undefined,
      { runId },
    );

    await waitFor(
      () =>
        broadcast.mock.calls.some(([event, payload]) => {
          const chatPayload = payload as {
            runId?: string;
            state?: string;
            errorMessage?: string;
          };
          return (
            event === "chat" &&
            chatPayload.runId === runId &&
            chatPayload.state === "error" &&
            chatPayload.errorMessage === "no response generated"
          );
        }),
      4500,
    );

    const errorCalls = broadcast.mock.calls.filter(([event, payload]) => {
      const chatPayload = payload as { runId?: string; state?: string };
      return event === "chat" && chatPayload.runId === runId && chatPayload.state === "error";
    });
    expect(errorCalls).toHaveLength(1);
    expect(nodeSendToSession).toHaveBeenCalledTimes(1);
  });
});
