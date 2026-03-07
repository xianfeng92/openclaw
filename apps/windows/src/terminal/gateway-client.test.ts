import { describe, expect, it, vi } from "vitest";
import { TerminalGatewayClient } from "./gateway-client.js";

describe("TerminalGatewayClient.sendMessage", () => {
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
