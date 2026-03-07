import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext, GatewayRequestHandlerOptions, RespondFn } from "./types.js";

const mocks = vi.hoisted(() => ({
  buildCyDeckAgentHintSystemPrompt: vi.fn(),
  buildCyDeckLandingSystemPrompt: vi.fn(),
  createReplyPrefixOptions: vi.fn(),
  dispatchInboundMessage: vi.fn(),
  extractCyDeckTranscriptMessages: vi.fn(),
  getFollowupQueueStatus: vi.fn(),
  isCyDeckClient: vi.fn(),
  isEmbeddedPiRunActive: vi.fn(),
  loadSessionEntry: vi.fn(),
  normalizeCyDeckAgentHint: vi.fn(),
  readSessionMessages: vi.fn(),
  resolveAgentTimeoutMs: vi.fn(),
  resolveCyDeckRealtimeQuery: vi.fn(),
  resolveCyDeckWorkspacePath: vi.fn(),
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
  readSessionMessages: mocks.readSessionMessages,
  resolveSessionModelRef: () => ({ provider: "anthropic", model: "claude-opus-4-1" }),
}));

vi.mock("../cydeck-memory.js", () => ({
  buildCyDeckLandingSystemPrompt: mocks.buildCyDeckLandingSystemPrompt,
  extractCyDeckTranscriptMessages: mocks.extractCyDeckTranscriptMessages,
}));

vi.mock("../cydeck-realtime.js", () => ({
  resolveCyDeckRealtimeQuery: mocks.resolveCyDeckRealtimeQuery,
}));

vi.mock("../cydeck-runtime.js", () => ({
  buildCyDeckAgentHintSystemPrompt: mocks.buildCyDeckAgentHintSystemPrompt,
  isCyDeckClient: mocks.isCyDeckClient,
  normalizeCyDeckAgentHint: mocks.normalizeCyDeckAgentHint,
  resolveCyDeckWorkspacePath: mocks.resolveCyDeckWorkspacePath,
}));

import { chatHandlers } from "./chat.js";

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
  agentHint?: string;
  client?: GatewayRequestHandlerOptions["client"];
  context: GatewayRequestContext;
  message: string;
  respond: RespondFn;
  runId: string;
  sessionKey: string;
}) {
  await chatHandlers["chat.send"]({
    req: { type: "req", id: "req-chat-send", method: "chat.send" },
    params: {
      agentHint: params.agentHint,
      idempotencyKey: params.runId,
      message: params.message,
      sessionKey: params.sessionKey,
    },
    client: params.client ?? null,
    context: params.context,
    respond: params.respond,
    isWebchatConnect: () => false,
  } as unknown as GatewayRequestHandlerOptions);
}

