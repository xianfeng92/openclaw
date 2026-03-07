import { describe, expect, it, vi } from "vitest";
import {
  createConnectOkPayload,
  parseGatewayRequest,
  sendGatewayChatEvent,
  sendGatewayResponse,
  validateConnectRequest,
} from "./embedded-gateway.protocol.js";

describe("embedded-gateway protocol helpers", () => {
  it("parses valid request frames and rejects malformed input", () => {
    const parsed = parseGatewayRequest(
      Buffer.from(
        JSON.stringify({
          type: "req",
          id: "abc",
          method: "chat.send",
          params: { message: "hello" },
        }),
      ),
    );

    expect(parsed).toMatchObject({
      type: "req",
      id: "abc",
      method: "chat.send",
    });
    expect(parseGatewayRequest(Buffer.from("{bad json"))).toBeNull();
    expect(
      parseGatewayRequest(
        Buffer.from(
          JSON.stringify({
            type: "req",
            id: "abc",
            method: "",
          }),
        ),
      ),
    ).toBeNull();
  });

  it("validates protocol and token during connect", () => {
    expect(
      validateConnectRequest({
        expectedToken: "secret",
        params: {
          minProtocol: 4,
        },
      }),
    ).toMatchObject({
      ok: false,
      code: 426,
    });

    expect(
      validateConnectRequest({
        expectedToken: "secret",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: { id: "cli" },
        },
        auth: { token: "secret" },
      }),
    ).toEqual({
      ok: true,
      clientId: "cli",
    });
  });

  it("serializes response and chat event frames", () => {
    const send = vi.fn();
    const ws = {
      readyState: 1,
      send,
    } as const;

    expect(sendGatewayResponse(ws as never, "req-1", createConnectOkPayload())).toBe(true);
    expect(
      sendGatewayChatEvent(ws as never, {
        runId: "run-1",
        sessionKey: "default",
        state: "final",
        text: "done",
      }),
    ).toBe(true);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toContain('"ok":true');
    expect(send.mock.calls[1]?.[0]).toContain('"event":"chat"');
  });
});