describe("chat.send CyDeck runtime path", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.buildCyDeckAgentHintSystemPrompt.mockReset();
    mocks.buildCyDeckLandingSystemPrompt.mockReset();
    mocks.createReplyPrefixOptions.mockReset();
    mocks.dispatchInboundMessage.mockReset();
    mocks.extractCyDeckTranscriptMessages.mockReset();
    mocks.getFollowupQueueStatus.mockReset();
    mocks.isCyDeckClient.mockReset();
    mocks.isEmbeddedPiRunActive.mockReset();
    mocks.loadSessionEntry.mockReset();
    mocks.normalizeCyDeckAgentHint.mockReset();
    mocks.readSessionMessages.mockReset();
    mocks.resolveAgentTimeoutMs.mockReset();
    mocks.resolveCyDeckRealtimeQuery.mockReset();
    mocks.resolveCyDeckWorkspacePath.mockReset();
    mocks.resolveSendPolicy.mockReset();
    mocks.resolveSessionAgentId.mockReset();

    mocks.buildCyDeckAgentHintSystemPrompt.mockImplementation((hint?: string) =>
      hint ? `[cydeck:agent-hint]\nPreferred agent profile: ${hint}.` : "",
    );
    mocks.buildCyDeckLandingSystemPrompt.mockReturnValue("Landing prompt");
    mocks.createReplyPrefixOptions.mockReturnValue({ onModelSelected: undefined });
    mocks.dispatchInboundMessage.mockResolvedValue({
      queuedFinal: false,
      counts: { tool: 0, block: 0, final: 0 },
    });
    mocks.extractCyDeckTranscriptMessages.mockReturnValue([]);
    mocks.getFollowupQueueStatus.mockReturnValue({
      depth: 0,
      draining: false,
      droppedCount: 0,
    });
    mocks.isCyDeckClient.mockReturnValue(true);
    mocks.isEmbeddedPiRunActive.mockReturnValue(false);
    mocks.loadSessionEntry.mockReturnValue({
      cfg: {},
      entry: { sessionId: "sess-cydeck" },
      storePath: undefined,
    });
    mocks.normalizeCyDeckAgentHint.mockImplementation((value: unknown) =>
      typeof value === "string" ? value.trim().toLowerCase() : undefined,
    );
    mocks.readSessionMessages.mockReturnValue([]);
    mocks.resolveAgentTimeoutMs.mockReturnValue(60_000);
    mocks.resolveCyDeckRealtimeQuery.mockResolvedValue(null);
    mocks.resolveCyDeckWorkspacePath.mockReturnValue("C:/workspace");
    mocks.resolveSendPolicy.mockReturnValue("allow");
    mocks.resolveSessionAgentId.mockReturnValue("main");
  });

  it("augments BodyForAgent with landing prompt and agent hint", async () => {
    const { context } = makeContext();
    const respond = vi.fn<RespondFn>();

    await callChatSend({
      agentHint: "Claude",
      client: {
        connect: {
          client: { id: "cli", displayName: "CyDeck Terminal", mode: "cydeck" },
          caps: ["desktop.cydeck"],
        } as never,
      },
      context,
      message: "hello from cydeck",
      respond,
      runId: "run-cydeck-1",
      sessionKey: "main",
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      { runId: "run-cydeck-1", status: "started" },
      undefined,
      { runId: "run-cydeck-1" },
    );
    expect(mocks.dispatchInboundMessage).toHaveBeenCalledTimes(1);

    const dispatchArg = mocks.dispatchInboundMessage.mock.calls[0]?.[0] as {
      ctx?: { Body?: string; BodyForAgent?: string };
    };
    expect(dispatchArg.ctx?.Body).toBe("hello from cydeck");
    expect(dispatchArg.ctx?.BodyForAgent).toContain("[cydeck:landing-system-prompt]");
    expect(dispatchArg.ctx?.BodyForAgent).toContain("Landing prompt");
    expect(dispatchArg.ctx?.BodyForAgent).toContain("Preferred agent profile: claude.");
    expect(dispatchArg.ctx?.BodyForAgent).toContain("User request:");
  });

  it("returns realtime results directly without dispatching the agent runtime", async () => {
    const { context, broadcast, nodeSendToSession } = makeContext();
    const respond = vi.fn<RespondFn>();
    mocks.resolveCyDeckRealtimeQuery.mockResolvedValue({
      intent: "weather",
      assistantText: "Shanghai weather snapshot",
    });

    await callChatSend({
      client: {
        connect: {
          client: { id: "cli", displayName: "CyDeck Terminal", mode: "cydeck" },
          caps: ["desktop.cydeck"],
        } as never,
      },
      context,
      message: "上海天气",
      respond,
      runId: "run-cydeck-2",
      sessionKey: "main",
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      { runId: "run-cydeck-2", status: "started" },
      undefined,
      { runId: "run-cydeck-2" },
    );
    expect(mocks.dispatchInboundMessage).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith(
      "chat",
      expect.objectContaining({
        runId: "run-cydeck-2",
        sessionKey: "main",
        state: "final",
        message: expect.objectContaining({
          role: "assistant",
          content: [expect.objectContaining({ text: "Shanghai weather snapshot" })],
        }),
      }),
    );
    expect(nodeSendToSession).toHaveBeenCalledWith(
      "main",
      "chat",
      expect.objectContaining({
        runId: "run-cydeck-2",
        state: "final",
      }),
    );
    expect(context.neuroMetrics.clearRun).toHaveBeenCalledWith("run-cydeck-2");
  });
});
